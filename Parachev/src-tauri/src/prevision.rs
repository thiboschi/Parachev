use rusqlite::Connection;
use serde::Deserialize;
use std::collections::HashMap;
use std::fs;

// ---------------------------------------------------------------------------
// Coefficients calibrés (exportés par le script Python de calibration)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CoefficientsExport {
    pub version: u32,
    pub date_calibration: String,
    pub seuil_diametre_manuel_mm: f64,
    pub postes: HashMap<String, PosteCoefficients>,
}

#[derive(Debug, Deserialize)]
pub struct PosteCoefficients {
    pub intercept: f64,
    pub coefficients: HashMap<String, f64>,
}

impl CoefficientsExport {
    pub fn charger(path: &str) -> Result<Self, String> {
        let contenu = fs::read_to_string(path)
            .map_err(|e| format!("Impossible de lire {path}: {e}"))?;
        serde_json::from_str(&contenu).map_err(|e| format!("JSON invalide dans {path}: {e}"))
    }
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

    resultat.map_err(|e| format!("Affaire '{affaire}' introuvable en base: {e}"))
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

/// Combine chargement des variables depuis SQLite + application des coefficients,
/// pour une affaire déjà présente en base (ex. devis importé mais pas encore réalisé).
pub fn predire_affaire(
    conn: &Connection,
    coeffs: &CoefficientsExport,
    affaire: &str,
) -> Result<Prevision, String> {
    let variables = charger_variables_affaire(conn, affaire)?;
    Ok(predire(coeffs, &variables))
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

    #[test]
    fn test_predire_affaire_depuis_sqlite() {
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
        conn.execute(
            "INSERT INTO variables_affaires VALUES ('AFF001', 20, 60, 5, 55, 14.0, 340.0)",
            [],
        )
        .unwrap();

        let coeffs = coeffs_test();
        let prevision = predire_affaire(&conn, &coeffs, "AFF001").unwrap();

        assert!((prevision.heures_par_poste["goujonnage"] - 7.7).abs() < 1e-9);
    }

    #[test]
    fn test_affaire_introuvable_retourne_erreur() {
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

        let coeffs = coeffs_test();
        let resultat = predire_affaire(&conn, &coeffs, "INEXISTANTE");
        assert!(resultat.is_err());
    }
}