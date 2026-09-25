//! Indexation du dossier surveillé (arborescence "COMMANDES FINIES" :
//! un dossier par affaire, "1100xxxxxx NOM DU PROJET").
//!
//! Pour chaque fichier :
//! 1. rattachement à une affaire par le NOM DU DOSSIER (pas par le contenu),
//!    avec les drapeaux utiles : sous-dossier "Ancien", sous-dossier d'une
//!    autre affaire (référence gardée par le préparateur, typiquement sous
//!    "Préparation/"), dossier annulé, non-conformité ;
//! 2. classement (fiche de prévision, RDE, mail, plan, programme CN...) ;
//! 3. extraction selon le type, en ne retenant qu'UNE fiche et UN RDE par
//!    affaire : le fichier à la racine du dossier d'abord, puis le plus
//!    récent (date saisie dans le fichier, puis date de modification) ;
//! 4. enregistrement du document dans `documents` + index plein texte
//!    `documents_fts` (FTS5) pour la recherche.
//!
//! Incrémental : un fichier dont la taille et la date de modification n'ont
//! pas changé depuis le dernier passage n'est pas relu (table `fichiers`).
//! Les dossiers "1100......", "1700...", "1900..." (sans n° d'affaire
//! exploitable) sont ignorés.

use crate::erp::traiter_fichier_erp;
use crate::parsing::{self, operations, rde, LigneOperation};
use calamine::{open_workbook, Reader, Xlsx};
use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// À incrémenter quand l'extraction change : force la relecture de tous
/// les fichiers au prochain scan (sinon l'incrémental les sauterait).
const VERSION_INDEXEUR: &str = "3";
const CLE_VERSION_INDEXEUR: &str = "indexeur_version";
/// Taille maximale du texte d'un mail indexé en plein texte.
const MAX_CARACTERES_CONTENU: usize = 20_000;

// ---------------------------------------------------------------------------
// Schéma
// ---------------------------------------------------------------------------

pub fn initialiser_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS fichiers (
            chemin   TEXT PRIMARY KEY,
            taille   INTEGER NOT NULL,
            mtime    INTEGER NOT NULL,
            statut   TEXT NOT NULL,
            erreur   TEXT,
            traite_le TEXT NOT NULL
        );

        -- Un dossier d'affaire de l'arborescence surveillée.
        CREATE TABLE IF NOT EXISTS dossiers_affaires (
            affaire        TEXT PRIMARY KEY,
            nom_dossier    TEXT NOT NULL,
            chemin         TEXT NOT NULL,
            annule         INTEGER NOT NULL DEFAULT 0,
            non_conformite INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS documents (
            chemin          TEXT PRIMARY KEY,
            affaire         TEXT,
            type            TEXT NOT NULL,
            nom             TEXT NOT NULL,
            dossier_relatif TEXT,
            taille          INTEGER,
            date_modif      TEXT,
            ancien          INTEGER NOT NULL DEFAULT 0,
            reference       INTEGER NOT NULL DEFAULT 0,
            titre           TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_documents_affaire ON documents(affaire);

        CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
            chemin UNINDEXED, affaire UNINDEXED, titre, contenu,
            tokenize = 'unicode61 remove_diacritics 2'
        );

        -- RDE retenu pour l'affaire (voir parsing::rde).
        CREATE TABLE IF NOT EXISTS rde_affaires (
            affaire              TEXT PRIMARY KEY,
            chemin               TEXT NOT NULL,
            rang                 TEXT NOT NULL,
            date_rde             TEXT,
            projet               TEXT,
            offre                TEXT,
            client               TEXT,
            donneur_ordre        TEXT,
            cde_laminage         TEXT,
            type_affaire         TEXT,
            type_poutre          TEXT,
            remarques            TEXT,
            traitement_surface   TEXT,
            traitements          TEXT,
            en10163              TEXT,
            tolerance            TEXT,
            tolerance_speciale   TEXT,
            exc                  TEXT,
            tracabilite          TEXT,
            en10204              TEXT,
            prep_en8501          TEXT,
            classe_us            TEXT,
            exigence_fabrication TEXT,
            exigences_acier      TEXT,
            accessoires          TEXT
        );

        CREATE TABLE IF NOT EXISTS rde_laminage (
            affaire       TEXT NOT NULL,
            profil        TEXT NOT NULL,
            longueur      REAL,
            nuance        TEXT,
            poids_kg      REAL,
            nombre        REAL,
            usine         TEXT,
            date_laminage TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_rde_laminage_affaire ON rde_laminage(affaire);

        -- Opérations par source : 'rde' (demandée), 'fiche' (prévue, avec
        -- heures allouées), 'suivi' (réalisée, avec dates). Les heures ERP
        -- restent dans `heures`.
        CREATE TABLE IF NOT EXISTS affaire_operations (
            affaire    TEXT NOT NULL,
            source     TEXT NOT NULL,
            operation  TEXT NOT NULL,
            libelle    TEXT,
            heures     REAL,
            nb_barres  REAL,
            date_debut TEXT,
            date_fin   TEXT,
            PRIMARY KEY (affaire, source, operation)
        );

        CREATE TABLE IF NOT EXISTS fiche_postes (
            affaire TEXT NOT NULL,
            ordre   INTEGER NOT NULL,
            libelle TEXT NOT NULL,
            heures  REAL NOT NULL,
            PRIMARY KEY (affaire, ordre)
        );

        -- Fiche/RDE d'une autre affaire rangé dans le dossier d'une affaire
        -- (le préparateur s'en est servi comme référence).
        CREATE TABLE IF NOT EXISTS affaires_references (
            affaire           TEXT NOT NULL,
            affaire_reference TEXT NOT NULL,
            chemin            TEXT NOT NULL,
            PRIMARY KEY (affaire, affaire_reference, chemin)
        );
        ",
    )?;
    migrer_colonnes_fiche(conn)?;
    // Copie d'un autre document de la même affaire, et empreinte du contenu
    // qui le confirme (voir marquer_doublons).
    for colonne in ["doublon_de", "empreinte"] {
        match conn.execute(&format!("ALTER TABLE documents ADD COLUMN {colonne} TEXT"), []) {
            Ok(_) => {}
            Err(rusqlite::Error::SqliteFailure(_, Some(msg))) if msg.contains("duplicate column") => {}
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

/// Colonnes de fiche ajoutées à `variables_affaires` (migration idempotente,
/// même principe que erp::migrer_ajouter_colonne_client).
fn migrer_colonnes_fiche(conn: &Connection) -> rusqlite::Result<()> {
    for (colonne, type_sql) in [
        ("date_fiche", "TEXT"),
        ("poids_t", "REAL"),
        ("taux_horaire", "REAL"),
        ("heures_prevues_fiche", "REAL"),
        ("chemin_fiche", "TEXT"),
        ("rang_fiche", "TEXT"),
    ] {
        match conn.execute(&format!("ALTER TABLE variables_affaires ADD COLUMN {colonne} {type_sql}"), []) {
            Ok(_) => {}
            Err(rusqlite::Error::SqliteFailure(_, Some(msg))) if msg.contains("duplicate column") => {}
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

/// Vide la table `fichiers` si l'extraction a changé depuis le dernier scan,
/// pour que tout soit relu avec la nouvelle version.
pub fn verifier_version(conn: &Connection) -> Result<(), String> {
    let version = crate::config::lire_config(conn, CLE_VERSION_INDEXEUR)?;
    if version.as_deref() != Some(VERSION_INDEXEUR) {
        conn.execute("DELETE FROM fichiers", []).map_err(|e| e.to_string())?;
        crate::config::ecrire_config(conn, CLE_VERSION_INDEXEUR, VERSION_INDEXEUR)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Rattachement d'un fichier à une affaire, d'après son chemin
// ---------------------------------------------------------------------------

#[derive(Debug, Default, Clone, PartialEq)]
pub struct Contexte {
    pub affaire: Option<String>,
    pub nom_dossier: Option<String>,
    pub chemin_dossier: Option<PathBuf>,
    /// Fichier directement dans le dossier de l'affaire (pas un sous-dossier).
    pub a_la_racine: bool,
    /// Sous-dossier "Ancien"/"old" : version périmée.
    pub ancien: bool,
    /// Sous-dossier d'une autre affaire ("1100617508 TS BIELEFELD" sous
    /// "Préparation/") : référence, jamais la fiche de l'affaire.
    pub reference: bool,
    pub annule: bool,
    pub non_conformite: bool,
    /// Dossier d'affaire sans n° exploitable ("1100......", "1900...") :
    /// ignoré pour l'instant.
    pub ignore: bool,
    /// Pièce jointe extraite d'un mail (fichier temporaire).
    pub piece_jointe: bool,
    /// Sous-chemin entre le dossier d'affaire et le fichier ("Préparation").
    pub dossier_relatif: String,
}

/// N° d'affaire en tête d'un nom de dossier ("1100725621 HOFMANN RIEG").
fn numero_dossier_affaire(nom: &str) -> Option<String> {
    parsing::numero_affaire(nom).filter(|n| nom.trim_start().starts_with(n.as_str()))
}

/// Nom qui ressemble à un dossier d'affaire sans n° exploitable :
/// "1100...... LUGOJ", "1700037302 redressage", "0 1100".
fn ressemble_dossier_affaire(nom: &str) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^(0\s+)?1\d00[\d.]*(\s|$)").unwrap())
        .is_match(nom.trim())
}

fn est_non_conformite(nom: &str) -> bool {
    let n = operations::normaliser(nom);
    n.contains("NON-CONFORM") || n.contains("NON CONFORM")
}

pub fn contexte(racine: &Path, chemin: &Path) -> Contexte {
    let mut ctx = Contexte::default();
    let Ok(relatif) = chemin.strip_prefix(racine) else {
        return ctx;
    };
    let composants: Vec<String> = relatif
        .parent()
        .map(|p| p.components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect())
        .unwrap_or_default();

    let mut sous_dossiers: Vec<&str> = Vec::new();
    for (i, nom) in composants.iter().enumerate() {
        if est_non_conformite(nom) {
            ctx.non_conformite = true;
        }
        if ctx.affaire.is_none() {
            if let Some(numero) = numero_dossier_affaire(nom) {
                ctx.affaire = Some(numero);
                ctx.nom_dossier = Some(nom.clone());
                ctx.chemin_dossier = Some(composants[..=i].iter().fold(racine.to_path_buf(), |p, c| p.join(c)));
                ctx.annule = operations::normaliser(nom).contains("ANNUL");
            } else if ressemble_dossier_affaire(nom) {
                ctx.ignore = true;
                return ctx;
            }
        } else {
            sous_dossiers.push(nom);
            if numero_dossier_affaire(nom).is_some() || ressemble_dossier_affaire(nom) {
                ctx.reference = true;
            }
            let n = operations::normaliser(nom);
            if n.contains("ANCIEN") || n == "OLD" || n.starts_with("OLD ") {
                ctx.ancien = true;
            }
        }
    }
    ctx.a_la_racine = ctx.affaire.is_some() && sous_dossiers.is_empty();
    ctx.dossier_relatif = sous_dossiers.join("/");
    ctx
}

// ---------------------------------------------------------------------------
// Classement
// ---------------------------------------------------------------------------

fn type_par_extension(ext: &str) -> &'static str {
    match ext {
        "xlsx" | "xlsm" | "xls" => "excel",
        "msg" => "mail",
        "pdf" => "pdf",
        "dwg" | "dxf" | "dxe" => "plan",
        "nc" | "nc1" | "cam" => "cn",
        "jpg" | "jpeg" | "png" | "gif" => "image",
        "txt" | "csv" | "log" => "texte",
        "doc" | "docx" | "ppt" | "pptx" => "bureautique",
        _ => "autre",
    }
}

/// Fichiers système / temporaires jamais indexés.
fn est_ignore(nom: &str) -> bool {
    nom.starts_with('.') || nom.starts_with("~$") || nom.eq_ignore_ascii_case("Thumbs.db")
}

/// Type fin d'un classeur Excel d'après ses feuilles.
fn type_excel(chemin: &Path) -> &'static str {
    let Ok(workbook) = open_workbook::<Xlsx<_>, _>(chemin) else {
        return "excel";
    };
    let feuilles = workbook.sheet_names().to_owned();
    if feuilles.iter().any(|f| f == "PREVI") {
        "fiche"
    } else if rde::est_un_rde(&feuilles) {
        "rde"
    } else {
        "excel"
    }
}

// ---------------------------------------------------------------------------
// Traitement d'un fichier
// ---------------------------------------------------------------------------

#[derive(Debug, PartialEq)]
pub enum Resultat {
    /// Taille et date inchangées depuis le dernier passage.
    Inchange,
    Ignore,
    /// Indexé ; `principal` = données retenues pour l'affaire (fiche/RDE).
    Indexe { type_doc: &'static str, affaire: Option<String>, principal: bool },
}

/// Ce qu'un traitement spécifique renvoie pour l'index plein texte.
#[derive(Default)]
struct Extraction {
    affaire: Option<String>,
    titre: String,
    contenu: String,
    principal: bool,
}

fn mtime(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Clé de priorité comparable en texte : racine d'abord, puis date saisie
/// dans le fichier, puis date de modification.
fn rang(a_la_racine: bool, date: Option<&str>, mtime: i64) -> String {
    format!("{}|{}|{:012}", a_la_racine as u8, date.unwrap_or("0000-00-00"), mtime)
}

/// true si (chemin, rang) doit remplacer ce qui est enregistré pour
/// l'affaire dans `table` (même fichier, ou rang supérieur ou égal).
fn est_prioritaire(conn: &Connection, table: &str, col_chemin: &str, col_rang: &str, affaire: &str, chemin: &str, rang: &str) -> Result<bool, String> {
    let existant: Option<(Option<String>, Option<String>)> = conn
        .query_row(
            &format!("SELECT {col_chemin}, {col_rang} FROM {table} WHERE affaire = ?1"),
            [affaire],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(match existant {
        Some((Some(c), Some(r))) => c == chemin || rang >= r.as_str(),
        _ => true,
    })
}

fn ajouter_reference(conn: &Connection, affaire: &str, affaire_reference: &str, chemin: &str) -> Result<(), String> {
    if affaire == affaire_reference {
        return Ok(());
    }
    conn.execute(
        "INSERT OR IGNORE INTO affaires_references (affaire, affaire_reference, chemin) VALUES (?1, ?2, ?3)",
        params![affaire, affaire_reference, chemin],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn enregistrer_dossier(conn: &Connection, ctx: &Contexte) -> Result<(), String> {
    let (Some(affaire), Some(nom), Some(chemin)) = (&ctx.affaire, &ctx.nom_dossier, &ctx.chemin_dossier) else {
        return Ok(());
    };
    conn.execute(
        "INSERT INTO dossiers_affaires (affaire, nom_dossier, chemin, annule, non_conformite)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(affaire) DO UPDATE SET
            nom_dossier = excluded.nom_dossier,
            chemin = excluded.chemin,
            annule = excluded.annule,
            non_conformite = MAX(dossiers_affaires.non_conformite, excluded.non_conformite)",
        params![affaire, nom, chemin.to_string_lossy(), ctx.annule, ctx.non_conformite],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Appelé pour chaque dossier rencontré pendant le scan : enregistre le
/// dossier d'affaire, et le drapeau non-conformité même si le sous-dossier
/// "Non-conformité" est vide.
pub fn noter_dossier(conn: &Connection, racine: &Path, dossier: &Path) -> Result<(), String> {
    enregistrer_dossier(conn, &contexte(racine, &dossier.join("_")))
}

/// Point d'entrée : indexe un fichier du dossier surveillé.
pub fn traiter_fichier(conn: &mut Connection, racine: &Path, chemin: &Path) -> Result<Resultat, String> {
    let nom = chemin.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    if est_ignore(&nom) {
        return Ok(Resultat::Ignore);
    }
    let meta = fs::metadata(chemin).map_err(|e| format!("Fichier inaccessible: {e}"))?;
    // Fichier OneDrive "à la demande" pas encore téléchargé : pas enregistré
    // dans `fichiers`, pour être retenté au prochain passage.
    if meta.len() == 0 {
        return Err("Fichier vide (pas encore synchronisé ?)".into());
    }
    let chemin_str = chemin.to_string_lossy().to_string();
    let (taille, mtime) = (meta.len() as i64, mtime(&meta));

    let deja_vu: Option<(i64, i64)> = conn
        .query_row("SELECT taille, mtime FROM fichiers WHERE chemin = ?1", [&chemin_str], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()
        .map_err(|e| e.to_string())?;
    if deja_vu == Some((taille, mtime)) {
        return Ok(Resultat::Inchange);
    }

    let ctx = contexte(racine, chemin);
    if ctx.ignore {
        marquer_fichier(conn, &chemin_str, taille, mtime, "ignore", None)?;
        return Ok(Resultat::Ignore);
    }
    enregistrer_dossier(conn, &ctx)?;

    let ext = chemin.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let mut type_doc = type_par_extension(&ext);
    if type_doc == "excel" {
        type_doc = type_excel(chemin);
    }

    let extraction = match type_doc {
        "fiche" => traiter_fiche(conn, &ctx, &chemin_str, mtime),
        "rde" => traiter_rde(conn, &ctx, &chemin_str, mtime),
        "mail" => traiter_mail(conn, &ctx, chemin),
        // Export ERP : uniquement hors dossier d'affaire (un .txt rangé dans
        // un dossier d'affaire est une note, un log...).
        "texte" if ext == "txt" && ctx.affaire.is_none() => {
            traiter_fichier_erp(chemin, conn).map(|n| Extraction { titre: format!("Export ERP ({n} lignes)"), ..Default::default() })
        }
        _ => Ok(Extraction::default()),
    };
    let (extraction, erreur) = match extraction {
        Ok(e) => (e, None),
        Err(e) => (Extraction::default(), Some(e)),
    };

    let affaire = ctx.affaire.clone().or(extraction.affaire.clone());
    enregistrer_document(conn, &chemin_str, &nom, type_doc, affaire.as_deref(), &ctx, taille, &meta, &extraction)?;
    let statut = if erreur.is_some() { "erreur" } else { "ok" };
    marquer_fichier(conn, &chemin_str, taille, mtime, statut, erreur.as_deref())?;
    if let Some(e) = erreur {
        return Err(e);
    }
    Ok(Resultat::Indexe { type_doc, affaire, principal: extraction.principal })
}

/// Enregistre un fichier dont l'analyse a planté (panique d'un parseur sur
/// un classeur corrompu...) : avec sa taille et sa date actuelles, il n'est
/// plus retenté aux scans suivants tant qu'il n'est pas modifié.
pub fn marquer_plantage(conn: &Connection, chemin: &Path, message: &str) -> Result<(), String> {
    let meta = fs::metadata(chemin).map_err(|e| e.to_string())?;
    marquer_fichier(conn, &chemin.to_string_lossy(), meta.len() as i64, mtime(&meta), "plantage", Some(message))
}

fn marquer_fichier(conn: &Connection, chemin: &str, taille: i64, mtime: i64, statut: &str, erreur: Option<&str>) -> Result<(), String> {
    let maintenant = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    conn.execute(
        "INSERT OR REPLACE INTO fichiers (chemin, taille, mtime, statut, erreur, traite_le) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![chemin, taille, mtime, statut, erreur, maintenant],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn enregistrer_document(
    conn: &Connection,
    chemin: &str,
    nom: &str,
    type_doc: &str,
    affaire: Option<&str>,
    ctx: &Contexte,
    taille: i64,
    meta: &fs::Metadata,
    extraction: &Extraction,
) -> Result<(), String> {
    let date_modif = meta
        .modified()
        .ok()
        .map(|t| chrono::DateTime::<chrono::Local>::from(t).format("%Y-%m-%d").to_string());
    let titre = if extraction.titre.is_empty() { nom.to_string() } else { extraction.titre.clone() };
    conn.execute(
        "INSERT INTO documents (chemin, affaire, type, nom, dossier_relatif, taille, date_modif, ancien, reference, titre)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(chemin) DO UPDATE SET
            affaire = excluded.affaire, type = excluded.type, nom = excluded.nom,
            dossier_relatif = excluded.dossier_relatif, taille = excluded.taille,
            date_modif = excluded.date_modif, ancien = excluded.ancien,
            reference = excluded.reference, titre = excluded.titre,
            -- Fichier relu (donc modifié) : empreinte à recalculer.
            empreinte = NULL",
        params![chemin, affaire, type_doc, nom, ctx.dossier_relatif, taille, date_modif, ctx.ancien, ctx.reference, titre],
    )
    .map_err(|e| e.to_string())?;

    // Le nom de fichier et les dossiers font partie du texte cherchable
    // ("non-conformité", "plan", "montage à blanc"...).
    let contenu = format!(
        "{} {} {} {}",
        nom,
        ctx.nom_dossier.as_deref().unwrap_or(""),
        ctx.dossier_relatif,
        extraction.contenu
    );
    conn.execute("DELETE FROM documents_fts WHERE chemin = ?1", [chemin]).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO documents_fts (chemin, affaire, titre, contenu) VALUES (?1, ?2, ?3, ?4)",
        params![chemin, affaire, titre, contenu],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Retire de l'index un fichier supprimé.
pub fn oublier_fichier(conn: &Connection, chemin: &str) -> Result<(), String> {
    for sql in [
        "DELETE FROM fichiers WHERE chemin = ?1",
        "DELETE FROM documents WHERE chemin = ?1",
        "DELETE FROM documents_fts WHERE chemin = ?1",
    ] {
        conn.execute(sql, [chemin]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Après un scan complet : retire les fichiers indexés sous `racine` qui
/// n'existent plus.
pub fn purger_absents(conn: &Connection, racine: &Path, vus: &HashSet<String>) -> Result<usize, String> {
    let racine = racine.to_string_lossy().to_string();
    let absents: Vec<String> = {
        let mut stmt = conn.prepare("SELECT chemin FROM fichiers").map_err(|e| e.to_string())?;
        let chemins = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
        chemins
            .filter_map(Result::ok)
            .filter(|c| c.starts_with(&racine) && !vus.contains(c))
            .collect()
    };
    for chemin in &absents {
        oublier_fichier(conn, chemin)?;
    }
    Ok(absents.len())
}

/// Taille lue au début et à la fin d'un fichier pour son empreinte.
const OCTETS_EMPREINTE: u64 = 64 * 1024;
/// Préfixe de version des empreintes : une empreinte d'une autre version
/// (ex. calculée sur le fichier entier) est recalculée.
const VERSION_EMPREINTE: &str = "p1:";

/// Empreinte FNV-1a 64 bits (stable d'une version de Rust à l'autre,
/// contrairement à DefaultHasher) des 64 premiers et 64 derniers Ko du
/// fichier, plus sa taille : lire le fichier entier forcerait OneDrive à
/// télécharger des Go de plans/PDF "à la demande" juste pour comparer des
/// copies. Un fichier de moins de 128 Ko (programmes CN, textes, où les
/// faux doublons ont été observés) est lu en entier. None si illisible.
fn empreinte_fichier(chemin: &str) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut fichier = fs::File::open(chemin).ok()?;
    let taille = fichier.metadata().ok()?.len();
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let mut melanger = |octets: &[u8]| {
        for &octet in octets {
            hash ^= octet as u64;
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    };
    melanger(&taille.to_le_bytes());
    let mut lire = |fichier: &mut fs::File, n: u64| -> Option<Vec<u8>> {
        let mut tampon = Vec::with_capacity(n as usize);
        fichier.take(n).read_to_end(&mut tampon).ok()?;
        Some(tampon)
    };
    if taille <= 2 * OCTETS_EMPREINTE {
        melanger(&lire(&mut fichier, taille)?);
    } else {
        melanger(&lire(&mut fichier, OCTETS_EMPREINTE)?);
        fichier.seek(SeekFrom::End(-(OCTETS_EMPREINTE as i64))).ok()?;
        melanger(&lire(&mut fichier, OCTETS_EMPREINTE)?);
    }
    Some(format!("{VERSION_EMPREINTE}{hash:016x}"))
}

/// Repère les copies d'un même fichier dans le dossier d'une affaire (un
/// mail rangé à la racine ET dans "Mails/", un plan dans "Plan/" et
/// "Ancien/"...) : chaque copie reçoit `doublon_de` = chemin de l'exemplaire
/// retenu, et est ensuite exclue des listes et de la recherche plein texte.
/// Rien n'est supprimé du disque.
///
/// Même nom + même taille ne suffit pas (43 programmes CN / plans du dossier
/// "1a COMMANDES FINIES 2025" ont nom et taille identiques mais un contenu
/// différent) : le contenu est comparé par empreinte (début + fin du
/// fichier, voir empreinte_fichier), calculée seulement pour les fichiers
/// candidats et mise en cache dans `documents.empreinte` (remise à NULL
/// quand le fichier est relu).
///
/// Exemplaire retenu : hors "Ancien", hors dossier de référence, le moins
/// profond, puis le plus récent. Recalcul complet à chaque appel (quelques
/// millisecondes une fois les empreintes en cache). Retourne le nombre de
/// copies.
pub fn marquer_doublons(conn: &Connection) -> Result<usize, String> {
    let candidats: Vec<String> = {
        let mut stmt = conn
            .prepare(
                "SELECT d.chemin FROM documents d
                 WHERE d.affaire IS NOT NULL
                   AND (d.empreinte IS NULL OR d.empreinte NOT LIKE ?1 || '%')
                   AND EXISTS (SELECT 1 FROM documents o
                               WHERE o.affaire = d.affaire AND o.nom = d.nom
                                 AND o.taille = d.taille AND o.chemin <> d.chemin)",
            )
            .map_err(|e| e.to_string())?;
        let chemins = stmt
            .query_map([VERSION_EMPREINTE], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        chemins.filter_map(Result::ok).collect()
    };
    for chemin in &candidats {
        if let Some(empreinte) = empreinte_fichier(chemin) {
            conn.execute("UPDATE documents SET empreinte = ?1 WHERE chemin = ?2", params![empreinte, chemin])
                .map_err(|e| e.to_string())?;
        }
    }

    conn.execute("UPDATE documents SET doublon_de = NULL WHERE doublon_de IS NOT NULL", [])
        .map_err(|e| e.to_string())?;
    // Empreinte inconnue (fichier illisible) : jamais considéré comme copie.
    conn.execute(
        "UPDATE documents SET doublon_de = c.original
         FROM (
             SELECT chemin, FIRST_VALUE(chemin) OVER (
                 PARTITION BY affaire, nom, taille, empreinte
                 ORDER BY ancien, reference,
                          LENGTH(COALESCE(dossier_relatif, '')) - LENGTH(REPLACE(COALESCE(dossier_relatif, ''), '/', '')),
                          COALESCE(dossier_relatif, '') <> '',
                          date_modif DESC, chemin
             ) AS original
             FROM documents
             WHERE affaire IS NOT NULL AND empreinte IS NOT NULL
         ) AS c
         WHERE c.chemin = documents.chemin AND c.original <> documents.chemin",
        [],
    )
    .map_err(|e| e.to_string())
}

fn tronquer(texte: &str, max: usize) -> String {
    texte.chars().take(max).collect()
}

// ---------------------------------------------------------------------------
// Fiche de prévision
// ---------------------------------------------------------------------------

fn traiter_fiche(conn: &mut Connection, ctx: &Contexte, chemin: &str, mtime: i64) -> Result<Extraction, String> {
    let variables = parsing::extraire_variables_affaire(chemin)?;
    let commande = parsing::numero_affaire(&variables.affaire);
    let mut extraction = Extraction {
        affaire: commande.clone(),
        titre: format!("Fiche de prévision {}", variables.affaire),
        contenu: [
            variables.client.clone().unwrap_or_default(),
            variables.numero_plan.clone().unwrap_or_default(),
            variables.numero_offre.clone().unwrap_or_default(),
            variables.groupes_profil.iter().map(|g| g.profil.clone()).collect::<Vec<_>>().join(" "),
            variables.postes_prevus.iter().map(|p| p.libelle.clone()).collect::<Vec<_>>().join(" "),
        ]
        .join(" "),
        principal: false,
    };

    // Fiche d'une autre affaire rangée dans ce dossier : simple référence.
    if let (Some(affaire), Some(commande)) = (&ctx.affaire, &commande) {
        if affaire != commande {
            ajouter_reference(conn, affaire, commande, chemin)?;
            extraction.affaire = Some(affaire.clone());
            return Ok(extraction);
        }
    }
    if ctx.ancien || ctx.reference {
        if let (Some(affaire), Some(commande)) = (&ctx.affaire, &commande) {
            ajouter_reference(conn, affaire, commande, chemin)?;
        }
        return Ok(extraction);
    }
    let Some(affaire) = ctx.affaire.clone().or(commande) else {
        return Ok(extraction);
    };

    let rang = rang(ctx.a_la_racine || ctx.affaire.is_none(), variables.date_fiche.as_deref(), mtime);
    if est_prioritaire(conn, "variables_affaires", "chemin_fiche", "rang_fiche", &affaire, chemin, &rang)? {
        let mut variables = variables;
        variables.affaire = affaire.clone();
        parsing::enregistrer_fiche(conn, &variables)?;
        conn.execute(
            "UPDATE variables_affaires SET chemin_fiche = ?1, rang_fiche = ?2 WHERE affaire = ?3",
            params![chemin, rang, affaire],
        )
        .map_err(|e| e.to_string())?;
        extraction.principal = true;
    }
    Ok(extraction)
}

// ---------------------------------------------------------------------------
// RDE
// ---------------------------------------------------------------------------

fn traiter_rde(conn: &mut Connection, ctx: &Contexte, chemin: &str, mtime: i64) -> Result<Extraction, String> {
    let info = rde::extraire_rde(chemin)?.ok_or("Classeur sans feuilles cde/parachèvement")?;
    let mut extraction = Extraction {
        affaire: info.affaire.clone(),
        titre: format!("RDE {}", info.projet.as_deref().unwrap_or("")),
        contenu: [
            &info.projet, &info.client, &info.donneur_ordre, &info.offre, &info.cde_laminage,
            &info.remarques, &info.type_affaire, &info.exigence_fabrication, &info.exc, &info.en10163,
            &info.tolerance, &info.en10204, &info.prep_en8501, &info.classe_us,
        ]
        .iter()
        .filter_map(|v| v.as_deref())
        .chain(info.laminage.iter().flat_map(|l| [Some(l.profil.as_str()), l.nuance.as_deref()]).flatten())
        .collect::<Vec<_>>()
        .join(" "),
        principal: false,
    };

    if let (Some(affaire), Some(numero)) = (&ctx.affaire, &info.affaire) {
        if affaire != numero {
            ajouter_reference(conn, affaire, numero, chemin)?;
            extraction.affaire = Some(affaire.clone());
            return Ok(extraction);
        }
    }
    if ctx.ancien || ctx.reference {
        return Ok(extraction);
    }
    let Some(affaire) = ctx.affaire.clone().or(info.affaire.clone()) else {
        return Ok(extraction);
    };

    let rang = rang(ctx.a_la_racine || ctx.affaire.is_none(), info.date.as_deref(), mtime);
    if est_prioritaire(conn, "rde_affaires", "chemin", "rang", &affaire, chemin, &rang)? {
        enregistrer_rde(conn, &affaire, &info, chemin, &rang)?;
        extraction.principal = true;
    }
    Ok(extraction)
}

fn enregistrer_rde(conn: &mut Connection, affaire: &str, info: &rde::InfoRde, chemin: &str, rang: &str) -> Result<(), String> {
    let tx = conn.savepoint().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT OR REPLACE INTO rde_affaires (
            affaire, chemin, rang, date_rde, projet, offre, client, donneur_ordre, cde_laminage,
            type_affaire, type_poutre, remarques, traitement_surface, traitements, en10163, tolerance,
            tolerance_speciale, exc, tracabilite, en10204, prep_en8501, classe_us, exigence_fabrication,
            exigences_acier, accessoires
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25)",
        params![
            affaire, chemin, rang, info.date, info.projet, info.offre, info.client, info.donneur_ordre,
            info.cde_laminage, info.type_affaire, info.type_poutre, info.remarques, info.traitement_surface,
            info.traitements.join(";"), info.en10163, info.tolerance, info.tolerance_speciale, info.exc,
            info.tracabilite, info.en10204, info.prep_en8501, info.classe_us, info.exigence_fabrication,
            info.exigences_acier.join(";"), info.accessoires.join(";"),
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM rde_laminage WHERE affaire = ?1", [affaire]).map_err(|e| e.to_string())?;
    for l in &info.laminage {
        tx.execute(
            "INSERT INTO rde_laminage (affaire, profil, longueur, nuance, poids_kg, nombre, usine, date_laminage)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![affaire, l.profil, l.longueur, l.nuance, l.poids_kg, l.nombre, l.usine, l.date_laminage],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;

    let lignes: Vec<LigneOperation> = info
        .operations
        .iter()
        .map(|(cle, libelle)| LigneOperation { operation: cle.clone(), libelles: vec![libelle.clone()], ..Default::default() })
        .collect();
    parsing::remplacer_operations(conn, affaire, "rde", &lignes)
}

// ---------------------------------------------------------------------------
// Mails
// ---------------------------------------------------------------------------

fn traiter_mail(conn: &mut Connection, ctx: &Contexte, chemin: &Path) -> Result<Extraction, String> {
    let msg = crate::msg::load_msg(chemin)?;
    let demande = crate::msg::extraire_demande(&msg.subject, &msg.body_text);
    if let Some(reference) = crate::msg::enregistrer_demande(conn, &msg.subject, &demande)? {
        println!("{chemin:?} : demande {reference} enregistrée");
    }

    // Pièces jointes Excel/ERP/mail : seulement pour un mail déposé hors
    // dossier d'affaire (comportement historique). Dans un dossier
    // d'affaire, les fichiers utiles y sont déjà rangés, et une pièce
    // jointe est presque toujours une version antérieure.
    if ctx.affaire.is_none() && !ctx.piece_jointe {
        traiter_pieces_jointes(conn, &msg, chemin);
    }

    let pieces: Vec<&str> = msg.attachments.iter().map(|a| a.filename.as_str()).collect();
    Ok(Extraction {
        affaire: None,
        titre: msg.subject.clone(),
        contenu: format!("{} {}", tronquer(&msg.body_text, MAX_CARACTERES_CONTENU), pieces.join(" ")),
        principal: false,
    })
}

fn traiter_pieces_jointes(conn: &mut Connection, msg: &crate::msg::ParsedMsg, chemin: &Path) {
    let utiles: Vec<_> = msg
        .attachments
        .iter()
        .filter(|a| {
            let n = a.filename.to_lowercase();
            n.ends_with(".xlsx") || n.ends_with(".txt") || n.ends_with(".msg")
        })
        .collect();
    if utiles.is_empty() {
        return;
    }
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    std::hash::Hash::hash(&chemin, &mut hash);
    let tmp = std::env::temp_dir().join(format!(
        "parachev_msg_{}_{:x}",
        std::process::id(),
        std::hash::Hasher::finish(&hash)
    ));
    if let Err(e) = fs::create_dir_all(&tmp) {
        eprintln!("Impossible de créer {tmp:?}: {e}");
        return;
    }
    let ctx = Contexte { piece_jointe: true, ..Default::default() };
    for pj in utiles {
        let Some(nom) = Path::new(&pj.filename).file_name() else { continue };
        let cible = tmp.join(nom);
        if fs::write(&cible, &pj.bytes).is_err() {
            continue;
        }
        let cible_str = cible.to_string_lossy().to_string();
        let resultat = match type_par_extension(&cible.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()) {
            "excel" => match type_excel(&cible) {
                "fiche" => traiter_fiche(conn, &ctx, &cible_str, 0).map(|_| ()),
                "rde" => traiter_rde(conn, &ctx, &cible_str, 0).map(|_| ()),
                _ => Ok(()),
            },
            "mail" => traiter_mail(conn, &ctx, &cible).map(|_| ()),
            "texte" => traiter_fichier_erp(&cible, conn).map(|_| ()),
            _ => Ok(()),
        };
        match resultat {
            Ok(()) => println!("{chemin:?} : pièce jointe {nom:?} traitée"),
            Err(e) => eprintln!("{chemin:?} : pièce jointe {nom:?} : {e}"),
        }
    }
    let _ = fs::remove_dir_all(&tmp);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(chemin: &str) -> Contexte {
        contexte(Path::new("/racine"), Path::new(chemin))
    }

    #[test]
    fn rattachement_par_dossier() {
        let c = ctx("/racine/1100725621 HOFMANN RIEG/1100725621.xlsx");
        assert_eq!(c.affaire.as_deref(), Some("1100725621"));
        assert!(c.a_la_racine && !c.ancien && !c.reference && !c.annule);
        assert_eq!(c.chemin_dossier, Some(PathBuf::from("/racine/1100725621 HOFMANN RIEG")));

        let c = ctx("/racine/1100717997 WIB BRÜCKE TROISDORF/Préparation/1100717997 avec urgence.xlsx");
        assert_eq!(c.affaire.as_deref(), Some("1100717997"));
        assert!(!c.a_la_racine && !c.reference);
        assert_eq!(c.dossier_relatif, "Préparation");

        let c = ctx("/racine/1100732005 PONT PEYRAMALE/Préparation/1100617508 TS BIELEFELD DB HILFSBRÜCKEN ok/1100617508.xlsx");
        assert_eq!(c.affaire.as_deref(), Some("1100732005"));
        assert!(c.reference);

        let c = ctx("/racine/1100710731 LINDWURMSTRASSE/Ancienne RDE/RDE.xlsx");
        assert!(c.ancien);

        let c = ctx("/racine/1100726705 ANNULE  ZAGURY SPIRALA/RDE.xlsx");
        assert!(c.annule);

        let c = ctx("/racine/1100721669 STUPOSIANY/Non-conformité/NC 01.pdf");
        assert!(c.non_conformite);
    }

    #[test]
    fn dossiers_sans_numero_ignores() {
        for chemin in [
            "/racine/1100...... LUGOJ TIMISOARA EST WALLERICH/12002RO23 - RDE V7.xlsx",
            "/racine/1700037302 redressage usine MARY François/a.xlsx",
            "/racine/1900017337 ANNULE CHARGEMENT R&D/a.xlsx",
            "/racine/0 1100/a.xlsx",
        ] {
            assert!(ctx(chemin).ignore, "{chemin}");
        }
        // Hors de toute arborescence d'affaire : pas ignoré, juste sans contexte.
        let c = ctx("/racine/Para/1100546190.xlsx");
        assert!(!c.ignore && c.affaire.is_none());
    }

    #[test]
    fn doublons_de_documents() {
        let dossier = std::env::temp_dir().join(format!("parachev_doublons_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dossier);
        fs::create_dir_all(&dossier).unwrap();
        let fichier = |nom: &str, contenu: &str| {
            let p = dossier.join(nom);
            fs::write(&p, contenu).unwrap();
            p.to_string_lossy().to_string()
        };
        let racine_m = fichier("racine_m", "mail A");
        let mails_m = fichier("mails_m", "mail A");
        let ancien_m = fichier("ancien_m", "mail A");
        let autre_contenu = fichier("autre_contenu", "mail B"); // même taille, contenu différent
        let autre_affaire = fichier("autre_affaire", "mail A");

        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE variables_affaires (affaire TEXT PRIMARY KEY);
             CREATE TABLE configuration (cle TEXT PRIMARY KEY, valeur TEXT NOT NULL);",
        )
        .unwrap();
        initialiser_schema(&conn).unwrap();
        let doc = |chemin: &str, affaire: &str, dossier: &str, ancien: bool| {
            conn.execute(
                "INSERT INTO documents (chemin, affaire, type, nom, dossier_relatif, taille, date_modif, ancien)
                 VALUES (?1, ?2, 'mail', 'm.msg', ?3, 6, '2025-01-01', ?4)",
                params![chemin, affaire, dossier, ancien],
            )
            .unwrap();
        };
        doc(&mails_m, "A", "Mails", false);
        doc(&racine_m, "A", "", false);
        doc(&ancien_m, "A", "Ancien", true);
        doc(&autre_contenu, "A", "Mails/2", false);
        doc(&autre_affaire, "B", "", false);

        assert_eq!(marquer_doublons(&conn).unwrap(), 2);
        let doublon = |chemin: &str| -> Option<String> {
            conn.query_row("SELECT doublon_de FROM documents WHERE chemin = ?1", [chemin], |r| r.get(0)).unwrap()
        };
        assert_eq!(doublon(&racine_m), None);
        assert_eq!(doublon(&mails_m), Some(racine_m.clone()));
        assert_eq!(doublon(&ancien_m), Some(racine_m.clone()));
        assert_eq!(doublon(&autre_contenu), None);
        assert_eq!(doublon(&autre_affaire), None);
        // Idempotent (empreintes en cache).
        assert_eq!(marquer_doublons(&conn).unwrap(), 2);
        let _ = fs::remove_dir_all(&dossier);
    }

    #[test]
    fn priorite_racine_puis_date() {
        assert!(rang(true, Some("2025-01-01"), 1) > rang(false, Some("2026-01-01"), 9));
        assert!(rang(true, Some("2025-08-05"), 1) > rang(true, Some("2025-04-01"), 9));
        assert!(rang(true, Some("2025-08-05"), 9) > rang(true, Some("2025-08-05"), 1));
    }
}
