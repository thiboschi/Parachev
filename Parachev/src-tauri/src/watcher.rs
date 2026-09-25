use crate::indexeur::{self, Resultat};
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebouncedEventKind};
use rusqlite::Connection;
use std::collections::HashSet;
use std::fs;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// Connexion dédiée au thread d'indexation : attend (au lieu d'échouer)
/// quand l'interface écrit en même temps dans la base.
fn ouvrir_base(chemin_db: &str) -> Option<Connection> {
    match Connection::open(chemin_db) {
        Ok(conn) => {
            let _ = conn.busy_timeout(Duration::from_secs(10));
            Some(conn)
        }
        Err(e) => {
            eprintln!("Impossible d'ouvrir la base: {e}");
            None
        }
    }
}

/// Compteurs d'un scan, pour le résumé final.
#[derive(Default)]
struct Bilan {
    examines: usize,
    inchanges: usize,
    indexes: usize,
    principaux: usize,
    erreurs: usize,
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
    /// Horodatage de la fin du dernier scan complet.
    pub termine_le: Option<String>,
}

/// Intervalle minimum entre deux rapports de progression (l'interface n'a
/// pas besoin de plus de ~10 rafraîchissements par seconde).
const INTERVALLE_RAPPORT: Duration = Duration::from_millis(100);

/// Parcourt le dossier surveillé -- ET tous ses sous-dossiers -- et indexe
/// les fichiers nouveaux ou modifiés depuis le dernier passage (voir
/// indexeur : un fichier inchangé n'est pas relu). Le watcher
/// (surveiller_dossier) ne détecte que les changements FUTURS, d'où ce scan
/// au démarrage. Retire aussi de l'index les fichiers supprimés entre-temps.
/// À appeler une fois avant surveiller_dossier, dans le même thread.
///
/// `rapport` reçoit l'avancement : au début, au plus toutes les 100 ms
/// pendant l'analyse, et à la fin (`en_cours` = false).
pub fn scanner_dossier_initial(chemin_dossier: &str, chemin_db: &str, rapport: &dyn Fn(&Progression)) {
    let mut progression = Progression {
        en_cours: true,
        etape: "comptage".into(),
        dossier: chemin_dossier.to_string(),
        ..Default::default()
    };
    rapport(&progression);

    let Some(mut conn) = ouvrir_base(chemin_db) else {
        progression.en_cours = false;
        rapport(&progression);
        return;
    };
    if let Err(e) = indexeur::verifier_version(&conn) {
        eprintln!("Erreur version indexeur: {e}");
    }
    let racine = Path::new(chemin_dossier);

    // Inventaire d'abord, pour connaître le total à afficher.
    let mut fichiers = Vec::new();
    collecter_fichiers(&conn, racine, racine, &mut fichiers);
    progression.etape = "analyse".into();
    progression.total = fichiers.len();
    rapport(&progression);

    let mut vus = HashSet::new();
    let mut bilan = Bilan::default();
    let mut dernier_rapport = Instant::now();
    for (i, path) in fichiers.iter().enumerate() {
        if dernier_rapport.elapsed() >= INTERVALLE_RAPPORT {
            progression.traites = i;
            progression.erreurs = bilan.erreurs;
            progression.fichier = path.file_name().map(|n| n.to_string_lossy().to_string());
            rapport(&progression);
            dernier_rapport = Instant::now();
        }
        bilan.examines += 1;
        vus.insert(path.to_string_lossy().to_string());
        match indexeur::traiter_fichier(&mut conn, racine, path) {
            Ok(Resultat::Inchange) => bilan.inchanges += 1,
            Ok(Resultat::Ignore) => {}
            Ok(Resultat::Indexe { principal, .. }) => {
                bilan.indexes += 1;
                bilan.principaux += principal as usize;
            }
            Err(e) => {
                bilan.erreurs += 1;
                eprintln!("Erreur {path:?}: {e}");
            }
        }
    }

    progression.etape = "finalisation".into();
    progression.traites = fichiers.len();
    progression.erreurs = bilan.erreurs;
    progression.fichier = None;
    rapport(&progression);
    match indexeur::purger_absents(&conn, racine, &vus) {
        Ok(n) if n > 0 => println!("{n} fichier(s) supprimé(s) retiré(s) de l'index"),
        Ok(_) => {}
        Err(e) => eprintln!("Erreur purge index: {e}"),
    }
    match indexeur::marquer_doublons(&conn) {
        Ok(n) => println!("{n} copie(s) de documents marquée(s) comme doublons"),
        Err(e) => eprintln!("Erreur doublons: {e}"),
    }
    println!(
        "Scan initial terminé ({chemin_dossier}) : {} fichier(s), {} inchangé(s), {} indexé(s) dont {} fiche(s)/RDE retenu(s), {} erreur(s)",
        bilan.examines, bilan.inchanges, bilan.indexes, bilan.principaux, bilan.erreurs
    );
    progression.en_cours = false;
    progression.termine_le = Some(chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string());
    rapport(&progression);
}

/// Liste récursivement les fichiers d'un dossier, et note au passage chaque
/// sous-dossier (dossiers d'affaire, non-conformités).
fn collecter_fichiers(conn: &Connection, racine: &Path, dossier: &Path, fichiers: &mut Vec<PathBuf>) {
    let entrees = match fs::read_dir(dossier) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("Impossible de lire le dossier {dossier:?}: {e}");
            return;
        }
    };

    for entree in entrees.flatten() {
        let path = entree.path();
        if path.is_dir() {
            if let Err(e) = indexeur::noter_dossier(conn, racine, &path) {
                eprintln!("Erreur dossier {path:?}: {e}");
            }
            collecter_fichiers(conn, racine, &path, fichiers);
        } else if path.is_file() {
            fichiers.push(path);
        }
    }
}

/// Lance la surveillance du dossier local (synchronisé OneDrive) et indexe
/// chaque fichier créé ou modifié. Fonction bloquante : à lancer dans son
/// propre thread (std::thread::spawn), pas besoin de tokio.
pub fn surveiller_dossier(chemin_dossier: &str, chemin_db: &str) -> notify::Result<()> {
    let (tx, rx) = mpsc::channel();

    let mut debouncer = new_debouncer(Duration::from_secs(2), tx)?;
    debouncer
        .watcher()
        .watch(Path::new(chemin_dossier), RecursiveMode::Recursive)?;

    let Some(mut conn) = ouvrir_base(chemin_db) else { return Ok(()) };
    let racine = Path::new(chemin_dossier);
    println!("Surveillance active sur : {chemin_dossier}");
    for evenement in rx {
        match evenement {
            Ok(evenements) => {
                for e in evenements {
                    if e.kind != DebouncedEventKind::Any {
                        continue;
                    }
                    traiter_evenement(&mut conn, racine, &e.path);
                }
            }
            Err(erreur) => eprintln!("Erreur watcher: {erreur:?}"),
        }
    }
    Ok(())
}

fn traiter_evenement(conn: &mut Connection, racine: &Path, path: &Path) {
    indexer_evenement(conn, racine, path);
    if let Err(e) = indexeur::marquer_doublons(conn) {
        eprintln!("Erreur doublons: {e}");
    }
}

fn indexer_evenement(conn: &mut Connection, racine: &Path, path: &Path) {
    if path.is_dir() {
        if let Err(e) = indexeur::noter_dossier(conn, racine, path) {
            eprintln!("Erreur dossier {path:?}: {e}");
        }
        return;
    }
    if !path.exists() {
        if let Err(e) = indexeur::oublier_fichier(conn, &path.to_string_lossy()) {
            eprintln!("Erreur suppression {path:?}: {e}");
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
        Err(e) => eprintln!("Erreur {path:?}: {e}"),
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
        scanner_dossier_initial(&racine.to_string_lossy(), &db.to_string_lossy(), &|p| {
            rapports.set(rapports.get() + 1);
            *dernier.borrow_mut() = p.clone();
        });
        println!("Durée scan complet : {:?} ({} rapports de progression)", debut.elapsed(), rapports.get());
        let fin = dernier.borrow().clone();
        assert!(!fin.en_cours && fin.termine_le.is_some());
        assert_eq!(fin.traites, fin.total);
        assert!(fin.total > 6000);

        let debut = std::time::Instant::now();
        scanner_dossier_initial(&racine.to_string_lossy(), &db.to_string_lossy(), &|_| {});
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
