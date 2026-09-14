//! Extraction de la contre-flèche (Cfl) depuis la feuille FC-PRES/FC-PRESS
//! ("FICHE DE CONTRÔLE / PRESSE").
//!
//! Structure observée (confirmée sur 4 fichiers réels) :
//! - En-tête multilingue sur 4 lignes (FR/DE/EN/PL), la ligne française
//!   portant "Rep" (colonne identifiant la barre) et "Cfl  plan axe fort" /
//!   "Cfl  plan axe faible" (valeurs cible de contre-flèche, souvent
//!   seulement l'axe fort renseigné).
//! - Une ligne par barre juste en dessous, jusqu'à la première ligne vide
//!   (colonne Rep) qui marque la fin du tableau -- les lignes suivantes
//!   (légende tolérances, "Def.Ame"...) ne doivent pas être lues comme des
//!   données.
//!
//! Sur les 5 fichiers réels disponibles : seul 1100719879.xlsx a la colonne
//! Cfl (axe fort) réellement renseignée (206 pour ses 6 barres) ; les 3
//! autres qui ont la feuille laissent la colonne vide (gabarit non rempli),
//! et 1100633635-636 n'a pas la feuille du tout. D'où le repli à deux
//! niveaux dans `extraire_contre_fleche` : donnée réelle si disponible,
//! sinon simple signal de présence (voir variables_parcing.rs).

use super::{cellule_est_erreur, cellule_vers_texte, cellule_vide};
use calamine::{open_workbook, DataType, Range, Reader, Xlsx};

const NOMS_FEUILLES_CANDIDATS: [&str; 2] = ["FC-PRES", "FC-PRESS"];
const MAX_LIGNES_RECHERCHE_ENTETE: u32 = 25;
const MAX_COL_RECHERCHE_ENTETE: u32 = 20;
const MAX_LIGNES_DONNEES: u32 = 220; // garde-fou si jamais aucune fin nette n'est trouvée

/// Valeur de repli quand la feuille FC-PRES/FC-PRESS existe mais que sa
/// colonne Cfl n'est pas renseignée (gabarit vide) -- même sémantique de
/// "présence sans donnée" que pour le Forage, voir variables_parcing.rs.
const VALEUR_PRESENCE_SANS_DONNEE: f64 = 1.0;

#[derive(Debug)]
pub struct ResultatPresse {
    pub feuille_utilisee: String,
    pub nb_valeurs: usize,
    pub contre_fleche_moyenne: Option<f64>,
}

impl ResultatPresse {
    /// La contre-flèche moyenne si elle a pu être calculée, sinon la valeur
    /// de repli "présence sans donnée" (la feuille existe donc le poste
    /// presse/redressage est utilisé sur cette affaire, mais aucune valeur
    /// n'y a été saisie).
    pub fn valeur_avec_repli(&self) -> f64 {
        self.contre_fleche_moyenne.unwrap_or(VALEUR_PRESENCE_SANS_DONNEE)
    }
}

fn trouver_ligne_entete(range: &Range<calamine::Data>, motif: &str) -> Option<u32> {
    let hauteur = MAX_LIGNES_RECHERCHE_ENTETE.min(range.height() as u32);
    let largeur = MAX_COL_RECHERCHE_ENTETE.min(range.width() as u32);
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

fn trouver_colonne(range: &Range<calamine::Data>, ligne: u32, motif: &str) -> Option<u32> {
    for c in 0..MAX_COL_RECHERCHE_ENTETE.min(range.width() as u32) {
        if let Some(v) = range.get_value((ligne, c)) {
            if cellule_vers_texte(v).to_uppercase().contains(&motif.to_uppercase()) {
                return Some(c);
            }
        }
    }
    None
}

/// Retourne (nb_valeurs, moyenne) sur toutes les lignes de données valides
/// où la colonne Cfl axe fort contient une valeur numérique. None si la
/// feuille n'a pas la structure attendue (colonnes REP/Cfl introuvables).
fn extraire_depuis_feuille(range: &Range<calamine::Data>) -> Option<(usize, f64)> {
    let ligne_entete = trouver_ligne_entete(range, "REP")?;
    let col_rep = trouver_colonne(range, ligne_entete, "REP")?;
    // "Cfl  plan axe fort" précède toujours "Cfl  plan axe faible" sur la
    // ligne d'en-tête -- la première colonne contenant "CFL" est la bonne.
    let col_cfl = trouver_colonne(range, ligne_entete, "CFL")?;

    let mut somme = 0.0;
    let mut nb_valeurs = 0usize;
    let mut r = ligne_entete + 1;
    let limite = (ligne_entete + MAX_LIGNES_DONNEES).min(range.height() as u32);

    while r < limite {
        let rep_cell = range.get_value((r, col_rep));
        if cellule_vide(rep_cell) || cellule_est_erreur(rep_cell) {
            break; // fin du tableau
        }
        if let Some(v) = range.get_value((r, col_cfl)).and_then(|v| v.as_f64()) {
            somme += v;
            nb_valeurs += 1;
        }
        r += 1;
    }

    Some((nb_valeurs, somme))
}

/// Cherche la feuille FC-PRES/FC-PRESS dans le classeur et en extrait la
/// contre-flèche moyenne (axe fort) sur toutes les barres où elle est
/// renseignée. `contre_fleche_moyenne` vaut None si la feuille existe mais
/// qu'aucune valeur numérique n'y est saisie (gabarit vide) -- à distinguer
/// du cas où la feuille est totalement absente (voir Ok(None) global).
pub fn extraire_presse(chemin_fichier: &str) -> Result<Option<ResultatPresse>, String> {
    let mut workbook: Xlsx<_> =
        open_workbook(chemin_fichier).map_err(|e| format!("Ouverture impossible: {e}"))?;

    for nom in NOMS_FEUILLES_CANDIDATS {
        if let Ok(range) = workbook.worksheet_range(nom) {
            if let Some((nb_valeurs, somme)) = extraire_depuis_feuille(&range) {
                return Ok(Some(ResultatPresse {
                    feuille_utilisee: nom.to_string(),
                    nb_valeurs,
                    contre_fleche_moyenne: (nb_valeurs > 0).then_some(somme / nb_valeurs as f64),
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
    fn test_presse_valeurs_reelles_719879() {
        let resultat = extraire_presse("1100719879.xlsx").unwrap().unwrap();
        assert_eq!(resultat.feuille_utilisee, "FC-PRES");
        assert_eq!(resultat.nb_valeurs, 6);
        assert_eq!(resultat.contre_fleche_moyenne, Some(206.0));
        assert_eq!(resultat.valeur_avec_repli(), 206.0);
    }

    #[test]
    fn test_presse_feuille_presente_mais_vide_706839() {
        // La feuille FC-PRES existe mais la colonne Cfl n'y est pas remplie.
        let resultat = extraire_presse("1100706839.xlsx").unwrap().unwrap();
        assert_eq!(resultat.feuille_utilisee, "FC-PRES");
        assert_eq!(resultat.nb_valeurs, 0);
        assert_eq!(resultat.contre_fleche_moyenne, None);
        assert_eq!(resultat.valeur_avec_repli(), 1.0);
    }

    #[test]
    fn test_presse_nom_feuille_fc_press_662668() {
        let resultat = extraire_presse("1100662668.xlsx").unwrap().unwrap();
        assert_eq!(resultat.feuille_utilisee, "FC-PRESS");
        assert_eq!(resultat.nb_valeurs, 0);
        assert_eq!(resultat.contre_fleche_moyenne, None);
    }
}
