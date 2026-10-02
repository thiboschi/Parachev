//! Extraction du nombre de goujons depuis la feuille FC-GOUJ.
//!
//! Structure (confirmée sur données réelles) :
//! - Lignes 13-16 (1-based) : en-têtes multilingues (FR/DE/EN/PL)
//! - À partir de la ligne 17 : une ligne par barre physique (Rep = identifiant
//!   de barre, ex. "1A", "T01"...)
//! - 3 groupes de colonnes, chacun avec :
//!   Diam., Nb plan (Sol Menge -- planifié), Nb réel (Ist Menge -- réalisé)
//! - Lignes 10-12 : au-dessus de chaque groupe, la zone de la poutre qui
//!   reçoit ses goujons (Âme / Aile sup / Aile inf / Tête), cochée d'un "X"
//!   -- la position du groupe ne dit rien : sur 1100732005 les trois groupes
//!   sont Aile sup, Aile inf et Tête (plaques de tête).

use super::{cellule_est_erreur, cellule_vers_texte, cellule_vide};
use calamine::{open_workbook, Data, DataType, Reader, Xlsx};
use regex::Regex;

/// Un type de goujon (diamètre x hauteur) sur une zone d'une poutre, et son
/// nombre.
#[derive(Debug, Clone, PartialEq)]
pub struct GroupeGoujons {
    pub diametre: Option<f64>,
    pub hauteur: Option<f64>,
    /// "ame", "aile_sup", "aile_inf" ou "tete" ; None si aucune zone n'est
    /// cochée pour ce groupe de colonnes.
    pub zone: Option<&'static str>,
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

// Colonnes "Nb plan" (Sol Menge) des 3 groupes. Index 0-based (calamine).
const COLONNES_NB_PLAN: [u32; 3] = [7, 10, 13];
// Choix de la zone d'un groupe : libellés dans la colonne "Nb plan", "X"
// dans la colonne suivante, sur les lignes 10-12 (1-based).
const LIGNES_ZONES: std::ops::Range<u32> = 9..12;
const DECALAGE_COCHE_ZONE: u32 = 1;
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

/// Normalise un libellé de zone : "Âme/Steg/Web/ Trzon" -> "ame",
/// "Aile inf./Unterflange/..." -> "aile_inf", "plq de tête" -> "tete".
fn normaliser_zone(libelle: &str) -> Option<&'static str> {
    let l = libelle.trim().to_lowercase();
    if l.contains("tête") || l.contains("tete") {
        Some("tete")
    } else if l.starts_with("aile sup") {
        Some("aile_sup")
    } else if l.starts_with("aile inf") {
        Some("aile_inf")
    } else if l.starts_with("âme") || l.starts_with("ame") {
        Some("ame")
    } else {
        None
    }
}

/// Zone cochée ("X") pour le groupe dont la colonne "Nb plan" est `col`.
fn lire_zone(range: &calamine::Range<Data>, col: u32) -> Option<&'static str> {
    LIGNES_ZONES
        .filter(|&r| {
            range
                .get_value((r, col + DECALAGE_COCHE_ZONE))
                .is_some_and(|c| cellule_vers_texte(c).eq_ignore_ascii_case("x"))
        })
        .find_map(|r| normaliser_zone(&cellule_vers_texte(range.get_value((r, col))?)))
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

    let zones = COLONNES_NB_PLAN.map(|col| lire_zone(&range, col));

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
        for (&col, &zone) in COLONNES_NB_PLAN.iter().zip(&zones) {
            let Some(n) = range.get_value((r, col)).and_then(|v| v.as_f64()) else {
                continue;
            };
            goujons_ligne += n;
            if n <= 0.0 {
                continue;
            }
            let (diametre, hauteur) = lire_diametre_hauteur(range.get_value((r, col - DECALAGE_DIAM)));
            // Deux groupes de colonnes peuvent porter le même type sur la même zone.
            match groupes
                .iter_mut()
                .find(|g| g.diametre == diametre && g.hauteur == hauteur && g.zone == zone)
            {
                Some(g) => g.nb_goujons += n,
                None => groupes.push(GroupeGoujons { diametre, hauteur, zone, nb_goujons: n }),
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
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diam_hauteur_avec_symbole_diametre_et_espace() {
        // Format réel observé dans FC-GOUJ (voir Para/Script Excel/1100719879.xlsx) :
        // "Ø22x150 " -- symbole Ø, pas d'espace autour du x, espace de trop en fin.
        assert_eq!(
            lire_diametre_hauteur(Some(&Data::String("Ø22x150 ".to_string()))),
            (Some(22.0), Some(150.0))
        );
    }

    #[test]
    fn zones_cochees_sur_fiche_reelle() {
        // 1100732005 (Pont Peyramale) : Aile sup / Aile inf / Tête cochées.
        let chemin = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../COMMANDES FINIES/1a COMMANDES FINIES 2025/1100732005 PONT PEYRAMALE/1100732005.xlsx"
        );
        if !std::path::Path::new(chemin).exists() {
            return; // données réelles absentes de cette machine
        }
        let resultat = extraire_goujons_fc_gouj(chemin).unwrap().unwrap();
        assert_eq!(resultat.nb_goujons_total, 1984.0);
        let zones: Vec<_> = resultat.detail[0].groupes.iter().map(|g| (g.zone, g.nb_goujons)).collect();
        assert_eq!(zones, vec![(Some("aile_sup"), 90.0), (Some("aile_inf"), 10.0), (Some("tete"), 10.0)]);
    }

    #[test]
    fn zones_normalisees() {
        // Libellés réels des lignes 10-12 de FC-GOUJ.
        assert_eq!(normaliser_zone("Âme/Steg/Web/ Trzon"), Some("ame"));
        assert_eq!(normaliser_zone("Aile sup / Oberflange / Upper flange / Szeroki"), Some("aile_sup"));
        assert_eq!(normaliser_zone("Aile inf./Unterflange/ Lower flange / Wąski"), Some("aile_inf"));
        assert_eq!(normaliser_zone("Tête"), Some("tete"));
        assert_eq!(normaliser_zone("plq de tête"), Some("tete"));
        assert_eq!(normaliser_zone("Bureaux"), None);
    }
}
