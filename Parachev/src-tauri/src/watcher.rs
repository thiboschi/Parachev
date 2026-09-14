use crate::erp::traiter_fichier_erp;
use crate::parsing::traiter_fichier_excel;
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebouncedEventKind};
use rusqlite::Connection;
use std::fs;
use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

/// Parcourt le dossier surveillé -- ET tous ses sous-dossiers -- et traite
/// tous les fichiers déjà présents, qu'ils aient changé ou non depuis le
/// dernier lancement -- le watcher (surveiller_dossier) ne détecte que les
/// changements FUTURS, donc sans ce scan initial, un fichier déjà présent
/// et inchangé au démarrage de l'app ne serait jamais (re)traité tant
/// qu'il n'est pas modifié une nouvelle fois.
/// À appeler une fois avant surveiller_dossier, idéalement dans le même
/// thread d'arrière-plan.
pub fn scanner_dossier_initial(chemin_dossier: &str, chemin_db: &str) {
    let mut n_traites = 0;
    parcourir_recursivement(Path::new(chemin_dossier), chemin_db, &mut n_traites);
    println!("Scan initial terminé : {n_traites} fichier(s) examiné(s) dans {chemin_dossier} (sous-dossiers inclus)");
}

/// Parcourt récursivement un dossier : traite chaque fichier rencontré,
/// et redescend dans chaque sous-dossier trouvé.
fn parcourir_recursivement(dossier: &Path, chemin_db: &str, n_traites: &mut usize) {
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
            parcourir_recursivement(&path, chemin_db, n_traites);
        } else if path.is_file() {
            traiter_evenement(&path, chemin_db);
            *n_traites += 1;
        }
    }
}

/// Lance la surveillance du dossier local (synchronisé OneDrive) et traite
/// chaque fichier créé ou modifié. Fonction bloquante : à lancer dans son
/// propre thread (std::thread::spawn), pas besoin de tokio.
pub fn surveiller_dossier(chemin_dossier: &str, chemin_db: &str) -> notify::Result<()> {
    let (tx, rx) = mpsc::channel();

    let mut debouncer = new_debouncer(Duration::from_secs(2), tx)?;
    debouncer
        .watcher()
        .watch(Path::new(chemin_dossier), RecursiveMode::Recursive)?;

    println!("Surveillance active sur : {chemin_dossier}");
    for evenement in rx {
        match evenement {
            Ok(evenements) => {
                for e in evenements {
                    if e.kind != DebouncedEventKind::Any {
                        continue;
                    }
                    traiter_evenement(&e.path, chemin_db);
                }
            }
            Err(erreur) => eprintln!("Erreur watcher: {erreur:?}"),
        }
    }
    Ok(())
}

fn traiter_evenement(path: &Path, chemin_db: &str) {
    let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
        return;
    };

    // Garde-fou basique contre les fichiers OneDrive "à la demande"
    // (placeholders cloud pas encore téléchargés) : on vérifie que le
    // fichier a une taille non nulle avant de tenter de le parser.
    match fs_metadata_taille(path) {
        Some(0) | None => {
            eprintln!("Fichier vide ou inaccessible, ignoré: {path:?}");
            return;
        }
        _ => {}
    }

    match ext {
        "txt" => {
            let mut conn = match Connection::open(chemin_db) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("Impossible d'ouvrir la base: {e}");
                    return;
                }
            };
            match traiter_fichier_erp(path, &mut conn) {
                Ok(n) => println!("{path:?} : {n} lignes traitées"),
                Err(e) => eprintln!("Erreur parsing {path:?}: {e}"),
            }
        }
        "xlsx" => {
            let mut conn = match Connection::open(chemin_db) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("Impossible d'ouvrir la base: {e}");
                    return;
                }
            };
            match traiter_fichier_excel(&path.to_string_lossy(), &mut conn) {
                Ok(affaire) => println!("{path:?} : variables extraites pour l'affaire {affaire}"),
                Err(e) => eprintln!("Erreur parsing {path:?}: {e}"),
            }
        }
        _ => {}
    }
}

fn fs_metadata_taille(path: &Path) -> Option<u64> {
    std::fs::metadata(path).ok().map(|m| m.len())
}