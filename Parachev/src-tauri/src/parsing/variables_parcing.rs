//! Extraction des variables de forage (perçage manuel FT-MAN et perçage
//! numérique FT-NUM) -- les 3 variables explicatives de `variables_affaires`
//! que les autres sous-parsers (previ, goujons, oxycoupage, presse) ne
//! couvrent pas.
//!
//! Constat fait en examinant les 4 fichiers réels disponibles dans "Para" :
//! - La feuille "LISTE TROUS" (censée détailler chaque trou percé avec son
//!   diamètre) n'est, dans les 4 fichiers, qu'un gabarit vide : toutes les
//!   lignes valent "Ø" / 0, aucune donnée réelle n'y est jamais saisie.
//! - Les feuilles FT-MAN / FT-NUM existent et ont des lignes de données par
//!   barre (colonne REP), mais leur colonne "Nbre prévu/réalisé" vaut
//!   invariablement 1 par barre -- elle compte les barres passées à la
//!   foreuse, pas le nombre de trous qui y sont percés (la somme reproduit
//!   exactement nb_barres, ce n'est donc pas un comptage de trous fiable).
//! - Aucune colonne de diamètre (K/L/M sous "TROUS FORES" en FT-MAN, ou la
//!   légende AA/AB en FT-NUM) n'est jamais renseignée.
//!
//! Faute de donnée quantitative exploitable, on retombe sur un signal plus
//! pauvre mais honnête : la présence même de la feuille FT-MAN / FT-NUM dans
//! le classeur indique que ce poste est utilisé sur l'affaire. On code cette
//! présence par la valeur `1.0` (plutôt que `None`, qui laisserait croire
//! que le poste n'existe pas du tout) -- une valeur de repli explicitement
//! grossière, que l'utilisateur pourra corriger manuellement une fois la
//! vraie donnée connue. Si la feuille est absente, le poste n'est pas
//! utilisé sur cette affaire : `None`.

use calamine::{open_workbook, Reader, Xlsx};

const FEUILLE_FORAGE_MANUEL: &str = "FT-MAN";
const FEUILLE_FORAGE_NUMERIQUE: &str = "FT-NUM";

/// Valeur de repli utilisée quand une feuille de forage est présente mais
/// qu'aucune donnée quantitative n'a pu en être extraite.
const VALEUR_PRESENCE_SANS_DONNEE: f64 = 1.0;

#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct VariablesForage {
    pub nb_trous_manuel: Option<f64>,
    pub nb_trous_numerique: Option<f64>,
    pub diametre_moyen_numerique: Option<f64>,
}

/// Extrait les variables de forage d'une affaire à partir de son fichier
/// Excel. Ne renvoie une erreur que si le fichier lui-même est illisible --
/// l'absence des feuilles FT-MAN/FT-NUM est un cas normal (poste non
/// utilisé), pas une erreur.
pub fn extraire_variables_forage(chemin_fichier: &str) -> Result<VariablesForage, String> {
    let workbook: Xlsx<_> =
        open_workbook(chemin_fichier).map_err(|e| format!("Ouverture impossible: {e}"))?;

    let feuilles = workbook.sheet_names().to_owned();
    let manuel_present = feuilles.iter().any(|f| f == FEUILLE_FORAGE_MANUEL);
    let numerique_present = feuilles.iter().any(|f| f == FEUILLE_FORAGE_NUMERIQUE);

    Ok(VariablesForage {
        nb_trous_manuel: manuel_present.then_some(VALEUR_PRESENCE_SANS_DONNEE),
        nb_trous_numerique: numerique_present.then_some(VALEUR_PRESENCE_SANS_DONNEE),
        // Même feuille (FT-NUM) que nb_trous_numerique pour la présence du
        // poste -- aucune des deux ne dispose de donnée quantitative propre.
        diametre_moyen_numerique: numerique_present.then_some(VALEUR_PRESENCE_SANS_DONNEE),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_forage_present_706839() {
        // FT-MAN et FT-NUM existent tous les deux dans ce fichier.
        let forage = extraire_variables_forage("1100706839.xlsx").unwrap();
        assert_eq!(forage.nb_trous_manuel, Some(1.0));
        assert_eq!(forage.nb_trous_numerique, Some(1.0));
        assert_eq!(forage.diametre_moyen_numerique, Some(1.0));
    }

    #[test]
    fn test_forage_partiel_662668() {
        // Ce fichier n'a que FT-MAN, pas FT-NUM (confirmé par la liste des
        // feuilles) -- le forage numérique ne doit pas être inventé.
        let forage = extraire_variables_forage("1100662668.xlsx").unwrap();
        assert_eq!(forage.nb_trous_manuel, Some(1.0));
        assert_eq!(forage.nb_trous_numerique, None);
        assert_eq!(forage.diametre_moyen_numerique, None);
    }

    #[test]
    fn test_fichier_introuvable_retourne_erreur() {
        let resultat = extraire_variables_forage("fichier_inexistant.xlsx");
        assert!(resultat.is_err());
    }
}
