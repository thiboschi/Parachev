use crate::prevision::{CoefficientsExport, PosteCoefficients};
use nalgebra::{DMatrix, DVector};
use rusqlite::Connection;
use std::collections::HashMap;

/// Définition des variables explicatives par poste -- doit rester
/// cohérente avec POSTE_VARIABLES côté pipeline_calibration.py.
pub fn poste_variables() -> HashMap<&'static str, Vec<&'static str>> {
    HashMap::from([
        ("assemblage_tracage", vec!["nb_barres"]),
        ("manutention", vec!["nb_barres"]),
        ("enfilage", vec!["nb_goujons"]),
        ("forage_manuel", vec!["nb_trous_manuel"]),
        ("forage_numerique", vec!["nb_trous_numerique", "diametre_moyen_numerique"]),
        ("goujonnage", vec!["nb_goujons"]),
        ("mise_a_longueur", vec!["nb_barres"]),
        ("oxycoupage", vec!["longueur_coupe"]),
    ])
}

const MIN_OBS_PAR_VARIABLE: usize = 15; // même règle empirique que côté Python
const DIAMETRE_SEUIL_MANUEL_MM: f64 = 40.0;

#[derive(Debug)]
pub struct ResultatCalibration {
    pub poste: String,
    pub n: usize,
    pub r2: f64,
    pub coefficients: PosteCoefficients,
}

/// Une ligne jointe (affaire, heures du poste, valeurs des variables explicatives).
struct LigneCalibration {
    heures: f64,
    valeurs: Vec<f64>,
}

/// Charge, pour un poste donné, les couples (heures réelles, variables)
/// en joignant `heures` et `variables_affaires` sur `affaire`.
fn charger_donnees_poste(
    conn: &Connection,
    poste: &str,
    variables: &[&str],
) -> Result<Vec<LigneCalibration>, String> {
    let colonnes_variables = variables.join(", ");
    let requete = format!(
        "SELECT h.total_heures, {colonnes_variables}
         FROM (
             SELECT affaire, SUM(heures) AS total_heures
             FROM heures WHERE poste = ?1
             GROUP BY affaire
         ) h
         JOIN variables_affaires v ON v.affaire = h.affaire"
    );

    let mut stmt = conn.prepare(&requete).map_err(|e| e.to_string())?;
    let n_variables = variables.len();

    let lignes = stmt
        .query_map([poste], |row| {
            let heures: f64 = row.get(0)?;
            let mut valeurs = Vec::with_capacity(n_variables);
            for i in 0..n_variables {
                valeurs.push(row.get::<_, f64>(1 + i)?);
            }
            Ok(LigneCalibration { heures, valeurs })
        })
        .map_err(|e| e.to_string())?;

    lignes
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

/// Résout la régression linéaire par moindres carrés via décomposition SVD
/// (plus stable numériquement que l'équation normale directe (XᵀX)⁻¹Xᵀy,
/// tout en donnant le même résultat pour un système bien posé).
fn regression_lineaire(donnees: &[LigneCalibration], n_variables: usize) -> (f64, Vec<f64>, f64) {
    let n = donnees.len();

    // Matrice design X avec une colonne de 1 pour l'intercept
    let mut x = DMatrix::<f64>::zeros(n, n_variables + 1);
    let mut y = DVector::<f64>::zeros(n);
    for (i, ligne) in donnees.iter().enumerate() {
        x[(i, 0)] = 1.0;
        for (j, v) in ligne.valeurs.iter().enumerate() {
            x[(i, j + 1)] = *v;
        }
        y[i] = ligne.heures;
    }

    let svd = x.clone().svd(true, true);
    let beta = svd
        .solve(&y, 1e-12)
        .expect("échec de la résolution par moindres carrés");

    let intercept = beta[0];
    let coefficients: Vec<f64> = beta.iter().skip(1).copied().collect();

    // R² = 1 - (somme des carrés résiduels / somme des carrés totaux)
    let y_pred = &x * &beta;
    let residus: f64 = (0..n).map(|i| (y[i] - y_pred[i]).powi(2)).sum();
    let y_moyenne = y.mean();
    let total: f64 = (0..n).map(|i| (y[i] - y_moyenne).powi(2)).sum();
    let r2 = if total > 0.0 { 1.0 - residus / total } else { 0.0 };

    (intercept, coefficients, r2)
}

/// Calibre un seul poste. Retourne None si l'échantillon est insuffisant.
pub fn calibrer_poste(
    conn: &Connection,
    poste: &str,
    variables: &[&str],
) -> Result<Option<ResultatCalibration>, String> {
    let donnees = charger_donnees_poste(conn, poste, variables)?;

    let seuil_min = (MIN_OBS_PAR_VARIABLE * variables.len()).max(variables.len() + 2);
    if donnees.len() < seuil_min {
        println!(
            "[{poste}] échantillon insuffisant : {} affaires (minimum {seuil_min}), ignoré",
            donnees.len()
        );
        return Ok(None);
    }

    let (intercept, coefs, r2) = regression_lineaire(&donnees, variables.len());

    let coefficients: HashMap<String, f64> = variables
        .iter()
        .map(|v| v.to_string())
        .zip(coefs.into_iter())
        .collect();

    println!(
        "[{poste}] n={}  R²={:.2}  coef={:?}",
        donnees.len(),
        r2,
        coefficients
    );

    Ok(Some(ResultatCalibration {
        poste: poste.to_string(),
        n: donnees.len(),
        r2,
        coefficients: PosteCoefficients { intercept, coefficients },
    }))
}

/// Calibre tous les postes exploitables et retourne un CoefficientsExport
/// prêt à être sauvegardé (même format que celui produit par le script Python).
pub fn calibrer_tous_les_postes(conn: &Connection) -> Result<CoefficientsExport, String> {
    let mut postes = HashMap::new();

    for (poste, variables) in poste_variables() {
        if let Some(resultat) = calibrer_poste(conn, poste, &variables)? {
            postes.insert(resultat.poste.clone(), resultat.coefficients);
        }
    }

    Ok(CoefficientsExport {
        version: 1,
        date_calibration: chrono::Local::now().format("%Y-%m-%d").to_string(),
        seuil_diametre_manuel_mm: DIAMETRE_SEUIL_MANUEL_MM,
        postes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn preparer_base_test() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE heures (affaire TEXT, poste TEXT, heures REAL);
             CREATE TABLE variables_affaires (
                 affaire TEXT PRIMARY KEY, nb_barres REAL, nb_goujons REAL,
                 nb_trous_manuel REAL, nb_trous_numerique REAL,
                 diametre_moyen_numerique REAL, longueur_coupe REAL
             );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn test_regression_retrouve_coefficients_connus() {
        let conn = preparer_base_test();

        // Génère des données synthétiques suivant EXACTEMENT
        // heures = 0.5 + 0.12 * nb_goujons (sans bruit), pour vérifier
        // que la régression retrouve les coefficients exacts.
        for i in 0..20 {
            let affaire = format!("AFF{i:03}");
            let nb_goujons = 10.0 + i as f64 * 5.0;
            let heures = 0.5 + 0.12 * nb_goujons;

            conn.execute(
                "INSERT INTO variables_affaires
                 (affaire, nb_barres, nb_goujons, nb_trous_manuel, nb_trous_numerique,
                  diametre_moyen_numerique, longueur_coupe)
                 VALUES (?1, 0, ?2, 0, 0, 0, 0)",
                rusqlite::params![affaire, nb_goujons],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO heures VALUES (?1, 'goujonnage', ?2)",
                rusqlite::params![affaire, heures],
            )
            .unwrap();
        }

        let resultat = calibrer_poste(&conn, "goujonnage", &["nb_goujons"])
            .unwrap()
            .expect("devrait être calibré, échantillon suffisant");

        assert_eq!(resultat.n, 20);
        assert!((resultat.coefficients.intercept - 0.5).abs() < 1e-6);
        assert!((resultat.coefficients.coefficients["nb_goujons"] - 0.12).abs() < 1e-6);
        assert!(resultat.r2 > 0.999); // données sans bruit -> R² quasi parfait
    }

    #[test]
    fn test_echantillon_insuffisant_retourne_none() {
        let conn = preparer_base_test();

        // Seulement 3 affaires -- largement sous le seuil minimum (15 pour 1 variable)
        for i in 0..3 {
            let affaire = format!("AFF{i}");
            conn.execute(
                "INSERT INTO variables_affaires
                 (affaire, nb_barres, nb_goujons, nb_trous_manuel, nb_trous_numerique,
                  diametre_moyen_numerique, longueur_coupe)
                 VALUES (?1, 0, 10, 0, 0, 0, 0)",
                rusqlite::params![affaire],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO heures VALUES (?1, 'goujonnage', 5.0)",
                rusqlite::params![affaire],
            )
            .unwrap();
        }

        let resultat = calibrer_poste(&conn, "goujonnage", &["nb_goujons"]).unwrap();
        assert!(resultat.is_none());
    }

    #[test]
    fn test_regression_multivariable() {
        let conn = preparer_base_test();

        // heures = 1.0 + 0.05*nb_trous_numerique + 0.02*diametre_moyen (sans bruit)
        for i in 0..30 {
            let affaire = format!("AFF{i:03}");
            let nb_trous = 20.0 + i as f64 * 2.0;
            let diametre = 10.0 + (i % 5) as f64;
            let heures = 1.0 + 0.05 * nb_trous + 0.02 * diametre;

            conn.execute(
                "INSERT INTO variables_affaires
                 (affaire, nb_barres, nb_goujons, nb_trous_manuel, nb_trous_numerique,
                  diametre_moyen_numerique, longueur_coupe)
                 VALUES (?1, 0, 0, 0, ?2, ?3, 0)",
                rusqlite::params![affaire, nb_trous, diametre],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO heures VALUES (?1, 'forage_numerique', ?2)",
                rusqlite::params![affaire, heures],
            )
            .unwrap();
        }

        let resultat = calibrer_poste(
            &conn,
            "forage_numerique",
            &["nb_trous_numerique", "diametre_moyen_numerique"],
        )
        .unwrap()
        .expect("devrait être calibré");

        assert!((resultat.coefficients.intercept - 1.0).abs() < 1e-6);
        assert!(
            (resultat.coefficients.coefficients["nb_trous_numerique"] - 0.05).abs() < 1e-6
        );
        assert!(
            (resultat.coefficients.coefficients["diametre_moyen_numerique"] - 0.02).abs() < 1e-6
        );
    }

    #[test]
    fn test_calibrer_tous_les_postes_ignore_postes_absents() {
        let conn = preparer_base_test();
        // Base vide : aucun poste ne doit être calibré, mais ça ne doit pas planter
        let export = calibrer_tous_les_postes(&conn).unwrap();
        assert!(export.postes.is_empty());
        assert_eq!(export.version, 1);
    }
}