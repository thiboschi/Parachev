//! Extraction des variables de forage (perçage manuel et perçage numérique)
//! -- les variables explicatives de `variables_affaires` que les autres
//! sous-parsers (previ, goujons, oxycoupage, presse) ne couvrent pas.
//!
//! Forage manuel : la feuille "FC FMAN" (et sa variante "FC FMAN 4Ø", plus
//! de zones) a exactement le même format que FC-GOUJ (voir goujons.rs) --
//! lignes 13-16 d'en-tête, une ligne par barre (Rep) à partir de la ligne
//! 17, des paires de colonnes Diam./Nb plan (2, 3 ou 4 zones Âme/Aile sup/
//! Aile inf selon la variante). "FT-MAN" existe aussi mais ne sert qu'au
//! comptage de barres passées à la foreuse (colonne "Nbre prévu" vaut
//! invariablement 1), pas de trous -- FC FMAN est la seule source fiable.
//!
//! Forage numérique : aucune feuille équivalente (Diam./Nb plan) n'a été
//! trouvée dans les fichiers réels -- "LISTE TROUS" est un gabarit toujours
//! vide, et FT-NUM n'a pas de colonne de diamètre.
//!
//! La simple PRÉSENCE d'une feuille ne prouve rien : la fiche de prévision
//! est un gabarit qui contient toutes les feuilles FC-/FT- quelle que soit
//! l'affaire (FT-NUM est présente dans 182 fiches sur 262 du dossier "1a
//! COMMANDES FINIES 2025"). L'usage réel d'un poste se lit désormais dans
//! la feuille SUIVI (voir suivi.rs), les postes A-D de PREVI et le RDE --
//! ici, une variable sans donnée chiffrée vaut None, jamais un repli.

use super::{cellule_est_erreur, cellule_vers_texte, cellule_vide};
use calamine::{open_workbook, DataType, Reader, Xlsx};

const FEUILLES_FORAGE_MANUEL: [&str; 2] = ["FC FMAN", "FC FMAN 4Ø"];

const COL_REP: u32 = 2;
const COL_PROFIL: u32 = 3;
const LIGNE_DEBUT_DONNEES: u32 = 16; // ligne 17 en 1-based
const LIGNE_ENTETE: u32 = 12; // ligne 13 en 1-based -- porte les cellules "Diam."
const MAX_COLONNES_ENTETE: u32 = 25;

#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct VariablesForage {
    pub nb_trous_manuel: Option<f64>,
    /// Diamètre moyen des trous de FC FMAN, pondéré par leur nombre (mm).
    pub diametre_moyen_manuel: Option<f64>,
    pub nb_trous_numerique: Option<f64>,
    pub diametre_moyen_numerique: Option<f64>,
}

/// Extrait les variables de forage d'une affaire à partir de son fichier
/// Excel. Ne renvoie une erreur que si le fichier lui-même est illisible --
/// l'absence des feuilles de forage est un cas normal (poste non utilisé),
/// pas une erreur.
pub fn extraire_variables_forage(chemin_fichier: &str) -> Result<VariablesForage, String> {
    let mut workbook: Xlsx<_> =
        open_workbook(chemin_fichier).map_err(|e| format!("Ouverture impossible: {e}"))?;

    let (nb_trous_manuel, diametre_moyen_manuel) = extraire_trous_fc_fman(&mut workbook)?.unzip();

    // Forage numérique : aucune source chiffrée connue (voir en-tête).
    Ok(VariablesForage {
        nb_trous_manuel,
        diametre_moyen_manuel: diametre_moyen_manuel.flatten(),
        nb_trous_numerique: None,
        diametre_moyen_numerique: None,
    })
}

/// Somme les "Nb plan" de toutes les zones Diam./Nb plan de FC FMAN (ou
/// FC FMAN 4Ø), toutes barres confondues -- même format que FC-GOUJ, donc
/// même lecture (voir goujons::extraire_goujons_fc_gouj). None si la
/// feuille est absente OU vide (gabarit non rempli) : dans les deux cas le
/// nombre de trous est inconnu.
///
/// Renvoie aussi le diamètre moyen de ces trous, pondéré par leur nombre
/// (cellule "Diam." de la ligne : "Ø 40", "Ø50", 40...). None si aucun
/// diamètre n'est lisible ; une ligne sans diamètre ne compte que pour le
/// nombre de trous.
fn extraire_trous_fc_fman<R: std::io::Read + std::io::Seek>(
    workbook: &mut Xlsx<R>,
) -> Result<Option<(f64, Option<f64>)>, String> {
    let feuille = FEUILLES_FORAGE_MANUEL
        .iter()
        .find(|&&nom| workbook.sheet_names().iter().any(|f| f == nom));
    let Some(&feuille) = feuille else {
        return Ok(None);
    };

    let range = workbook
        .worksheet_range(feuille)
        .map_err(|e| format!("Lecture de {feuille} impossible: {e}"))?;

    // Colonnes "Diam." -- détectées dynamiquement dans l'en-tête plutôt que
    // codées en dur, pour couvrir aussi bien la variante 3 zones ("FC FMAN")
    // que la variante 4 zones ("FC FMAN 4Ø") avec le même code.
    let colonnes_diam: Vec<u32> = (0..MAX_COLONNES_ENTETE.min(range.width() as u32))
        .filter(|&c| {
            range
                .get_value((LIGNE_ENTETE, c))
                .map(cellule_vers_texte)
                .is_some_and(|t| t.eq_ignore_ascii_case("Diam."))
        })
        .collect();

    let mut total = 0.0;
    let mut somme_diametres = 0.0;
    let mut trous_avec_diametre = 0.0;
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

        for &col_diam in &colonnes_diam {
            if let Some(n) = range.get_value((r, col_diam + 1)).and_then(|v| v.as_f64()) {
                total += n;
                let diametre = range.get_value((r, col_diam)).map(cellule_vers_texte).and_then(|t| lire_diametre(&t));
                if let Some(diametre) = diametre {
                    somme_diametres += diametre * n;
                    trous_avec_diametre += n;
                }
            }
        }
        r += 1;
    }

    let diametre_moyen = (trous_avec_diametre > 0.0).then(|| somme_diametres / trous_avec_diametre);
    Ok((total > 0.0).then_some((total, diametre_moyen)))
}

/// Premier nombre d'une cellule "Diam." ("Ø 40" -> 40, "Ø22,5" -> 22.5).
/// None pour un gabarit non rempli ("Ø") ou une valeur nulle.
fn lire_diametre(texte: &str) -> Option<f64> {
    let debut = texte.find(|c: char| c.is_ascii_digit())?;
    let nombre: String = texte[debut..]
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.' || *c == ',')
        .map(|c| if c == ',' { '.' } else { c })
        .collect();
    nombre.trim_end_matches('.').parse().ok().filter(|d: &f64| *d > 0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diametre_d_une_cellule() {
        assert_eq!(lire_diametre("Ø 40"), Some(40.0));
        assert_eq!(lire_diametre("Ø50"), Some(50.0));
        assert_eq!(lire_diametre("Ø 22,5"), Some(22.5));
        assert_eq!(lire_diametre("33"), Some(33.0));
        assert_eq!(lire_diametre("Ø "), None);
        assert_eq!(lire_diametre(""), None);
    }
}
