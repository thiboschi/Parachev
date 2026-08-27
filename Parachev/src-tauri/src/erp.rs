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
// Normalisation des libellés de poste
// ---------------------------------------------------------------------------

pub fn normaliser_poste(libelle: &str) -> Option<&'static str> {
    // Tous les libellés confirmés sur le fichier ERP complet (13 059 lignes,
    // 459 affaires). On normalise TOUT ici -- le filtrage entre postes
    // "exploitables" (avec variable explicative) et "à clarifier" se fait
    // au niveau de la calibration (POSTE_VARIABLES dans calibration.rs),
    // pas au niveau du parsing. Ça permet de garder l'historique complet
    // en base même pour P3/Robot/etc., utile pour le suivi et pour ne pas
    // avoir à re-parser les fichiers une fois ces postes clarifiés.
    match libelle {
        "PADI/PARA/ASSEMBLAGE, TRACAGE" => Some("assemblage_tracage"),
        "PADI/PARA/MANUTENTION" => Some("manutention"),
        "PADI/PARA/FORAGE MANUEL" => Some("forage_manuel"),
        "PADI/PARA/FORAGE NUMERIQUE" => Some("forage_numerique"),
        "PADI/PARA/GOUJONNAGE" => Some("goujonnage"),
        "PADI/PARA/OXYCOUPAGE" => Some("oxycoupage"),
        "PADI/PARA/P3" => Some("p3"),
        "PADI/PARA/ROBOT" => Some("robot"),
        "PADI/PARA/PRESSE, CINTRAGE" => Some("presse_cintrage"),
        "PADI/PARA/SOUDAGE" => Some("soudage"),
        "PADI/PARA/SOUDAGE SOUS FLUX" => Some("soudage_sous_flux"),
        "PADI/PARA/CONTROLE CND" => Some("controle_cnd"),
        "PADI/PARA/REPARATION" => Some("reparation"),
        "PADI/PARA/CASSE MACHINE" => Some("casse_machine"),
        // "MISE À LONGUEUR" : traité à part via .contains() plutôt qu'un
        // match exact, car le "À" accentué peut être encodé en forme
        // composée (NFC, U+00C0) ou décomposée (NFD, "A" + accent
        // combinant U+0300) selon l'éditeur/OS -- deux représentations
        // visuellement identiques mais jamais égales en comparaison de
        // chaînes. .contains("LONGUEUR") évite complètement le problème.
        s if s.starts_with("PADI/PARA/MISE") && s.contains("LONGUEUR") => {
            Some("mise_a_longueur")
        }
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Parsing du fichier ERP (fixed-width, Latin-1)
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub struct LigneHeure {
    pub affaire: String,
    pub ot: String,
    pub date: String,
    pub poste: String,
    pub heures: f64,
}

pub fn parser_fichier_erp(path: &Path) -> Result<Vec<LigneHeure>, String> {
    let octets = fs::read(path).map_err(|e| format!("Lecture impossible: {e}"))?;
    let contenu: String = octets.iter().map(|&b| b as char).collect();

    let re_header = Regex::new(r"^\s*\*\*\s*OT:\s*(\S+)\s*=\s*(\d+)(.*)$").unwrap();
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

        // Un en-tête "** OT: ..." qui ne matche pas le regex complet (pas de
        // numéro d'affaire exploitable juste après "=", ex. "REDRESSAGE
        // POUTRES" ou un numéro noyé dans du texte) doit RÉINITIALISER le
        // contexte -- sinon les lignes de détail qui suivent seraient
        // attribuées à tort à l'affaire précédente (corruption silencieuse).
        if ligne.trim_start().starts_with("** OT:") {
            affaire_courante = None;
            ot_courant = None;
            continue;
        }

        if let Some(caps) = re_detail.captures(ligne) {
            let (Some(affaire), Some(ot)) = (&affaire_courante, &ot_courant) else {
                continue;
            };
            let date = caps[1].to_string();
            let libelle_poste = caps[3].trim().to_string();
            let heures_str = caps[5].replace(',', ".");

            let Ok(heures) = heures_str.parse::<f64>() else {
                continue;
            };

            let Some(poste_normalise) = normaliser_poste(&libelle_poste) else {
                continue;
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

pub fn traiter_fichier_erp(path: &Path, conn: &mut Connection) -> Result<usize, String> {
    let lignes = parser_fichier_erp(path)?;
    let n = lignes.len();
    inserer_heures(conn, &lignes).map_err(|e| format!("Erreur SQLite: {e}"))?;
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_fichier_erp_complet() {
        let lignes = parser_fichier_erp(Path::new("ERP.txt")).unwrap();
        println!("Lignes exploitables parsées : {}", lignes.len());

        let affaires: std::collections::HashSet<&str> =
            lignes.iter().map(|l| l.affaire.as_str()).collect();
        println!("Affaires distinctes (postes exploitables) : {}", affaires.len());

        // Répartition par poste
        let mut par_poste: std::collections::HashMap<&str, (usize, f64)> =
            std::collections::HashMap::new();
        for l in &lignes {
            let entry = par_poste.entry(l.poste.as_str()).or_insert((0, 0.0));
            entry.0 += 1;
            entry.1 += l.heures;
        }
        for (poste, (n, total)) in &par_poste {
            println!("  {poste}: {n} lignes, {total:.1}h");
        }

        assert!(!lignes.is_empty());
        // Les 15 postes réels doivent tous être présents désormais
        assert_eq!(par_poste.len(), 15, "les 15 postes réels doivent tous apparaître");
    }

    #[test]
    fn test_insertion_fichier_complet() {
        let lignes = parser_fichier_erp(Path::new("ERP.txt")).unwrap();
        let mut conn = Connection::open_in_memory().unwrap();
        initialiser_schema(&conn).unwrap();

        inserer_heures(&mut conn, &lignes).unwrap();

        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM heures", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n as usize, lignes.len());

        // Idempotence sur le fichier complet
        inserer_heures(&mut conn, &lignes).unwrap();
        let n2: i64 = conn
            .query_row("SELECT COUNT(*) FROM heures", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n2, n, "pas de doublon après ré-insertion");
    }
}