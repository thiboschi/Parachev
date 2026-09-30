//! Quantités de travail extraites hors de la fiche de prévision : trous et
//! pointeaux des programmes CN (DSTV, voir parsing::dstv) et goujons / trous
//! cités dans les mails (voir parsing::quantites_mail).
//!
//! Stockage brut par fichier (`cn_programmes`, `cn_percages`,
//! `quantites_mails`), puis consolidation par affaire dans
//! `variables_affaires` (fonction `consolider`, appelée après chaque scan
//! et chaque événement du watcher, une fois les doublons marqués) :
//!
//! - `nb_trous_numerique`, `diametre_moyen_numerique`,
//!   `nb_pointeaux_numerique` : somme des programmes CN de l'affaire, hors
//!   "Ancien", hors dossier de référence d'une autre affaire, hors copies.
//!   La fiche ne fournit jamais ces valeurs (voir variables_parcing.rs).
//! - `nb_goujons_mails` : besoin en goujons d'après les mails (par
//!   spécification Ø×L, la mention la plus récente ; un "total number of
//!   studs" l'emporte). Recopié dans `nb_goujons` seulement si la feuille
//!   FC-GOUJ est vide.
//!
//! `source_trous_numerique` / `source_nb_goujons` disent d'où vient la
//! valeur retenue : 'cn', 'mails', 'fc-gouj' (fiche) ou 'manuel' (saisie
//! dans l'écran Prévision). Une valeur 'manuel' n'est jamais écrasée par la
//! consolidation.

use crate::parsing::dstv::ProgrammeCn;
use crate::parsing::quantites_mail::MentionQuantite;
use regex::Regex;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::sync::OnceLock;

pub fn initialiser_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        -- Un programme CN (fichier DSTV) : trous et pointeaux déjà multipliés
        -- par la quantité de pièces du programme.
        CREATE TABLE IF NOT EXISTS cn_programmes (
            chemin          TEXT PRIMARY KEY,
            affaire         TEXT,
            piece           TEXT,
            profil          TEXT,
            code_profil     TEXT,
            quantite        REAL NOT NULL,
            nb_trous        REAL NOT NULL,
            nb_pointeaux    REAL NOT NULL,
            somme_diametres REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_cn_programmes_affaire ON cn_programmes(affaire);

        -- Perçages (hors pointeaux) d'un programme, par diamètre.
        CREATE TABLE IF NOT EXISTS cn_percages (
            chemin   TEXT NOT NULL,
            diametre REAL NOT NULL,
            nb       REAL NOT NULL,
            PRIMARY KEY (chemin, diametre)
        );

        -- Goujons / trous cités dans un mail (voir parsing::quantites_mail).
        CREATE TABLE IF NOT EXISTS quantites_mails (
            chemin    TEXT NOT NULL,
            affaire   TEXT,
            date_mail TEXT,
            nature    TEXT NOT NULL,
            diametre  REAL,
            hauteur   REAL,
            nombre    REAL NOT NULL,
            besoin    INTEGER NOT NULL,
            unite     TEXT NOT NULL,
            extrait   TEXT,
            position  INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_quantites_mails_affaire ON quantites_mails(affaire);
        CREATE INDEX IF NOT EXISTS idx_quantites_mails_chemin ON quantites_mails(chemin);
        ",
    )?;
    // Migration idempotente (même principe que erp::migrer_ajouter_colonne_client).
    for (colonne, type_sql) in [
        ("nb_pointeaux_numerique", "REAL"),
        ("nb_goujons_mails", "REAL"),
        ("source_trous_numerique", "TEXT"),
        ("source_nb_goujons", "TEXT"),
    ] {
        match conn.execute(&format!("ALTER TABLE variables_affaires ADD COLUMN {colonne} {type_sql}"), []) {
            Ok(_) => {}
            Err(rusqlite::Error::SqliteFailure(_, Some(msg))) if msg.contains("duplicate column") => {}
            Err(e) => return Err(e),
        }
    }
    match conn.execute("ALTER TABLE cn_programmes ADD COLUMN lot TEXT", []) {
        Ok(_) => {}
        Err(rusqlite::Error::SqliteFailure(_, Some(msg))) if msg.contains("duplicate column") => {}
        Err(e) => return Err(e),
    }
    Ok(())
}

/// N° d'urgence (lot de livraison) dans le chemin d'un programme :
/// "D015/URG 2/P1.NC" -> "2". Les urgences d'une affaire réutilisent les
/// mêmes n° de pièce pour des poutres différentes (D015 : P1 en HE650B,
/// HE600B, HE650B) : elles ne sont pas des versions l'une de l'autre.
fn lot_urgence(chemin: &str) -> Option<String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)\bURG(?:ENCE)?\s*(\d+)").unwrap())
        .captures_iter(chemin)
        .last()
        .map(|c| c[1].to_string())
}

/// Remplace ce qui est enregistré pour un fichier CN (None : fichier qui
/// n'est pas un DSTV, rien à garder).
pub fn enregistrer_programme_cn(conn: &mut Connection, chemin: &str, affaire: Option<&str>, programme: Option<&ProgrammeCn>) -> Result<(), String> {
    let tx = conn.savepoint().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM cn_programmes WHERE chemin = ?1", [chemin]).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM cn_percages WHERE chemin = ?1", [chemin]).map_err(|e| e.to_string())?;
    if let Some(p) = programme {
        tx.execute(
            "INSERT INTO cn_programmes (chemin, affaire, piece, profil, code_profil, quantite, nb_trous, nb_pointeaux, somme_diametres, lot)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![chemin, affaire, p.piece, p.profil, p.code_profil, p.quantite, p.nb_trous(), p.nb_pointeaux(), p.somme_diametres_trous(), lot_urgence(chemin)],
        )
        .map_err(|e| e.to_string())?;
        for (diametre, nb) in p.trous_par_diametre() {
            tx.execute(
                "INSERT INTO cn_percages (chemin, diametre, nb) VALUES (?1, ?2, ?3)",
                params![chemin, diametre, nb],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

/// Remplace les mentions de quantités d'un mail.
pub fn enregistrer_mentions_mail(conn: &mut Connection, chemin: &str, affaire: Option<&str>, date_mail: Option<&str>, mentions: &[MentionQuantite]) -> Result<(), String> {
    let tx = conn.savepoint().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM quantites_mails WHERE chemin = ?1", [chemin]).map_err(|e| e.to_string())?;
    for m in mentions {
        tx.execute(
            "INSERT INTO quantites_mails (chemin, affaire, date_mail, nature, diametre, hauteur, nombre, besoin, unite, extrait, position)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![chemin, affaire, date_mail, m.nature, m.diametre, m.hauteur, m.nombre, m.besoin, m.unite, m.extrait, m.position as i64],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

/// Retire les quantités d'un fichier supprimé de l'index.
pub fn oublier_fichier(conn: &Connection, chemin: &str) -> Result<(), String> {
    for sql in [
        "DELETE FROM cn_programmes WHERE chemin = ?1",
        "DELETE FROM cn_percages WHERE chemin = ?1",
        "DELETE FROM quantites_mails WHERE chemin = ?1",
    ] {
        conn.execute(sql, [chemin]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Programmes CN retenus pour le forage numérique d'une affaire : ni
/// "Ancien", ni dossier de référence d'une autre affaire, ni copie, ni tôle
/// / fer plat (code DSTV "B", pas percé sur la foreuse à poutrelles). Une
/// pièce présente en plusieurs versions (DIP Parkhaus : trois dossiers de
/// programmes pour les mêmes 32 poutrelles) n'est comptée qu'une fois, dans
/// sa version la plus récente -- regroupées par n° de pièce seul, le
/// libellé du profil variant d'un export à l'autre ("IPE 500 A" / "IPE500A"),
/// et par urgence (voir lot_urgence).
///
/// Vacam exporte chaque pièce deux fois : "REP A" (trous et pointeaux dans
/// le bloc BO) et "REP A PROD" (programme machine : mêmes trous, pointeaux
/// convertis en blocs KO, voir parsing::dstv). Même pièce, comptée une
/// fois : la version sans PROD est préférée.
const PROGRAMMES_RETENUS: &str = "
    SELECT * FROM (
        SELECT p.*, ROW_NUMBER() OVER (
                   PARTITION BY p.affaire, COALESCE(p.lot, ''),
                                COALESCE(CASE WHEN p.piece LIKE '% PROD' THEN RTRIM(SUBSTR(p.piece, 1, LENGTH(p.piece) - 5)) ELSE p.piece END, p.chemin)
                   ORDER BY p.piece LIKE '% PROD', COALESCE(f.mtime, 0) DESC, p.chemin
               ) AS version
        FROM cn_programmes p
        JOIN documents d ON d.chemin = p.chemin
        LEFT JOIN fichiers f ON f.chemin = p.chemin
        WHERE p.affaire IS NOT NULL AND d.ancien = 0 AND d.reference = 0 AND d.doublon_de IS NULL
          AND COALESCE(p.code_profil, '') <> 'B'
    ) WHERE version = 1";

/// Mails pris en compte : hors dossier de référence d'une autre affaire.
const MENTIONS_RETENUES: &str = "
    SELECT q.rowid AS ordre, q.* FROM quantites_mails q JOIN documents d ON d.chemin = q.chemin
    WHERE q.affaire IS NOT NULL AND d.reference = 0";

/// Besoin en goujons par affaire d'après les mails : par spécification
/// (Ø × L), la valeur APPARUE en dernier (date de sa première mention).
/// Le dernier mail ne suffit pas : une réponse dans une autre branche du fil
/// recite l'ancien besoin (Peyramale : 2277 cité le 28/07 après le nouveau
/// besoin de 1984), alors qu'une citation n'introduit jamais de nouvelle
/// valeur. Un total sans spécification ("total number of studs") l'emporte
/// sur la somme des spécifications.
fn goujons_mails_par_affaire(conn: &Connection) -> Result<HashMap<String, f64>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT affaire, diametre, hauteur, nombre, MIN(date_mail) AS apparition, MIN(ordre) AS premier
             FROM ({MENTIONS_RETENUES})
             WHERE nature = 'goujons' AND besoin = 1
             GROUP BY affaire, diametre, hauteur, nombre
             ORDER BY affaire, apparition, premier"
        ))
        .map_err(|e| e.to_string())?;
    let lignes = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<f64>>(1)?, r.get::<_, Option<f64>>(2)?, r.get::<_, f64>(3)?)))
        .map_err(|e| e.to_string())?;

    // Par affaire : dernier total apparu, et dernier besoin apparu par spécification.
    let mut par_affaire: HashMap<String, (Option<f64>, BTreeMap<(i64, i64), f64>)> = HashMap::new();
    for ligne in lignes {
        let (affaire, diametre, hauteur, nombre) = ligne.map_err(|e| e.to_string())?;
        let entree = par_affaire.entry(affaire).or_default();
        match diametre {
            None => entree.0 = Some(nombre),
            Some(d) => {
                let cle = ((d * 10.0) as i64, hauteur.map(|h| (h * 10.0) as i64).unwrap_or(0));
                entree.1.insert(cle, nombre);
            }
        }
    }
    Ok(par_affaire
        .into_iter()
        .map(|(affaire, (total, specs))| (affaire, total.unwrap_or_else(|| specs.values().sum())))
        .collect())
}

/// Recopie les quantités brutes dans `variables_affaires` (voir en-tête).
/// Idempotent ; à appeler après marquer_doublons.
pub fn consolider(conn: &Connection) -> Result<(), String> {
    let cn = format!(
        "SELECT affaire, SUM(nb_trous) AS trous, SUM(nb_pointeaux) AS pointeaux, SUM(somme_diametres) AS somme_d
         FROM ({PROGRAMMES_RETENUS}) GROUP BY affaire"
    );
    let executer = |sql: &str| conn.execute(sql, []).map_err(|e| format!("Consolidation des quantités: {e}"));

    // Trous du forage numérique, depuis les programmes CN.
    executer(&format!(
        "INSERT INTO variables_affaires
            (affaire, nb_trous_numerique, diametre_moyen_numerique, nb_pointeaux_numerique, source_trous_numerique)
         SELECT affaire, trous, CASE WHEN trous > 0 THEN somme_d / trous END, pointeaux, 'cn' FROM ({cn}) WHERE true
         ON CONFLICT(affaire) DO UPDATE SET
            nb_trous_numerique = CASE WHEN variables_affaires.source_trous_numerique = 'manuel'
                                      THEN variables_affaires.nb_trous_numerique
                                      ELSE excluded.nb_trous_numerique END,
            diametre_moyen_numerique = excluded.diametre_moyen_numerique,
            nb_pointeaux_numerique = excluded.nb_pointeaux_numerique,
            source_trous_numerique = COALESCE(NULLIF(variables_affaires.source_trous_numerique, 'cn'), 'cn')"
    ))?;
    // Programmes CN supprimés depuis : valeurs retirées.
    executer(&format!(
        "UPDATE variables_affaires
         SET nb_trous_numerique = NULL, diametre_moyen_numerique = NULL, nb_pointeaux_numerique = NULL,
             source_trous_numerique = NULL
         WHERE source_trous_numerique = 'cn' AND affaire NOT IN (SELECT affaire FROM ({cn}))"
    ))?;

    // Goujons cités dans les mails.
    executer("UPDATE variables_affaires SET nb_goujons_mails = NULL WHERE nb_goujons_mails IS NOT NULL")?;
    for (affaire, nombre) in goujons_mails_par_affaire(conn)? {
        conn.execute(
            "INSERT INTO variables_affaires (affaire, nb_goujons_mails) VALUES (?1, ?2)
             ON CONFLICT(affaire) DO UPDATE SET nb_goujons_mails = excluded.nb_goujons_mails",
            params![affaire, nombre],
        )
        .map_err(|e| e.to_string())?;
    }
    // Utilisé seulement si ni FC-GOUJ ni une saisie manuelle ne donnent la valeur.
    executer(
        "UPDATE variables_affaires SET nb_goujons = nb_goujons_mails, source_nb_goujons = 'mails'
         WHERE nb_goujons_mails > 0 AND COALESCE(source_nb_goujons, '') NOT IN ('manuel', 'fc-gouj')",
    )?;
    // Mails supprimés depuis : retour à la valeur de la fiche (0 = FC-GOUJ vide).
    executer(
        "UPDATE variables_affaires
         SET nb_goujons = CASE WHEN chemin_fiche IS NOT NULL THEN 0 END, source_nb_goujons = NULL
         WHERE source_nb_goujons = 'mails' AND nb_goujons_mails IS NULL",
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Lecture pour l'interface
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct PercageCn {
    pub diametre: f64,
    pub nb: f64,
}

#[derive(Debug, Serialize)]
pub struct MentionMail {
    pub chemin: String,
    pub date_mail: Option<String>,
    pub nature: String,
    pub diametre: Option<f64>,
    pub hauteur: Option<f64>,
    pub nombre: f64,
    pub besoin: bool,
    pub unite: String,
    pub extrait: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct QuantitesAffaire {
    pub source_trous_numerique: Option<String>,
    pub source_nb_goujons: Option<String>,
    pub nb_pointeaux_numerique: Option<f64>,
    pub nb_goujons_mails: Option<f64>,
    pub nb_programmes_cn: i64,
    pub percages_cn: Vec<PercageCn>,
    /// Une ligne par mention distincte (la plus récente si répétée dans le fil).
    pub mentions_mails: Vec<MentionMail>,
}

pub fn obtenir_quantites_affaire(conn: &Connection, affaire: &str) -> Result<QuantitesAffaire, String> {
    let (source_trous_numerique, source_nb_goujons, nb_pointeaux_numerique, nb_goujons_mails) = conn
        .query_row(
            "SELECT source_trous_numerique, source_nb_goujons, nb_pointeaux_numerique, nb_goujons_mails
             FROM variables_affaires WHERE affaire = ?1",
            [affaire],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok((None, None, None, None)),
            e => Err(e.to_string()),
        })?;

    let nb_programmes_cn = conn
        .query_row(&format!("SELECT COUNT(*) FROM ({PROGRAMMES_RETENUS}) WHERE affaire = ?1"), [affaire], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(&format!(
            "SELECT c.diametre, SUM(c.nb) FROM cn_percages c
             JOIN ({PROGRAMMES_RETENUS}) p ON p.chemin = c.chemin
             WHERE p.affaire = ?1 GROUP BY c.diametre ORDER BY c.diametre"
        ))
        .map_err(|e| e.to_string())?;
    let percages_cn = stmt
        .query_map([affaire], |r| Ok(PercageCn { diametre: r.get(0)?, nb: r.get(1)? }))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(&format!(
            "SELECT chemin, date_mail, nature, diametre, hauteur, nombre, besoin, unite, extrait
             FROM ({MENTIONS_RETENUES}) WHERE affaire = ?1
             ORDER BY date_mail DESC, position, ordre"
        ))
        .map_err(|e| e.to_string())?;
    let toutes = stmt
        .query_map([affaire], |r| {
            Ok(MentionMail {
                chemin: r.get(0)?,
                date_mail: r.get(1)?,
                nature: r.get(2)?,
                diametre: r.get(3)?,
                hauteur: r.get(4)?,
                nombre: r.get(5)?,
                besoin: r.get(6)?,
                unite: r.get(7)?,
                extrait: r.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    // Un fil de mails cite plusieurs fois la même mention : on garde la
    // plus récente (tri descendant ci-dessus).
    let mut mentions_mails: Vec<MentionMail> = Vec::new();
    for m in toutes {
        let deja = mentions_mails.iter().any(|u| {
            u.nature == m.nature && u.diametre == m.diametre && u.hauteur == m.hauteur && u.nombre == m.nombre && u.unite == m.unite
        });
        if !deja {
            mentions_mails.push(m);
        }
    }

    Ok(QuantitesAffaire {
        source_trous_numerique,
        source_nb_goujons,
        nb_pointeaux_numerique,
        nb_goujons_mails,
        nb_programmes_cn,
        percages_cn,
        mentions_mails,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parsing::dstv::lire_programme;
    use crate::parsing::quantites_mail::extraire_quantites;

    fn base() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::erp::initialiser_schema(&conn).unwrap();
        crate::config::initialiser_schema(&conn).unwrap();
        crate::indexeur::initialiser_schema(&conn).unwrap();
        initialiser_schema(&conn).unwrap();
        conn
    }

    fn document(conn: &Connection, chemin: &str, affaire: &str, reference: bool) {
        conn.execute(
            "INSERT INTO documents (chemin, affaire, type, nom, reference) VALUES (?1, ?2, 'x', ?1, ?3)",
            params![chemin, affaire, reference],
        )
        .unwrap();
    }

    const DSTV: &str = "ST\n1\nP1\n1\nP1\nS355\n3\nHEB300\nI\n12000\nBO\n  o 100.00s 50.00 26.00\n  o 200.00s 50.00 30.00\n  v 300.00s 50.00 1.00\nEN\n";

    fn valeur<T: rusqlite::types::FromSql>(conn: &Connection, colonne: &str) -> T {
        conn.query_row(&format!("SELECT {colonne} FROM variables_affaires WHERE affaire = 'A'"), [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn trous_cn_consolides_sauf_saisie_manuelle() {
        let mut conn = base();
        document(&conn, "/A/p1.nc", "A", false);
        document(&conn, "/A/ref/p9.nc", "A", true);
        let p = lire_programme(DSTV).unwrap();
        enregistrer_programme_cn(&mut conn, "/A/p1.nc", Some("A"), Some(&p)).unwrap();
        enregistrer_programme_cn(&mut conn, "/A/ref/p9.nc", Some("A"), Some(&p)).unwrap();
        consolider(&conn).unwrap();

        // 3 pièces × (Ø26 + Ø30), le programme du dossier de référence ignoré.
        assert_eq!(valeur::<f64>(&conn, "nb_trous_numerique"), 6.0);
        assert_eq!(valeur::<f64>(&conn, "diametre_moyen_numerique"), 28.0);
        assert_eq!(valeur::<f64>(&conn, "nb_pointeaux_numerique"), 3.0);
        assert_eq!(valeur::<String>(&conn, "source_trous_numerique"), "cn");

        // Nouvelle version du même programme dans un autre dossier : la pièce
        // P1 n'est comptée qu'une fois (version la plus récente, 2 pièces).
        document(&conn, "/A/v2/p1.nc", "A", false);
        conn.execute(
            "INSERT INTO fichiers (chemin, taille, mtime, statut, traite_le) VALUES ('/A/p1.nc', 1, 100, 'ok', ''), ('/A/v2/p1.nc', 1, 200, 'ok', '')",
            [],
        )
        .unwrap();
        let v2 = lire_programme(&DSTV.replace("\n3\n", "\n2\n")).unwrap();
        enregistrer_programme_cn(&mut conn, "/A/v2/p1.nc", Some("A"), Some(&v2)).unwrap();
        consolider(&conn).unwrap();
        assert_eq!(valeur::<f64>(&conn, "nb_trous_numerique"), 4.0);
        oublier_fichier(&conn, "/A/v2/p1.nc").unwrap();
        consolider(&conn).unwrap();
        assert_eq!(valeur::<f64>(&conn, "nb_trous_numerique"), 6.0);

        conn.execute("UPDATE variables_affaires SET nb_trous_numerique = 99, source_trous_numerique = 'manuel'", []).unwrap();
        consolider(&conn).unwrap();
        assert_eq!(valeur::<f64>(&conn, "nb_trous_numerique"), 99.0);

        conn.execute("UPDATE variables_affaires SET source_trous_numerique = 'cn'", []).unwrap();
        oublier_fichier(&conn, "/A/p1.nc").unwrap();
        consolider(&conn).unwrap();
        assert_eq!(valeur::<Option<f64>>(&conn, "nb_trous_numerique"), None);
    }

    #[test]
    fn programmes_vacam_prod_et_urgences() {
        let mut conn = base();
        let programme = |piece: &str, bo: &str| {
            lire_programme(&format!("ST\nD015\nOA\n1\n{piece}\nS355\n1\nHE650B\nI\n12000\nBO\n{bo}EN\n")).unwrap()
        };
        // Programme plan (trou Ø26 + pointeau Ø1) et programme PROD (pointeau
        // passé en KO) : une seule pièce, lue dans la version sans PROD.
        let plan = programme("P1", "  o 100.00s 50.00 26.00\n  v 300.00s 50.00 1.00\n");
        let prod = programme("P1 PROD", "  o 100.00s 50.00 26.00\n");
        for urg in ["URG 1", "URG 2"] {
            for (nom, p) in [("P1.NC", &plan), ("P1 PROD.NC", &prod)] {
                let chemin = format!("/V/D015/{urg}/{nom}");
                document(&conn, &chemin, "A", false);
                enregistrer_programme_cn(&mut conn, &chemin, Some("A"), Some(p)).unwrap();
            }
        }
        consolider(&conn).unwrap();
        // Deux urgences (poutres différentes malgré le même n° P1).
        assert_eq!(valeur::<f64>(&conn, "nb_trous_numerique"), 2.0);
        assert_eq!(valeur::<f64>(&conn, "nb_pointeaux_numerique"), 2.0);
        assert_eq!(lot_urgence("/V/D015/URG 2/P1.NC").as_deref(), Some("2"));
        assert_eq!(lot_urgence("/V/D090/14092100/85.NC"), None);
    }

    #[test]
    fn goujons_mails_seulement_si_fc_gouj_vide() {
        let mut conn = base();
        document(&conn, "/A/m1.msg", "A", false);
        document(&conn, "/A/m2.msg", "A", false);
        let ancien = extraire_quantites("• 2400 goujons Ø25x200 (besoin 2277 goujons) • 300 goujons Ø19x75 (besoin 250 goujons)");
        // Le mail récent cite l'ancien besoin (2277) sous le nouveau (1984).
        let recent = extraire_quantites(
            "• 2400 goujons Ø25x200 (besoin +/- 1984 goujons pour les 16 poutres) De : ... • 2400 goujons Ø25x200 (besoin 2277 goujons)",
        );
        enregistrer_mentions_mail(&mut conn, "/A/m1.msg", Some("A"), Some("2025-07-23"), &ancien).unwrap();
        enregistrer_mentions_mail(&mut conn, "/A/m2.msg", Some("A"), Some("2025-07-28"), &recent).unwrap();
        // Fiche avec FC-GOUJ vide.
        conn.execute("INSERT INTO variables_affaires (affaire, nb_goujons, chemin_fiche) VALUES ('A', 0, 'f.xlsx')", []).unwrap();
        consolider(&conn).unwrap();

        // Ø25x200 : dernier besoin (1984) ; Ø19x75 : 250.
        assert_eq!(valeur::<f64>(&conn, "nb_goujons_mails"), 2234.0);
        assert_eq!(valeur::<f64>(&conn, "nb_goujons"), 2234.0);
        assert_eq!(valeur::<String>(&conn, "source_nb_goujons"), "mails");

        // FC-GOUJ rempli (fiche relue) : la fiche prime.
        conn.execute("UPDATE variables_affaires SET nb_goujons = 2100, source_nb_goujons = 'fc-gouj'", []).unwrap();
        consolider(&conn).unwrap();
        assert_eq!(valeur::<f64>(&conn, "nb_goujons"), 2100.0);
        assert_eq!(valeur::<f64>(&conn, "nb_goujons_mails"), 2234.0);

        let q = obtenir_quantites_affaire(&conn, "A").unwrap();
        assert_eq!(q.mentions_mails.len(), 3); // 1984, 2277, 250 (1984 le plus récent en tête)
        assert_eq!(q.mentions_mails[0].nombre, 1984.0);
    }
}
