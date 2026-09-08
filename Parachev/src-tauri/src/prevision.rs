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

    Ok(CoefficientsExport {
        version,
        date_calibration,
        seuil_diametre_manuel_mm,
        postes,
    })
}

// ---------------------------------------------------------------------------
// Variables d'une affaire (issues de variables_affaires en SQLite,
// ou fournies manuellement pour une simulation avant insertion en base)
// ---------------------------------------------------------------------------

pub type VariablesAffaire = HashMap<String, f64>;

/// Lit les variables d'une affaire directement depuis la table SQLite.
/// Retourne une erreur si l'affaire n'existe pas encore dans la base
/// (ex. devis pas encore importé).
pub fn charger_variables_affaire(
    conn: &Connection,
    affaire: &str,
) -> Result<VariablesAffaire, String> {
    let mut stmt = conn
        .prepare(
            "SELECT nb_barres, nb_goujons, nb_trous_manuel, nb_trous_numerique,
                    diametre_moyen_numerique, longueur_coupe
             FROM variables_affaires WHERE affaire = ?1",
        )
        .map_err(|e| e.to_string())?;

    let resultat = stmt.query_row([affaire], |row| {
        let mut variables = VariablesAffaire::new();
        variables.insert("nb_barres".into(), row.get(0)?);
        variables.insert("nb_goujons".into(), row.get(1)?);
        variables.insert("nb_trous_manuel".into(), row.get(2)?);
        variables.insert("nb_trous_numerique".into(), row.get(3)?);
        variables.insert("diametre_moyen_numerique".into(), row.get(4)?);
        variables.insert("longueur_coupe".into(), row.get(5)?);
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
        let mut temps = params.intercept;
        for (variable, coef) in &params.coefficients {
            let valeur = variables.get(variable).copied().unwrap_or(0.0);
            temps += coef * valeur;
        }
        // Garde-fou : un temps ne peut pas être négatif (extrapolation
        // hors du domaine calibré donnant un résultat aberrant)
        heures_par_poste.insert(poste.clone(), temps.max(0.0));
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
pub fn enregistrer_prevision(
    conn: &mut Connection,
    affaire: &str,
    prevision: &Prevision,
    version_coefficients: &str,
) -> Result<(), String> {
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
pub fn previsualiser_et_enregistrer(
    conn: &mut Connection,
    coeffs: &CoefficientsExport,
    affaire: &str,
) -> Result<Prevision, String> {
    println!("About to previ and register");
    let variables = charger_variables_affaire(conn, affaire)?;
    let prevision = predire(coeffs, &variables);
    enregistrer_prevision(conn, affaire, &prevision, &coeffs.date_calibration)?;
    Ok(prevision)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn coeffs_test() -> CoefficientsExport {
        let mut postes = HashMap::new();
        postes.insert(
            "goujonnage".to_string(),
            PosteCoefficients {
                intercept: 0.5,
                coefficients: HashMap::from([("nb_goujons".to_string(), 0.12)]),
            },
        );
        postes.insert(
            "forage_numerique".to_string(),
            PosteCoefficients {
                intercept: 1.0,
                coefficients: HashMap::from([
                    ("nb_trous_numerique".to_string(), 0.05),
                    ("diametre_moyen_numerique".to_string(), 0.02),
                ]),
            },
        );
        CoefficientsExport {
            version: 1,
            date_calibration: "2026-08-13".into(),
            seuil_diametre_manuel_mm: 40.0,
            postes,
        }
    }

    #[test]
    fn test_predire_formule_simple() {
        let coeffs = coeffs_test();
        let mut variables = VariablesAffaire::new();
        variables.insert("nb_goujons".into(), 60.0);

        let prevision = predire(&coeffs, &variables);
        // 0.5 + 0.12 * 60 = 7.7
        assert!((prevision.heures_par_poste["goujonnage"] - 7.7).abs() < 1e-9);
    }

    #[test]
    fn test_predire_variable_absente_vaut_zero() {
        // Si une variable attendue par le modèle n'est pas fournie,
        // elle doit être traitée comme 0.0, pas planter.
        let coeffs = coeffs_test();
        let variables = VariablesAffaire::new(); // vide
        let prevision = predire(&coeffs, &variables);
        assert!((prevision.heures_par_poste["goujonnage"] - 0.5).abs() < 1e-9);
    }

    #[test]
    fn test_predire_total_heures() {
        let coeffs = coeffs_test();
        let mut variables = VariablesAffaire::new();
        variables.insert("nb_goujons".into(), 60.0);
        variables.insert("nb_trous_numerique".into(), 55.0);
        variables.insert("diametre_moyen_numerique".into(), 14.0);

        let prevision = predire(&coeffs, &variables);
        // goujonnage: 0.5 + 0.12*60 = 7.7
        // forage_numerique: 1.0 + 0.05*55 + 0.02*14 = 1.0 + 2.75 + 0.28 = 4.03
        let total_attendu = 7.7 + 4.03;
        assert!((prevision.total_heures - total_attendu).abs() < 1e-9);
    }
}

#[cfg(test)]
mod tests_json_reel {
    use super::*;

    #[test]
    fn test_charge_coefficients_json_genere() {
        let export = CoefficientsExport::charger("coefficients.json")
            .expect("le fichier coefficients.json de test doit se charger sans erreur");
        assert_eq!(export.postes.len(), 8);
        assert!(export.postes.contains_key("forage_numerique"));
        assert_eq!(
            export.postes["forage_numerique"].coefficients["nb_trous_numerique"],
            0.052
        );
    }
}

#[cfg(test)]
mod tests_persistance {
    use super::*;

    fn preparer_base_test() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE variables_affaires (
                affaire TEXT PRIMARY KEY, nb_barres REAL, nb_goujons REAL,
                nb_trous_manuel REAL, nb_trous_numerique REAL,
                diametre_moyen_numerique REAL, longueur_coupe REAL
            )",
            [],
        )
        .unwrap();
        initialiser_schema_previsions(&conn).unwrap();
        conn
    }

    fn coeffs_test() -> CoefficientsExport {
        let mut postes = HashMap::new();
        postes.insert(
            "goujonnage".to_string(),
            PosteCoefficients {
                intercept: 0.5,
                coefficients: HashMap::from([("nb_goujons".to_string(), 0.12)]),
            },
        );
        CoefficientsExport {
            version: 1,
            date_calibration: "2026-08-25".into(),
            seuil_diametre_manuel_mm: 40.0,
            postes,
        }
    }

    #[test]
    fn test_enregistrer_prevision_puis_relire() {
        let mut conn = preparer_base_test();
        let coeffs = coeffs_test();

        conn.execute(
            "INSERT INTO variables_affaires VALUES ('AFF001', 0, 60, 0, 0, 0, 0)",
            [],
        )
        .unwrap();

        let prevision = previsualiser_et_enregistrer(&mut conn, &coeffs, "AFF001").unwrap();
        assert!((prevision.heures_par_poste["goujonnage"] - 7.7).abs() < 1e-9);

        let heures_en_base: f64 = conn
            .query_row(
                "SELECT heures_prevues FROM previsions WHERE affaire = 'AFF001' AND poste = 'goujonnage'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!((heures_en_base - 7.7).abs() < 1e-9);
    }

    #[test]
    fn test_v2_remplace_v1_sans_fusionner() {
        // Reproduit exactement le scénario décrit : V1 avec moins de
        // goujons, puis V2 avec plus de goujons -- le résultat en base
        // doit refléter UNIQUEMENT la V2, pas une moyenne ou un cumul.
        let mut conn = preparer_base_test();
        let coeffs = coeffs_test();

        // --- V1 : 60 goujons ---
        conn.execute(
            "INSERT INTO variables_affaires VALUES ('AFF001', 0, 60, 0, 0, 0, 0)",
            [],
        )
        .unwrap();
        let prevision_v1 = previsualiser_et_enregistrer(&mut conn, &coeffs, "AFF001").unwrap();
        assert!((prevision_v1.heures_par_poste["goujonnage"] - 7.7).abs() < 1e-9);

        // --- V2 : correction à 100 goujons (plus de goujons que la V1) ---
        conn.execute(
            "UPDATE variables_affaires SET nb_goujons = 100 WHERE affaire = 'AFF001'",
            [],
        )
        .unwrap();
        let prevision_v2 = previsualiser_et_enregistrer(&mut conn, &coeffs, "AFF001").unwrap();
        // 0.5 + 0.12*100 = 12.5
        assert!((prevision_v2.heures_par_poste["goujonnage"] - 12.5).abs() < 1e-9);

        // Vérifications en base : une seule ligne (pas de doublon V1+V2),
        // et cette ligne contient bien la valeur V2, pas V1.
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM previsions WHERE affaire = 'AFF001'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1, "une seule ligne attendue, pas d'accumulation V1+V2");

        let heures_finales: f64 = conn
            .query_row(
                "SELECT heures_prevues FROM previsions WHERE affaire = 'AFF001' AND poste = 'goujonnage'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(
            (heures_finales - 12.5).abs() < 1e-9,
            "doit refléter la V2 (12.5), pas la V1 (7.7) ni une fusion des deux"
        );
    }

    #[test]
    fn test_deux_affaires_distinctes_ne_s_interferent_pas() {
        let mut conn = preparer_base_test();
        let coeffs = coeffs_test();

        conn.execute(
            "INSERT INTO variables_affaires VALUES ('AFF001', 0, 60, 0, 0, 0, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO variables_affaires VALUES ('AFF002', 0, 100, 0, 0, 0, 0)",
            [],
        )
        .unwrap();

        previsualiser_et_enregistrer(&mut conn, &coeffs, "AFF001").unwrap();
        previsualiser_et_enregistrer(&mut conn, &coeffs, "AFF002").unwrap();

        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM previsions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 2, "les deux affaires doivent coexister sans s'écraser");
    }
}