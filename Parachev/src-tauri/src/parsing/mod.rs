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
mod variables_parcing;

pub use goujons::{extraire_goujons_fc_gouj};
pub use oxycoupage::{extraire_oxycoupage};
pub use previ::{extraire_info_previ};
pub use variables_parcing::{extraire_variables_forage, VariablesForage};

use calamine::Data;
use rusqlite::{params, Connection};

/// L'ensemble des variables explicatives extraites pour une affaire,
/// prêtes à être insérées dans la table SQLite `variables_affaires`.
///
/// nb_barres/nb_goujons/longueur_coupe sont des f64 "connus" : 0.0 signifie
/// explicitement "ce poste n'est pas utilisé sur cette affaire" (ex. pas de
/// goujonnage), une valeur légitime et différente de "pas encore mesuré".
///
/// Les champs liés au Forage restent en Option<f64> : None signifie "poste
/// non utilisé sur cette affaire" (feuille FT-MAN/FT-NUM absente). Quand la
/// feuille existe, aucune des données réelles observées à ce jour ne permet
/// de compter les trous ou leur diamètre (voir variables_parcing.rs) -- la
/// valeur vaut alors 1.0, un repli grossier à corriger manuellement plutôt
/// qu'un silence qui laisserait croire que le poste n'existe pas.
#[derive(Debug, Default)]
pub struct VariablesAffaire {
    pub affaire: String,
    pub nb_barres: f64,
    pub nb_goujons: f64,
    pub longueur_coupe: f64,
    pub nb_trous_manuel: Option<f64>,
    pub nb_trous_numerique: Option<f64>,
    pub diametre_moyen_numerique: Option<f64>,
}

/// Extrait toutes les variables disponibles pour une affaire en ouvrant
/// son fichier Excel une seule fois et en déléguant à chaque sous-parser.
pub fn extraire_variables_affaire(chemin_fichier: &str) -> Result<VariablesAffaire, String> {
    let info = extraire_info_previ(chemin_fichier)?
        .ok_or_else(|| format!("Feuille PREVI introuvable dans {chemin_fichier}"))?;

    let goujons = extraire_goujons_fc_gouj(chemin_fichier)?;
    let oxycoupage = extraire_oxycoupage(chemin_fichier)?;
    let forage = extraire_variables_forage(chemin_fichier)?;

    Ok(VariablesAffaire {
        affaire: info.commande,
        nb_barres: info.nb_barres_total,
        nb_goujons: goujons.map(|g| g.nb_goujons_total).unwrap_or(0.0),
        longueur_coupe: oxycoupage.map(|o| o.longueur_coupe_totale).unwrap_or(0.0),
        nb_trous_manuel: forage.nb_trous_manuel,
        nb_trous_numerique: forage.nb_trous_numerique,
        diametre_moyen_numerique: forage.diametre_moyen_numerique,
    })
}

/// Insère ou met à jour une affaire dans variables_affaires. Idempotent
/// (INSERT OR REPLACE sur la clé primaire `affaire`) -- ré-extraire un
/// fichier modifié écrase proprement les anciennes valeurs, colonnes Forage
/// incluses : un None reflète maintenant un poste réellement absent de
/// l'affaire (feuille FT-MAN/FT-NUM manquante), pas un parser non
/// implémenté, donc plus de raison de le préserver artificiellement.
pub fn inserer_variables_affaire(
    conn: &Connection,
    variables: &VariablesAffaire,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO variables_affaires
            (affaire, nb_barres, nb_goujons, longueur_coupe,
             nb_trous_manuel, nb_trous_numerique, diametre_moyen_numerique)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(affaire) DO UPDATE SET
            nb_barres = excluded.nb_barres,
            nb_goujons = excluded.nb_goujons,
            longueur_coupe = excluded.longueur_coupe,
            nb_trous_manuel = excluded.nb_trous_manuel,
            nb_trous_numerique = excluded.nb_trous_numerique,
            diametre_moyen_numerique = excluded.diametre_moyen_numerique",
        params![
            variables.affaire,
            variables.nb_barres,
            variables.nb_goujons,
            variables.longueur_coupe,
            variables.nb_trous_manuel,
            variables.nb_trous_numerique,
            variables.diametre_moyen_numerique,
        ],
    )
    .map_err(|e| format!("Erreur insertion variables_affaires: {e}"))?;

    Ok(())
}

/// Point d'entrée haut niveau : extrait puis insère en une seule opération.
/// C'est cette fonction que le watcher doit appeler pour chaque fichier
/// .xlsx détecté.
pub fn traiter_fichier_excel(chemin_fichier: &str, conn: &Connection) -> Result<String, String> {
    let variables = extraire_variables_affaire(chemin_fichier)?;
    let affaire = variables.affaire.clone();
    inserer_variables_affaire(conn, &variables)?;
    Ok(affaire)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn preparer_base_test() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE variables_affaires (
                affaire TEXT PRIMARY KEY, nb_barres REAL, nb_goujons REAL,
                nb_trous_manuel REAL, nb_trous_numerique REAL,
                diametre_moyen_numerique REAL, longueur_coupe REAL
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn test_pipeline_complet_4_fichiers_reels() {
        let conn = preparer_base_test();

        for fichier in [
            "1100706839.xlsx",
            "1100719879.xlsx",
            "1100546190.xlsx",
            "1100662668.xlsx",
        ] {
            let affaire = traiter_fichier_excel(fichier, &conn)
                .unwrap_or_else(|e| panic!("échec sur {fichier}: {e}"));
            println!("{fichier} -> affaire {affaire} inséré");
        }

        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM variables_affaires", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 4);

        // Vérifie les valeurs clés pour 1100719879 (le fichier "riche")
        let (nb_barres, nb_goujons, longueur_coupe): (f64, f64, f64) = conn
            .query_row(
                "SELECT nb_barres, nb_goujons, longueur_coupe FROM variables_affaires
                 WHERE affaire = '1100719879'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(nb_barres, 6.0);
        assert_eq!(nb_goujons, 3510.0);
        assert_eq!(longueur_coupe, 6.0 * 33800.0);
    }

    #[test]
    fn test_reinsertion_ecrase_les_colonnes_forage() {
        let conn = preparer_base_test();

        // 1er passage : extraction normale. FT-MAN et FT-NUM existent tous
        // les deux dans 1100719879.xlsx -> repli de présence à 1.0.
        traiter_fichier_excel("1100719879.xlsx", &conn).unwrap();
        let nb_trous: Option<f64> = conn
            .query_row(
                "SELECT nb_trous_numerique FROM variables_affaires WHERE affaire = '1100719879'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(nb_trous, Some(1.0));

        // Une correction manuelle en base (l'utilisateur affine le repli)...
        conn.execute(
            "UPDATE variables_affaires SET nb_trous_numerique = 42.0 WHERE affaire = '1100719879'",
            [],
        )
        .unwrap();

        // ...est bien écrasée par une ré-extraction (fichier Excel modifié
        // ou juste re-scanné) : idempotent et cohérent avec nb_barres.
        traiter_fichier_excel("1100719879.xlsx", &conn).unwrap();
        let nb_trous_apres: Option<f64> = conn
            .query_row(
                "SELECT nb_trous_numerique FROM variables_affaires WHERE affaire = '1100719879'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(nb_trous_apres, Some(1.0), "la ré-extraction doit écraser la correction manuelle, comme les autres colonnes");

        // nb_barres doit bien être remis à jour normalement
        let nb_barres: f64 = conn
            .query_row(
                "SELECT nb_barres FROM variables_affaires WHERE affaire = '1100719879'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(nb_barres, 6.0);
    }

    #[test]
    fn test_affaire_sans_previ_retourne_erreur() {
        let conn = preparer_base_test();
        let resultat = traiter_fichier_excel("fichier_inexistant.xlsx", &conn);
        assert!(resultat.is_err());
    }
}