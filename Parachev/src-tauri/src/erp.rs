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
            client                      TEXT,
            profil                      TEXT,
            numero_plan                 TEXT,
            numero_offre                TEXT,
            nb_barres                   REAL,
            nb_goujons                  REAL,
            nb_trous_manuel             REAL,
            nb_trous_numerique          REAL,
            diametre_moyen_numerique    REAL,
            longueur_coupe              REAL,
            contre_fleche               REAL
        );

        -- Une affaire peut regrouper plusieurs groupes profil+longueur
        -- distincts (ex. HEB 600/11000mm et HEB 600/12800mm sur la même
        -- commande) ; `variables_affaires.profil` ne garde que le premier
        -- comme résumé rapide, cette table porte le détail complet (un
        -- groupe profil+longueur = une ligne, avec son propre nb_barres et
        -- son L-LAM, la longueur brute livrée par le laminoir).
        CREATE TABLE IF NOT EXISTS profils_affaires (
            affaire   TEXT NOT NULL,
            profil    TEXT NOT NULL,
            longueur  REAL NOT NULL,
            l_lam     REAL,
            nb_barres REAL NOT NULL,
            PRIMARY KEY (affaire, profil, longueur)
        );
        ",
    )?;
    Ok(())
}

/// Ajoute la colonne `client` à variables_affaires si elle n'existe pas
/// déjà -- migration idempotente pour les bases créées avant ce correctif
/// (SQLite n'a pas de "ADD COLUMN IF NOT EXISTS" natif, d'où la gestion
/// manuelle de l'erreur "duplicate column").
pub fn migrer_ajouter_colonne_client(conn: &Connection) -> rusqlite::Result<()> {
    match conn.execute("ALTER TABLE variables_affaires ADD COLUMN client TEXT", []) {
        Ok(_) => Ok(()),
        Err(rusqlite::Error::SqliteFailure(_, Some(msg))) if msg.contains("duplicate column") => {
            Ok(())
        }
        Err(e) => Err(e),
    }
}

/// Ajoute les colonnes `profil` et `numero_plan` à variables_affaires si
/// elles n'existent pas déjà -- même migration idempotente que pour
/// `client`, pour les bases créées avant ce correctif.
pub fn migrer_ajouter_colonnes_profil_numero_plan(conn: &Connection) -> rusqlite::Result<()> {
    for colonne in ["profil", "numero_plan", "numero_offre"] {
        match conn.execute(
            &format!("ALTER TABLE variables_affaires ADD COLUMN {colonne} TEXT"),
            [],
        ) {
            Ok(_) => {}
            Err(rusqlite::Error::SqliteFailure(_, Some(msg)))
                if msg.contains("duplicate column") => {}
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

/// Ajoute la colonne `contre_fleche` à variables_affaires si elle n'existe
/// pas déjà -- même migration idempotente que pour `client`/`profil`, pour
/// les bases créées avant ce correctif.
pub fn migrer_ajouter_colonne_contre_fleche(conn: &Connection) -> rusqlite::Result<()> {
    match conn.execute("ALTER TABLE variables_affaires ADD COLUMN contre_fleche REAL", []) {
        Ok(_) => Ok(()),
        Err(rusqlite::Error::SqliteFailure(_, Some(msg))) if msg.contains("duplicate column") => {
            Ok(())
        }
        Err(e) => Err(e),
    }
}

/// Recrée `profils_affaires` avec les colonnes `longueur`/`l_lam` et une clé
/// primaire élargie (affaire, profil, longueur) -- une même affaire peut
/// désormais avoir plusieurs lignes pour un même profil si ses longueurs
/// diffèrent (ex. HEB 600 en 11000mm ET en 12800mm), alors que l'ancien
/// schéma ("affaire, profil") les aurait fait entrer en conflit.
/// SQLite ne permet pas de changer une clé primaire via ALTER TABLE, d'où
/// la recréation complète plutôt qu'un ADD COLUMN idempotent comme les
/// autres migrations de ce fichier. Les anciennes lignes ne sont pas
/// reprises (elles n'ont pas de longueur connue) mais c'est sans perte :
/// `profils_affaires` n'est qu'un cache régénéré en intégralité (DELETE +
/// INSERT) à chaque ré-extraction Excel, et `scanner_dossier_initial` la
/// repeuple automatiquement au démarrage. Idempotente : ne fait rien si la
/// colonne `longueur` existe déjà.
pub fn migrer_profils_affaires_ajouter_longueur(conn: &Connection) -> rusqlite::Result<()> {
    let colonne_longueur_existe = conn
        .prepare("SELECT 1 FROM pragma_table_info('profils_affaires') WHERE name = 'longueur'")?
        .exists([])?;
    if colonne_longueur_existe {
        return Ok(());
    }

    conn.execute_batch(
        "DROP TABLE IF EXISTS profils_affaires;
        CREATE TABLE profils_affaires (
            affaire   TEXT NOT NULL,
            profil    TEXT NOT NULL,
            longueur  REAL NOT NULL,
            l_lam     REAL,
            nb_barres REAL NOT NULL,
            PRIMARY KEY (affaire, profil, longueur)
        );",
    )
}

/// Reformate en ISO ("YYYY-MM-DD") les dates encore stockées sous l'ancien
/// format compact SAP ("YYYYMMDD", 8 chiffres sans séparateur). Idempotent :
/// ne touche que les lignes dont `date` fait exactement 8 chiffres, donc ne
/// modifie rien au second appel une fois les dates déjà migrées. À appeler
/// une fois au démarrage (juste après initialiser_schema) pour que les
/// données importées avant ce correctif trient et se filtrent correctement
/// par date, sans avoir à ré-importer le fichier ERP.
pub fn migrer_format_dates(conn: &Connection) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE heures
         SET date = substr(date, 1, 4) || '-' || substr(date, 5, 2) || '-' || substr(date, 7, 2)
         WHERE date IS NOT NULL
           AND length(date) = 8
           AND date GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'",
        [],
    )
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

/// Résultat complet du parsing : les lignes d'heures, plus le nom du
/// client/de l'affaire associé à chaque numéro d'affaire (capturé une
/// seule fois, depuis la ligne d'en-tête "** OT: ... = 1100706839 NOM").
///
/// Limite connue : le fichier ERP source peut contenir une corruption
/// d'encodage préexistante sur les caractères accentués (conversion avec
/// perte faite en amont, avant que ce fichier n'arrive dans le pipeline).
/// Le nom capturé ici reflète fidèlement les données source, y compris
/// corrompues le cas échéant -- ce n'est pas récupérable côté parsing.
#[derive(Debug, Default)]
pub struct ResultatParsingErp {
    pub lignes: Vec<LigneHeure>,
    pub clients: std::collections::HashMap<String, String>,
}

pub fn parser_fichier_erp(path: &Path) -> Result<ResultatParsingErp, String> {
    let octets = fs::read(path).map_err(|e| format!("Lecture impossible: {e}"))?;
    let contenu: String = octets.iter().map(|&b| b as char).collect();

    let re_header = Regex::new(r"^\s*\*\*\s*OT:\s*(\S+)\s*=\s*(\d+)(.*)$").unwrap();
    let re_detail = Regex::new(
        r"^\s*(\d{8})\s+\d\s+(\S+)\s+(.+?)\s{2,}(\S+)\s+([\d,]+)\s*([XV])?\s*$",
    )
    .unwrap();

    let mut lignes = Vec::new();
    let mut clients = std::collections::HashMap::new();
    let mut affaire_courante: Option<String> = None;
    let mut ot_courant: Option<String> = None;

    for ligne in contenu.lines() {
        if let Some(caps) = re_header.captures(ligne) {
            ot_courant = Some(caps[1].to_string());
            let affaire = caps[2].to_string();

            let nom_client = caps[3].trim().to_string();
            if !nom_client.is_empty() {
                clients.insert(affaire.clone(), nom_client);
            }

            affaire_courante = Some(affaire);
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
            let date_brute = caps[1].to_string(); // format interne SAP : YYYYMMDD
            let date = format!(
                "{}-{}-{}",
                &date_brute[0..4],
                &date_brute[4..6],
                &date_brute[6..8]
            );
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

    Ok(ResultatParsingErp { lignes, clients })
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

/// Insère ou met à jour le nom client pour chaque affaire, sans jamais
/// toucher aux autres colonnes de variables_affaires (nb_barres,
/// nb_goujons... alimentées séparément par le parsing Excel). Idempotent.
///
/// Ne sert que de repli : le nom client extrait de la feuille PREVI des
/// Excel (voir parsing::previ, encodage fiable) prime sur celui-ci, donc on
/// n'écrase jamais un client déjà renseigné -- seulement les affaires pour
/// lesquelles aucun Excel n'a encore été traité.
pub fn inserer_clients(conn: &Connection, clients: &std::collections::HashMap<String, String>) -> rusqlite::Result<()> {
    for (affaire, client) in clients {
        conn.execute(
            "INSERT INTO variables_affaires (affaire, client) VALUES (?1, ?2)
             ON CONFLICT(affaire) DO UPDATE SET
                client = COALESCE(variables_affaires.client, excluded.client)",
            params![affaire, client],
        )?;
    }
    Ok(())
}

pub fn traiter_fichier_erp(path: &Path, conn: &mut Connection) -> Result<usize, String> {
    let resultat = parser_fichier_erp(path)?;
    let n = resultat.lignes.len();
    inserer_heures(conn, &resultat.lignes).map_err(|e| format!("Erreur SQLite: {e}"))?;
    inserer_clients(conn, &resultat.clients).map_err(|e| format!("Erreur SQLite (clients): {e}"))?;
    Ok(n)
}
