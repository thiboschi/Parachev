//! Extraction de la "Revue des exigences techniques" (RDE, gabarit V1.7 --
//! seule version rencontrée sur les 224 fichiers du dossier "1a COMMANDES
//! FINIES 2025").
//!
//! Deux feuilles utiles :
//! - "cde" : en-tête commande (date, projet, offre, client, donneur
//!   d'ordre, n° de commande laminage 1900... et n° d'affaire 1100...), puis
//!   le tableau "Commande de Laminage" (profil, longueur, nuance, poids,
//!   nombre, usine, date de laminage) à colonnes fixes.
//! - "parachèvement" : type d'affaire, cases à cocher des opérations de
//!   fabrication et traitements de surface, et les exigences normatives
//!   (EN 10163-3, tolérance, EXC EN 1090, EN 10204, EN 8501-3, US...), dont
//!   la valeur est toujours en colonne G.
//!
//! Cases à cocher : un "x" dans la ou les cellules qui suivent le libellé
//! (ex. "Coupe | x | Droite, 90° | x | Biaise | | Ouverture d'âme"). "-"
//! est la valeur par défaut des listes déroulantes : traité comme vide.

use super::{cellule_vers_date, cellule_vers_texte, numero_affaire, operations};
use calamine::{open_workbook, Data, Range, Reader, Xlsx};

const MAX_LIGNES: u32 = 160;
const MAX_COLONNES: u32 = 20;
const COL_VALEUR_EXIGENCE: u32 = 6; // colonne G de "parachèvement"

#[derive(Debug, Clone, Default)]
pub struct LigneLaminage {
    pub profil: String,
    pub longueur: Option<f64>,
    pub nuance: Option<String>,
    pub poids_kg: Option<f64>,
    pub nombre: Option<f64>,
    pub usine: Option<String>,
    pub date_laminage: Option<String>,
}

#[derive(Debug, Default)]
pub struct InfoRde {
    pub date: Option<String>,
    pub projet: Option<String>,
    pub offre: Option<String>,
    pub client: Option<String>,
    pub donneur_ordre: Option<String>,
    pub cde_laminage: Option<String>,
    /// N° d'affaire 1100... lu dans "No de cde client" (None si absent).
    pub affaire: Option<String>,
    pub laminage: Vec<LigneLaminage>,
    pub type_affaire: Option<String>,
    pub type_poutre: Option<String>,
    pub remarques: Option<String>,
    /// Cases cochées : (clé operations::operation_rde, libellé d'origine).
    pub operations: Vec<(String, String)>,
    /// "oui"/"non" de la ligne sous "Traitement de surface".
    pub traitement_surface: Option<String>,
    pub traitements: Vec<String>,
    pub en10163: Option<String>,
    pub tolerance: Option<String>,
    pub tolerance_speciale: Option<String>,
    pub exc: Option<String>,
    pub tracabilite: Option<String>,
    pub en10204: Option<String>,
    pub prep_en8501: Option<String>,
    pub classe_us: Option<String>,
    pub exigence_fabrication: Option<String>,
    pub exigences_acier: Vec<String>,
    pub accessoires: Vec<String>,
}

/// true si les noms de feuilles sont ceux d'un RDE (feuille "cde" + une
/// feuille "parachèvement").
pub fn est_un_rde(feuilles: &[String]) -> bool {
    feuilles.iter().any(|f| f == "cde") && feuilles.iter().any(|f| f.to_lowercase().contains("parach"))
}

/// Grille texte (dates converties en ISO) des premières lignes d'une feuille.
fn grille(range: &Range<Data>) -> Vec<Vec<String>> {
    (0..MAX_LIGNES.min(range.height() as u32))
        .map(|r| {
            (0..MAX_COLONNES)
                .map(|c| match range.get_value((r, c)) {
                    Some(v @ (Data::DateTime(_) | Data::DateTimeIso(_))) => {
                        cellule_vers_date(v).unwrap_or_else(|| cellule_vers_texte(v))
                    }
                    Some(v) => cellule_vers_texte(v),
                    None => String::new(),
                })
                .collect()
        })
        .collect()
}

fn valeur(s: &str) -> Option<String> {
    let t = s.trim();
    (!t.is_empty() && t != "-").then(|| t.to_string())
}

/// Première ligne dont la colonne `col` commence par `libelle` (insensible
/// à la casse et aux accents).
fn ligne(g: &[Vec<String>], libelle: &str, col: usize) -> Option<usize> {
    let cible = operations::normaliser(libelle);
    g.iter().position(|r| operations::normaliser(&r[col]).starts_with(&cible))
}

/// Libellés d'une ligne suivis d'un "x" avant le libellé suivant.
fn cases_cochees(r: &[String]) -> Vec<String> {
    let libelles: Vec<(usize, &String)> = r
        .iter()
        .enumerate()
        .filter(|(_, v)| valeur(v).is_some() && !v.trim().eq_ignore_ascii_case("x"))
        .collect();
    libelles
        .iter()
        .enumerate()
        .filter_map(|(k, (c, libelle))| {
            let fin = libelles.get(k + 1).map(|(c2, _)| *c2).unwrap_or(r.len());
            r[c + 1..fin]
                .iter()
                .any(|v| v.trim().eq_ignore_ascii_case("x"))
                .then(|| libelle.trim().to_string())
        })
        .collect()
}

fn nombre(s: &str) -> Option<f64> {
    s.trim().replace(',', ".").parse::<f64>().ok()
}

/// Variantes de saisie d'une même classe de tolérance ("Class 1",
/// "tolérance client") ramenées aux valeurs de la liste déroulante.
fn normaliser_tolerance(t: &str) -> String {
    let n = operations::normaliser(t);
    if let Some(classe) = n.strip_prefix("CLASSE ").or_else(|| n.strip_prefix("CLASS ")) {
        format!("Classe {classe}")
    } else if n.starts_with("TOLERANCE") && n.contains("CLIENT") {
        "tolérances client".to_string()
    } else {
        t.to_string()
    }
}

pub fn extraire_rde(chemin_fichier: &str) -> Result<Option<InfoRde>, String> {
    let mut workbook: Xlsx<_> =
        open_workbook(chemin_fichier).map_err(|e| format!("Ouverture impossible: {e}"))?;
    let feuilles = workbook.sheet_names().to_owned();
    if !est_un_rde(&feuilles) {
        return Ok(None);
    }
    let nom_parach = feuilles.iter().find(|f| f.to_lowercase().contains("parach")).cloned().unwrap_or_default();
    let cde = grille(&workbook.worksheet_range("cde").map_err(|e| format!("Feuille cde illisible: {e}"))?);
    let par = grille(&workbook.worksheet_range(&nom_parach).map_err(|e| format!("Feuille {nom_parach} illisible: {e}"))?);

    let mut info = InfoRde::default();

    // --- Feuille "cde" -----------------------------------------------------
    // La valeur est en colonne E (parfois D pour la date).
    let champ = |libelle: &str| ligne(&cde, libelle, 0).and_then(|i| valeur(&cde[i][4]).or_else(|| valeur(&cde[i][3])));
    info.date = ligne(&cde, "Date", 0).and_then(|i| {
        [3, 4].iter().find_map(|&c| super::texte_vers_date(&cde[i][c]))
    });
    info.projet = champ("Nom Projet");
    info.offre = champ("N° offre AM");
    info.client = champ("Client");
    info.donneur_ordre = champ("Donneur d'ordre");
    if let Some(i) = ligne(&cde, "No de cde Laminage", 0) {
        info.cde_laminage = valeur(&cde[i][4]);
        info.affaire = cde[i][8..].iter().find_map(|v| numero_affaire(v));
    }
    // Tableau "Commande de Laminage" : première ligne "Postes", jusqu'à
    // "Commande client" (second tableau, redondant).
    if let Some(debut) = ligne(&cde, "Postes", 0) {
        for r in &cde[debut + 1..] {
            if operations::normaliser(&r[0]).starts_with("COMMANDE") {
                break;
            }
            let Some(profil) = valeur(&r[3]) else { continue };
            info.laminage.push(LigneLaminage {
                profil,
                longueur: nombre(&r[4]),
                nuance: valeur(&r[6]),
                poids_kg: nombre(&r[8]),
                nombre: nombre(&r[11]),
                usine: valeur(&r[14]),
                date_laminage: super::texte_vers_date(&r[17]),
            });
        }
    }

    // --- Feuille "parachèvement" -----------------------------------------
    info.type_affaire = ligne(&par, "Type d'affaire", 0).and_then(|i| valeur(&par[i][2]));
    if let Some(i) = ligne(&par, "Coupe", 0) {
        info.type_poutre = valeur(&par[i][10]);
    }
    for libelle in ["Coupe", "Perçage", "Contre-flèche", "Assemblage"] {
        if let Some(i) = ligne(&par, libelle, 0) {
            for coche in cases_cochees(&par[i]) {
                if let Some(cle) = operations::operation_rde(&coche) {
                    if !info.operations.iter().any(|(c, _)| c == cle) {
                        info.operations.push((cle.to_string(), coche));
                    }
                }
            }
        }
    }
    info.remarques = ligne(&par, "Remarques", 0).and_then(|i| par[i][1..].iter().find_map(|v| valeur(v)));
    if let Some(i) = ligne(&par, "Traitement de surface", 0) {
        info.traitement_surface = par.get(i + 1).and_then(|r| valeur(&r[0]));
        info.traitements = par[i + 2..(i + 4).min(par.len())].iter().flat_map(|r| cases_cochees(r)).collect();
    }
    let exigence = |libelle: &str| ligne(&par, libelle, 0).and_then(|i| valeur(&par[i][COL_VALEUR_EXIGENCE as usize]));
    info.exigence_fabrication = exigence("Exigence(s) particulière(s) fab");
    info.en10163 = exigence("Exigeances de réparation");
    info.tolerance = exigence("Classe de tolérance").map(|t| normaliser_tolerance(&t));
    info.tolerance_speciale = exigence("si tolérances spéciales");
    info.exc = exigence("Classe d’exécution").or_else(|| exigence("Classe d'exécution"));
    info.tracabilite = exigence("Type de traçabilité");
    info.en10204 = exigence("Type de document de contr");
    info.prep_en8501 = exigence("Degré de préparation");
    info.classe_us = exigence("Classe US");
    if let Some(i) = ligne(&par, "Exigence(s) particulière(s)acier", 0) {
        info.exigences_acier = par[i..(i + 2).min(par.len())]
            .iter()
            .flat_map(|r| cases_cochees(r))
            .filter(|l| !operations::normaliser(l).starts_with("EXIGENCE"))
            .collect();
    }
    if let Some(i) = ligne(&par, "Ecarteur", 0) {
        info.accessoires = par[i..(i + 3).min(par.len())].iter().flat_map(|r| cases_cochees(r)).collect();
    }

    Ok(Some(info))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tolerances_normalisees() {
        assert_eq!(normaliser_tolerance("Class 1"), "Classe 1");
        assert_eq!(normaliser_tolerance("Classe 2"), "Classe 2");
        assert_eq!(normaliser_tolerance("tolérance client"), "tolérances client");
        assert_eq!(normaliser_tolerance("tolérances client"), "tolérances client");
    }

    #[test]
    fn cases_cochees_sur_ligne_reelle() {
        // Ligne "Coupe" du RDE Lexus Tower (1100732016).
        let mut r = vec![String::new(); 12];
        r[0] = "Coupe".into();
        r[1] = "x".into();
        r[2] = "Droite, 90°".into();
        r[3] = "x".into();
        r[4] = "Biaise".into();
        r[5] = "x".into();
        r[6] = "Ouverture d'âme".into();
        r[9] = "Type poutre:".into();
        r[10] = "Profil".into();
        assert_eq!(cases_cochees(&r), vec!["Coupe", "Droite, 90°", "Biaise"]);
    }

    const RDE_HOFMANN: &str = "../../1a COMMANDES FINIES 2025/1100725621 HOFMANN RIEG/RDE V7 - 1900017230 - 1100725621.xlsx";

    #[test]
    fn rde_reel_hofmann() {
        if !std::path::Path::new(RDE_HOFMANN).exists() {
            return;
        }
        let rde = extraire_rde(RDE_HOFMANN).unwrap().unwrap();
        assert_eq!(rde.date.as_deref(), Some("2025-04-17"));
        assert_eq!(rde.offre.as_deref(), Some("5502ST25"));
        assert_eq!(rde.cde_laminage.as_deref(), Some("1900017230"));
        assert_eq!(rde.affaire.as_deref(), Some("1100725621"));
        assert_eq!(rde.laminage.len(), 1);
        assert_eq!(rde.laminage[0].profil, "HE 600 B");
        assert_eq!(rde.laminage[0].nombre, Some(80.0));
        assert_eq!(rde.laminage[0].date_laminage.as_deref(), Some("2025-05-22"));
        assert!(rde.operations.iter().any(|(c, _)| c == "double_redressage"));
        assert_eq!(rde.exc.as_deref(), Some("EXC2"));
        assert_eq!(rde.en10204.as_deref(), Some("EN 10204 - 3.1"));
        assert_eq!(rde.tolerance.as_deref(), Some("tolérances client"));
        assert_eq!(rde.traitement_surface.as_deref(), Some("non"));
    }
}
