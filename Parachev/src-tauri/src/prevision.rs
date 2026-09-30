use crate::config;
use crate::parsing::operations;
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};
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
    /// Courbe puissance : temps = intercept + Σ(coef_i × x_i^exposant) au
    /// lieu d'une droite, pour un poste dont le temps par unité baisse avec
    /// la taille de la commande (voir calibration::ajuster_puissance).
    /// Absent des coefficients.json antérieurs : None = droite.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exposant: Option<f64>,
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
const CLE_EXPOSANT: &str = "__exposant__";
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

/// Modifie un coefficient (poste+variable, où `variable` peut valoir
/// `__intercept__` ou `__exposant__`) -- pour des tests manuels depuis l'écran Coefficients,
/// sans repasser par une calibration complète. Upsert : fonctionne aussi
/// bien pour corriger un coefficient déjà calibré que pour en ajouter un
/// nouveau sur un poste pas encore calibré.
pub fn modifier_coefficient(conn: &Connection, poste: &str, variable: &str, valeur: f64) -> Result<(), String> {
    conn.execute(
        "INSERT INTO coefficients (poste, variable, valeur) VALUES (?1, ?2, ?3)
         ON CONFLICT(poste, variable) DO UPDATE SET valeur = excluded.valeur",
        params![poste, variable, valeur],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
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

        if let Some(exposant) = params.exposant {
            tx.execute(
                "INSERT INTO coefficients (poste, variable, valeur) VALUES (?1, ?2, ?3)",
                params![poste, CLE_EXPOSANT, exposant],
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
            exposant: None,
        });
        match variable.as_str() {
            CLE_INTERCEPT => entry.intercept = valeur,
            CLE_EXPOSANT => entry.exposant = Some(valeur),
            _ => {
                entry.coefficients.insert(variable, valeur);
            }
        }
    }

    if postes.is_empty() {
        return Err("Aucun coefficient en base -- calibrer d'abord".to_string());
    }

    Ok(CoefficientsExport {version, date_calibration, seuil_diametre_manuel_mm, postes})
}

// ---------------------------------------------------------------------------
// Variables d'une affaire (issues de variables_affaires en SQLite,
// ou fournies manuellement pour une simulation avant insertion en base),
// complétées par les variables propres aux postes prévus
// ---------------------------------------------------------------------------

pub type VariablesAffaire = HashMap<String, f64>;

/// Variables d'une affaire pour la calibration : None = valeur inconnue
/// (fiche pas encore parsée, gabarit vide), à distinguer de 0 = "poste non
/// utilisé" (voir calibration::charger_donnees_poste).
pub type VariablesConnues = HashMap<String, Option<f64>>;

/// Colonnes de `variables_affaires` reprises telles quelles comme variables.
const COLONNES_VARIABLES: [&str; 6] = [
    "nb_barres",
    "nb_goujons",
    "nb_trous_manuel",
    "nb_trous_numerique",
    "diametre_moyen_numerique",
    "longueur_coupe",
];

/// Postes dont le temps suit le nombre de barres qui y passent, avec leur
/// variable dérivée : nb_barres si le poste est prévu, 0 sinon. Sans ce
/// filtre, nb_barres seul chiffrerait de la presse ou du soudage sur toutes
/// les affaires (sur 88 affaires avec fiche et heures ERP, le poste est
/// prévu pour 66 des 67 qui ont des heures de presse, 30 des 35 en robot ;
/// l'assemblage, chiffré sur toutes les affaires avec nb_barres seul, l'était
/// à tort sur 62 affaires sur 88, contre 9 en le limitant aux affaires où il
/// est prévu).
/// Pour le forage numérique, ce n'est qu'un repli : le nombre de trous des
/// programmes CN reste préféré dès qu'il est connu sur assez d'affaires
/// (voir calibration::calibrer_poste).
pub const POSTES_PAR_BARRE: [(&str, &str); 6] = [
    ("assemblage_tracage", "nb_barres_assemblage"),
    ("presse_cintrage", "nb_barres_presse"),
    ("robot", "nb_barres_robot"),
    ("p3", "nb_barres_p3"),
    ("soudage", "nb_barres_soudage"),
    ("forage_numerique", "nb_barres_forage_numerique"),
];

/// Postes chiffrés au forfait (indicatrice 1/0) : trop peu d'affaires avec
/// fiche pour relier leurs heures à une quantité (1 en contrôle CND, 2 en
/// soudage sous flux), le forfait est calibré sur toutes les affaires ERP.
pub const POSTES_FORFAIT: [(&str, &str); 2] = [
    ("soudage_sous_flux", "soudage_sous_flux_prevu"),
    ("controle_cnd", "controle_cnd_prevu"),
];

/// Ajoute les variables dérivées des postes prévus (POSTES_PAR_BARRE,
/// POSTES_FORFAIT). Un poste prévu avec nb_barres inconnu donne une
/// variable inconnue, pas 0.
fn deriver_variables(variables: &mut VariablesConnues, postes_prevus: &HashSet<String>) {
    let nb_barres = variables.get("nb_barres").copied().flatten();
    for (poste, variable) in POSTES_PAR_BARRE {
        let valeur = if postes_prevus.contains(poste) { nb_barres } else { Some(0.0) };
        variables.insert(variable.to_string(), valeur);
    }
    for (poste, variable) in POSTES_FORFAIT {
        let valeur = if postes_prevus.contains(poste) { 1.0 } else { 0.0 };
        variables.insert(variable.to_string(), Some(valeur));
    }
}

/// Postes rendus nécessaires par des cases cochées du RDE (voir
/// operations::postes_depuis_operation_rde).
pub fn postes_depuis_operations_rde<'a>(operations_rde: impl IntoIterator<Item = &'a str>) -> impl Iterator<Item = String> {
    operations_rde
        .into_iter()
        .flat_map(operations::postes_depuis_operation_rde)
        .map(|poste| poste.to_string())
}

/// Postes que chaque affaire traverse : postes de la fiche (avec heures) et
/// colonnes de SUIVI, cases cochées du RDE et préparation P3 demandée au
/// RDE (EN ISO 8501-3).
fn charger_postes_prevus(conn: &Connection, affaire: Option<&str>) -> Result<HashMap<String, HashSet<String>>, String> {
    let mut postes: HashMap<String, HashSet<String>> = HashMap::new();

    let mut stmt = conn
        .prepare("SELECT affaire, source, operation FROM affaire_operations WHERE ?1 IS NULL OR affaire = ?1")
        .map_err(|e| e.to_string())?;
    let lignes = stmt
        .query_map([affaire], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))
        .map_err(|e| e.to_string())?;
    for ligne in lignes {
        let (affaire, source, operation) = ligne.map_err(|e| e.to_string())?;
        let postes_affaire = postes.entry(affaire).or_default();
        match source.as_str() {
            "rde" => postes_affaire.extend(postes_depuis_operations_rde([operation.as_str()])),
            _ => {
                postes_affaire.insert(operation);
            }
        }
    }

    let mut stmt = conn
        .prepare("SELECT affaire FROM rde_affaires WHERE prep_en8501 LIKE 'P3%' AND (?1 IS NULL OR affaire = ?1)")
        .map_err(|e| e.to_string())?;
    let affaires_p3 = stmt.query_map([affaire], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
    for affaire in affaires_p3 {
        postes.entry(affaire.map_err(|e| e.to_string())?).or_default().insert("p3".into());
    }
    Ok(postes)
}

/// Variables de toutes les affaires de `variables_affaires` (ou d'une
/// seule) : colonnes de COLONNES_VARIABLES plus variables dérivées des
/// postes prévus. Partagé entre la calibration et la prévision pour que
/// les deux voient exactement les mêmes valeurs.
pub fn charger_variables(conn: &Connection, affaire: Option<&str>) -> Result<HashMap<String, VariablesConnues>, String> {
    let postes_prevus = charger_postes_prevus(conn, affaire)?;
    let requete = format!(
        "SELECT affaire, {} FROM variables_affaires WHERE ?1 IS NULL OR affaire = ?1",
        COLONNES_VARIABLES.join(", ")
    );
    let mut stmt = conn.prepare(&requete).map_err(|e| e.to_string())?;
    let lignes = stmt
        .query_map([affaire], |row| {
            let mut variables = VariablesConnues::new();
            for (i, colonne) in COLONNES_VARIABLES.iter().enumerate() {
                variables.insert(colonne.to_string(), row.get::<_, Option<f64>>(1 + i)?);
            }
            Ok((row.get::<_, String>(0)?, variables))
        })
        .map_err(|e| e.to_string())?;

    let aucun_poste = HashSet::new();
    let mut resultat = HashMap::new();
    for ligne in lignes {
        let (affaire, mut variables) = ligne.map_err(|e| e.to_string())?;
        deriver_variables(&mut variables, postes_prevus.get(&affaire).unwrap_or(&aucun_poste));
        resultat.insert(affaire, variables);
    }
    Ok(resultat)
}

/// Variables d'une affaire pour la prévision (inconnu = 0). Retourne une
/// erreur si l'affaire n'existe pas encore dans la base (ex. devis pas
/// encore importé).
pub fn charger_variables_affaire(conn: &Connection, affaire: &str) -> Result<VariablesAffaire, String> {
    let variables = charger_variables(conn, Some(affaire))?.remove(affaire).ok_or_else(|| {
        eprintln!("Affaire '{affaire}' introuvable en base");
        format!("Affaire '{affaire}' introuvable en base")
    })?;
    Ok(variables.into_iter().map(|(nom, valeur)| (nom, valeur.unwrap_or(0.0))).collect())
}

/// Variables d'un chiffrage manuel : quantités saisies plus variables
/// dérivées des postes cochés (mêmes règles que pour une affaire en base).
pub fn variables_saisies(saisies: &HashMap<String, f64>, postes_prevus: &HashSet<String>) -> VariablesAffaire {
    let mut variables: VariablesConnues = saisies.iter().map(|(nom, valeur)| (nom.clone(), Some(*valeur))).collect();
    deriver_variables(&mut variables, postes_prevus);
    variables.into_iter().map(|(nom, valeur)| (nom, valeur.unwrap_or(0.0))).collect()
}

// ---------------------------------------------------------------------------
// Prévision
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub struct Prevision {
    pub heures_par_poste: HashMap<String, f64>,
    pub total_heures: f64,
}

/// Applique la formule calibrée : temps = intercept + Σ(coef_i × x_i), ou
/// intercept + Σ(coef_i × x_i^exposant) pour une courbe puissance, pour
/// chaque poste calibré, à partir des variables fournies.
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
                temps += coef * match params.exposant {
                    Some(exposant) => valeur.max(0.0).powf(exposant),
                    None => valeur,
                };
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
