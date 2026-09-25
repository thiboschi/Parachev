// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod erp;
mod msg;
mod parsing;
mod watcher;
mod prevision;
mod calibration;
mod config;
mod indexeur;
mod recherche;

use crate::prevision::{CoefficientsExport};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use crate::calibration::{calibrer_tous_les_postes, poste_variables};
use crate::watcher::Progression;
use tauri::{Emitter, Manager};
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

/// Connexion pour une commande de l'interface. Le thread d'indexation
/// écrit par lots de ~2 s : sans délai d'attente, une écriture de
/// l'interface pendant un lot échouerait ("database is locked").
fn ouvrir_db(app: &tauri::AppHandle) -> Result<Connection, String> {
    let conn = Connection::open(chemin_db(app)?).map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())?;
    Ok(conn)
}

fn chemin_coefficients(app: &tauri::AppHandle) -> Result<String, String> {
    Ok(dossier_donnees(app)?
        .join("coefficients.json")
        .to_string_lossy()
        .to_string())
}

/// Dernier avancement connu de l'analyse des fichiers, partagé entre le
/// thread d'indexation et la commande `obtenir_progression_indexation`
/// (une page ouverte après le début du scan a manqué les premiers
/// événements et lit l'état courant ici).
type EtatProgression = Arc<Mutex<Progression>>;

/// Événement émis vers l'interface à chaque rapport de progression.
const EVENEMENT_PROGRESSION: &str = "indexation-progression";

/// Intervalle minimum entre deux envois de progression à l'interface (le
/// scan en produit un par fichier ; ~10 rafraîchissements/s suffisent).
const INTERVALLE_ENVOI_PROGRESSION: std::time::Duration = std::time::Duration::from_millis(100);

/// Lance, dans un thread dédié, le scan initial du dossier puis sa
/// surveillance. Chaque rapport de progression met à jour l'état partagé
/// (lu aussi par `obtenir_progression_indexation`) et est envoyé à
/// l'interface au plus toutes les 100 ms. Journal : `indexation.log` dans
/// le dossier de données de l'app.
fn lancer_indexation(app: tauri::AppHandle, chemin_dossier: String, chemin_db: String) {
    std::thread::spawn(move || {
        let etat = app.state::<EtatProgression>().inner().clone();
        let chemin_journal = dossier_donnees(&app).ok().map(|d| d.join("indexation.log"));
        let journal = watcher::Journal::ouvrir(chemin_journal.as_deref());
        let dernier_envoi = Mutex::new(std::time::Instant::now() - INTERVALLE_ENVOI_PROGRESSION);
        let rapport = |p: &Progression| {
            if let Ok(mut e) = etat.lock() {
                *e = p.clone();
            }
            let Ok(mut dernier) = dernier_envoi.lock() else { return };
            if !p.en_cours || p.etape != "analyse" || dernier.elapsed() >= INTERVALLE_ENVOI_PROGRESSION {
                let _ = app.emit(EVENEMENT_PROGRESSION, p);
                *dernier = std::time::Instant::now();
            }
        };
        watcher::scanner_dossier_initial(&chemin_dossier, &chemin_db, &rapport, &journal);
        if let Err(e) = watcher::surveiller_dossier(&chemin_dossier, &chemin_db, &journal) {
            journal.ecrire(&format!("Erreur watcher: {e:?}"));
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(EtatProgression::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            previsualiser_affaire,
            chiffrer_manuellement,
            recalibrer,
            lister_coefficients,
            modifier_coefficient,
            lister_variables_poste,
            lister_heures,
            lister_heures_affaire,
            obtenir_dossier_configure,
            choisir_dossier_surveille,
            lister_variables_affaires,
            obtenir_variables_affaire,
            mettre_a_jour_variables_affaire,
            lister_profils_affaire,
            lister_goujons_affaire,
            lister_cfl_affaire,
            lister_previsions_affaire,
            lister_affaires_recherche,
            rechercher_texte,
            obtenir_dossier_affaire,
            ouvrir_document,
            obtenir_progression_indexation
        ])
        .setup(|app| {
            let app_handle = app.handle().clone();
            let chemin_db_str = chemin_db(&app_handle)?;

            let mut conn = Connection::open(&chemin_db_str).map_err(|e| e.to_string())?;
            // WAL : l'interface peut lire pendant que le thread d'indexation
            // écrit (sinon "database is locked" pendant le scan initial).
            conn.pragma_update(None, "journal_mode", "WAL").map_err(|e| e.to_string())?;
            erp::initialiser_schema(&conn).map_err(|e| e.to_string())?;
            erp::migrer_format_dates(&conn).map_err(|e| e.to_string())?;
            erp::migrer_ajouter_colonne_client(&conn).map_err(|e| e.to_string())?;
            erp::migrer_ajouter_colonnes_profil_numero_plan(&conn).map_err(|e| e.to_string())?;
            erp::migrer_ajouter_colonne_contre_fleche(&conn).map_err(|e| e.to_string())?;
            erp::migrer_profils_affaires_ajouter_longueur(&conn).map_err(|e| e.to_string())?;
            config::initialiser_schema(&conn).map_err(|e| e.to_string())?;
            prevision::initialiser_schema_coefficients(&conn).map_err(|e| e.to_string())?;
            indexeur::initialiser_schema(&conn).map_err(|e| e.to_string())?;

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
                lancer_indexation(app_handle, chemin_dossier, chemin_db_str);
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
    let conn = ouvrir_db(&app)?;
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

    lancer_indexation(app, chemin.clone(), chemin_db_str);

    Ok(Some(chemin))
}

/// Avancement courant de l'analyse des fichiers (voir EtatProgression).
#[tauri::command]
fn obtenir_progression_indexation(etat: tauri::State<EtatProgression>) -> Progression {
    etat.lock().map(|p| p.clone()).unwrap_or_default()
}

#[tauri::command]
fn previsualiser_affaire(app: tauri::AppHandle, affaire: String) -> Result<HashMap<String, f64>, String> {
    let mut conn = ouvrir_db(&app)?;
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
    let conn = ouvrir_db(&app)?;
    let coeffs = prevision::charger_coefficients(&conn)?;
    let prevision = prevision::predire(&coeffs, &variables);

    let mut resultat = prevision.heures_par_poste;
    resultat.insert("total".into(), prevision.total_heures);
    Ok(resultat)
}

#[tauri::command]
fn recalibrer(app: tauri::AppHandle) -> Result<(), String> {
    let mut conn = ouvrir_db(&app)?;
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
    let conn = ouvrir_db(&app)?;
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

/// Modifie ou ajoute un coefficient (poste+variable), pour des tests
/// manuels depuis l'écran Coefficients -- ne relance pas de calibration,
/// n'incrémente pas la version, juste la valeur en base.
#[tauri::command]
fn modifier_coefficient(app: tauri::AppHandle, poste: String, variable: String, valeur: f64) -> Result<(), String> {
    let conn = ouvrir_db(&app)?;
    prevision::modifier_coefficient(&conn, &poste, &variable, valeur)
}

/// Variables explicatives connues par poste (voir calibration::poste_variables)
/// -- utilisé par l'écran Coefficients pour proposer les bons champs même
/// sur un poste pas encore calibré (aucune ligne en base pour l'instant).
#[tauri::command]
fn lister_variables_poste() -> HashMap<String, Vec<String>> {
    poste_variables()
        .into_iter()
        .map(|(poste, variables)| {
            (poste.to_string(), variables.into_iter().map(str::to_string).collect())
        })
        .collect()
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
    let conn = ouvrir_db(&app)?;
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
    let conn = ouvrir_db(&app)?;
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
    numero_offre: Option<String>,
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
    let conn = ouvrir_db(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT affaire, client, profil, numero_plan, numero_offre, nb_barres, nb_goujons,
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
                numero_offre: row.get(4)?,
                nb_barres: row.get(5)?,
                nb_goujons: row.get(6)?,
                nb_trous_manuel: row.get(7)?,
                nb_trous_numerique: row.get(8)?,
                diametre_moyen_numerique: row.get(9)?,
                longueur_coupe: row.get(10)?,
                contre_fleche: row.get(11)?,
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
    let conn = ouvrir_db(&app)?;
    conn.query_row(
        "SELECT affaire, client, profil, numero_plan, numero_offre, nb_barres, nb_goujons,
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
                numero_offre: row.get(4)?,
                nb_barres: row.get(5)?,
                nb_goujons: row.get(6)?,
                nb_trous_manuel: row.get(7)?,
                nb_trous_numerique: row.get(8)?,
                diametre_moyen_numerique: row.get(9)?,
                longueur_coupe: row.get(10)?,
                contre_fleche: row.get(11)?,
            })
        },
    )
    .map_err(|e| format!("Affaire '{affaire}' introuvable en base: {e}"))
}

#[derive(Deserialize)]
struct VariablesAffaireEdition {
    profil: Option<String>,
    numero_plan: Option<String>,
    numero_offre: Option<String>,
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
    let conn = ouvrir_db(&app)?;
    let n = conn
        .execute(
            "UPDATE variables_affaires SET
                profil = ?1,
                numero_plan = ?2,
                numero_offre = ?9,
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
                variables.numero_offre,
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
    let conn = ouvrir_db(&app)?;
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
struct GoujonAffaireRow {
    rep: String,
    profil: String,
    longueur: f64,
    diametre: Option<f64>,
    hauteur: Option<f64>,
    nb_goujons: f64,
}

/// Détail des goujons d'une affaire (table `goujons_affaires`) : une ligne
/// par poutre (rep) et par type de goujon (diamètre x hauteur), une même
/// poutre pouvant mélanger plusieurs diamètres -- regroupement par rep
/// laissé au front (voir GoujonsAffaireRow côté TS). Vide si l'affaire n'a
/// pas de goujonnage ou n'a pas encore été parsée.
#[tauri::command]
fn lister_goujons_affaire(app: tauri::AppHandle, affaire: String) -> Result<Vec<GoujonAffaireRow>, String> {
    let conn = ouvrir_db(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT rep, profil, longueur, diametre, hauteur, nb_goujons FROM goujons_affaires
             WHERE affaire = ?1 ORDER BY rep, diametre, hauteur",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([&affaire], |row| {
            Ok(GoujonAffaireRow {
                rep: row.get(0)?,
                profil: row.get(1)?,
                longueur: row.get(2)?,
                diametre: row.get(3)?,
                hauteur: row.get(4)?,
                nb_goujons: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct CflAffaireRow {
    rep: String,
    profil: String,
    longueur: f64,
    cfl: Option<f64>,
}

/// Détail de la contre-flèche d'une affaire (table `cfl_affaires`) : une
/// ligne par barre (Rep de FC-PRES/FC-PRESS), `cfl` étant `null` si cette
/// barre précise n'a pas de valeur saisie. Vide si l'affaire n'utilise pas
/// le poste presse/redressage ou n'a pas encore été parsée.
#[tauri::command]
fn lister_cfl_affaire(app: tauri::AppHandle, affaire: String) -> Result<Vec<CflAffaireRow>, String> {
    let conn = ouvrir_db(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT rep, profil, longueur, cfl FROM cfl_affaires
             WHERE affaire = ?1 ORDER BY rep",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([&affaire], |row| {
            Ok(CflAffaireRow {
                rep: row.get(0)?,
                profil: row.get(1)?,
                longueur: row.get(2)?,
                cfl: row.get(3)?,
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
    let conn = ouvrir_db(&app)?;
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
/// Une ligne par affaire, toutes sources fusionnées (dossier, RDE, fiche,
/// SUIVI, ERP) -- voir recherche::lister_affaires. Filtrée côté interface.
#[tauri::command]
fn lister_affaires_recherche(app: tauri::AppHandle) -> Result<Vec<recherche::AffaireRecherche>, String> {
    let conn = ouvrir_db(&app)?;
    recherche::lister_affaires(&conn)
}

/// Recherche plein texte dans les documents indexés (mails, RDE, fiches,
/// noms de fichiers et de dossiers).
#[tauri::command]
fn rechercher_texte(app: tauri::AppHandle, texte: String) -> Result<Vec<recherche::ResultatTexte>, String> {
    let conn = ouvrir_db(&app)?;
    recherche::rechercher_texte(&conn, &texte)
}

/// Détail du dossier d'une affaire : RDE, laminage, opérations par source,
/// documents, affaires de référence.
#[tauri::command]
fn obtenir_dossier_affaire(app: tauri::AppHandle, affaire: String) -> Result<recherche::DossierAffaire, String> {
    let conn = ouvrir_db(&app)?;
    recherche::obtenir_dossier(&conn, &affaire)
}

/// Ouvre un document avec l'application par défaut du système. Limité aux
/// fichiers présents dans l'index (pas de chemin arbitraire venant de l'UI).
#[tauri::command]
fn ouvrir_document(app: tauri::AppHandle, chemin: String) -> Result<(), String> {
    let conn = ouvrir_db(&app)?;
    if !recherche::est_document_indexe(&conn, &chemin)? {
        return Err("Document inconnu de l'index".into());
    }
    tauri_plugin_opener::open_path(&chemin, None::<&str>).map_err(|e| e.to_string())
}
