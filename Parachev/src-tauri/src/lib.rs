// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod erp;
mod watcher;
mod prevision;

use crate::prevision::{CoefficientsExport};
use rusqlite::Connection;
use std::collections::HashMap;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![previsualiser_affaire])
        .setup(|_app| {
            let chemin_dossier = "./../Test".to_string();
            let chemin_db = "affaires.db".to_string();

            std::thread::spawn(move || {
                if let Err(e) = watcher::surveiller_dossier(&chemin_dossier, &chemin_db) {
                    eprintln!("Erreur watcher: {e:?}");
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn previsualiser_affaire(affaire: String) -> Result<HashMap<String, f64>, String> {
    let conn = Connection::open("affaires.db").map_err(|e| e.to_string())?;
    let coeffs = CoefficientsExport::charger("coefficients.json")?;
    let prevision = prevision::predire_affaire(&conn, &coeffs, &affaire)?;

    let mut resultat = prevision.heures_par_poste;
    resultat.insert("total".into(), prevision.total_heures);
    Ok(resultat)
}
