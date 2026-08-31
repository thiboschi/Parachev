//! Extraction des variables explicatives depuis les fichiers Excel de
//! prévision par affaire (un fichier .xlsx par affaire, ~80-120 feuilles).
//!
//! Structure : un sous-module par feuille source, chacun responsable de
//! son propre format de colonnes. Ce fichier ne fait qu'orchestrer les
//! sous-parsers et fournir les helpers partagés entre eux (lecture de
//! cellule, détection des cellules d'erreur #REF!).

mod goujons;
mod oxycoupage;
mod previ;

pub use goujons::{extraire_goujons_fc_gouj, BarreGoujons, ResultatGoujons};
pub use oxycoupage::{extraire_oxycoupage, ResultatOxycoupage};
pub use previ::{extraire_info_previ, InfoPrevi};

use calamine::Data;

/// L'ensemble des variables explicatives extraites pour une affaire,
/// prêtes à être insérées dans la table SQLite `variables_affaires`.
/// Les champs sont des Option car toutes les affaires n'utilisent pas
/// tous les postes (ex. pas de goujonnage -> nb_goujons = None ou 0).
#[derive(Debug, Default)]
pub struct VariablesAffaire {
    pub affaire: String,
    pub nb_barres: f64,
    pub nb_goujons: f64,
    pub longueur_coupe: f64,
    // À compléter au fur et à mesure des sous-modules suivants :
    // pub nb_trous_manuel: f64,
    // pub nb_trous_numerique: f64,
    // pub diametre_moyen_numerique: f64,
}

/// Extrait toutes les variables disponibles pour une affaire en ouvrant
/// son fichier Excel une seule fois et en déléguant à chaque sous-parser.
pub fn extraire_variables_affaire(chemin_fichier: &str) -> Result<VariablesAffaire, String> {
    let info = extraire_info_previ(chemin_fichier)?
        .ok_or_else(|| format!("Feuille PREVI introuvable dans {chemin_fichier}"))?;

    let goujons = extraire_goujons_fc_gouj(chemin_fichier)?;
    let oxycoupage = extraire_oxycoupage(chemin_fichier)?;

    Ok(VariablesAffaire {
        affaire: info.commande,
        nb_barres: info.nb_barres_total,
        nb_goujons: goujons.map(|g| g.nb_goujons_total).unwrap_or(0.0),
        longueur_coupe: oxycoupage.map(|o| o.longueur_coupe_totale).unwrap_or(0.0),
    })
}

// ---------------------------------------------------------------------------
// Helpers partagés entre tous les sous-parsers de feuille
// ---------------------------------------------------------------------------

/// Convertit une cellule Calamine en texte, quel que soit son type source.
pub(crate) fn cellule_vers_texte(v: &Data) -> String {
    match v {
        Data::String(s) => s.trim().to_string(),
        Data::Float(f) => {
            if f.fract() == 0.0 {
                format!("{}", *f as i64)
            } else {
                f.to_string()
            }
        }
        Data::Int(i) => i.to_string(),
        _ => String::new(),
    }
}

/// Détecte les cellules d'erreur Excel (#REF!, #N/A, etc.) -- artefact
/// récurrent dans ces templates après la dernière ligne de données réelle
/// (copier-coller avec suppression de lignes dans le fichier source).
/// Commun à toutes les feuilles de détail par ligne (FC-*, FT-*).
pub(crate) fn cellule_est_erreur(v: Option<&Data>) -> bool {
    matches!(v, Some(Data::Error(_)))
}

pub(crate) fn cellule_vide(v: Option<&Data>) -> bool {
    match v {
        None => true,
        Some(val) => cellule_vers_texte(val).trim().is_empty(),
    }
}