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
