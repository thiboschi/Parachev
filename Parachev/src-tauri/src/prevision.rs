use crate::config;
use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::fs;

// ---------------------------------------------------------------------------
// Coefficients calibrés (exportés par le script Python de calibration)
// ---------------------------------------------------------------------------

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct CoefficientsExport {
    pub version: u32,
    pub date_calibration: String,
    pub seuil_diametre_manuel_mm: f64,
    pub postes: HashMap<String, PosteCoefficients>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PosteCoefficients {
    pub intercept: f64,
    pub coefficients: HashMap<String, f64>,
}

impl CoefficientsExport {
    pub fn charger(path: &str) -> Result<Self, String> {
        println!("{}", path);
        let contenu = fs::read_to_string(path)
            .map_err(|e| {
                eprintln!("Impossible de lire {path}: {e}");
                format!("Impossible de lire {path}: {e}")
            })?;
        println!("c'est bon");
        serde_json::from_str(&contenu).map_err(|e|{ 
            eprintln!("JSON invalide dans {path}: {e}");
            format!("JSON invalide dans {path}: {e}")})
    }
}

// ---------------------------------------------------------------------------
// Persistance des coefficients en SQLite (remplace la lecture répétée du
// fichier coefficients.json à chaque prévision)
// ---------------------------------------------------------------------------

const CLE_INTERCEPT: &str = "__intercept__";
const CLE_VERSION: &str = "coefficients_version";
const CLE_DATE_CALIBRATION: &str = "coefficients_date_calibration";
const CLE_SEUIL_DIAMETRE_MANUEL_MM: &str = "coefficients_seuil_diametre_manuel_mm";

pub fn initialiser_schema_coefficients(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS coefficients (
            poste    TEXT NOT NULL,
            variable TEXT NOT NULL,
            valeur   REAL NOT NULL,
            PRIMARY KEY (poste, variable)
        );",
    )
}

/// Remplace intégralement le contenu de la table `coefficients` (et les
/// métadonnées associées dans `configuration`) par celui de `coeffs`.
/// Un remplacement complet, plutôt qu'un upsert, garantit qu'une variable ou
/// un poste retiré lors d'une nouvelle calibration ne reste pas orphelin.
pub fn enregistrer_coefficients(conn: &mut Connection, coeffs: &CoefficientsExport) -> Result<(), String> {
    initialiser_schema_coefficients(conn).map_err(|e| e.to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM coefficients", []).map_err(|e| e.to_string())?;

    for (poste, params) in &coeffs.postes {
        tx.execute(
            "INSERT INTO coefficients (poste, variable, valeur) VALUES (?1, ?2, ?3)",
            params![poste, CLE_INTERCEPT, params.intercept],
        )
        .map_err(|e| e.to_string())?;

        for (variable, valeur) in &params.coefficients {
            tx.execute(
                "INSERT INTO coefficients (poste, variable, valeur) VALUES (?1, ?2, ?3)",
                params![poste, variable, valeur],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;

    config::ecrire_config(conn, CLE_VERSION, &coeffs.version.to_string())?;
    config::ecrire_config(conn, CLE_DATE_CALIBRATION, &coeffs.date_calibration)?;
    config::ecrire_config(
        conn,
        CLE_SEUIL_DIAMETRE_MANUEL_MM,
        &coeffs.seuil_diametre_manuel_mm.to_string(),
    )?;

    Ok(())
}

/// Reconstruit un `CoefficientsExport` à partir de la table `coefficients`
/// et des métadonnées en base -- utilisé à la place de la lecture directe
/// du fichier JSON pour chaque prévision.
pub fn charger_coefficients(conn: &Connection) -> Result<CoefficientsExport, String> {
    println!("charger_coef");
    let version: u32 = config::lire_config(conn, CLE_VERSION)?
        .ok_or_else(|| "Aucune version de coefficients en base -- calibrer d'abord".to_string())?
        .parse()
        .map_err(|e| format!("Version de coefficients invalide en base: {e}"))?;

    let date_calibration = config::lire_config(conn, CLE_DATE_CALIBRATION)?
        .ok_or_else(|| "Aucune date de calibration en base".to_string())?;

    let seuil_diametre_manuel_mm: f64 = config::lire_config(conn, CLE_SEUIL_DIAMETRE_MANUEL_MM)?
        .ok_or_else(|| "Aucun seuil de diamètre manuel en base".to_string())?
        .parse()
        .map_err(|e| format!("Seuil de diamètre manuel invalide en base: {e}"))?;

    let mut stmt = conn
        .prepare("SELECT poste, variable, valeur FROM coefficients")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, f64>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut postes: HashMap<String, PosteCoefficients> = HashMap::new();
    for row in rows {
        let (poste, variable, valeur) = row.map_err(|e| e.to_string())?;
        let entry = postes.entry(poste).or_insert_with(|| PosteCoefficients {
            intercept: 0.0,
            coefficients: HashMap::new(),
        });
        if variable == CLE_INTERCEPT {
            entry.intercept = valeur;
        } else {
            entry.coefficients.insert(variable, valeur);
        }
    }

    if postes.is_empty() {
        return Err("Aucun coefficient en base -- calibrer d'abord".to_string());
    }

    Ok(CoefficientsExport {version, date_calibration, seuil_diametre_manuel_mm, postes})
}

// ---------------------------------------------------------------------------
// Variables d'une affaire (issues de variables_affaires en SQLite,
// ou fournies manuellement pour une simulation avant insertion en base)
// ---------------------------------------------------------------------------

pub type VariablesAffaire = HashMap<String, f64>;

/// Lit les variables d'une affaire directement depuis la table SQLite.
/// Retourne une erreur si l'affaire n'existe pas encore dans la base
/// (ex. devis pas encore importé).
pub fn charger_variables_affaire(conn: &Connection, affaire: &str) -> Result<VariablesAffaire, String> {
    let mut stmt = conn
        .prepare(
            "SELECT nb_barres, nb_goujons, nb_trous_manuel, nb_trous_numerique,
                    diametre_moyen_numerique, longueur_coupe
             FROM variables_affaires WHERE affaire = ?1",
        )
        .map_err(|e| e.to_string())?;

    let resultat = stmt.query_row([affaire], |row| {
        let mut variables = VariablesAffaire::new();
        variables.insert("nb_barres".into(), row.get::<_, Option<f64>>(0)?.unwrap_or(0.0));
        variables.insert("nb_goujons".into(), row.get::<_, Option<f64>>(1)?.unwrap_or(0.0));
        variables.insert("nb_trous_manuel".into(), row.get::<_, Option<f64>>(2)?.unwrap_or(0.0));
        variables.insert("nb_trous_numerique".into(), row.get::<_, Option<f64>>(3)?.unwrap_or(0.0));
        variables.insert("diametre_moyen_numerique".into(), row.get::<_, Option<f64>>(4)?.unwrap_or(0.0));
        variables.insert("longueur_coupe".into(), row.get::<_, Option<f64>>(5)?.unwrap_or(0.0));
        Ok(variables)
    });

    resultat.map_err(|e|{ 
        eprintln!("Affaire '{affaire}' introuvable en base: {e}");
        format!("Affaire '{affaire}' introuvable en base: {e}")})
}

// ---------------------------------------------------------------------------
// Prévision
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub struct Prevision {
    pub heures_par_poste: HashMap<String, f64>,
    pub total_heures: f64,
}

/// Applique la formule linéaire calibrée : temps = intercept + Σ(coef_i × x_i)
/// pour chaque poste calibré, à partir des variables fournies.
pub fn predire(coeffs: &CoefficientsExport, variables: &VariablesAffaire) -> Prevision {
    println!("predire");
    let mut heures_par_poste = HashMap::new();

    for (poste, params) in &coeffs.postes {
        let toutes_variables_nulles = params
            .coefficients
            .keys()
            .all(|variable| variables.get(variable).copied().unwrap_or(0.0) == 0.0);

        // Si aucune des variables du poste n'est renseignée (toutes à 0),
        // il n'y a pas de travail à prévoir pour ce poste, même si
        // l'intercept calibré est non nul.
        let temps = if toutes_variables_nulles {
            0.0
        } else {
            let mut temps = params.intercept;
            for (variable, coef) in &params.coefficients {
                let valeur = variables.get(variable).copied().unwrap_or(0.0);
                temps += coef * valeur;
            }
            // Garde-fou : un temps ne peut pas être négatif (extrapolation
            // hors du domaine calibré donnant un résultat aberrant)
            temps.max(0.0)
        };
        heures_par_poste.insert(poste.clone(), temps);
    }

    let total_heures = heures_par_poste.values().sum();
    Prevision { heures_par_poste, total_heures }
}

// ---------------------------------------------------------------------------
// Persistance des prévisions (table previsions)
// ---------------------------------------------------------------------------

/// Crée la table previsions si elle n'existe pas encore.
/// Une prévision = un total d'heures par (affaire, poste), remplacé
/// intégralement à chaque nouveau calcul (pas d'historique de versions).
pub fn initialiser_schema_previsions(conn: &Connection) -> rusqlite::Result<()> {
    println!("Create table prevision");
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS previsions (
            affaire              TEXT NOT NULL,
            poste                TEXT NOT NULL,
            heures_prevues       REAL NOT NULL,
            date_prevision       TEXT NOT NULL,
            version_coefficients TEXT,
            PRIMARY KEY (affaire, poste)
        );",
    )
}

/// Enregistre une prévision en base : supprime les anciennes lignes de
/// cette affaire puis insère les nouvelles. Idempotent -- si les variables
/// de l'affaire ont changé entre deux appels (ex. plus de goujons en V2
/// qu'en V1), l'ancien résultat est intégralement remplacé, pas fusionné.
pub fn enregistrer_prevision(conn: &mut Connection, affaire: &str, prevision: &Prevision, version_coefficients: &str) -> Result<(), String> {
    println!("Prevision enregistrée");
    let date_prevision = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM previsions WHERE affaire = ?1",
        rusqlite::params![affaire],
    )
    .map_err(|e| e.to_string())?;

    for (poste, heures) in &prevision.heures_par_poste {
        tx.execute(
            "INSERT INTO previsions (affaire, poste, heures_prevues, date_prevision, version_coefficients)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![affaire, poste, heures, date_prevision, version_coefficients],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Combine calcul de la prévision + enregistrement en base, en une seule
/// opération -- c'est cette fonction que la commande Tauri doit appeler.
pub fn previsualiser_et_enregistrer(conn: &mut Connection, coeffs: &CoefficientsExport, affaire: &str) -> Result<Prevision, String> {
    println!("About to previ and register");
    let variables = charger_variables_affaire(conn, affaire)?;
    let prevision = predire(coeffs, &variables);
    enregistrer_prevision(conn, affaire, &prevision, &coeffs.date_calibration)?;
    Ok(prevision)
}
