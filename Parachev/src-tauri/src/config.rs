//! Configuration persistante de l'application (clé-valeur en SQLite).
//! Sert notamment à retenir le dossier choisi par l'utilisateur pour la
//! surveillance des fichiers, entre deux lancements de l'app.

use rusqlite::{params, Connection};

pub const CLE_DOSSIER_SURVEILLE: &str = "dossier_surveille";

pub fn initialiser_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS configuration (
            cle    TEXT PRIMARY KEY,
            valeur TEXT NOT NULL
        );",
    )
}

pub fn lire_config(conn: &Connection, cle: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT valeur FROM configuration WHERE cle = ?1",
        params![cle],
        |row| row.get(0),
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        e => Err(e.to_string()),
    })
}

pub fn ecrire_config(conn: &Connection, cle: &str, valeur: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO configuration (cle, valeur) VALUES (?1, ?2)
         ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur",
        params![cle, valeur],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn preparer_base_test() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        initialiser_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn test_lire_config_absente_retourne_none() {
        let conn = preparer_base_test();
        let v = lire_config(&conn, CLE_DOSSIER_SURVEILLE).unwrap();
        assert_eq!(v, None);
    }

    #[test]
    fn test_ecrire_puis_lire() {
        let conn = preparer_base_test();
        ecrire_config(&conn, CLE_DOSSIER_SURVEILLE, "/Users/thibault/Para").unwrap();
        let v = lire_config(&conn, CLE_DOSSIER_SURVEILLE).unwrap();
        assert_eq!(v.as_deref(), Some("/Users/thibault/Para"));
    }

    #[test]
    fn test_reecriture_met_a_jour_sans_dupliquer() {
        let conn = preparer_base_test();
        ecrire_config(&conn, CLE_DOSSIER_SURVEILLE, "/ancien/chemin").unwrap();
        ecrire_config(&conn, CLE_DOSSIER_SURVEILLE, "/nouveau/chemin").unwrap();

        let v = lire_config(&conn, CLE_DOSSIER_SURVEILLE).unwrap();
        assert_eq!(v.as_deref(), Some("/nouveau/chemin"));

        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM configuration", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1, "pas de doublon attendu");
    }
}