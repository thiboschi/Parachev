// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod erp;
mod msg;
mod parsing;
mod watcher;
mod prevision;
mod calibration;
mod config;

use crate::prevision::{CoefficientsExport};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
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
            chiffrer_manuellement,
            recalibrer,
            lister_coefficients,
            lister_heures,
            lister_heures_affaire,
            obtenir_dossier_configure,
            choisir_dossier_surveille,
            lister_variables_affaires,
            obtenir_variables_affaire,
            mettre_a_jour_variables_affaire,
            lister_profils_affaire,
            lister_previsions_affaire
        ])
        .setup(|app| {
            let app_handle = app.handle().clone();
            let chemin_db_str = chemin_db(&app_handle)?;

            let mut conn = Connection::open(&chemin_db_str).map_err(|e| e.to_string())?;
            erp::initialiser_schema(&conn).map_err(|e| e.to_string())?;
            erp::migrer_format_dates(&conn).map_err(|e| e.to_string())?;
            erp::migrer_ajouter_colonne_client(&conn).map_err(|e| e.to_string())?;
            erp::migrer_ajouter_colonnes_profil_numero_plan(&conn).map_err(|e| e.to_string())?;
            erp::migrer_ajouter_colonne_contre_fleche(&conn).map_err(|e| e.to_string())?;
            erp::migrer_profils_affaires_ajouter_longueur(&conn).map_err(|e| e.to_string())?;
            config::initialiser_schema(&conn).map_err(|e| e.to_string())?;
            prevision::initialiser_schema_coefficients(&conn).map_err(|e| e.to_string())?;

            // Migration ponctuelle depuis coefficients.json vers la table
            // `coefficients` -- si un fichier existe déjà (installation
            // précédente) mais que la base n'a jamais été peuplée.
            let chemin_coefficients_str = chemin_coefficients(&app_handle)?;
            if config::lire_config(&conn, "coefficients_version")
                .map_err(|e| e.to_string())?
                .is_none()
            {
                if let Ok(coeffs) = CoefficientsExport::charger(&chemin_coefficients_str) {
                    prevision::enregistrer_coefficients(&mut conn, &coeffs)
                        .map_err(|e| e.to_string())?;
                }
            }

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

    let coeffs = prevision::charger_coefficients(&conn)?;
    let prevision = prevision::previsualiser_et_enregistrer(&mut conn, &coeffs, &affaire)?;

    let mut resultat = prevision.heures_par_poste;
    resultat.insert("total".into(), prevision.total_heures);
    Ok(resultat)
}

/// Chiffre un projet à partir de variables saisies à la main, sans passer
/// par `variables_affaires` -- pour estimer une affaire qui n'a pas encore
/// de fichier Excel dans le dossier surveillé (devis, avant-projet...).
/// Contrairement à `previsualiser_affaire`, ne lit ni n'écrit rien d'autre
/// que les coefficients déjà calibrés : c'est une simulation, pas une
/// prévision persistée.
#[tauri::command]
fn chiffrer_manuellement(app: tauri::AppHandle, variables: HashMap<String, f64>) -> Result<HashMap<String, f64>, String> {
    let conn = Connection::open(chemin_db(&app)?).map_err(|e| e.to_string())?;
    let coeffs = prevision::charger_coefficients(&conn)?;
    let prevision = prevision::predire(&coeffs, &variables);

    let mut resultat = prevision.heures_par_poste;
    resultat.insert("total".into(), prevision.total_heures);
    Ok(resultat)
}

#[tauri::command]
fn recalibrer(app: tauri::AppHandle) -> Result<(), String> {
    let mut conn = Connection::open(chemin_db(&app)?).map_err(|e| e.to_string())?;
    let export = calibrer_tous_les_postes(&conn)?;

    // Le JSON reste écrit pour inspection/débogage, mais la base est
    // désormais la source utilisée par previsualiser_affaire.
    let json = serde_json::to_string_pretty(&export).map_err(|e| e.to_string())?;
    std::fs::write(chemin_coefficients(&app)?, json).map_err(|e| e.to_string())?;

    prevision::enregistrer_coefficients(&mut conn, &export)?;

    Ok(())
}

#[derive(Serialize)]
struct CoefficientLigne {
    poste: String,
    variable: String,
    valeur: f64,
}

#[derive(Serialize)]
struct CoefficientsInfo {
    version: Option<u32>,
    date_calibration: Option<String>,
    lignes: Vec<CoefficientLigne>,
}

/// Liste le contenu brut de la table `coefficients`, pour affichage --
/// `lignes` est vide (avec version/date_calibration à None) tant qu'aucune
/// calibration n'a été lancée.
#[tauri::command]
fn lister_coefficients(app: tauri::AppHandle) -> Result<CoefficientsInfo, String> {
    let conn = Connection::open(chemin_db(&app)?).map_err(|e| e.to_string())?;
    prevision::initialiser_schema_coefficients(&conn).map_err(|e| e.to_string())?;

    let version = config::lire_config(&conn, "coefficients_version")?
        .and_then(|v| v.parse().ok());
    let date_calibration = config::lire_config(&conn, "coefficients_date_calibration")?;

    let mut stmt = conn
        .prepare("SELECT poste, variable, valeur FROM coefficients ORDER BY poste, variable")
        .map_err(|e| e.to_string())?;
    let lignes = stmt
        .query_map([], |row| {
            Ok(CoefficientLigne {
                poste: row.get(0)?,
                variable: row.get(1)?,
                valeur: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(CoefficientsInfo { version, date_calibration, lignes })
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

/// Comme `lister_heures`, mais restreint à une seule affaire (clé privée
/// `affaire`) -- utile pour l'écran de prévision qui n'a besoin des heures
/// que de l'affaire actuellement affichée.
#[tauri::command]
fn lister_heures_affaire(app: tauri::AppHandle, affaire: String) -> Result<Vec<HeureRow>, String> {
    let conn = Connection::open(chemin_db(&app)?).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT affaire, ot, date, poste, heures FROM heures WHERE affaire = ?1 ORDER BY rowid")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([&affaire], |row| {
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

#[derive(Serialize)]
struct VariablesAffaireRow {
    affaire: String,
    client: Option<String>,
    profil: Option<String>,
    numero_plan: Option<String>,
    nb_barres: Option<f64>,
    nb_goujons: Option<f64>,
    nb_trous_manuel: Option<f64>,
    nb_trous_numerique: Option<f64>,
    diametre_moyen_numerique: Option<f64>,
    longueur_coupe: Option<f64>,
    contre_fleche: Option<f64>,
}

#[tauri::command]
fn lister_variables_affaires(app: tauri::AppHandle) -> Result<Vec<VariablesAffaireRow>, String> {
    let conn = Connection::open(chemin_db(&app)?).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT affaire, client, profil, numero_plan, nb_barres, nb_goujons,
                    nb_trous_manuel, nb_trous_numerique, diametre_moyen_numerique, longueur_coupe,
                    contre_fleche
             FROM variables_affaires ORDER BY affaire",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(VariablesAffaireRow {
                affaire: row.get(0)?,
                client: row.get(1)?,
                profil: row.get(2)?,
                numero_plan: row.get(3)?,
                nb_barres: row.get(4)?,
                nb_goujons: row.get(5)?,
                nb_trous_manuel: row.get(6)?,
                nb_trous_numerique: row.get(7)?,
                diametre_moyen_numerique: row.get(8)?,
                longueur_coupe: row.get(9)?,
                contre_fleche: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Comme `lister_variables_affaires`, mais restreint à une seule affaire
/// (clé privée `affaire`) -- une erreur est renvoyée si l'affaire n'existe
/// pas encore en base (ex. devis pas encore importé).
#[tauri::command]
fn obtenir_variables_affaire(app: tauri::AppHandle, affaire: String) -> Result<VariablesAffaireRow, String> {
    let conn = Connection::open(chemin_db(&app)?).map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT affaire, client, profil, numero_plan, nb_barres, nb_goujons,
                nb_trous_manuel, nb_trous_numerique, diametre_moyen_numerique, longueur_coupe,
                contre_fleche
         FROM variables_affaires WHERE affaire = ?1",
        [&affaire],
        |row| {
            Ok(VariablesAffaireRow {
                affaire: row.get(0)?,
                client: row.get(1)?,
                profil: row.get(2)?,
                numero_plan: row.get(3)?,
                nb_barres: row.get(4)?,
                nb_goujons: row.get(5)?,
                nb_trous_manuel: row.get(6)?,
                nb_trous_numerique: row.get(7)?,
                diametre_moyen_numerique: row.get(8)?,
                longueur_coupe: row.get(9)?,
                contre_fleche: row.get(10)?,
            })
        },
    )
    .map_err(|e| format!("Affaire '{affaire}' introuvable en base: {e}"))
}

#[derive(Deserialize)]
struct VariablesAffaireEdition {
    profil: Option<String>,
    numero_plan: Option<String>,
    nb_barres: Option<f64>,
    nb_goujons: Option<f64>,
    nb_trous_manuel: Option<f64>,
    nb_trous_numerique: Option<f64>,
    contre_fleche: Option<f64>,
}

/// Met à jour les variables modifiables manuellement depuis l'écran de
/// prévision (les colonnes issues du parsing Excel -- diametre_moyen_numerique,
/// longueur_coupe -- ne sont pas éditées ici). N'insère jamais de nouvelle
/// ligne : l'affaire doit déjà exister dans `variables_affaires` (ce qui est
/// garanti puisque l'écran ne montre le formulaire d'édition que pour une
/// affaire déjà chargée).
#[tauri::command]
fn mettre_a_jour_variables_affaire(app: tauri::AppHandle, affaire: String, variables: VariablesAffaireEdition) -> Result<(), String> {
    let conn = Connection::open(chemin_db(&app)?).map_err(|e| e.to_string())?;
    let n = conn
        .execute(
            "UPDATE variables_affaires SET
                profil = ?1,
                numero_plan = ?2,
                nb_barres = ?3,
                nb_goujons = ?4,
                nb_trous_manuel = ?5,
                nb_trous_numerique = ?6,
                contre_fleche = ?7
             WHERE affaire = ?8",
            params![
                variables.profil,
                variables.numero_plan,
                variables.nb_barres,
                variables.nb_goujons,
                variables.nb_trous_manuel,
                variables.nb_trous_numerique,
                variables.contre_fleche,
                affaire,
            ],
        )
        .map_err(|e| e.to_string())?;

    if n == 0 {
        return Err(format!("Affaire '{affaire}' introuvable en base"));
    }
    Ok(())
}

#[derive(Serialize)]
struct ProfilAffaireRow {
    profil: String,
    longueur: f64,
    l_lam: Option<f64>,
    nb_barres: f64,
}

/// Détail par profil+longueur d'une affaire (table `profils_affaires`) --
/// utile quand une affaire mélange plusieurs profils ou longueurs
/// distincts, chacun avec son propre nb_barres/L-LAM
/// (`variables_affaires.profil`/`nb_barres` ne gardent qu'un résumé du
/// premier). Vide (pas une erreur) si l'affaire n'a pas encore été parsée.
#[tauri::command]
fn lister_profils_affaire(app: tauri::AppHandle, affaire: String) -> Result<Vec<ProfilAffaireRow>, String> {
    let conn = Connection::open(chemin_db(&app)?).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT profil, longueur, l_lam, nb_barres FROM profils_affaires
             WHERE affaire = ?1 ORDER BY profil, longueur",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([&affaire], |row| {
            Ok(ProfilAffaireRow {
                profil: row.get(0)?,
                longueur: row.get(1)?,
                l_lam: row.get(2)?,
                nb_barres: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct PrevisionRow {
    affaire: String,
    poste: String,
    heures_prevues: f64,
    date_prevision: String,
    version_coefficients: Option<String>,
}

/// Retourne les prévisions déjà enregistrées (table `previsions`) pour une
/// seule affaire (clé privée `affaire`), une ligne par poste.
#[tauri::command]
fn lister_previsions_affaire(app: tauri::AppHandle, affaire: String) -> Result<Vec<PrevisionRow>, String> {
    let conn = Connection::open(chemin_db(&app)?).map_err(|e| e.to_string())?;
    prevision::initialiser_schema_previsions(&conn).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT affaire, poste, heures_prevues, date_prevision, version_coefficients
             FROM previsions WHERE affaire = ?1 ORDER BY poste",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([&affaire], |row| {
            Ok(PrevisionRow {
                affaire: row.get(0)?,
                poste: row.get(1)?,
                heures_prevues: row.get(2)?,
                date_prevision: row.get(3)?,
                version_coefficients: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}