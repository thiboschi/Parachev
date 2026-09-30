use crate::prevision::{self, CoefficientsExport, PosteCoefficients, Presence, VariablesConnues, POSTES_FORFAIT, SEUIL_PRESENCE};
use nalgebra::{DMatrix, DVector};
use rusqlite::Connection;
use std::collections::HashMap;

/// Modèles candidats par poste, par ordre de priorité : chaque candidat est
/// une liste de variables (voir prevision::charger_variables). La
/// calibration garde, parmi les candidats à une variable, la grandeur qui
/// prévoit le mieux en validation croisée (voir choisir_variable) ; un
/// candidat à plusieurs variables en tête de liste (forage numérique : trous
/// + diamètre) passe avant dès qu'il est calibrable. Le premier candidat
/// est le modèle par défaut (affiché pour un poste pas encore calibré).
///
/// Grandeurs candidates retenues d'après les données de 2025 (erreur en
/// validation croisée, nombre de barres -> meilleure grandeur) : P3 63 % ->
/// poids 42 %, mise à longueur 105 % -> mètres de poutre 74 %, presse
/// 68 % -> poids 62 %. Les postes filtrés (POSTES_PREVUS) utilisent la
/// version réservée au poste prévu de chaque grandeur (poids_p3...). Seuls
/// "reparation" et "casse_machine" restent sans modèle : ce sont des aléas,
/// pas du travail prévisible. Doit rester cohérent avec POSTE_VARIABLES
/// côté pipeline_calibration.py.
///
/// Note : "enfilage" n'existe PAS dans les données ERP réelles (confirmé
/// sur le fichier complet, 15 postes recensés, enfilage absent) --
/// volontairement retiré d'ici pour ne pas laisser une entrée trompeuse.
pub fn poste_variables() -> HashMap<&'static str, Vec<Vec<String>>> {
    let une = |variable: &str| vec![variable.to_string()];
    let filtrees = |suffixe: &str, prefixes: &[&str]| -> Vec<Vec<String>> {
        prefixes.iter().map(|prefixe| vec![prevision::variable_filtree(prefixe, suffixe)]).collect()
    };

    let mut forage_numerique = vec![
        vec!["nb_trous_numerique".to_string(), "diametre_moyen_numerique".to_string()],
        une("nb_trous_numerique"),
    ];
    forage_numerique.extend(filtrees("forage_numerique", &["nb_barres", "poids", "metres", "nb_barres_cfl"]));

    let mut postes = HashMap::from([
        ("manutention", vec![une("nb_barres"), une("poids_t"), une("metres"), une("nb_barres_cfl")]),
        ("mise_a_longueur", vec![une("nb_barres"), une("poids_t"), une("metres")]),
        ("forage_manuel", vec![une("nb_trous_manuel")]),
        ("forage_numerique", forage_numerique),
        ("goujonnage", vec![une("nb_goujons")]),
        ("oxycoupage", vec![une("longueur_coupe")]),
        ("assemblage_tracage", filtrees("assemblage", &["nb_barres", "poids", "metres"])),
        ("presse_cintrage", filtrees("presse", &["nb_barres", "poids", "metres", "nb_barres_cfl"])),
        ("robot", filtrees("robot", &["nb_barres", "poids", "metres"])),
        ("p3", filtrees("p3", &["nb_barres", "poids", "metres"])),
        ("soudage", filtrees("soudage", &["nb_barres", "poids", "metres"])),
    ]);
    for (poste, variable) in POSTES_FORFAIT {
        postes.insert(poste, vec![une(variable)]);
    }
    postes
}

const MIN_OBS_PAR_VARIABLE: usize = 10;
/// En dessous de MIN_OBS_PAR_VARIABLE, la régression est remplacée par un
/// ratio médian heures/quantité (ou un forfait), à partir de ce nombre
/// d'affaires.
const MIN_OBS_REPLI: usize = 5;
const DIAMETRE_SEUIL_MANUEL_MM: f64 = 40.0;
/// Part minimale des affaires, par rapport à la grandeur la mieux
/// renseignée du poste, où une grandeur doit être connue pour être retenue :
/// un modèle sur une donnée rare chiffrerait 0 h sur toutes les autres
/// affaires. Sur la base complète de 2025, trous + diamètre des programmes
/// CN ne sont connus que sur 63 affaires avec du forage numérique, contre
/// plusieurs centaines pour le nombre de barres.
const COUVERTURE_MIN: f64 = 0.5;

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
///
/// Une affaire de quantité nulle est prévue à 0 h et n'entre pas dans
/// l'apprentissage, comme dans predire (voir choisir_variable, où une
/// grandeur peut valoir 0 sur des affaires qui ont pourtant des heures).
fn erreur_validation_croisee(donnees: &[LigneCalibration], ajuster: fn(&[LigneCalibration]) -> Option<Forme>) -> Option<f64> {
    let mut erreur = 0.0;
    for bloc in 0..BLOCS_VALIDATION {
        let apprentissage: Vec<LigneCalibration> = donnees
            .iter()
            .enumerate()
            .filter(|(i, l)| i % BLOCS_VALIDATION != bloc && l.valeurs[0] != 0.0)
            .map(|(_, l)| l.clone())
            .collect();
        let forme = ajuster(&apprentissage)?;
        erreur += donnees
            .iter()
            .enumerate()
            .filter(|(i, _)| i % BLOCS_VALIDATION == bloc)
            .map(|(_, l)| {
                let prevu = if l.valeurs[0] == 0.0 { 0.0 } else { forme.prevoir(l.valeurs[0]) };
                (prevu - l.heures).abs()
            })
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
                presence: None,
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
                presence: None,
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

pub(crate) fn mediane(mut valeurs: Vec<f64>) -> Option<f64> {
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
    Some(PosteCoefficients { intercept: 0.0, coefficients, exposant: None, presence: None })
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
            presence: None,
        },
    }))
}

/// Grandeur d'un poste parmi ses candidates à une variable (voir
/// poste_variables). Chacune est évaluée (meilleure forme, droite ou
/// courbe) en validation croisée sur les MÊMES affaires -- celles où toutes
/// les candidates sont connues --, pour que la comparaison ne dépende pas de
/// l'échantillon de chacune. Une grandeur connue sur trop peu d'affaires est
/// écartée d'emblée (voir COUVERTURE_MIN). Si ces affaires communes sont trop peu
/// nombreuses, la candidate connue sur le moins d'affaires est écartée, et
/// ainsi de suite. À erreur égale, la candidate prioritaire l'emporte. None
/// si aucune candidate n'a MIN_OBS_REPLI affaires.
/// Nombre d'affaires exploitables pour chaque candidate à une variable.
fn affaires_par_candidate<'a>(
    conn: &Connection,
    poste: &str,
    candidates: &[&'a str],
    variables_affaires: &HashMap<String, VariablesConnues>,
) -> Result<Vec<(&'a str, usize)>, String> {
    candidates
        .iter()
        .map(|c| Ok((*c, charger_donnees_poste(conn, poste, &[c], variables_affaires)?.len())))
        .collect()
}

fn choisir_variable<'a>(
    conn: &Connection,
    poste: &str,
    candidates: &[&'a str],
    variables_affaires: &HashMap<String, VariablesConnues>,
) -> Result<Option<&'a str>, String> {
    let comptes = affaires_par_candidate(conn, poste, candidates, variables_affaires)?;
    let n_max = comptes.iter().map(|(_, n)| *n).max().unwrap_or(0);
    let mut restantes: Vec<(&'a str, usize)> = Vec::new();
    for (candidate, n) in comptes {
        if n < MIN_OBS_REPLI {
            continue;
        }
        if (n as f64) < COUVERTURE_MIN * n_max as f64 {
            println!("[{poste}] {candidate} écartée : connue sur {n} affaires contre {n_max}");
            continue;
        }
        restantes.push((candidate, n));
    }

    let (noms, communes) = loop {
        match restantes.len() {
            0 => return Ok(None),
            1 => return Ok(Some(restantes[0].0)),
            _ => {}
        }
        let noms: Vec<&'a str> = restantes.iter().map(|(nom, _)| *nom).collect();
        let communes = charger_donnees_poste(conn, poste, &noms, variables_affaires)?;
        if communes.len() >= MIN_OBS_PAR_VARIABLE {
            break (noms, communes);
        }
        // La moins renseignée ; à égalité, la moins prioritaire.
        let moins_renseignee = (0..restantes.len()).rev().min_by_key(|&i| restantes[i].1).unwrap_or(0);
        restantes.remove(moins_renseignee);
    };

    let ajusteurs: [fn(&[LigneCalibration]) -> Option<Forme>; 2] = [ajuster_droite, ajuster_puissance];
    let mut meilleure: Option<(&'a str, f64)> = None;
    let mut journal = Vec::new();
    for (j, nom) in noms.iter().enumerate() {
        let donnees: Vec<LigneCalibration> = communes
            .iter()
            .map(|l| LigneCalibration { heures: l.heures, valeurs: vec![l.valeurs[j]] })
            .collect();
        let erreur = ajusteurs
            .iter()
            .filter_map(|ajuster| erreur_validation_croisee(&donnees, *ajuster))
            .fold(f64::INFINITY, f64::min);
        journal.push(format!("{nom} {:.0} %", erreur * 100.0));
        if meilleure.is_none_or(|(_, e)| erreur < e) {
            meilleure = Some((nom, erreur));
        }
    }
    println!("[{poste}] choix de la grandeur sur {} affaires communes : {}", communes.len(), journal.join(", "));
    Ok(meilleure.map(|(nom, _)| nom))
}

/// Calibre un seul poste. Retourne None si l'échantillon est insuffisant.
///
/// Un candidat à plusieurs variables en tête de `candidats` est calibré par
/// moindres carrés s'il a assez d'affaires, connu sur au moins
/// COUVERTURE_MIN des affaires de la grandeur simple la mieux renseignée, et
/// des coefficients positifs.
/// Sinon, grandeur choisie parmi les candidats à une variable (voir
/// choisir_variable), puis droite ou courbe puissance (voir
/// calibrer_une_variable) si l'échantillon le permet et que la pente est
/// positive (une pente négative -- plus de barres, moins d'heures -- n'a pas
/// de sens physique et vient du bruit), sinon ratio médian (voir
/// ratio_median).
pub fn calibrer_poste(
    conn: &Connection,
    poste: &str,
    candidats: &[Vec<String>],
    variables_affaires: &HashMap<String, VariablesConnues>,
) -> Result<Option<ResultatCalibration>, String> {
    if let Some((_, variable)) = POSTES_FORFAIT.iter().find(|(p, _)| *p == poste) {
        return calibrer_forfait(conn, poste, variable);
    }

    let simples: Vec<&str> = candidats.iter().filter(|c| c.len() == 1).map(|c| c[0].as_str()).collect();

    if let Some(variables) = candidats.first().filter(|c| c.len() > 1) {
        let variables: Vec<&str> = variables.iter().map(String::as_str).collect();
        let donnees = charger_donnees_poste(conn, poste, &variables, variables_affaires)?;
        let seuil_min = (MIN_OBS_PAR_VARIABLE * variables.len()).max(variables.len() + 2);
        let n_max = affaires_par_candidate(conn, poste, &simples, variables_affaires)?
            .into_iter()
            .map(|(_, n)| n)
            .max()
            .unwrap_or(0);
        if (donnees.len() as f64) < COUVERTURE_MIN * n_max as f64 {
            println!("[{poste}] {variables:?} écartées : connues sur {} affaires contre {n_max}", donnees.len());
        } else if donnees.len() >= seuil_min {
            let (intercept, coefs, r2) = regression_lineaire(&donnees, variables.len());
            if coefs.iter().all(|c| *c >= 0.0) {
                let coefficients: HashMap<String, f64> =
                    variables.iter().map(|v| v.to_string()).zip(coefs).collect();
                println!("[{poste}] n={}  moindres carrés  R²={:.2}  intercept={intercept:.2}  coef={:?}", donnees.len(), r2, coefficients);
                return Ok(Some(ResultatCalibration {
                    poste: poste.to_string(),
                    coefficients: PosteCoefficients { intercept, coefficients, exposant: None, presence: None },
                }));
            }
            println!("[{poste}] régression {variables:?} rejetée (coefficient négatif : {coefs:?})");
        } else {
            println!("[{poste}] {variables:?} : {} affaires (minimum {seuil_min}), grandeurs simples", donnees.len());
        }
    }

    let Some(variable) = choisir_variable(conn, poste, &simples, variables_affaires)? else {
        println!("[{poste}] échantillon insuffisant pour toutes les grandeurs (minimum {MIN_OBS_REPLI} affaires), ignoré");
        return Ok(None);
    };

    let donnees = charger_donnees_poste(conn, poste, &[variable], variables_affaires)?;
    if donnees.len() >= MIN_OBS_PAR_VARIABLE {
        if let Some(coefficients) = calibrer_une_variable(poste, variable, &donnees) {
            return Ok(Some(ResultatCalibration { poste: poste.to_string(), coefficients }));
        }
    }
    Ok(ratio_median(&donnees, &[variable]).map(|coefficients| {
        println!("[{poste}] n={}  ratio médian  coef={:?}", donnees.len(), coefficients.coefficients);
        ResultatCalibration { poste: poste.to_string(), coefficients }
    }))
}

/// Affaires de référence pour la présence des postes : celles qui ont des
/// heures ERP (tous postes confondus) et une fiche lue (nb_barres connu).
/// Une affaire sans fiche n'a aucun signal de présence : elle gonflerait la
/// probabilité d'un poste "non prévu".
fn affaires_de_reference(conn: &Connection, variables_affaires: &HashMap<String, VariablesConnues>) -> Result<Vec<String>, String> {
    let mut stmt = conn.prepare("SELECT DISTINCT affaire FROM heures").map_err(|e| e.to_string())?;
    let affaires = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(affaires
        .into_iter()
        .filter(|a| variables_affaires.get(a).is_some_and(|v| v.get("nb_barres").copied().flatten().is_some()))
        .collect())
}

/// Présence d'un poste (voir prevision::Presence), sur les affaires de
/// référence, avec la même règle "poste prévu" qu'à la prévision (voir
/// prevision::poste_prevu) :
/// - si_prevu : part des affaires où il est prévu avec une quantité connue
///   qui ont des heures ERP au poste (1 si moins de MIN_OBS_PAR_VARIABLE
///   affaires) ;
/// - si_signal_seul : même part quand il n'est prévu que par l'indicatrice,
///   sans quantité (si_prevu si moins de MIN_OBS_PAR_VARIABLE affaires) ;
/// - correction : heures du poste sur toutes les affaires / sur celles où
///   il est chiffré (prévu, dans un cas de probabilité ≥ SEUIL_PRESENCE) --
///   report des heures pointées hors prévision ;
/// - heures_sans_quantite : moyenne des heures quand le poste est prévu et
///   utilisé mais que sa formule n'a aucune variable non nulle (à défaut,
///   moyenne sur toutes les affaires où il est utilisé).
fn calibrer_presence(
    conn: &Connection,
    poste: &str,
    params: &PosteCoefficients,
    reference: &[String],
    variables_affaires: &HashMap<String, VariablesConnues>,
) -> Result<Presence, String> {
    let heures: HashMap<String, f64> = heures_par_affaire(conn, poste)?.into_iter().collect();
    // (affaires, affaires ayant utilisé le poste, leurs heures) : prévu avec
    // quantité, prévu sur signal seul.
    let (mut avec_quantite, mut signal_seul) = ((0usize, 0usize, 0.0), (0usize, 0usize, 0.0));
    let mut n_sinon_utilise = 0usize;
    let mut heures_toutes = 0.0;
    let (mut sans_quantite, mut toutes) = (Vec::new(), Vec::new());
    for affaire in reference {
        let variables = &variables_affaires[affaire];
        let valeur = |v: &str| variables.get(v).copied().flatten().unwrap_or(0.0);
        let prevu = prevision::poste_prevu(poste, params.coefficients.keys(), valeur);
        let quantite_connue = params.coefficients.keys().any(|v| valeur(v) != 0.0);
        let utilise = heures.get(affaire).copied();
        let categorie = match (prevu, quantite_connue) {
            (false, _) => None,
            (true, true) => Some(&mut avec_quantite),
            (true, false) => Some(&mut signal_seul),
        };
        match (categorie, utilise) {
            (Some(categorie), Some(h)) => {
                categorie.0 += 1;
                categorie.1 += 1;
                categorie.2 += h;
                if !quantite_connue {
                    sans_quantite.push(h);
                }
            }
            (Some(categorie), None) => categorie.0 += 1,
            (None, Some(_)) => n_sinon_utilise += 1,
            (None, None) => {}
        }
        if let Some(h) = utilise {
            heures_toutes += h;
            toutes.push(h);
        }
    }
    let moyenne = |v: &[f64]| if v.is_empty() { 0.0 } else { v.iter().sum::<f64>() / v.len() as f64 };
    let part = |(n, utilises, _): (usize, usize, f64), defaut: f64| if n >= MIN_OBS_PAR_VARIABLE { utilises as f64 / n as f64 } else { defaut };
    let si_prevu = part(avec_quantite, 1.0);
    let si_signal_seul = part(signal_seul, si_prevu);
    // Heures des cas effectivement chiffrés (voir prevision::heures_poste).
    let heures_chiffrees: f64 = [(si_prevu, avec_quantite.2), (si_signal_seul, signal_seul.2)]
        .iter()
        .filter(|(p, _)| *p >= SEUIL_PRESENCE)
        .map(|(_, h)| h)
        .sum();
    let presence = Presence {
        si_prevu,
        si_signal_seul,
        correction: if heures_chiffrees > 0.0 { heures_toutes / heures_chiffrees } else { 1.0 },
        heures_sans_quantite: if sans_quantite.len() >= MIN_OBS_REPLI { moyenne(&sans_quantite) } else { moyenne(&toutes) },
    };
    println!(
        "[{poste}] présence : utilisé sur {}/{} affaires prévues avec quantité ({:.0} %), {}/{} sur signal seul ({:.0} %), \
         {n_sinon_utilise} non prévues (correction ×{:.2}) ; {:.1} h sans quantité",
        avec_quantite.1,
        avec_quantite.0,
        presence.si_prevu * 100.0,
        signal_seul.1,
        signal_seul.0,
        presence.si_signal_seul * 100.0,
        presence.correction,
        presence.heures_sans_quantite
    );
    Ok(presence)
}

/// Calibre tous les postes exploitables et retourne un CoefficientsExport
/// prêt à être sauvegardé (même format que celui produit par le script Python).
pub fn calibrer_tous_les_postes(conn: &Connection) -> Result<CoefficientsExport, String> {
    let variables_affaires = prevision::charger_variables(conn, None)?;
    let reference = affaires_de_reference(conn, &variables_affaires)?;
    let mut postes = HashMap::new();

    for (poste, candidats) in poste_variables() {
        if let Some(mut resultat) = calibrer_poste(conn, poste, &candidats, &variables_affaires)? {
            resultat.coefficients.presence =
                Some(calibrer_presence(conn, poste, &resultat.coefficients, &reference, &variables_affaires)?);
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

        let resultat = calibrer_poste(&conn, "presse_cintrage", &[vec!["nb_barres_presse".to_string()]], &variables)
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
    fn grandeur_choisie_sur_les_affaires_communes() {
        let conn = base();
        // Heures de presse proportionnelles au poids, sans lien avec le
        // nombre de barres ; une affaire sans poids connu n'entre pas dans
        // la comparaison.
        for i in 0..15 {
            let affaire_i = format!("A{i}");
            let nb_barres = ((i * 7) % 11 + 1) as f64;
            let poids = 10.0 * (i + 1) as f64;
            affaire(&conn, &affaire_i, nb_barres, true, 2.0 * poids);
            conn.execute("UPDATE variables_affaires SET poids_t = ?1 WHERE affaire = ?2", rusqlite::params![poids, affaire_i])
                .unwrap();
        }
        affaire(&conn, "SANS_POIDS", 3.0, true, 500.0);

        let variables = prevision::charger_variables(&conn, None).unwrap();
        assert_eq!(variables["A0"]["poids_presse"], Some(10.0));
        assert_eq!(variables["SANS_POIDS"]["poids_presse"], None);
        let choix = choisir_variable(&conn, "presse_cintrage", &["nb_barres_presse", "poids_presse", "metres_presse"], &variables)
            .unwrap();
        // metres_presse (aucune longueur en base) est écartée faute d'affaires.
        assert_eq!(choix, Some("poids_presse"));

        let candidats = poste_variables()["presse_cintrage"].clone();
        let resultat = calibrer_poste(&conn, "presse_cintrage", &candidats, &variables).unwrap().unwrap();
        assert!(resultat.coefficients.coefficients.contains_key("poids_presse"));
    }

    #[test]
    fn grandeur_rare_ecartee() {
        let conn = base();
        // 30 affaires de presse avec barres connues, dont 10 seulement avec
        // un poids qui explique parfaitement les heures.
        for i in 0..30 {
            let affaire_i = format!("A{i}");
            let poids = 10.0 * (i + 1) as f64;
            affaire(&conn, &affaire_i, ((i * 7) % 11 + 1) as f64, true, 2.0 * poids);
            if i < 10 {
                conn.execute("UPDATE variables_affaires SET poids_t = ?1 WHERE affaire = ?2", rusqlite::params![poids, affaire_i])
                    .unwrap();
            }
        }
        let variables = prevision::charger_variables(&conn, None).unwrap();
        let choix = choisir_variable(&conn, "presse_cintrage", &["nb_barres_presse", "poids_presse"], &variables).unwrap();
        assert_eq!(choix, Some("nb_barres_presse"));
    }

    #[test]
    fn grandeur_manquante_estimee_pour_la_prevision() {
        let conn = base();
        // Deux affaires de référence à 2 t par barre ; la troisième a des
        // barres mais pas de poids lu.
        for (affaire_i, nb, poids) in [("R1", 10.0, Some(20.0)), ("R2", 30.0, Some(60.0)), ("SANS_POIDS", 5.0, None)] {
            affaire(&conn, affaire_i, nb, true, 0.0);
            conn.execute("UPDATE variables_affaires SET poids_t = ?1 WHERE affaire = ?2", rusqlite::params![poids, affaire_i])
                .unwrap();
        }
        let variables = prevision::charger_variables_affaire(&conn, "SANS_POIDS").unwrap();
        assert_eq!(variables["poids_t"], 10.0);
        assert_eq!(variables["poids_presse"], 10.0);
        assert_eq!(variables["poids_p3"], 0.0); // P3 pas prévu
        // La calibration, elle, garde le poids inconnu.
        assert_eq!(prevision::charger_variables(&conn, Some("SANS_POIDS")).unwrap()["SANS_POIDS"]["poids_t"], None);
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
    fn presence_des_postes() {
        let params = |presence| PosteCoefficients {
            intercept: 0.0,
            coefficients: HashMap::from([("nb_barres_robot".to_string(), 2.0)]),
            exposant: None,
            presence,
        };
        let presence = Some(Presence { si_prevu: 0.8, si_signal_seul: 0.5, correction: 1.25, heures_sans_quantite: 30.0 });
        let variables = |nb_barres: f64, robot_prevu: bool| -> prevision::VariablesAffaire {
            HashMap::from([
                ("nb_barres".to_string(), nb_barres),
                ("nb_barres_robot".to_string(), if robot_prevu { nb_barres } else { 0.0 }),
                ("robot_prevu".to_string(), robot_prevu as u8 as f64),
            ])
        };
        // Prévu : 0,8 × 1,25 × (2 h × 10 barres).
        assert_eq!(prevision::heures_poste("robot", &params(presence.clone()), &variables(10.0, true)), 20.0);
        // Non prévu : 0 h.
        assert_eq!(prevision::heures_poste("robot", &params(presence.clone()), &variables(10.0, false)), 0.0);
        // Prévu mais sans quantité (ni barres) : 0,5 × 1,25 × 32 h sans quantité.
        let mut sans_barres = variables(0.0, true);
        sans_barres.insert("nb_barres_robot".into(), 0.0);
        let presence = Some(Presence { heures_sans_quantite: 32.0, ..presence.unwrap() });
        assert_eq!(prevision::heures_poste("robot", &params(presence), &sans_barres), 20.0);
        // Signal seul utilisé moins d'une fois sur 2 : 0 h.
        let rare = Some(Presence { si_prevu: 0.8, si_signal_seul: 0.3, correction: 1.25, heures_sans_quantite: 32.0 });
        assert_eq!(prevision::heures_poste("robot", &params(rare), &sans_barres), 0.0);
        // Sans présence calibrée (coefficients antérieurs) : formule si
        // variable non nulle.
        assert_eq!(prevision::heures_poste("robot", &params(None), &variables(10.0, true)), 20.0);
        assert_eq!(prevision::heures_poste("robot", &params(None), &variables(10.0, false)), 0.0);
    }

    #[test]
    fn presence_calibree() {
        let conn = base();
        // 20 affaires avec presse prévue dont 15 l'utilisent (2 h/barre), et
        // 10 sans presse prévue dont 2 l'utilisent quand même.
        for i in 0..20 {
            affaire(&conn, &format!("P{i}"), 10.0, true, if i < 15 { 20.0 } else { 0.0 });
        }
        for i in 0..10 {
            affaire(&conn, &format!("N{i}"), 10.0, false, if i < 2 { 20.0 } else { 0.0 });
        }
        conn.execute("INSERT INTO heures (affaire, poste, heures) SELECT affaire, 'robot', 1 FROM variables_affaires", []).unwrap();

        let variables = prevision::charger_variables(&conn, None).unwrap();
        let reference = affaires_de_reference(&conn, &variables).unwrap();
        assert_eq!(reference.len(), 30);
        let params = PosteCoefficients {
            intercept: 0.0,
            coefficients: HashMap::from([("nb_barres_presse".to_string(), 2.0)]),
            exposant: None,
            presence: None,
        };
        let presence = calibrer_presence(&conn, "presse_cintrage", &params, &reference, &variables).unwrap();
        assert_eq!(presence.si_prevu, 0.75);
        assert!((presence.correction - 340.0 / 300.0).abs() < 1e-9);
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
                    presence: None,
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
        let resultat = calibrer_poste(&conn, "controle_cnd", &[vec!["controle_cnd_prevu".to_string()]], &HashMap::new())
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
        for (poste, candidats) in postes {
            if POSTES_FORFAIT.iter().any(|(p, _)| *p == poste) {
                continue;
            }
            // La grandeur que la calibration retiendrait (voir choisir_variable).
            let simples: Vec<&str> = candidats.iter().filter(|c| c.len() == 1).map(|c| c[0].as_str()).collect();
            let Some(variable) = choisir_variable(&conn, poste, &simples, &variables_affaires).unwrap() else {
                continue;
            };
            let d = charger_donnees_poste(&conn, poste, &[variable], &variables_affaires).unwrap();
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

            let mut ligne = format!("{poste:18} {variable} n={:4} tiers <{:.0} / <{:.0} |", d.len(), bornes.0, bornes.1);
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

    // -----------------------------------------------------------------------
    // Prévision par affaire en validation croisée (10 blocs d'affaires) : la
    // calibration complète est refaite sans les heures ERP du bloc, puis
    // chaque affaire du bloc est prévue comme dans l'application. Écrit un
    // CSV (affaire, poste, réel, prévu) -- travaille sur une COPIE de la base.
    //   PARACHEV_DB=/copie/affaires.db PARACHEV_CSV=/tmp/eval.csv cargo test --lib evaluation_par_affaire -- --ignored --nocapture
    // -----------------------------------------------------------------------

    #[test]
    #[ignore]
    fn evaluation_par_affaire() {
        use std::io::Write;
        const BLOCS: usize = 10;
        let conn = Connection::open(std::env::var("PARACHEV_DB").expect("PARACHEV_DB non défini")).unwrap();
        let mut csv = std::fs::File::create(std::env::var("PARACHEV_CSV").expect("PARACHEV_CSV non défini")).unwrap();
        writeln!(csv, "affaire,poste,reel,prevu").unwrap();

        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT v.affaire FROM variables_affaires v JOIN heures h USING (affaire)
                 WHERE v.nb_barres > 0 ORDER BY v.affaire",
            )
            .unwrap();
        let affaires: Vec<String> = stmt.query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
        drop(stmt);

        for bloc in 0..BLOCS {
            let test: Vec<&String> = affaires.iter().enumerate().filter(|(i, _)| i % BLOCS == bloc).map(|(_, a)| a).collect();
            conn.execute_batch("BEGIN").unwrap();
            let mut reel: HashMap<(String, String), f64> = HashMap::new();
            for affaire in &test {
                let mut stmt = conn.prepare("SELECT poste, SUM(heures) FROM heures WHERE affaire = ?1 GROUP BY poste").unwrap();
                for ligne in stmt.query_map([affaire], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?))).unwrap() {
                    let (poste, h) = ligne.unwrap();
                    reel.insert(((*affaire).clone(), poste), h);
                }
                conn.execute("DELETE FROM heures WHERE affaire = ?1", [affaire]).unwrap();
            }
            let coeffs = calibrer_tous_les_postes(&conn).unwrap();
            for affaire in &test {
                let variables = prevision::charger_variables_affaire(&conn, affaire).unwrap();
                let prevu = prevision::predire(&coeffs, &variables).heures_par_poste;
                let mut postes: std::collections::HashSet<&String> = prevu.keys().collect();
                postes.extend(reel.keys().filter(|(a, _)| a == *affaire).map(|(_, p)| p));
                for poste in postes {
                    let r = reel.get(&((*affaire).clone(), poste.clone())).copied().unwrap_or(0.0);
                    let p = prevu.get(poste).copied().unwrap_or(0.0);
                    writeln!(csv, "{affaire},{poste},{r},{p}").unwrap();
                }
            }
            conn.execute_batch("ROLLBACK").unwrap();
            eprintln!("bloc {bloc} : {} affaires", test.len());
        }
    }
}
