use regex::Regex;
use rusqlite::{params, Connection};
use std::fs;
use std::path::Path;

// ---------------------------------------------------------------------------
// Schéma SQLite
// ---------------------------------------------------------------------------

pub fn initialiser_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS heures (
            affaire TEXT NOT NULL,
            ot      TEXT,
            date    TEXT,
            poste   TEXT NOT NULL,
            heures  REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_heures_affaire ON heures(affaire);

        CREATE TABLE IF NOT EXISTS variables_affaires (
            affaire                     TEXT PRIMARY KEY,
            nb_barres                   REAL,
            nb_goujons                  REAL,
            nb_trous_manuel             REAL,
            nb_trous_numerique          REAL,
            diametre_moyen_numerique    REAL,
            longueur_coupe              REAL
        );
        ",
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Normalisation des libellés de poste (fait ici, pas côté Python)
// ---------------------------------------------------------------------------

pub fn normaliser_poste(libelle: &str) -> Option<&'static str> {
    // À compléter avec les libellés exacts observés dans le fichier ERP
    // complet -- seul FORAGE NUMERIQUE est confirmé pour l'instant.
    match libelle {
        s if s.contains("FORAGE NUMERIQUE") => Some("forage_numerique"),
        s if s.contains("FORAGE MANUEL") => Some("forage_manuel"),
        s if s.contains("ASSEMBLAGE") || s.contains("TRACAGE") => Some("assemblage_tracage"),
        s if s.contains("MANUTENTION") => Some("manutention"),
        s if s.contains("ENFILAGE") => Some("enfilage"),
        s if s.contains("GOUJONNAGE") => Some("goujonnage"),
        s if s.contains("MISE A LONGUEUR") || s.contains("MISE À LONGUEUR") => {
            Some("mise_a_longueur")
        }
        s if s.contains("OXYCOUPAGE") => Some("oxycoupage"),
        // CASSE MACHINE, P3, ROBOT, etc. volontairement absents :
        // temps improductif ou postes pas encore clarifiés -> ignorés
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Parsing du fichier ERP (fixed-width, Latin-1)
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub struct LigneHeure {
    affaire: String,
    ot: String,
    date: String,
    poste: String,
    heures: f64,
}

pub fn parser_fichier_erp(path: &Path) -> Result<Vec<LigneHeure>, String> {
    let octets = fs::read(path).map_err(|e| format!("Lecture impossible: {e}"))?;
    // Le fichier est en Latin-1 (ISO-8859-1), pas UTF-8
    let contenu: String = octets.iter().map(|&b| b as char).collect();

    let re_header = Regex::new(r"^\s*\*\*\s*OT:\s*(\S+)\s*=\s*(\d+)\s+(.+)$").unwrap();
    let re_detail = Regex::new(
        r"^\s*(\d{8})\s+\d\s+(\S+)\s+(.+?)\s{2,}(\S+)\s+([\d,]+)\s*([XV])?\s*$",
    )
    .unwrap();

    let mut lignes = Vec::new();
    let mut affaire_courante: Option<String> = None;
    let mut ot_courant: Option<String> = None;

    for ligne in contenu.lines() {
        if let Some(caps) = re_header.captures(ligne) {
            ot_courant = Some(caps[1].to_string());
            affaire_courante = Some(caps[2].to_string());
            continue;
        }

        if let Some(caps) = re_detail.captures(ligne) {
            let (Some(affaire), Some(ot)) = (&affaire_courante, &ot_courant) else {
                continue; // ligne de détail avant tout en-tête -- ignorée
            };
            let date = caps[1].to_string();
            let libelle_poste = caps[3].trim().to_string();
            let heures_str = caps[5].replace(',', ".");

            let Ok(heures) = heures_str.parse::<f64>() else {
                continue;
            };

            let Some(poste_normalise) = normaliser_poste(&libelle_poste) else {
                continue; // poste non exploitable pour l'instant (P3, Robot...)
            };

            lignes.push(LigneHeure {
                affaire: affaire.clone(),
                ot: ot.clone(),
                date,
                poste: poste_normalise.to_string(),
                heures,
            });
        }
    }

    Ok(lignes)
}

// ---------------------------------------------------------------------------
// Insertion idempotente (delete + reinsert par affaire)
// ---------------------------------------------------------------------------

pub fn inserer_heures(conn: &mut Connection, lignes: &[LigneHeure]) -> rusqlite::Result<()> {
    // Toutes les affaires distinctes présentes dans ce lot
    let affaires: std::collections::HashSet<&str> =
        lignes.iter().map(|l| l.affaire.as_str()).collect();

    let tx = conn.transaction()?;
    for affaire in &affaires {
        tx.execute("DELETE FROM heures WHERE affaire = ?1", params![affaire])?;
    }
    for ligne in lignes {
        tx.execute(
            "INSERT INTO heures (affaire, ot, date, poste, heures) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![ligne.affaire, ligne.ot, ligne.date, ligne.poste, ligne.heures],
        )?;
    }
    tx.commit()?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Point d'entrée haut niveau : parser un fichier ERP puis l'insérer
// ---------------------------------------------------------------------------

pub fn traiter_fichier_erp(path: &Path, conn: &mut Connection) -> Result<usize, String> {
    let lignes = parser_fichier_erp(path)?;
    let n = lignes.len();
    inserer_heures(conn, &lignes).map_err(|e| format!("Erreur SQLite: {e}"))?;
    Ok(n)
}