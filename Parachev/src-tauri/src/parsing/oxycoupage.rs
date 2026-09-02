//! Extraction de longueur_coupe depuis les feuilles Oxycoupage.
//!
//! Le nom de la feuille varie selon les fichiers ("FC-OXY", "FT-OXY",
//! "FC-OXY FER-T") -- on essaie plusieurs noms candidats. La position des
//! colonnes varie aussi (PROFIL/LONGUEUR ne sont pas aux mêmes indices
//! selon la variante), d'où une détection dynamique par en-tête, comme
//! pour PREVI.
//!
//! Piège partagé avec FC-GOUJ/FT-OXY : la colonne 1 contient parfois un
//! bloc d'info empilé (Commande/Lot/Plan/Société) qui se répète toutes les
//! 4-5 lignes -- PAS une commande par ligne. La validité d'une ligne de
//! donnée se juge donc sur PROFIL (non vide, pas une erreur #REF!), pas
//! sur la colonne 1.
//!
//! Note : "FC-COUPBIAIS" n'est PAS une variante d'oxycoupage malgré son
//! nom -- c'est une "FICHE DE CONTROLE COUPE BIAISE" (coupe biaise),
//! une opération différente, volontairement exclue ici.

use super::{cellule_est_erreur, cellule_vers_texte, cellule_vide};
use calamine::{open_workbook, DataType, Range, Reader, Xlsx};

const NOMS_FEUILLES_CANDIDATS: [&str; 3] = ["FT-OXY", "FC-OXY FER-T", "FC-OXY"];
const MAX_LIGNES_RECHERCHE_ENTETE: u32 = 25;
const MAX_COL_RECHERCHE_ENTETE: u32 = 20;
const MAX_LIGNES_DONNEES: u32 = 220; // garde-fou si jamais aucune fin nette n'est trouvée

#[derive(Debug)]
pub struct ResultatOxycoupage {
    pub feuille_utilisee: String,
    pub nb_coupes: usize,
    pub longueur_coupe_totale: f64,
}

/// Cherche la première ligne (0-based) contenant une cellule dont le texte
/// (trim, casse ignorée) vaut exactement `motif`, dans les `max_ligne`
/// premières lignes et `max_col` premières colonnes.
fn trouver_ligne_entete(
    range: &Range<calamine::Data>,
    motif: &str,
    max_ligne: u32,
    max_col: u32,
) -> Option<u32> {
    let hauteur = max_ligne.min(range.height() as u32);
    let largeur = max_col.min(range.width() as u32);
    for r in 0..hauteur {
        for c in 0..largeur {
            if let Some(v) = range.get_value((r, c)) {
                if cellule_vers_texte(v).eq_ignore_ascii_case(motif) {
                    return Some(r);
                }
            }
        }
    }
    None
}

/// Cherche, sur une ligne donnée, la colonne dont le texte contient
/// `motif` (insensible à la casse).
fn trouver_colonne(
    range: &Range<calamine::Data>,
    ligne: u32,
    motif: &str,
    max_col: u32,
) -> Option<u32> {
    for c in 0..max_col.min(range.width() as u32) {
        if let Some(v) = range.get_value((ligne, c)) {
            if cellule_vers_texte(v).to_uppercase().contains(&motif.to_uppercase()) {
                return Some(c);
            }
        }
    }
    None
}

fn extraire_depuis_feuille( range: &Range<calamine::Data>, ) -> Result<Option<(usize, f64)>, String> {
    let Some(ligne_entete) =
        trouver_ligne_entete(range, "PROFIL", MAX_LIGNES_RECHERCHE_ENTETE, MAX_COL_RECHERCHE_ENTETE)
    else {
        return Ok(None);
    };

    let col_profil = trouver_colonne(range, ligne_entete, "PROFIL", MAX_COL_RECHERCHE_ENTETE);
    let col_longueur = trouver_colonne(range, ligne_entete, "LONG", MAX_COL_RECHERCHE_ENTETE);

    let (Some(col_profil), Some(col_longueur)) = (col_profil, col_longueur) else {
        return Ok(None);
    };

    let mut longueur_totale = 0.0;
    let mut nb_coupes = 0usize;
    let limite = (ligne_entete + MAX_LIGNES_DONNEES).min(range.height() as u32);

    // Phase 1 : localiser la vraie première ligne de données. Les lignes
    // de continuation d'en-tête (multi-langues, "Länge"/"Length"...)
    // peuvent avoir une colonne Profil vide (FT-OXY) ou au contraire
    // remplie d'un texte de continuation (FC-OXY) -- dans les deux cas,
    // leur colonne Longueur n'est PAS numérique. On avance tant que ce
    // n'est pas le cas, sans jamais interpréter ces lignes comme la fin
    // du tableau.
    let mut r = ligne_entete + 1;
    while r < limite {
        let profil_cell = range.get_value((r, col_profil));
        let longueur_numerique = range
            .get_value((r, col_longueur))
            .and_then(|v| v.as_f64())
            .is_some();
        if !cellule_vide(profil_cell) && !cellule_est_erreur(profil_cell) && longueur_numerique {
            break; // première vraie ligne de données trouvée
        }
        r += 1;
    }

    // Phase 2 : lire les données jusqu'à la fin réelle du tableau (ligne
    // vide ou erreur #REF!).
    while r < limite {
        let profil_cell = range.get_value((r, col_profil));

        if cellule_vide(profil_cell) {
            break;
        }
        if cellule_est_erreur(profil_cell) {
            break;
        }

        if let Some(v) = range.get_value((r, col_longueur)).and_then(|v| v.as_f64()) {
            longueur_totale += v;
            nb_coupes += 1;
        }

        r += 1;
    }

    Ok(Some((nb_coupes, longueur_totale)))
}

/// Extrait la longueur totale de coupe (oxycoupage) pour une affaire.
/// Retourne None si aucune feuille d'oxycoupage n'est présente (affaire
/// n'utilisant pas ce poste -- à ne pas confondre avec FC-COUPBIAIS, une
/// opération différente).
pub fn extraire_oxycoupage(chemin_fichier: &str) -> Result<Option<ResultatOxycoupage>, String> {
    let mut workbook: Xlsx<_> =
        open_workbook(chemin_fichier).map_err(|e| format!("Ouverture impossible: {e}"))?;

    for nom in NOMS_FEUILLES_CANDIDATS {
        if let Ok(range) = workbook.worksheet_range(nom) {
            if let Some((nb_coupes, longueur_coupe_totale)) = extraire_depuis_feuille(&range)? {
                return Ok(Some(ResultatOxycoupage {
                    feuille_utilisee: nom.to_string(),
                    nb_coupes,
                    longueur_coupe_totale,
                }));
            }
        }
    }

    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_oxycoupage_fc_oxy_719879() {
        let resultat = extraire_oxycoupage("1100719879.xlsx").unwrap().unwrap();
        assert_eq!(resultat.feuille_utilisee, "FC-OXY");
        assert_eq!(resultat.nb_coupes, 6);
        assert_eq!(resultat.longueur_coupe_totale, 6.0 * 33800.0);
    }

    #[test]
    fn test_oxycoupage_ft_oxy_662668() {
        let resultat = extraire_oxycoupage("1100662668.xlsx").unwrap().unwrap();
        assert_eq!(resultat.feuille_utilisee, "FT-OXY");
        assert_eq!(resultat.nb_coupes, 9);
        // 3 coupes a 11000 + 6 coupes a 12800
        assert_eq!(resultat.longueur_coupe_totale, 3.0 * 11000.0 + 6.0 * 12800.0);
    }

    #[test]
    fn test_oxycoupage_absent_706839() {
        // Cette affaire n'a que FC-COUPBIAIS (coupe biaise, opération
        // différente) -- pas d'oxycoupage réel.
        let resultat = extraire_oxycoupage("1100706839.xlsx").unwrap();
        assert!(resultat.is_none());
    }

    #[test]
    fn test_oxycoupage_absent_546190() {
        let resultat = extraire_oxycoupage("1100546190.xlsx").unwrap();
        assert!(resultat.is_none());
    }
}