use crate::prevision::{self, CoefficientsExport, PosteCoefficients, VariablesConnues, POSTES_FORFAIT, POSTES_PAR_BARRE};
use nalgebra::{DMatrix, DVector};
use rusqlite::Connection;
use std::collections::HashMap;

/// Définition des variables explicatives par poste -- doit rester
/// cohérente avec POSTE_VARIABLES côté pipeline_calibration.py.
///
/// Les postes de POSTES_PAR_BARRE (assemblage, presse, robot, P3, soudage) et de
/// POSTES_FORFAIT (soudage sous flux, contrôle CND) y sont ajoutés avec leur
/// variable dérivée (voir prevision::charger_variables) -- sauf s'ils ont
/// déjà leurs variables ici (forage numérique), la variable par barre
/// n'étant alors qu'un repli (voir calibrer_poste). Seuls
/// "reparation" et "casse_machine" restent sans modèle : ce sont des aléas,
/// pas du travail prévisible.
///
/// Note : "enfilage" n'existe PAS dans les données ERP réelles (confirmé
/// sur le fichier complet, 15 postes recensés, enfilage absent) --
/// volontairement retiré d'ici pour ne pas laisser une entrée trompeuse.
pub fn poste_variables() -> HashMap<&'static str, Vec<&'static str>> {
    let mut postes = HashMap::from([
        ("manutention", vec!["nb_barres"]),
        ("forage_manuel", vec!["nb_trous_manuel"]),
        ("forage_numerique", vec!["nb_trous_numerique", "diametre_moyen_numerique"]),
        ("goujonnage", vec!["nb_goujons"]),
        ("mise_a_longueur", vec!["nb_barres"]),
        ("oxycoupage", vec!["longueur_coupe"]),
    ]);
    for (poste, variable) in POSTES_PAR_BARRE.iter().chain(POSTES_FORFAIT.iter()) {
        postes.entry(poste).or_insert_with(|| vec![variable]);
    }
    postes
}

const MIN_OBS_PAR_VARIABLE: usize = 10;
/// En dessous de MIN_OBS_PAR_VARIABLE, la régression est remplacée par un
/// ratio médian heures/quantité (ou un forfait), à partir de ce nombre
/// d'affaires.
const MIN_OBS_REPLI: usize = 5;
const DIAMETRE_SEUIL_MANUEL_MM: f64 = 40.0;

#[derive(Debug)]
pub struct ResultatCalibration {
    pub poste: String,
    pub coefficients: PosteCoefficients,
}

/// Une ligne jointe (affaire, heures du poste, valeurs des variables explicatives).
#[derive(Clone)]
struct LigneCalibration {
    heures: f64,
    valeurs: Vec<f64>,
}

/// Heures réelles totales du poste, par affaire (ERP).
fn heures_par_affaire(conn: &Connection, poste: &str) -> Result<Vec<(String, f64)>, String> {
    let mut stmt = conn
        .prepare("SELECT affaire, SUM(heures) FROM heures WHERE poste = ?1 GROUP BY affaire HAVING SUM(heures) > 0")
        .map_err(|e| e.to_string())?;
    let lignes = stmt
        .query_map([poste], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?;
    lignes.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Couples (heures réelles, variables) d'un poste, en joignant les heures
/// ERP aux variables des affaires (`variables`, voir prevision::charger_variables).
///
/// Exclut les affaires dont une des variables requises est inconnue --
/// ex. une affaire dont les heures ERP sont importées mais dont le fichier
/// Excel n'a pas encore été parsé n'a que `affaire`/`client` de renseignés
/// (voir erp::inserer_clients), tout le reste vaut NULL. Les inclure avec
/// une valeur à 0 fausserait la régression (des heures réelles associées à
/// "0 barre"/"0 trou" alors que la variable est en fait inconnue, pas
/// nulle) ; mieux vaut les ignorer que produire un coefficient biaisé.
///
/// Exclut aussi les affaires dont toutes les variables valent 0 : predire
/// ne chiffre rien pour elles, la calibration ne doit donc pas en tenir
/// compte (ex. heures de presse sur une affaire où la presse n'était pas
/// prévue).
fn charger_donnees_poste(
    conn: &Connection,
    poste: &str,
    noms_variables: &[&str],
    variables: &HashMap<String, VariablesConnues>,
) -> Result<Vec<LigneCalibration>, String> {
    let mut donnees = Vec::new();
    for (affaire, heures) in heures_par_affaire(conn, poste)? {
        let Some(variables_affaire) = variables.get(&affaire) else { continue };
        let valeurs: Option<Vec<f64>> = noms_variables
            .iter()
            .map(|v| variables_affaire.get(*v).copied().flatten())
            .collect();
        let Some(valeurs) = valeurs else { continue };
        if valeurs.iter().all(|v| *v == 0.0) {
            continue;
        }
        donnees.push(LigneCalibration { heures, valeurs });
    }
    Ok(donnees)
}

/// Part de la variance des heures expliquée par le modèle (R²), pour le journal.
fn coefficient_determination(donnees: &[LigneCalibration], intercept: f64, coefficients: &[f64]) -> f64 {
    let n = donnees.len() as f64;
    let moyenne = donnees.iter().map(|l| l.heures).sum::<f64>() / n;
    let prevu = |l: &LigneCalibration| intercept + l.valeurs.iter().zip(coefficients).map(|(x, c)| x * c).sum::<f64>();
    let residus: f64 = donnees.iter().map(|l| (l.heures - prevu(l)).powi(2)).sum();
    let total: f64 = donnees.iter().map(|l| (l.heures - moyenne).powi(2)).sum();
    if total > 0.0 { 1.0 - residus / total } else { 0.0 }
}

/// Régression robuste pour une seule variable : pente de Theil-Sen
/// (médiane des pentes entre toutes les paires d'affaires de quantités
/// différentes), intercept tel que la moyenne des heures prévues égale
/// celle des heures réelles.
///
/// La pente médiane remplace celle des moindres carrés, qui pèsent les
/// écarts au carré : une seule grosse affaire atypique y faisait pivoter la
/// droite (sur les données de 2025, retirer une affaire changeait la pente
/// de 58 % en presse, 61 % en assemblage, 57 % en goujonnage ; 8 %, 36 % et
/// 14 % avec Theil-Sen).
///
/// L'intercept, lui, reste calé sur la moyenne et non sur la médiane : les
/// affaires atypiques ne sont pas des erreurs de saisie mais de vraies
/// affaires plus longues, toujours dans le même sens. Un intercept médian
/// (Theil-Sen pur) sous-estimait le total des heures de 31 % ; calé sur la
/// moyenne, l'écart reste sous 5 % par poste, avec une erreur par affaire
/// (validation croisée) égale ou inférieure aux moindres carrés sur tous
/// les postes. Même forme de résultat que regression_lineaire.
fn theil_sen(donnees: &[LigneCalibration]) -> (f64, Vec<f64>, f64) {
    let mut pentes = Vec::with_capacity(donnees.len() * donnees.len() / 2);
    for (i, a) in donnees.iter().enumerate() {
        for b in &donnees[i + 1..] {
            let dx = b.valeurs[0] - a.valeurs[0];
            if dx != 0.0 {
                pentes.push((b.heures - a.heures) / dx);
            }
        }
    }
    let pente = mediane(pentes).unwrap_or(0.0);
    let intercept = donnees.iter().map(|l| l.heures - pente * l.valeurs[0]).sum::<f64>() / donnees.len() as f64;
    let r2 = coefficient_determination(donnees, intercept, &[pente]);
    (intercept, vec![pente], r2)
}

/// Forme calibrée d'un poste à une variable, le temps d'une commande de
/// quantité x étant prevoir(x).
#[derive(Debug, Clone, Copy)]
enum Forme {
    Droite { intercept: f64, pente: f64 },
    Puissance { a: f64, k: f64 },
}

impl Forme {
    fn prevoir(self, x: f64) -> f64 {
        match self {
            Forme::Droite { intercept, pente } => (intercept + pente * x).max(0.0),
            Forme::Puissance { a, k } => a * x.max(0.0).powf(k),
        }
    }
}

fn ajuster_droite(donnees: &[LigneCalibration]) -> Option<Forme> {
    let (intercept, pentes, _) = theil_sen(donnees);
    Some(Forme::Droite { intercept, pente: pentes[0] })
}

/// Courbe puissance h = a × x^k : k = pente de Theil-Sen entre ln(x) et
/// ln(h), a calé pour que le total des heures prévues égale le total réel
/// (même principe que l'intercept de theil_sen). Avec k < 1, le temps par
/// unité baisse quand la commande grossit (réglages et mise en place
/// amortis) -- sur une seule courbe continue, sans saut de prix entre
/// tranches de taille. None si k ≤ 0 (pas de relation croissante) ou trop
/// peu d'affaires à quantité et heures non nulles.
fn ajuster_puissance(donnees: &[LigneCalibration]) -> Option<Forme> {
    let logs: Vec<LigneCalibration> = donnees
        .iter()
        .filter(|l| l.valeurs[0] > 0.0 && l.heures > 0.0)
        .map(|l| LigneCalibration { heures: l.heures.ln(), valeurs: vec![l.valeurs[0].ln()] })
        .collect();
    if logs.len() < MIN_OBS_REPLI {
        return None;
    }
    let k = theil_sen(&logs).1[0];
    let base: f64 = donnees.iter().map(|l| l.valeurs[0].max(0.0).powf(k)).sum();
    if k <= 0.0 || base <= 0.0 {
        return None;
    }
    let a = donnees.iter().map(|l| l.heures).sum::<f64>() / base;
    Some(Forme::Puissance { a, k })
}

const BLOCS_VALIDATION: usize = 10;

/// Erreur absolue de prévision en validation croisée, en fraction des
/// heures réelles : les affaires sont réparties en 10 blocs, chacune
/// prévue par un modèle calibré sans son bloc -- mesure ce que le modèle
/// vaut sur une affaire qu'il n'a pas vue, pas sur celles qui l'ont calibré.
fn erreur_validation_croisee(donnees: &[LigneCalibration], ajuster: fn(&[LigneCalibration]) -> Option<Forme>) -> Option<f64> {
    let mut erreur = 0.0;
    for bloc in 0..BLOCS_VALIDATION {
        let apprentissage: Vec<LigneCalibration> = donnees
            .iter()
            .enumerate()
            .filter(|(i, _)| i % BLOCS_VALIDATION != bloc)
            .map(|(_, l)| l.clone())
            .collect();
        let forme = ajuster(&apprentissage)?;
        erreur += donnees
            .iter()
            .enumerate()
            .filter(|(i, _)| i % BLOCS_VALIDATION == bloc)
            .map(|(_, l)| (forme.prevoir(l.valeurs[0]) - l.heures).abs())
            .sum::<f64>();
    }
    Some(erreur / donnees.iter().map(|l| l.heures).sum::<f64>())
}

/// Poste à une variable : droite (voir theil_sen) ou courbe puissance (voir
/// ajuster_puissance), celle qui prévoit le mieux en validation croisée.
/// Sur les données de 2025, la courbe gagne sur la plupart des postes (les
/// petites commandes coûtent plus par barre), la droite sur l'oxycoupage.
/// None si la pente de la droite est négative (repli sur le ratio médian).
fn calibrer_une_variable(poste: &str, variable: &str, donnees: &[LigneCalibration]) -> Option<PosteCoefficients> {
    let (intercept, pentes, r2) = theil_sen(donnees);
    let pente = pentes[0];
    if pente < 0.0 {
        println!("[{poste}] régression rejetée (pente négative : {pente}), repli sur le ratio médian");
        return None;
    }
    let erreur_droite = erreur_validation_croisee(donnees, ajuster_droite);
    let erreur_puissance = erreur_validation_croisee(donnees, ajuster_puissance);
    let pct = |e: Option<f64>| e.map_or("—".to_string(), |e| format!("{:.0} %", e * 100.0));
    let n = donnees.len();

    match (ajuster_puissance(donnees), erreur_droite, erreur_puissance) {
        (Some(Forme::Puissance { a, k }), Some(ed), Some(ep)) if ep < ed => {
            println!(
                "[{poste}] n={n}  courbe puissance  h = {a:.3} × x^{k:.2}  (erreur validation croisée {} contre {} pour la droite)",
                pct(erreur_puissance),
                pct(erreur_droite)
            );
            Some(PosteCoefficients {
                intercept: 0.0,
                coefficients: HashMap::from([(variable.to_string(), a)]),
                exposant: Some(k),
            })
        }
        _ => {
            println!(
                "[{poste}] n={n}  droite Theil-Sen  h = {intercept:.2} + {pente:.4} × x  R²={r2:.2}  (erreur validation croisée {} contre {} pour la courbe)",
                pct(erreur_droite),
                pct(erreur_puissance)
            );
            Some(PosteCoefficients {
                intercept,
                coefficients: HashMap::from([(variable.to_string(), pente)]),
                exposant: None,
            })
        }
    }
}

/// Résout la régression linéaire par moindres carrés via décomposition SVD
/// (plus stable numériquement que l'équation normale directe (XᵀX)⁻¹Xᵀy,
/// tout en donnant le même résultat pour un système bien posé). Réservée
/// aux postes à plusieurs variables, où Theil-Sen ne s'applique pas.
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
    let r2 = coefficient_determination(donnees, intercept, &coefficients);

    (intercept, coefficients, r2)
}

fn mediane(mut valeurs: Vec<f64>) -> Option<f64> {
    if valeurs.is_empty() {
        return None;
    }
    valeurs.sort_by(|a, b| a.total_cmp(b));
    let milieu = valeurs.len() / 2;
    Some(if valeurs.len() % 2 == 0 { (valeurs[milieu - 1] + valeurs[milieu]) / 2.0 } else { valeurs[milieu] })
}

/// Modèle de repli pour un petit échantillon (ou une régression aberrante) :
/// temps = ratio × première variable, ratio = médiane des heures/quantité
/// (robuste aux quelques affaires atypiques d'un petit échantillon). Les
/// autres variables du poste reçoivent 0.
fn ratio_median(donnees: &[LigneCalibration], variables: &[&str]) -> Option<PosteCoefficients> {
    let ratios: Vec<f64> = donnees
        .iter()
        .filter(|l| l.valeurs[0] > 0.0)
        .map(|l| l.heures / l.valeurs[0])
        .collect();
    if ratios.len() < MIN_OBS_REPLI {
        return None;
    }
    let ratio = mediane(ratios)?;
    let coefficients = variables
        .iter()
        .enumerate()
        .map(|(i, v)| (v.to_string(), if i == 0 { ratio } else { 0.0 }))
        .collect();
    Some(PosteCoefficients { intercept: 0.0, coefficients, exposant: None })
}

/// Forfait d'un poste de POSTES_FORFAIT : médiane des heures par affaire,
/// sur toutes les affaires ERP qui ont pointé ce poste (des heures pointées
/// prouvent que le poste était prévu, pas besoin de fiche).
fn calibrer_forfait(conn: &Connection, poste: &str, variable: &str) -> Result<Option<ResultatCalibration>, String> {
    let heures: Vec<f64> = heures_par_affaire(conn, poste)?.into_iter().map(|(_, h)| h).collect();
    let n = heures.len();
    if n < MIN_OBS_REPLI {
        println!("[{poste}] échantillon insuffisant : {n} affaires (minimum {MIN_OBS_REPLI}), ignoré");
        return Ok(None);
    }
    let forfait = mediane(heures).unwrap_or(0.0);
    println!("[{poste}] n={n}  forfait={forfait:.1} h");
    Ok(Some(ResultatCalibration {
        poste: poste.to_string(),
        coefficients: PosteCoefficients {
            intercept: 0.0,
            coefficients: HashMap::from([(variable.to_string(), forfait)]),
            exposant: None,
        },
    }))
}

/// Calibre un seul poste. Retourne None si l'échantillon est insuffisant.
///
/// Régression (droite ou courbe puissance pour une variable, voir
/// calibrer_une_variable ; moindres carrés au-delà) si l'échantillon le
/// permet et qu'elle donne des coefficients positifs (une pente négative -- plus de barres, moins
/// d'heures -- n'a pas de sens physique et vient du bruit), sinon ratio
/// médian (voir ratio_median). Si rien n'est calibrable avec les variables
/// du poste et qu'il a une variable par barre de repli (POSTES_PAR_BARRE),
/// nouvel essai avec celle-ci.
pub fn calibrer_poste(
    conn: &Connection,
    poste: &str,
    variables: &[&str],
    variables_affaires: &HashMap<String, VariablesConnues>,
) -> Result<Option<ResultatCalibration>, String> {
    if let Some((_, variable)) = POSTES_FORFAIT.iter().find(|(p, _)| *p == poste) {
        return calibrer_forfait(conn, poste, variable);
    }

    let donnees = charger_donnees_poste(conn, poste, variables, variables_affaires)?;
    let seuil_min = (MIN_OBS_PAR_VARIABLE * variables.len()).max(variables.len() + 2);

    if donnees.len() >= seuil_min && variables.len() == 1 {
        if let Some(coefficients) = calibrer_une_variable(poste, variables[0], &donnees) {
            return Ok(Some(ResultatCalibration { poste: poste.to_string(), coefficients }));
        }
    } else if donnees.len() >= seuil_min {
        let (intercept, coefs, r2) = regression_lineaire(&donnees, variables.len());
        if coefs.iter().all(|c| *c >= 0.0) {
            let coefficients: HashMap<String, f64> =
                variables.iter().map(|v| v.to_string()).zip(coefs).collect();
            println!("[{poste}] n={}  moindres carrés  R²={:.2}  intercept={intercept:.2}  coef={:?}", donnees.len(), r2, coefficients);
            return Ok(Some(ResultatCalibration {
                poste: poste.to_string(),
                coefficients: PosteCoefficients { intercept, coefficients, exposant: None },
            }));
        }
        println!("[{poste}] régression rejetée (coefficient négatif : {coefs:?}), repli sur le ratio médian");
    }

    match ratio_median(&donnees, variables) {
        Some(coefficients) => {
            println!("[{poste}] n={}  ratio médian  coef={:?}", donnees.len(), coefficients.coefficients);
            Ok(Some(ResultatCalibration { poste: poste.to_string(), coefficients }))
        }
        None => {
            println!(
                "[{poste}] échantillon insuffisant : {} affaires (minimum {MIN_OBS_REPLI}), ignoré",
                donnees.len()
            );
            match POSTES_PAR_BARRE.iter().find(|(p, v)| *p == poste && !variables.contains(v)) {
                Some((_, repli)) => {
                    println!("[{poste}] nouvel essai avec {repli}");
                    calibrer_poste(conn, poste, &[repli], variables_affaires)
                }
                None => Ok(None),
            }
        }
    }
}

/// Calibre tous les postes exploitables et retourne un CoefficientsExport
/// prêt à être sauvegardé (même format que celui produit par le script Python).
pub fn calibrer_tous_les_postes(conn: &Connection) -> Result<CoefficientsExport, String> {
    let variables_affaires = prevision::charger_variables(conn, None)?;
    let mut postes = HashMap::new();

    for (poste, variables) in poste_variables() {
        if let Some(resultat) = calibrer_poste(conn, poste, &variables, &variables_affaires)? {
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

    fn base() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::erp::initialiser_schema(&conn).unwrap();
        conn.execute_batch("CREATE TABLE configuration (cle TEXT PRIMARY KEY, valeur TEXT NOT NULL);").unwrap();
        crate::indexeur::initialiser_schema(&conn).unwrap();
        conn
    }

    fn affaire(conn: &Connection, affaire: &str, nb_barres: f64, presse_prevue: bool, heures_presse: f64) {
        conn.execute("INSERT INTO variables_affaires (affaire, nb_barres) VALUES (?1, ?2)", rusqlite::params![affaire, nb_barres])
            .unwrap();
        if presse_prevue {
            conn.execute(
                "INSERT INTO affaire_operations (affaire, source, operation) VALUES (?1, 'fiche', 'presse_cintrage')",
                [affaire],
            )
            .unwrap();
        }
        if heures_presse > 0.0 {
            conn.execute(
                "INSERT INTO heures (affaire, poste, heures) VALUES (?1, 'presse_cintrage', ?2)",
                rusqlite::params![affaire, heures_presse],
            )
            .unwrap();
        }
    }

    #[test]
    fn poste_par_barre_filtre_par_postes_prevus() {
        let conn = base();
        // 2 h par barre quand la presse est prévue ; les heures pointées
        // sans presse prévue (variable à 0) sont ignorées.
        for (i, nb) in [5.0, 10.0, 20.0, 40.0, 8.0, 12.0].iter().enumerate() {
            affaire(&conn, &format!("A{i}"), *nb, true, 2.0 * nb);
        }
        affaire(&conn, "SANS_PRESSE", 100.0, false, 500.0);

        let variables = prevision::charger_variables(&conn, None).unwrap();
        assert_eq!(variables["A0"]["nb_barres_presse"], Some(5.0));
        assert_eq!(variables["SANS_PRESSE"]["nb_barres_presse"], Some(0.0));

        let resultat = calibrer_poste(&conn, "presse_cintrage", &["nb_barres_presse"], &variables)
            .unwrap()
            .unwrap();
        assert_eq!(resultat.coefficients.intercept, 0.0);
        assert!((resultat.coefficients.coefficients["nb_barres_presse"] - 2.0).abs() < 1e-9);
    }

    #[test]
    fn cases_du_rde_rendent_les_postes_necessaires() {
        let conn = base();
        affaire(&conn, "A", 10.0, false, 0.0);
        conn.execute("INSERT INTO affaire_operations (affaire, source, operation) VALUES ('A', 'rde', 'contre_fleche')", [])
            .unwrap();
        conn.execute("INSERT INTO affaire_operations (affaire, source, operation) VALUES ('A', 'rde', 'coupe')", [])
            .unwrap();

        let variables = prevision::charger_variables(&conn, Some("A")).unwrap();
        assert_eq!(variables["A"]["nb_barres_presse"], Some(10.0));
        assert_eq!(variables["A"]["nb_barres_forage_numerique"], Some(10.0));
        assert_eq!(variables["A"]["nb_barres_assemblage"], Some(0.0));
        assert_eq!(variables["A"]["nb_barres_soudage"], Some(0.0));
    }

    #[test]
    fn theil_sen_pente_robuste_total_conserve() {
        // 10 h + 2 h/barre, plus une grosse affaire à 10 fois le temps attendu.
        let mut donnees: Vec<LigneCalibration> = (1..=12)
            .map(|x| LigneCalibration { heures: 10.0 + 2.0 * x as f64, valeurs: vec![x as f64] })
            .collect();
        donnees.push(LigneCalibration { heures: 1000.0, valeurs: vec![50.0] });

        // La pente ne pivote pas sur l'affaire aberrante...
        let (intercept, pentes, _) = theil_sen(&donnees);
        assert!((pentes[0] - 2.0).abs() < 1e-9, "pente {}", pentes[0]);
        // ... mais le total des heures prévues reste celui des heures réelles.
        let prevu: f64 = donnees.iter().map(|l| intercept + pentes[0] * l.valeurs[0]).sum();
        let reel: f64 = donnees.iter().map(|l| l.heures).sum();
        assert!((prevu - reel).abs() < 1e-6);

        // Les moindres carrés, eux, sont emportés par l'affaire aberrante.
        let (_, pentes_mc, _) = regression_lineaire(&donnees, 1);
        assert!(pentes_mc[0] > 10.0);
    }

    #[test]
    fn courbe_puissance_retrouvee_et_choisie() {
        // h = 20 × x^0,5 : le temps par barre baisse quand la commande grossit.
        let donnees: Vec<LigneCalibration> = (1..=30)
            .map(|x| LigneCalibration { heures: 20.0 * (x as f64).sqrt(), valeurs: vec![x as f64] })
            .collect();
        let Some(Forme::Puissance { a, k }) = ajuster_puissance(&donnees) else { panic!("pas de courbe") };
        assert!((k - 0.5).abs() < 1e-9 && (a - 20.0).abs() < 1e-9, "a={a} k={k}");

        let coefficients = calibrer_une_variable("robot", "nb_barres_robot", &donnees).unwrap();
        assert_eq!(coefficients.exposant.map(|k| (k * 1e6).round() / 1e6), Some(0.5));

        // Relation vraiment linéaire avec un temps fixe : la droite l'emporte.
        let donnees: Vec<LigneCalibration> = (1..=30)
            .map(|x| LigneCalibration { heures: 50.0 + 2.0 * x as f64, valeurs: vec![x as f64] })
            .collect();
        let coefficients = calibrer_une_variable("oxycoupage", "longueur_coupe", &donnees).unwrap();
        assert_eq!(coefficients.exposant, None);
        assert!((coefficients.intercept - 50.0).abs() < 1e-9);
    }

    #[test]
    fn prevision_avec_exposant() {
        let coeffs = CoefficientsExport {
            version: 1,
            date_calibration: String::new(),
            seuil_diametre_manuel_mm: 40.0,
            postes: HashMap::from([(
                "robot".to_string(),
                PosteCoefficients {
                    intercept: 0.0,
                    coefficients: HashMap::from([("nb_barres_robot".to_string(), 20.0)]),
                    exposant: Some(0.5),
                },
            )]),
        };
        let variables = HashMap::from([("nb_barres_robot".to_string(), 16.0)]);
        assert_eq!(prevision::predire(&coeffs, &variables).heures_par_poste["robot"], 80.0);
    }

    #[test]
    fn forfait_sur_toutes_les_affaires_erp() {
        let conn = base();
        for (i, h) in [10.0, 20.0, 30.0, 40.0, 1000.0].iter().enumerate() {
            conn.execute(
                "INSERT INTO heures (affaire, poste, heures) VALUES (?1, 'controle_cnd', ?2)",
                rusqlite::params![format!("A{i}"), h],
            )
            .unwrap();
        }
        let resultat = calibrer_poste(&conn, "controle_cnd", &["controle_cnd_prevu"], &HashMap::new())
            .unwrap()
            .unwrap();
        assert_eq!(resultat.coefficients.coefficients["controle_cnd_prevu"], 30.0);
    }

    #[test]
    fn tous_les_postes_machine_ont_un_modele() {
        let postes = poste_variables();
        for poste in [
            "assemblage_tracage", "manutention", "forage_manuel", "forage_numerique", "goujonnage",
            "oxycoupage", "mise_a_longueur", "p3", "robot", "presse_cintrage", "soudage",
            "soudage_sous_flux", "controle_cnd",
        ] {
            assert!(postes.contains_key(poste), "{poste}");
        }
    }

    // -----------------------------------------------------------------------
    // Banc d'essai sur une vraie base : compare les méthodes de régression
    // en validation croisée (10 blocs), par tiers de taille de commande.
    //   PARACHEV_DB=/chemin/affaires.db cargo test --lib banc_essai -- --ignored --nocapture
    // -----------------------------------------------------------------------

    type Modele = Box<dyn Fn(f64) -> f64>;

    fn copie(lignes: &[&LigneCalibration]) -> Vec<LigneCalibration> {
        lignes.iter().map(|l| (*l).clone()).collect()
    }

    fn droite(intercept: f64, pente: f64) -> Modele {
        Box::new(move |x| (intercept + pente * x).max(0.0))
    }

    fn moindres_carres(d: &[LigneCalibration]) -> Modele {
        let (a, b, _) = regression_lineaire(d, 1);
        droite(a, b[0])
    }

    fn hybride(d: &[LigneCalibration]) -> Modele {
        let (a, b, _) = theil_sen(d);
        droite(a, b[0])
    }

    fn theil_sen_pur(d: &[LigneCalibration]) -> Modele {
        let b = theil_sen(d).1[0];
        let a = mediane(d.iter().map(|l| l.heures - b * l.valeurs[0]).collect()).unwrap_or(0.0);
        droite(a, b)
    }

    /// Bornes des tiers de quantité (petites / moyennes / grandes commandes).
    fn bornes_tiers(d: &[LigneCalibration]) -> (f64, f64) {
        let mut x: Vec<f64> = d.iter().map(|l| l.valeurs[0]).collect();
        x.sort_by(|a, b| a.total_cmp(b));
        (x[x.len() / 3], x[2 * x.len() / 3])
    }

    fn tiers(x: f64, (b1, b2): (f64, f64)) -> usize {
        if x < b1 { 0 } else if x < b2 { 1 } else { 2 }
    }

    /// Une droite hybride par tiers (droite globale si un tiers a moins de
    /// MIN_OBS_PAR_VARIABLE affaires).
    fn trois_droites(d: &[LigneCalibration]) -> Modele {
        let bornes = bornes_tiers(d);
        let globale = hybride(d);
        let par_tiers: Vec<Option<Modele>> = (0..3)
            .map(|t| {
                let s: Vec<&LigneCalibration> = d.iter().filter(|l| tiers(l.valeurs[0], bornes) == t).collect();
                (s.len() >= MIN_OBS_PAR_VARIABLE).then(|| hybride(&copie(&s)))
            })
            .collect();
        Box::new(move |x| match &par_tiers[tiers(x, bornes)] {
            Some(f) => f(x),
            None => globale(x),
        })
    }

    /// Petites commandes : Theil-Sen pur, moyennes : hybride, grandes :
    /// moindres carrés (chacun calibré sur tout l'échantillon).
    fn methode_par_taille(d: &[LigneCalibration]) -> Modele {
        let bornes = bornes_tiers(d);
        let (petites, moyennes, grandes) = (theil_sen_pur(d), hybride(d), moindres_carres(d));
        Box::new(move |x| match tiers(x, bornes) {
            0 => petites(x),
            1 => moyennes(x),
            _ => grandes(x),
        })
    }

    fn puissance(d: &[LigneCalibration]) -> Modele {
        match ajuster_puissance(d) {
            Some(forme) => Box::new(move |x| forme.prevoir(x)),
            None => hybride(d),
        }
    }

    #[test]
    #[ignore]
    fn banc_essai() {
        const BLOCS: usize = 10;
        let conn = Connection::open(std::env::var("PARACHEV_DB").expect("PARACHEV_DB non défini")).unwrap();
        let variables_affaires = prevision::charger_variables(&conn, None).unwrap();
        let methodes: [(&str, fn(&[LigneCalibration]) -> Modele); 5] = [
            ("moindres carrés", moindres_carres),
            ("hybride", hybride),
            ("3 droites", trois_droites),
            ("méthode/taille", methode_par_taille),
            ("puissance", puissance),
        ];
        let mut erreurs_totales = vec![[0.0f64; 4]; methodes.len()];
        let mut reel_total = [0.0f64; 4];

        let mut postes: Vec<_> = poste_variables().into_iter().collect();
        postes.sort();
        for (poste, variables) in postes {
            let variables = match POSTES_PAR_BARRE.iter().find(|(p, _)| *p == poste) {
                Some((_, v)) if variables.len() > 1 => vec![*v],
                _ => variables,
            };
            if variables.len() != 1 || POSTES_FORFAIT.iter().any(|(p, _)| *p == poste) {
                continue;
            }
            let d = charger_donnees_poste(&conn, poste, &variables, &variables_affaires).unwrap();
            if d.len() < 2 * BLOCS {
                println!("{poste:18} n={:4} : trop peu d'affaires", d.len());
                continue;
            }
            let bornes = bornes_tiers(&d);
            let mut reel = [0.0f64; 4];
            for l in &d {
                reel[tiers(l.valeurs[0], bornes)] += l.heures;
                reel[3] += l.heures;
            }
            (0..4).for_each(|k| reel_total[k] += reel[k]);

            let mut ligne = format!("{poste:18} n={:4} tiers <{:.0} / <{:.0} |", d.len(), bornes.0, bornes.1);
            for (m, (nom, calibrer)) in methodes.iter().enumerate() {
                let mut erreurs = [0.0f64; 4];
                let mut prevu = 0.0;
                for bloc in 0..BLOCS {
                    let apprentissage: Vec<&LigneCalibration> =
                        d.iter().enumerate().filter(|(i, _)| i % BLOCS != bloc).map(|(_, l)| l).collect();
                    let modele = calibrer(&copie(&apprentissage));
                    for l in d.iter().enumerate().filter(|(i, _)| i % BLOCS == bloc).map(|(_, l)| l) {
                        let p = modele(l.valeurs[0]);
                        let e = (p - l.heures).abs();
                        erreurs[tiers(l.valeurs[0], bornes)] += e;
                        erreurs[3] += e;
                        prevu += p;
                    }
                }
                (0..4).for_each(|k| erreurs_totales[m][k] += erreurs[k]);
                ligne += &format!(" {nom} {:3.0}% ({:+.0}%) |", erreurs[3] / reel[3] * 100.0, (prevu / reel[3] - 1.0) * 100.0);
            }
            println!("{ligne}");
        }

        println!("\nErreur absolue en % des heures réelles, par tiers de taille de commande :");
        for (m, (nom, _)) in methodes.iter().enumerate() {
            let pct = |k: usize| erreurs_totales[m][k] / reel_total[k] * 100.0;
            println!("{nom:16} petites {:3.0}%  moyennes {:3.0}%  grandes {:3.0}%  total {:3.0}%", pct(0), pct(1), pct(2), pct(3));
        }
    }
}
