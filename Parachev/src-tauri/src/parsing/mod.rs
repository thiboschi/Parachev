//! Extraction des variables explicatives depuis les fichiers Excel de
//! prévision par affaire (un fichier .xlsx par affaire, ~80-120 feuilles).
//!
//! Structure : un sous-module par feuille source, chacun responsable de
//! son propre format de colonnes. Ce fichier ne fait qu'orchestrer les
//! sous-parsers et fournir les helpers partagés entre eux (lecture de
//! cellule, détection des cellules d'erreur #REF!).

mod goujons;
mod oxycoupage;
mod presse;
mod previ;
mod variables_parcing;

pub use goujons::{extraire_goujons_fc_gouj};
pub use oxycoupage::{extraire_oxycoupage};
pub use presse::{extraire_presse};
pub use previ::{extraire_info_previ, GroupeProfil};
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
    /// Profil du premier groupe barre/longueur (ex. "HEB 600"), et n° de
    /// plan ArcelorMittal (ex. "1900016822") -- tous deux extraits de la
    /// feuille PREVI, voir previ::InfoPrevi. None si non trouvés.
    pub profil: Option<String>,
    pub numero_plan: Option<String>,
    /// Détail de nb_barres par profil distinct -- voir previ::GroupeProfil.
    /// Stocké séparément (table `profils_affaires`), pas dans cette ligne.
    pub groupes_profil: Vec<GroupeProfil>,
    pub nb_barres: f64,
    pub nb_goujons: f64,
    pub longueur_coupe: f64,
    pub nb_trous_manuel: Option<f64>,
    pub nb_trous_numerique: Option<f64>,
    pub diametre_moyen_numerique: Option<f64>,
    /// Contre-flèche (Cfl axe fort) moyenne, extraite de la feuille
    /// FC-PRES/FC-PRESS -- voir presse::extraire_presse. None si cette
    /// feuille est absente (poste presse/redressage non utilisé) ; repli à
    /// 1.0 si la feuille existe mais que sa colonne Cfl n'est pas remplie
    /// (même sémantique de "présence sans donnée" que le Forage ci-dessus).
    pub contre_fleche: Option<f64>,
}

/// Extrait toutes les variables disponibles pour une affaire en ouvrant
/// son fichier Excel une seule fois et en déléguant à chaque sous-parser.
pub fn extraire_variables_affaire(chemin_fichier: &str) -> Result<VariablesAffaire, String> {
    let info = extraire_info_previ(chemin_fichier)?
        .ok_or_else(|| format!("Feuille PREVI introuvable dans {chemin_fichier}"))?;

    let goujons = extraire_goujons_fc_gouj(chemin_fichier)?;
    let oxycoupage = extraire_oxycoupage(chemin_fichier)?;
    let forage = extraire_variables_forage(chemin_fichier)?;
    let presse = extraire_presse(chemin_fichier)?;
    let contre_fleche = presse.map(|p| p.valeur_avec_repli());

    Ok(VariablesAffaire {
        affaire: info.commande,
        profil: info.profil,
        numero_plan: info.numero_plan,
        groupes_profil: info.groupes_profil,
        nb_barres: info.nb_barres_total,
        nb_goujons: goujons.map(|g| g.nb_goujons_total).unwrap_or(0.0),
        longueur_coupe: oxycoupage.map(|o| o.longueur_coupe_totale).unwrap_or(0.0),
        nb_trous_manuel: forage.nb_trous_manuel,
        nb_trous_numerique: forage.nb_trous_numerique,
        diametre_moyen_numerique: forage.diametre_moyen_numerique,
        contre_fleche,
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
            (affaire, profil, numero_plan, nb_barres, nb_goujons, longueur_coupe,
             nb_trous_manuel, nb_trous_numerique, diametre_moyen_numerique, contre_fleche)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(affaire) DO UPDATE SET
            profil = excluded.profil,
            numero_plan = excluded.numero_plan,
            nb_barres = excluded.nb_barres,
            nb_goujons = excluded.nb_goujons,
            longueur_coupe = excluded.longueur_coupe,
            nb_trous_manuel = excluded.nb_trous_manuel,
            nb_trous_numerique = excluded.nb_trous_numerique,
            diametre_moyen_numerique = excluded.diametre_moyen_numerique,
            contre_fleche = excluded.contre_fleche",
        params![
            variables.affaire,
            variables.profil,
            variables.numero_plan,
            variables.nb_barres,
            variables.nb_goujons,
            variables.longueur_coupe,
            variables.nb_trous_manuel,
            variables.nb_trous_numerique,
            variables.diametre_moyen_numerique,
            variables.contre_fleche,
        ],
    )
    .map_err(|e| format!("Erreur insertion variables_affaires: {e}"))?;

    Ok(())
}

/// Remplace intégralement le détail par profil d'une affaire dans
/// `profils_affaires` (DELETE puis INSERT, comme enregistrer_prevision) --
/// un remplacement complet plutôt qu'un upsert car le nombre de profils
/// distincts peut changer d'une extraction à l'autre (fichier corrigé).
pub fn inserer_profils_affaire(
    conn: &mut Connection,
    affaire: &str,
    groupes: &[GroupeProfil],
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM profils_affaires WHERE affaire = ?1", params![affaire])
        .map_err(|e| e.to_string())?;

    for groupe in groupes {
        tx.execute(
            "INSERT INTO profils_affaires (affaire, profil, nb_barres) VALUES (?1, ?2, ?3)",
            params![affaire, groupe.profil, groupe.nb_barres],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Point d'entrée haut niveau : extrait puis insère en une seule opération.
/// C'est cette fonction que le watcher doit appeler pour chaque fichier
/// .xlsx détecté.
pub fn traiter_fichier_excel(chemin_fichier: &str, conn: &mut Connection) -> Result<String, String> {
    let variables = extraire_variables_affaire(chemin_fichier)?;
    let affaire = variables.affaire.clone();
    inserer_variables_affaire(conn, &variables)?;
    inserer_profils_affaire(conn, &affaire, &variables.groupes_profil)?;
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
                affaire TEXT PRIMARY KEY, profil TEXT, numero_plan TEXT,
                nb_barres REAL, nb_goujons REAL,
                nb_trous_manuel REAL, nb_trous_numerique REAL,
                diametre_moyen_numerique REAL, longueur_coupe REAL,
                contre_fleche REAL
            );
            CREATE TABLE profils_affaires (
                affaire TEXT NOT NULL, profil TEXT NOT NULL, nb_barres REAL NOT NULL,
                PRIMARY KEY (affaire, profil)
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn test_pipeline_complet_4_fichiers_reels() {
        let mut conn = preparer_base_test();

        for fichier in [
            "1100706839.xlsx",
            "1100719879.xlsx",
            "1100546190.xlsx",
            "1100662668.xlsx",
        ] {
            let affaire = traiter_fichier_excel(fichier, &mut conn)
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

        // 1100719879 a une vraie valeur de contre-flèche (206, via FC-PRES) ;
        // 1100546190 a la feuille FC-PRES mais sans donnée -> repli à 1.0.
        let contre_fleche_719879: Option<f64> = conn
            .query_row(
                "SELECT contre_fleche FROM variables_affaires WHERE affaire = '1100719879'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(contre_fleche_719879, Some(206.0));

        let contre_fleche_546190: Option<f64> = conn
            .query_row(
                "SELECT contre_fleche FROM variables_affaires WHERE affaire = '1100546190'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(contre_fleche_546190, Some(1.0));

        // Le détail par profil de 1100706839 (profil unique "HEB 600") doit
        // aussi avoir été inséré dans profils_affaires.
        let (profil, profil_nb_barres): (String, f64) = conn
            .query_row(
                "SELECT profil, nb_barres FROM profils_affaires WHERE affaire = '1100706839'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(profil, "HEB 600");
        assert_eq!(profil_nb_barres, 23.0);
    }

    #[test]
    fn test_reinsertion_ecrase_les_colonnes_forage() {
        let mut conn = preparer_base_test();

        // 1er passage : extraction normale. FT-MAN et FT-NUM existent tous
        // les deux dans 1100719879.xlsx -> repli de présence à 1.0.
        traiter_fichier_excel("1100719879.xlsx", &mut conn).unwrap();
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
        traiter_fichier_excel("1100719879.xlsx", &mut conn).unwrap();
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
        let mut conn = preparer_base_test();
        let resultat = traiter_fichier_excel("fichier_inexistant.xlsx", &mut conn);
        assert!(resultat.is_err());
    }
}