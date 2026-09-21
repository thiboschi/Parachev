//! Extraction du nombre de goujons depuis la feuille FC-GOUJ.
//!
//! Structure (confirmée sur données réelles) :
//! - Lignes 13-16 (1-based) : en-têtes multilingues (FR/DE/EN/PL)
//! - À partir de la ligne 17 : une ligne par barre physique (Rep = identifiant
//!   de barre, ex. "1A", "T01"...)
//! - 3 groupes de colonnes (Âme / Aile sup / Aile inf), chacun avec :
//!   Diam., Nb plan (Sol Menge -- planifié), Nb réel (Ist Menge -- réalisé)

use super::{cellule_est_erreur, cellule_vers_texte, cellule_vide};
use calamine::{open_workbook, Data, DataType, Reader, Xlsx};
use regex::Regex;

/// Un type de goujon (diamètre x hauteur) et son nombre sur une poutre.
#[derive(Debug, Clone, PartialEq)]
pub struct GroupeGoujons {
    pub diametre: Option<f64>,
    pub hauteur: Option<f64>,
    pub nb_goujons: f64,
}

/// Une poutre (ligne Rep de FC-GOUJ) avec ses différents types de goujons.
#[derive(Debug, Clone)]
pub struct BarreGoujons {
    pub rep: String,
    pub profil: String,
    pub longueur: f64,
    pub nb_goujons: f64,
    pub groupes: Vec<GroupeGoujons>,
}

#[derive(Debug)]
pub struct ResultatGoujons {
    pub affaire: Option<String>,
    pub nb_barres: usize,
    pub nb_goujons_total: f64,
    pub detail: Vec<BarreGoujons>,
}

// Colonnes "Nb plan" (Sol Menge) pour les 3 zones Âme / Aile sup / Aile inf.
// Index 0-based (calamine).
const COLONNES_NB_PLAN: [u32; 3] = [7, 10, 13];
// La colonne "Diam." (contient diamètre et hauteur, ex. "19x125") précède
// immédiatement chaque colonne "Nb plan".
const DECALAGE_DIAM: u32 = 1;
const COL_REP: u32 = 2; // colonne C
const COL_PROFIL: u32 = 3; // colonne D
const COL_LONGUEUR: u32 = 4; // colonne E
const LIGNE_DEBUT_DONNEES: u32 = 16; // ligne 17 en 1-based
const LIGNE_COMMANDE: u32 = 6; // ligne 7 en 1-based
const COL_COMMANDE: u32 = 3; // colonne D

/// Lit la cellule "Diam." : "19x125" / "Ø19 x 125" / "19*125,5" -> (19, 125.5) ;
/// un simple nombre est pris comme diamètre seul.
fn lire_diametre_hauteur(cell: Option<&Data>) -> (Option<f64>, Option<f64>) {
    let Some(cell) = cell else { return (None, None) };
    if let Some(n) = cell.as_f64() {
        return (Some(n), None);
    }
    let texte = cellule_vers_texte(cell);
    let re = Regex::new(r"(\d+(?:[.,]\d+)?)\s*[x×*X]\s*(\d+(?:[.,]\d+)?)").unwrap();
    let nb = |s: &str| s.replace(',', ".").parse::<f64>().ok();
    if let Some(c) = re.captures(&texte) {
        return (nb(&c[1]), nb(&c[2]));
    }
    let re_seul = Regex::new(r"(\d+(?:[.,]\d+)?)").unwrap();
    (re_seul.captures(&texte).and_then(|c| nb(&c[1])), None)
}

/// Extrait le nombre total de goujons planifiés depuis FC-GOUJ.
/// Retourne None si la feuille n'existe pas (affaire sans goujonnage).
pub fn extraire_goujons_fc_gouj(chemin_fichier: &str) -> Result<Option<ResultatGoujons>, String> {
    let mut workbook: Xlsx<_> =
        open_workbook(chemin_fichier).map_err(|e| format!("Ouverture impossible: {e}"))?;

    let range = match workbook.worksheet_range("FC-GOUJ") {
        Ok(r) => r,
        Err(_) => return Ok(None),
    };

    let affaire = range
        .get_value((LIGNE_COMMANDE, COL_COMMANDE))
        .map(cellule_vers_texte)
        .filter(|s| !s.is_empty());

    let mut detail = Vec::new();
    let mut nb_goujons_total = 0.0;
    let mut nb_barres = 0usize;
    let mut r = LIGNE_DEBUT_DONNEES;

    let nb_lignes = range.height() as u32;
    while r < nb_lignes {
        let rep_cell = range.get_value((r, COL_REP));
        let profil_cell = range.get_value((r, COL_PROFIL));

        if cellule_vide(rep_cell) {
            break; // fin normale du tableau
        }
        if cellule_est_erreur(rep_cell) || cellule_est_erreur(profil_cell) {
            break; // artefact #REF! -- fin réelle des données valides
        }

        let mut goujons_ligne = 0.0;
        let mut groupes: Vec<GroupeGoujons> = Vec::new();
        for &col in &COLONNES_NB_PLAN {
            let Some(n) = range.get_value((r, col)).and_then(|v| v.as_f64()) else {
                continue;
            };
            goujons_ligne += n;
            if n <= 0.0 {
                continue;
            }
            let (diametre, hauteur) = lire_diametre_hauteur(range.get_value((r, col - DECALAGE_DIAM)));
            // Un même type peut apparaître dans plusieurs zones (âme / ailes).
            match groupes.iter_mut().find(|g| g.diametre == diametre && g.hauteur == hauteur) {
                Some(g) => g.nb_goujons += n,
                None => groupes.push(GroupeGoujons { diametre, hauteur, nb_goujons: n }),
            }
        }

        if goujons_ligne > 0.0 {
            let profil = profil_cell.map(cellule_vers_texte).unwrap_or_default();
            let longueur = range
                .get_value((r, COL_LONGUEUR))
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            let rep = rep_cell.map(cellule_vers_texte).unwrap_or_default();

            detail.push(BarreGoujons {
                rep,
                profil,
                longueur,
                nb_goujons: goujons_ligne,
                groupes,
            });
        }

        nb_goujons_total += goujons_ligne;
        nb_barres += 1;
        r += 1;
    }

    Ok(Some(ResultatGoujons {affaire, nb_barres, nb_goujons_total, detail}))
}