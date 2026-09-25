use crate::indexeur::{self, Resultat};
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebouncedEventKind};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::{HashSet, VecDeque};
use std::fs;
use std::io::Write;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};

/// Connexion dédiée au thread d'indexation : attend (au lieu d'échouer)
/// quand l'interface écrit en même temps dans la base. `synchronous =
/// NORMAL` : en mode WAL, la base ne peut pas être corrompue ; au pire une
/// coupure de courant perd les dernières secondes d'indexation, qui sont
/// simplement refaites au scan suivant. Avec le réglage par défaut (FULL),
/// chaque validation force une écriture physique -- très lent sur Windows.
fn ouvrir_base(chemin_db: &str, journal: &Journal) -> Option<Connection> {
    match Connection::open(chemin_db) {
        Ok(conn) => {
            let _ = conn.busy_timeout(Duration::from_secs(10));
            let _ = conn.pragma_update(None, "synchronous", "NORMAL");
            Some(conn)
        }
        Err(e) => {
            journal.ecrire(&format!("Impossible d'ouvrir la base: {e}"));
            None
        }
    }
}

// ---------------------------------------------------------------------------
// Journal d'indexation
// ---------------------------------------------------------------------------

/// Taille au-delà de laquelle le journal est archivé (indexation.old.log).
const TAILLE_MAX_JOURNAL: u64 = 5 * 1024 * 1024;

/// Journal texte de l'indexation : une app Windows n'a pas de console, les
/// messages d'erreur (eprintln) y sont perdus. Écrit dans le dossier de
/// données de l'app (indexation.log) et recopié sur la sortie d'erreur.
pub struct Journal {
    fichier: Option<Mutex<fs::File>>,
}

impl Journal {
    /// `chemin` None : sortie d'erreur seulement (tests).
    pub fn ouvrir(chemin: Option<&Path>) -> Journal {
        let fichier = chemin.and_then(|chemin| {
            if fs::metadata(chemin).is_ok_and(|m| m.len() > TAILLE_MAX_JOURNAL) {
                let _ = fs::rename(chemin, chemin.with_extension("old.log"));
            }
            fs::OpenOptions::new().create(true).append(true).open(chemin).ok().map(Mutex::new)
        });
        Journal { fichier }
    }

    pub fn ecrire(&self, message: &str) {
        eprintln!("{message}");
        if let Some(Ok(mut f)) = self.fichier.as_ref().map(|f| f.lock()) {
            let _ = writeln!(f, "[{}] {message}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"));
        }
    }
}

// ---------------------------------------------------------------------------
// Scan initial
// ---------------------------------------------------------------------------

/// Compteurs d'un scan, pour le résumé final.
#[derive(Default)]
struct Bilan {
    examines: usize,
    inchanges: usize,
    indexes: usize,
    principaux: usize,
    erreurs: usize,
    plantages: usize,
    lents: usize,
}

/// Avancement de l'analyse des fichiers, affiché par l'interface (barre de
/// progression) -- voir lib.rs pour l'envoi à l'interface.
#[derive(Debug, Clone, Default, Serialize)]
pub struct Progression {
    pub en_cours: bool,
    /// "comptage" (inventaire des fichiers), "analyse", "finalisation".
    pub etape: String,
    pub dossier: String,
    pub total: usize,
    pub traites: usize,
    pub erreurs: usize,
    /// Fichier en cours d'analyse (nom seul).
    pub fichier: Option<String>,
    /// Début de l'analyse du fichier en cours (secondes Unix) : l'interface
    /// signale un fichier qui bloque.
    pub debut_fichier: Option<i64>,
    /// Débit sur la dernière minute (fichiers/min) et temps restant estimé.
    pub fichiers_par_minute: Option<f64>,
    pub restant_secondes: Option<u64>,
    /// Horodatage de la fin du dernier scan complet.
    pub termine_le: Option<String>,
}

/// Validation des écritures toutes les ~2 s : une validation par fichier
/// (et même 5 à 13, une par table) rendait le scan très lent sur Windows.
const INTERVALLE_VALIDATION: Duration = Duration::from_secs(2);
/// Un fichier plus long que ça à analyser est noté dans le journal.
const SEUIL_FICHIER_LENT: Duration = Duration::from_secs(3);
/// Fenêtre de calcul du débit affiché.
const FENETRE_DEBIT: Duration = Duration::from_secs(60);

fn maintenant_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Ouvre un lot d'écritures (les fonctions de l'indexeur utilisent des
/// savepoints, qui s'imbriquent dans ce lot).
fn commencer_lot(conn: &Connection, journal: &Journal) {
    if conn.is_autocommit() {
        if let Err(e) = conn.execute_batch("BEGIN") {
            journal.ecrire(&format!("Erreur ouverture de lot: {e}"));
        }
    }
}

fn valider_lot(conn: &Connection, journal: &Journal) {
    if !conn.is_autocommit() {
        if let Err(e) = conn.execute_batch("COMMIT") {
            journal.ecrire(&format!("Erreur validation de lot: {e}"));
        }
    }
}

/// Texte d'une panique (message de `panic!`), pour le journal.
fn message_panique(panique: &(dyn std::any::Any + Send)) -> String {
    panique
        .downcast_ref::<&str>()
        .map(|s| s.to_string())
        .or_else(|| panique.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "panique sans message".into())
}

/// Parcourt le dossier surveillé -- ET tous ses sous-dossiers -- et indexe
/// les fichiers nouveaux ou modifiés depuis le dernier passage (voir
/// indexeur : un fichier inchangé n'est pas relu). Le watcher
/// (surveiller_dossier) ne détecte que les changements FUTURS, d'où ce scan
/// au démarrage. Retire aussi de l'index les fichiers supprimés entre-temps.
/// À appeler une fois avant surveiller_dossier, dans le même thread.
///
/// `rapport` reçoit l'avancement avant chaque fichier (l'appelant limite la
/// fréquence d'envoi à l'interface) et à la fin (`en_cours` = false). Un
/// scan interrompu (app fermée) reprend où il en était : les fichiers déjà
/// analysés sont enregistrés dans `fichiers` à chaque validation de lot.
pub fn scanner_dossier_initial(chemin_dossier: &str, chemin_db: &str, rapport: &dyn Fn(&Progression), journal: &Journal) {
    let debut_scan = Instant::now();
    let mut progression = Progression {
        en_cours: true,
        etape: "comptage".into(),
        dossier: chemin_dossier.to_string(),
        ..Default::default()
    };
    rapport(&progression);

    let Some(mut conn) = ouvrir_base(chemin_db, journal) else {
        progression.en_cours = false;
        rapport(&progression);
        return;
    };
    if let Err(e) = indexeur::verifier_version(&conn) {
        journal.ecrire(&format!("Erreur version indexeur: {e}"));
    }
    let racine = Path::new(chemin_dossier);

    // Inventaire d'abord, pour connaître le total à afficher.
    let mut fichiers = Vec::new();
    let mut dossiers = Vec::new();
    collecter(racine, &mut fichiers, &mut dossiers, journal);
    commencer_lot(&conn, journal);
    for dossier in &dossiers {
        if let Err(e) = indexeur::noter_dossier(&conn, racine, dossier) {
            journal.ecrire(&format!("Erreur dossier {dossier:?}: {e}"));
        }
    }
    valider_lot(&conn, journal);
    journal.ecrire(&format!(
        "Scan de {chemin_dossier} : {} fichier(s) dans {} dossier(s), inventaire en {:.0?}",
        fichiers.len(),
        dossiers.len(),
        debut_scan.elapsed()
    ));
    progression.etape = "analyse".into();
    progression.total = fichiers.len();
    rapport(&progression);

    let mut vus = HashSet::new();
    let mut bilan = Bilan::default();
    let mut debut_lot = Instant::now();
    // (instant, fichiers traités) sur la dernière minute, pour le débit.
    let mut echantillons: VecDeque<(Instant, usize)> = VecDeque::new();
    commencer_lot(&conn, journal);
    for (i, path) in fichiers.iter().enumerate() {
        let maintenant = Instant::now();
        echantillons.push_back((maintenant, i));
        while echantillons.front().is_some_and(|(t, _)| maintenant.duration_since(*t) > FENETRE_DEBIT) {
            echantillons.pop_front();
        }
        if let Some((t0, i0)) = echantillons.front() {
            let secondes = maintenant.duration_since(*t0).as_secs_f64();
            if secondes >= 5.0 && i > *i0 {
                let par_seconde = (i - i0) as f64 / secondes;
                progression.fichiers_par_minute = Some(par_seconde * 60.0);
                progression.restant_secondes = Some(((fichiers.len() - i) as f64 / par_seconde) as u64);
            }
        }
        progression.traites = i;
        progression.erreurs = bilan.erreurs + bilan.plantages;
        progression.fichier = path.file_name().map(|n| n.to_string_lossy().to_string());
        progression.debut_fichier = Some(maintenant_unix());
        rapport(&progression);

        bilan.examines += 1;
        vus.insert(path.to_string_lossy().to_string());
        let debut_fichier = Instant::now();
        // Une panique d'un parseur (classeur corrompu...) ne doit pas tuer
        // le thread d'indexation : sinon le scan ne se termine jamais et la
        // barre de progression reste figée.
        let resultat = catch_unwind(AssertUnwindSafe(|| indexeur::traiter_fichier(&mut conn, racine, path)));
        let duree = debut_fichier.elapsed();
        if duree >= SEUIL_FICHIER_LENT {
            bilan.lents += 1;
            journal.ecrire(&format!("Fichier lent ({:.1} s) : {}", duree.as_secs_f64(), path.display()));
        }
        match resultat {
            Ok(Ok(Resultat::Inchange)) => bilan.inchanges += 1,
            Ok(Ok(Resultat::Ignore)) => {}
            Ok(Ok(Resultat::Indexe { principal, .. })) => {
                bilan.indexes += 1;
                bilan.principaux += principal as usize;
            }
            Ok(Err(e)) => {
                bilan.erreurs += 1;
                journal.ecrire(&format!("Erreur {} : {e}", path.display()));
            }
            Err(panique) => {
                bilan.plantages += 1;
                let message = message_panique(panique.as_ref());
                journal.ecrire(&format!("Plantage sur {} : {message}", path.display()));
                if let Err(e) = indexeur::marquer_plantage(&conn, path, &message) {
                    journal.ecrire(&format!("Erreur enregistrement du plantage : {e}"));
                }
            }
        }

        if debut_lot.elapsed() >= INTERVALLE_VALIDATION {
            valider_lot(&conn, journal);
            commencer_lot(&conn, journal);
            debut_lot = Instant::now();
        }
        if (i + 1) % 1000 == 0 {
            journal.ecrire(&format!(
                "{} / {} fichiers ({:.0} fichiers/min sur la dernière minute)",
                i + 1,
                fichiers.len(),
                progression.fichiers_par_minute.unwrap_or(0.0)
            ));
        }
    }
    valider_lot(&conn, journal);

    progression.etape = "finalisation".into();
    progression.traites = fichiers.len();
    progression.erreurs = bilan.erreurs + bilan.plantages;
    progression.fichier = None;
    progression.debut_fichier = None;
    progression.restant_secondes = None;
    rapport(&progression);
    commencer_lot(&conn, journal);
    match indexeur::purger_absents(&conn, racine, &vus) {
        Ok(n) if n > 0 => journal.ecrire(&format!("{n} fichier(s) supprimé(s) retiré(s) de l'index")),
        Ok(_) => {}
        Err(e) => journal.ecrire(&format!("Erreur purge index: {e}")),
    }
    match indexeur::marquer_doublons(&conn) {
        Ok(n) => journal.ecrire(&format!("{n} copie(s) de documents marquée(s) comme doublons")),
        Err(e) => journal.ecrire(&format!("Erreur doublons: {e}")),
    }
    valider_lot(&conn, journal);
    journal.ecrire(&format!(
        "Scan terminé en {:.0?} : {} fichier(s), {} inchangé(s), {} indexé(s) dont {} fiche(s)/RDE retenu(s), {} erreur(s), {} plantage(s), {} fichier(s) lent(s)",
        debut_scan.elapsed(),
        bilan.examines,
        bilan.inchanges,
        bilan.indexes,
        bilan.principaux,
        bilan.erreurs,
        bilan.plantages,
        bilan.lents
    ));
    progression.en_cours = false;
    progression.fichiers_par_minute = None;
    progression.termine_le = Some(chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string());
    rapport(&progression);
}

/// Liste récursivement les fichiers et sous-dossiers d'un dossier (sans
/// toucher à la base : les dossiers sont notés ensuite en un seul lot).
fn collecter(dossier: &Path, fichiers: &mut Vec<PathBuf>, dossiers: &mut Vec<PathBuf>, journal: &Journal) {
    let entrees = match fs::read_dir(dossier) {
        Ok(e) => e,
        Err(e) => {
            journal.ecrire(&format!("Impossible de lire le dossier {dossier:?}: {e}"));
            return;
        }
    };

    for entree in entrees.flatten() {
        let path = entree.path();
        // file_type() vient de la lecture du dossier : pas d'accès
        // supplémentaire au fichier (coûteux sur OneDrive / Windows).
        match entree.file_type() {
            Ok(t) if t.is_dir() => {
                collecter(&path, fichiers, dossiers, journal);
                dossiers.push(path);
            }
            Ok(t) if t.is_file() => fichiers.push(path),
            _ => {}
        }
    }
}

/// Lance la surveillance du dossier local (synchronisé OneDrive) et indexe
/// chaque fichier créé ou modifié. Fonction bloquante : à lancer dans son
/// propre thread (std::thread::spawn), pas besoin de tokio.
pub fn surveiller_dossier(chemin_dossier: &str, chemin_db: &str, journal: &Journal) -> notify::Result<()> {
    let (tx, rx) = mpsc::channel();

    let mut debouncer = new_debouncer(Duration::from_secs(2), tx)?;
    debouncer
        .watcher()
        .watch(Path::new(chemin_dossier), RecursiveMode::Recursive)?;

    let Some(mut conn) = ouvrir_base(chemin_db, journal) else { return Ok(()) };
    let racine = Path::new(chemin_dossier);
    journal.ecrire(&format!("Surveillance active sur : {chemin_dossier}"));
    for evenement in rx {
        match evenement {
            Ok(evenements) => {
                for e in evenements {
                    if e.kind != DebouncedEventKind::Any {
                        continue;
                    }
                    traiter_evenement(&mut conn, racine, &e.path, journal);
                }
            }
            Err(erreur) => journal.ecrire(&format!("Erreur watcher: {erreur:?}")),
        }
    }
    Ok(())
}

fn traiter_evenement(conn: &mut Connection, racine: &Path, path: &Path, journal: &Journal) {
    if let Err(panique) = catch_unwind(AssertUnwindSafe(|| indexer_evenement(conn, racine, path, journal))) {
        let message = message_panique(panique.as_ref());
        journal.ecrire(&format!("Plantage sur {} : {message}", path.display()));
        let _ = indexeur::marquer_plantage(conn, path, &message);
    }
    if let Err(e) = indexeur::marquer_doublons(conn) {
        journal.ecrire(&format!("Erreur doublons: {e}"));
    }
}

fn indexer_evenement(conn: &mut Connection, racine: &Path, path: &Path, journal: &Journal) {
    if path.is_dir() {
        if let Err(e) = indexeur::noter_dossier(conn, racine, path) {
            journal.ecrire(&format!("Erreur dossier {path:?}: {e}"));
        }
        return;
    }
    if !path.exists() {
        if let Err(e) = indexeur::oublier_fichier(conn, &path.to_string_lossy()) {
            journal.ecrire(&format!("Erreur suppression {path:?}: {e}"));
        }
        return;
    }
    match indexeur::traiter_fichier(conn, racine, path) {
        Ok(Resultat::Indexe { type_doc, affaire, principal }) => println!(
            "{path:?} : {type_doc} indexé (affaire {}){}",
            affaire.as_deref().unwrap_or("?"),
            if principal { ", données retenues" } else { "" }
        ),
        Ok(_) => {}
        Err(e) => journal.ecrire(&format!("Erreur {} : {e}", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOSSIER_REEL: &str = "../../1a COMMANDES FINIES 2025";

    /// Indexation complète du dossier réel dans une base temporaire (long :
    /// `cargo test --release -- --ignored --nocapture indexation_dossier_reel`).
    #[test]
    #[ignore]
    fn indexation_dossier_reel() {
        let racine = std::fs::canonicalize(DOSSIER_REEL).expect("dossier réel absent");
        let db = std::env::temp_dir().join("parachev_test_index.db");
        let _ = std::fs::remove_file(&db);
        let conn = Connection::open(&db).unwrap();
        crate::erp::initialiser_schema(&conn).unwrap();
        crate::config::initialiser_schema(&conn).unwrap();
        indexeur::initialiser_schema(&conn).unwrap();
        let mut conn = conn;
        crate::erp::traiter_fichier_erp(Path::new("../../Para/ERP.txt"), &mut conn).unwrap();
        drop(conn);

        let debut = std::time::Instant::now();
        let rapports = std::cell::Cell::new(0);
        let dernier = std::cell::RefCell::new(Progression::default());
        let journal = Journal::ouvrir(None);
        scanner_dossier_initial(
            &racine.to_string_lossy(),
            &db.to_string_lossy(),
            &|p| {
                rapports.set(rapports.get() + 1);
                *dernier.borrow_mut() = p.clone();
            },
            &journal,
        );
        println!("Durée scan complet : {:?} ({} rapports de progression)", debut.elapsed(), rapports.get());
        let fin = dernier.borrow().clone();
        assert!(!fin.en_cours && fin.termine_le.is_some());
        assert_eq!(fin.traites, fin.total);
        assert!(fin.total > 6000);

        let debut = std::time::Instant::now();
        scanner_dossier_initial(&racine.to_string_lossy(), &db.to_string_lossy(), &|_| {}, &journal);
        println!("Durée second scan (incrémental) : {:?}", debut.elapsed());

        let conn = Connection::open(&db).unwrap();
        let compte = |sql: &str| conn.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap();
        println!("dossiers_affaires : {}", compte("SELECT COUNT(*) FROM dossiers_affaires"));
        println!("fiches retenues   : {}", compte("SELECT COUNT(*) FROM variables_affaires WHERE chemin_fiche IS NOT NULL"));
        println!("RDE retenus       : {}", compte("SELECT COUNT(*) FROM rde_affaires"));
        println!("documents         : {}", compte("SELECT COUNT(*) FROM documents"));
        println!("références        : {}", compte("SELECT COUNT(*) FROM affaires_references"));
        println!("copies (doublons) : {}", compte("SELECT COUNT(*) FROM documents WHERE doublon_de IS NOT NULL"));
        assert_eq!(compte("SELECT COUNT(*) FROM rde_laminage WHERE COALESCE(nombre, 0) <= 0 AND COALESCE(poids_kg, 0) <= 0"), 0);
        println!("fichiers en erreur: {}", compte("SELECT COUNT(*) FROM fichiers WHERE statut = 'erreur'"));
        println!("fichiers ignorés  : {}", compte("SELECT COUNT(*) FROM fichiers WHERE statut = 'ignore'"));
        let affaires = crate::recherche::lister_affaires(&conn).unwrap();
        println!("lignes de recherche : {}", affaires.len());
        let export = std::env::temp_dir().join("parachev_affaires.json");
        std::fs::write(&export, serde_json::to_string(&affaires).unwrap()).unwrap();
        let hofmann = affaires.iter().find(|a| a.affaire == "1100725621").unwrap();
        println!("{}", serde_json::to_string_pretty(hofmann).unwrap());
        let textes = crate::recherche::rechercher_texte(&conn, "double redressage").unwrap();
        println!("plein texte 'double redressage' : {} document(s)", textes.len());
        assert!(compte("SELECT COUNT(*) FROM rde_affaires") > 100);
        assert!(compte("SELECT COUNT(*) FROM variables_affaires WHERE chemin_fiche IS NOT NULL") > 100);
    }
}
