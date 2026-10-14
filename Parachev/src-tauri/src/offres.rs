//! Offres retouchées depuis la relecture de la page "Chiffrage", pour les
//! réexporter plus tard. Le contenu (données et textes de l'offre, en JSON)
//! est celui qu'envoie l'interface ; numéro, client et montant n'en sont
//! repris à part que pour la liste des offres.

use rusqlite::{params, Connection};
use serde::Serialize;

pub fn initialiser_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS offres (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            numero            TEXT NOT NULL,
            client            TEXT NOT NULL,
            montant           REAL,
            date_modification TEXT NOT NULL,
            contenu           TEXT NOT NULL
        );",
    )
}

#[derive(Serialize)]
pub struct ResumeOffre {
    pub id: i64,
    pub numero: String,
    pub client: String,
    pub montant: Option<f64>,
    pub date_modification: String,
}

/// Crée l'offre (id None) ou remplace celle de cet id. Retourne son id.
pub fn enregistrer(
    conn: &Connection,
    id: Option<i64>,
    numero: &str,
    client: &str,
    montant: Option<f64>,
    contenu: &str,
) -> Result<i64, String> {
    match id {
        Some(id) => {
            let modifiees = conn
                .execute(
                    "UPDATE offres
                     SET numero = ?2, client = ?3, montant = ?4, contenu = ?5,
                         date_modification = datetime('now', 'localtime')
                     WHERE id = ?1",
                    params![id, numero, client, montant, contenu],
                )
                .map_err(|e| e.to_string())?;
            if modifiees == 0 {
                return Err("Offre introuvable : elle a peut-être été supprimée".into());
            }
            Ok(id)
        }
        None => {
            conn.execute(
                "INSERT INTO offres (numero, client, montant, date_modification, contenu)
                 VALUES (?1, ?2, ?3, datetime('now', 'localtime'), ?4)",
                params![numero, client, montant, contenu],
            )
            .map_err(|e| e.to_string())?;
            Ok(conn.last_insert_rowid())
        }
    }
}

/// Toutes les offres, de la dernière modifiée à la plus ancienne.
pub fn lister(conn: &Connection) -> Result<Vec<ResumeOffre>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, numero, client, montant, date_modification FROM offres
             ORDER BY date_modification DESC, id DESC",
        )
        .map_err(|e| e.to_string())?;
    let lignes = stmt
        .query_map([], |row| {
            Ok(ResumeOffre {
                id: row.get(0)?,
                numero: row.get(1)?,
                client: row.get(2)?,
                montant: row.get(3)?,
                date_modification: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    lignes.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

pub fn obtenir(conn: &Connection, id: i64) -> Result<String, String> {
    conn.query_row("SELECT contenu FROM offres WHERE id = ?1", params![id], |row| row.get(0))
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => "Offre introuvable".to_string(),
            e => e.to_string(),
        })
}

pub fn supprimer(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM offres WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enregistrer_puis_remplacer_et_supprimer() {
        let conn = Connection::open_in_memory().unwrap();
        initialiser_schema(&conn).unwrap();

        let id = enregistrer(&conn, None, "0001AA26", "Client", Some(360.0), "{\"v\":1}").unwrap();
        assert_eq!(enregistrer(&conn, Some(id), "0001AA26", "Client B", None, "{\"v\":2}").unwrap(), id);

        let offres = lister(&conn).unwrap();
        assert_eq!(offres.len(), 1);
        assert_eq!(offres[0].client, "Client B");
        assert_eq!(offres[0].montant, None);
        assert_eq!(obtenir(&conn, id).unwrap(), "{\"v\":2}");

        supprimer(&conn, id).unwrap();
        assert!(lister(&conn).unwrap().is_empty());
        assert!(enregistrer(&conn, Some(id), "", "", None, "{}").is_err());
    }
}
