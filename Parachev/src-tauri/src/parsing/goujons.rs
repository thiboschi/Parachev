//! Extraction du nombre de goujons depuis la feuille FC-GOUJ.
//!
//! Structure (confirmée sur données réelles) :
//! - Lignes 13-16 (1-based) : en-têtes multilingues (FR/DE/EN/PL)
//! - À partir de la ligne 17 : une ligne par barre physique (Rep = identifiant
//!   de barre, ex. "1A", "T01"...)
//! - 3 groupes de colonnes (Âme / Aile sup / Aile inf), chacun avec :
//!   Diam., Nb plan (Sol Menge -- planifié), Nb réel (Ist Menge -- réalisé)

use super::{cellule_est_erreur, cellule_vers_texte, cellule_vide};
use calamine::{open_workbook, DataType, Reader, Xlsx};

#[derive(Debug, Clone)]
pub struct BarreGoujons {
    pub rep: String,
    pub profil: String,
    pub longueur: f64,
    pub nb_goujons: f64,
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
const COL_REP: u32 = 2; // colonne C
const COL_PROFIL: u32 = 3; // colonne D
const COL_LONGUEUR: u32 = 4; // colonne E
const LIGNE_DEBUT_DONNEES: u32 = 16; // ligne 17 en 1-based
const LIGNE_COMMANDE: u32 = 6; // ligne 7 en 1-based
const COL_COMMANDE: u32 = 3; // colonne D

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
        for &col in &COLONNES_NB_PLAN {
            if let Some(v) = range.get_value((r, col)) {
                if let Some(n) = v.as_f64() {
                    goujons_ligne += n;
                }
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
            });
        }

        nb_goujons_total += goujons_ligne;
        nb_barres += 1;
        r += 1;
    }

    Ok(Some(ResultatGoujons {
        affaire,
        nb_barres,
        nb_goujons_total,
        detail,
    }))
}