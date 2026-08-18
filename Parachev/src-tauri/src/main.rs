mod erp;
mod watcher;

use rusqlite::Connection;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let chemin_db = "affaires.db";
    let chemin_dossier = "./Test";

    // S'assure que le schéma existe avant de démarrer la surveillance
    let conn = Connection::open(chemin_db)?;
    erp::initialiser_schema(&conn)?;
    drop(conn);


    std::fs::create_dir_all(chemin_dossier)?;

    // Dans l'app Tauri réelle : lancer ceci dans un std::thread::spawn
    // au démarrage de l'app plutôt que dans main() directement.
    watcher::surveiller_dossier(chemin_dossier, chemin_db)?;

    Ok(())
}
