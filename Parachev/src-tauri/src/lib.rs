// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod erp;
mod parsing;
mod watcher;
mod prevision;
mod calibration;
mod config;

use crate::prevision::{CoefficientsExport};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use crate::calibration::{calibrer_tous_les_postes};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

/// Retourne (et crée si besoin) le dossier de données de l'application,
/// fourni par l'OS -- ~/Library/Application Support/<identifier>/ sur macOS,
/// %APPDATA%/<identifier>/ sur Windows. Contrairement à un chemin relatif
/// comme "affaires.db", ce dossier existe toujours et est garanti
/// accessible en écriture, que l'app tourne en dev ou packagée.
fn dossier_donnees(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn chemin_db(app: &tauri::AppHandle) -> Result<String, String> {
    Ok(dossier_donnees(app)?
        .join("affaires.db")
        .to_string_lossy()
        .to_string())
}

fn chemin_coefficients(app: &tauri::AppHandle) -> Result<String, String> {
    Ok(dossier_donnees(app)?
        .join("coefficients.json")
        .to_string_lossy()
        .to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            previsualiser_affaire,
            recalibrer,
            lister_heures,
            obtenir_dossier_configure,
            choisir_dossier_surveille
        ])
        .setup(|app| {
            let app_handle = app.handle().clone();
            let chemin_db_str = chemin_db(&app_handle)?;

            let conn = Connection::open(&chemin_db_str).map_err(|e| e.to_string())?;
            erp::initialiser_schema(&conn).map_err(|e| e.to_string())?;
            erp::migrer_format_dates(&conn).map_err(|e| e.to_string())?;
            config::initialiser_schema(&conn).map_err(|e| e.to_string())?;
            let chemin_dossier = config::lire_config(&conn, config::CLE_DOSSIER_SURVEILLE)
                .map_err(|e| e.to_string())?;
            drop(conn);

            // Ne démarre le watcher que si un dossier a déjà été choisi lors
            // d'un lancement précédent -- sinon on attend que l'utilisateur
            // en choisisse un via choisir_dossier_surveille().
            if let Some(chemin_dossier) = chemin_dossier {
                std::thread::spawn(move || {
                    watcher::scanner_dossier_initial(&chemin_dossier, &chemin_db_str);

                    if let Err(e) = watcher::surveiller_dossier(&chemin_dossier, &chemin_db_str) {
                        eprintln!("Erreur watcher: {e:?}");
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Retourne le dossier actuellement configuré, s'il y en a un. Utile pour
/// l'UI : afficher le chemin actuel au chargement de la page.
#[tauri::command]
fn obtenir_dossier_configure(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let conn = Connection::open(chemin_db(&app)?).map_err(|e| e.to_string())?;
    config::initialiser_schema(&conn).map_err(|e| e.to_string())?;
    config::lire_config(&conn, config::CLE_DOSSIER_SURVEILLE)
}

/// Ouvre un sélecteur de dossier natif, sauvegarde le choix, et démarre la
/// surveillance sur ce dossier.
///
/// Simplification assumée : si un dossier était déjà surveillé, l'ancien
/// thread de surveillance continue de tourner en tâche de fond (notify
/// n'offre pas d'arrêt propre trivial sans plomberie supplémentaire) --
/// changer de dossier prend donc pleinement effet après un redémarrage de
/// l'app.
#[tauri::command]
async  fn choisir_dossier_surveille(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let dossier = app.dialog().file().blocking_pick_folder();

    let Some(dossier) = dossier else {
        return Ok(None); // l'utilisateur a annulé la sélection
    };
    let chemin = dossier.to_string();

    let chemin_db_str = chemin_db(&app)?;
    let conn = Connection::open(&chemin_db_str).map_err(|e| e.to_string())?;
    config::initialiser_schema(&conn).map_err(|e| e.to_string())?;
    config::ecrire_config(&conn, config::CLE_DOSSIER_SURVEILLE, &chemin)?;
    drop(conn);

    let chemin_thread = chemin.clone();
    std::thread::spawn(move || {
        watcher::scanner_dossier_initial(&chemin_thread, &chemin_db_str);
        if let Err(e) = watcher::surveiller_dossier(&chemin_thread, &chemin_db_str) {
            eprintln!("Erreur watcher: {e:?}");
        }
    });

    Ok(Some(chemin))
}

#[tauri::command]
fn previsualiser_affaire(app: tauri::AppHandle, affaire: String) -> Result<HashMap<String, f64>, String> {
    let mut conn = Connection::open(chemin_db(&app)?).map_err(|e| e.to_string())?;
    prevision::initialiser_schema_previsions(&conn).map_err(|e| e.to_string())?;

    let coeffs = CoefficientsExport::charger(&chemin_coefficients(&app)?)?;
    let prevision = prevision::previsualiser_et_enregistrer(&mut conn, &coeffs, &affaire)?;

    let mut resultat = prevision.heures_par_poste;
    resultat.insert("total".into(), prevision.total_heures);
    Ok(resultat)
}

#[tauri::command]
fn recalibrer(app: tauri::AppHandle) -> Result<(), String> {
    let conn = Connection::open(chemin_db(&app)?).map_err(|e| e.to_string())?;
    let export = calibrer_tous_les_postes(&conn)?;

    let json = serde_json::to_string_pretty(&export).map_err(|e| e.to_string())?;
    std::fs::write(chemin_coefficients(&app)?, json).map_err(|e| e.to_string())?;

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
fn lister_heures(app: tauri::AppHandle) -> Result<Vec<HeureRow>, String> {
    let conn = Connection::open(chemin_db(&app)?).map_err(|e| e.to_string())?;
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