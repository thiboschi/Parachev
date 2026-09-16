use crate::prevision::{CoefficientsExport, PosteCoefficients};
use nalgebra::{DMatrix, DVector};
use rusqlite::Connection;
use std::collections::HashMap;

/// Définition des variables explicatives par poste -- doit rester
/// cohérente avec POSTE_VARIABLES côté pipeline_calibration.py.
///
/// Note : "enfilage" n'existe PAS dans les données ERP réelles (confirmé
/// sur le fichier complet, 15 postes recensés, enfilage absent) --
/// volontairement retiré d'ici pour ne pas laisser une entrée trompeuse.
pub fn poste_variables() -> HashMap<&'static str, Vec<&'static str>> {
    HashMap::from([
        ("assemblage_tracage", vec!["nb_barres"]),
        ("manutention", vec!["nb_barres"]),
        ("forage_manuel", vec!["nb_trous_manuel"]),
        ("forage_numerique", vec!["nb_trous_numerique", "diametre_moyen_numerique"]),
        ("goujonnage", vec!["nb_goujons"]),
        ("mise_a_longueur", vec!["nb_barres"]),
        ("oxycoupage", vec!["longueur_coupe"]),
    ])
}

const MIN_OBS_PAR_VARIABLE: usize = 15;
const DIAMETRE_SEUIL_MANUEL_MM: f64 = 40.0;

#[derive(Debug)]
pub struct ResultatCalibration {
    pub poste: String,
    // pub n: usize,
    // pub r2: f64,
    pub coefficients: PosteCoefficients,
}

/// Une ligne jointe (affaire, heures du poste, valeurs des variables explicatives).
struct LigneCalibration {
    heures: f64,
    valeurs: Vec<f64>,
}

/// Charge, pour un poste donné, les couples (heures réelles, variables)
/// en joignant `heures` et `variables_affaires` sur `affaire`.
///
/// Exclut les affaires dont une des variables requises est NULL en base --
/// ex. une affaire dont les heures ERP sont importées mais dont le fichier
/// Excel n'a pas encore été parsé n'a que `affaire`/`client` de renseignés
/// (voir erp::inserer_clients), tout le reste vaut NULL. Les inclure avec
/// une valeur à 0 fausserait la régression (des heures réelles associées à
/// "0 barre"/"0 trou" alors que la variable est en fait inconnue, pas
/// nulle) ; mieux vaut les ignorer que produire un coefficient biaisé.
fn charger_donnees_poste(conn: &Connection, poste: &str, variables: &[&str]) -> Result<Vec<LigneCalibration>, String> {
    let colonnes_variables = variables.join(", ");
    let conditions_non_null = variables
        .iter()
        .map(|v| format!("v.{v} IS NOT NULL"))
        .collect::<Vec<_>>()
        .join(" AND ");
    let requete = format!(
        "SELECT h.total_heures, {colonnes_variables}
         FROM (
             SELECT affaire, SUM(heures) AS total_heures
             FROM heures WHERE poste = ?1
             GROUP BY affaire
         ) h
         JOIN variables_affaires v ON v.affaire = h.affaire
         WHERE {conditions_non_null}"
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

    let y_pred = &x * &beta;
    let residus: f64 = (0..n).map(|i| (y[i] - y_pred[i]).powi(2)).sum();
    let y_moyenne = y.mean();
    let total: f64 = (0..n).map(|i| (y[i] - y_moyenne).powi(2)).sum();
    let r2 = if total > 0.0 { 1.0 - residus / total } else { 0.0 };

    (intercept, coefficients, r2)
}

/// Calibre un seul poste. Retourne None si l'échantillon est insuffisant.
pub fn calibrer_poste(conn: &Connection, poste: &str, variables: &[&str]) -> Result<Option<ResultatCalibration>, String> {
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
        // n: donnees.len(),
        // r2,
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