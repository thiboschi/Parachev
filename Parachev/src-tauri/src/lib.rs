// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod erp;
mod parsing;
mod watcher;
mod prevision;
mod calibration;

use crate::prevision::{CoefficientsExport};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashMap;
use crate::calibration::{calibrer_tous_les_postes};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![previsualiser_affaire, recalibrer, lister_heures])
        .setup(|_app| {

            let conn = Connection::open("affaires.db").map_err(|e| e.to_string())?;
            erp::initialiser_schema(&conn).map_err(|e| e.to_string())?;
            drop(conn);

            let chemin_dossier = "./../../Para".to_string();
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
    let mut conn = Connection::open("affaires.db").map_err(|e| e.to_string())?;
    prevision::initialiser_schema_previsions(&conn).map_err(|e| e.to_string())?;

    let coeffs = CoefficientsExport::charger("coefficients.json")?;
    let prevision = prevision::previsualiser_et_enregistrer(&mut conn, &coeffs, &affaire)?;

    let mut resultat = prevision.heures_par_poste;
    resultat.insert("total".into(), prevision.total_heures);
    Ok(resultat)
}

#[tauri::command]
fn recalibrer() -> Result<(), String> {
    let conn = Connection::open("affaires.db").map_err(|e| e.to_string())?;
    let export = calibrer_tous_les_postes(&conn)?;

    let json = serde_json::to_string_pretty(&export).map_err(|e| e.to_string())?;
    std::fs::write("coefficients.json", json).map_err(|e| e.to_string())?;

    Ok(())
}

#[derive(Serialize)]
struct HeureRow {
    affaire: String,
    ot: Option<String>,
    date: Option<String>,
    poste: String,
    heures: f64,
}

#[tauri::command]
fn lister_heures() -> Result<Vec<HeureRow>, String> {
    let conn = Connection::open("affaires.db").map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT affaire, ot, date, poste, heures FROM heures ORDER BY rowid")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(HeureRow {
                affaire: row.get(0)?,
                ot: row.get(1)?,
                date: row.get(2)?,
                poste: row.get(3)?,
                heures: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}