//! Extraction de la "Revue des exigences techniques" au format Word
//! (.docx généré par l'outil commercial, nommé "<projet>_V<n>_<horodatage>
//! .docx"), qui remplace le classeur Excel depuis fin 2025 : 104 fichiers
//! sur les dossiers "1a COMMANDES FINIES 2025" et "2026", tous au même
//! gabarit. Remplit la même structure `InfoRde` que `rde` (Excel).
//!
//! Le document est une suite de paragraphes-titres et de tableaux :
//! - tableau d'en-tête "Revue des exigences techniques" (libellé | valeur :
//!   date, nom de l'affaire, n° d'offre, client) ;
//! - "N°s cde laminage | 1900... | N°s cde client | 1100...[,1100...]" ;
//! - "Version n° | Date | Modifié par" (une ligne : la version du fichier) ;
//! - "Commande de laminage" (profil, longueur, nuance, poids, nombre, usine,
//!   date de laminage, US), colonnes repérées par leur titre ;
//! - "Routage" (ligne "Prégrenaillage" renseignée = prégrenaillé) ;
//! - "Type d'affaire : ...", "Type de poutre : ..." ;
//! - "Opérations à prévoir :" puis un tableau d'une opération par ligne
//!   (plus de cases à cocher : seules les opérations demandées sont
//!   listées) ;
//! - "Accessoires :" puis un tableau, puis les remarques en texte libre ;
//! - "Traitement de surface" (seulement s'il y en a) : "Opérations :" puis
//!   un tableau, "Remarques:" ;
//! - "Exigences normatives" (libellé | valeur).
//!
//! Absents du gabarit Word : donneur d'ordre, type de document de contrôle
//! (EN 10204), tolérances spéciales, classe US (seulement "US : Yes/No" par
//! ligne de laminage).

use super::rde::{normaliser_tolerance, valeur, InfoRde, LigneLaminage};
use super::{numero_affaire, operations, texte_vers_date};
use quick_xml::events::Event;
use quick_xml::Reader;
use std::io::Read;
use std::path::Path;

/// Valeur de `classe_us` quand le RDE Word demande un contrôle US : la
/// classe (EN 10306 cl. 2.x dans l'Excel) n'y figure pas.
const US_SANS_CLASSE: &str = "US (classe non précisée)";

#[derive(Debug, PartialEq)]
enum Bloc {
    Paragraphe(String),
    /// Lignes de cellules ; les paragraphes d'une cellule sont joints par "\n".
    Tableau(Vec<Vec<String>>),
}

/// Paragraphes et tableaux du corps du document, dans l'ordre. Seul le
/// texte des balises `w:t` est retenu (pas les coordonnées des dessins).
/// Les lignes et cellules sont souvent enveloppées dans des contrôles de
/// contenu (`w:sdt`), d'où une lecture à plat par événements.
fn blocs_document(xml: &str) -> Result<Vec<Bloc>, String> {
    let mut reader = Reader::from_str(xml.trim_start_matches('\u{feff}'));
    let mut blocs = Vec::new();
    let (mut prof_tableau, mut prof_paragraphe, mut repli) = (0u32, 0u32, 0u32);
    let (mut lignes, mut ligne, mut cellule): (Vec<Vec<String>>, Vec<String>, Vec<String>) = Default::default();
    let (mut en_cellule, mut dans_texte) = (false, false);
    let mut texte = String::new();

    loop {
        match reader.read_event().map_err(|e| format!("XML illisible: {e}"))? {
            Event::Start(e) => match e.name().as_ref() {
                b"w:tbl" => prof_tableau += 1,
                b"w:tr" if prof_tableau == 1 => ligne.clear(),
                b"w:tc" if prof_tableau == 1 => {
                    cellule.clear();
                    en_cellule = true;
                }
                b"w:p" => {
                    prof_paragraphe += 1;
                    if prof_paragraphe == 1 {
                        texte.clear();
                    } else {
                        texte.push('\n');
                    }
                }
                b"w:t" => dans_texte = true,
                // Copie de secours d'une zone de texte : déjà lue dans mc:Choice.
                b"mc:Fallback" => repli += 1,
                _ => {}
            },
            Event::Empty(e) => match e.name().as_ref() {
                b"w:tab" => texte.push(' '),
                b"w:br" | b"w:cr" => texte.push('\n'),
                _ => {}
            },
            Event::Text(t) if dans_texte && repli == 0 && prof_paragraphe > 0 => {
                texte.push_str(&t.unescape().map_err(|e| format!("XML illisible: {e}"))?);
            }
            Event::End(e) => match e.name().as_ref() {
                b"w:t" => dans_texte = false,
                b"mc:Fallback" => repli = repli.saturating_sub(1),
                b"w:p" => {
                    prof_paragraphe = prof_paragraphe.saturating_sub(1);
                    if prof_paragraphe == 0 {
                        let t = texte.replace(['\u{a0}', '\u{202f}'], " ");
                        let t = t.trim();
                        if en_cellule {
                            if !t.is_empty() {
                                cellule.push(t.to_string());
                            }
                        } else if prof_tableau == 0 && !t.is_empty() {
                            blocs.push(Bloc::Paragraphe(t.to_string()));
                        }
                    }
                }
                b"w:tc" if prof_tableau == 1 => {
                    ligne.push(cellule.join("\n"));
                    en_cellule = false;
                }
                b"w:tr" if prof_tableau == 1 => lignes.push(std::mem::take(&mut ligne)),
                b"w:tbl" => {
                    prof_tableau = prof_tableau.saturating_sub(1);
                    if prof_tableau == 0 {
                        blocs.push(Bloc::Tableau(std::mem::take(&mut lignes)));
                    }
                }
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(blocs)
}

fn lire_blocs(chemin: &Path) -> Result<Vec<Bloc>, String> {
    let fichier = std::fs::File::open(chemin).map_err(|e| format!("Ouverture impossible: {e}"))?;
    let mut archive = zip::ZipArchive::new(fichier).map_err(|e| format!("Document Word illisible: {e}"))?;
    let mut xml = String::new();
    archive
        .by_name("word/document.xml")
        .map_err(|e| format!("Document Word illisible: {e}"))?
        .read_to_string(&mut xml)
        .map_err(|e| format!("Document Word illisible: {e}"))?;
    blocs_document(&xml)
}

/// Libellé normalisé (majuscules sans accents, apostrophe droite).
fn cle(libelle: &str) -> String {
    operations::normaliser(libelle).replace('’', "'")
}

/// Texte qui suit le premier ":" ("Type de poutre : Fer T" -> "Fer T").
fn apres_deux_points(texte: &str) -> Option<String> {
    texte.split_once(':').and_then(|(_, v)| valeur(v))
}

/// Texte qui suit "<libellé> :" où qu'il soit dans le paragraphe ("Plans
/// BPE      Type d'affaire : Pont mixte" -> "Pont mixte").
fn apres_libelle(texte: &str, libelle: &str) -> Option<String> {
    texte
        .match_indices(':')
        .find(|(i, _)| cle(&texte[..*i]).ends_with(libelle))
        .and_then(|(i, _)| valeur(&texte[i + 1..]))
}

/// Cellules non vides d'un tableau à une valeur par ligne.
fn cellules(tableau: &[Vec<String>]) -> Vec<String> {
    tableau.iter().flatten().filter_map(|c| valeur(c)).collect()
}

/// "212 000.00" -> 212000.0.
fn nombre(s: &str) -> Option<f64> {
    let compact: String = s.chars().filter(|c| !c.is_whitespace()).collect();
    compact.replace(',', ".").parse::<f64>().ok()
}

/// Date de l'en-tête : "17-04-2026", ou "11/20/2025 7:52:52 AM" (mois en
/// premier) selon la langue du poste qui a généré le document.
fn date_entete(s: &str) -> Option<String> {
    let t = s.trim();
    let n = t.to_uppercase();
    if n.ends_with("AM") || n.ends_with("PM") {
        let jour = t.split_whitespace().next()?;
        return chrono::NaiveDate::parse_from_str(jour, "%m/%d/%Y").ok().map(|d| d.format("%Y-%m-%d").to_string());
    }
    texte_vers_date(t)
}

/// "04-09-2026 10:33" -> "2026-09-04 10:33".
fn date_version(s: &str) -> Option<String> {
    chrono::NaiveDateTime::parse_from_str(s.trim(), "%d-%m-%Y %H:%M")
        .ok()
        .map(|d| d.format("%Y-%m-%d %H:%M").to_string())
        .or_else(|| texte_vers_date(s).map(|d| format!("{d} 00:00")))
}

/// "oui"/"yes" (et tout ce qui n'est ni vide ni "non"/"no") = vrai.
fn est_oui(s: &str) -> bool {
    valeur(s).is_some_and(|v| !matches!(cle(&v).as_str(), "NON" | "NO" | "N/A"))
}

/// Valeurs de la liste déroulante ramenées à l'orthographe de l'Excel
/// ("P3 aile inferieure", sans accent) pour ne faire qu'une valeur de filtre.
fn normaliser_preparation(p: &str) -> String {
    if cle(p) == "P3 AILE INFERIEURE" {
        "P3 aile inferieure".to_string()
    } else {
        p.to_string()
    }
}

fn ajouter_remarque(remarques: &mut Vec<String>, texte: &str) {
    if let Some(t) = valeur(texte) {
        if !remarques.contains(&t) {
            remarques.push(t);
        }
    }
}

/// Ce qu'annonce le dernier paragraphe-titre rencontré.
#[derive(PartialEq, Clone, Copy)]
enum Section {
    Autre,
    Routage,
    Operations,
    /// Tableau des accessoires attendu, puis remarques en texte libre.
    Accessoires,
    Traitements,
    Remarques,
    Exigences,
}

fn en_tete(info: &mut InfoRde, tableau: &[Vec<String>]) {
    for r in tableau.iter().filter(|r| r.len() >= 2) {
        let v = valeur(&r[1]);
        match cle(&r[0]).as_str() {
            "DATE" => info.date = date_entete(&r[1]),
            "NOM DE L'AFFAIRE" | "NOM PROJET" => info.projet = v,
            "N° OFFRE AM" => info.offre = v,
            "CLIENT" => info.client = v,
            _ => {}
        }
    }
}

/// "N°s cde laminage | 1900017798 | N°s cde client | 1100752651".
fn commandes(info: &mut InfoRde, ligne: &[String]) {
    for paire in ligne.chunks(2).filter(|p| p.len() == 2) {
        let n = cle(&paire[0]);
        if n.starts_with("N°S CDE LAMINAGE") {
            info.cde_laminage = valeur(&paire[1]);
        } else if n.starts_with("N°S CDE CLIENT") {
            let mut numeros = paire[1].split(|c: char| !c.is_ascii_digit()).filter_map(numero_affaire);
            info.affaire = numeros.next();
            info.autres_affaires = numeros.filter(|n| Some(n) != info.affaire.as_ref()).collect();
        }
    }
}

fn laminage(info: &mut InfoRde, tableau: &[Vec<String>]) {
    let titres: Vec<String> = tableau[0].iter().map(|t| cle(t)).collect();
    let colonne = |titre: &str| titres.iter().position(|t| t == titre);
    let Some(col_profil) = colonne("PROFIL") else { return };
    for r in &tableau[1..] {
        let cellule = |titre: &str| colonne(titre).and_then(|c| r.get(c)).map(String::as_str).unwrap_or("");
        let Some(profil) = r.get(col_profil).and_then(|p| valeur(p)) else { continue };
        let (nb, poids) = (nombre(cellule("NOMBRE")), nombre(cellule("POIDS KG")));
        if nb.unwrap_or(0.0) <= 0.0 && poids.unwrap_or(0.0) <= 0.0 {
            continue;
        }
        if est_oui(cellule("US")) {
            info.classe_us = Some(US_SANS_CLASSE.to_string());
        }
        info.laminage.push(LigneLaminage {
            profil,
            longueur: nombre(cellule("LONGUEUR")),
            nuance: valeur(cellule("NUANCE")),
            poids_kg: poids,
            nombre: nb,
            // Cellule parfois remplie d'un seul signe de ponctuation.
            usine: valeur(cellule("USINE")).filter(|u| u.chars().any(char::is_alphanumeric)),
            date_laminage: texte_vers_date(cellule("DATE LAMINAGE")),
        });
    }
}

/// Ligne "| Prégrenaillage | Kleinlux |" (lieu ou dates) = prégrenaillé.
fn routage(info: &mut InfoRde, tableau: &[Vec<String>]) {
    let pregrenaille = tableau.iter().any(|r| {
        r.iter().position(|c| cle(c) == "PREGRENAILLAGE").is_some_and(|i| r[i + 1..].iter().any(|v| est_oui(v)))
    });
    if pregrenaille {
        info.traitements.push("Prégrenaillage".to_string());
    }
}

fn exigences(info: &mut InfoRde, tableau: &[Vec<String>], remarques: &mut Vec<String>) {
    for r in tableau.iter().filter(|r| !r.is_empty()) {
        let n = cle(&r[0]);
        let v = r.get(1).and_then(|v| valeur(v));
        if n.starts_with("EXIGENCES DE REPARATION") {
            info.en10163 = v;
        } else if n.starts_with("CLASSE D'EXECUTION") {
            info.exc = v;
        } else if n.starts_with("CLASSE DE TOLERANCE") {
            info.tolerance = v.map(|t| normaliser_tolerance(&t));
        } else if n.starts_with("TYPE DE TRACABILITE") {
            info.tracabilite = v;
        } else if n.starts_with("DEGRE DE PREPARATION") {
            info.prep_en8501 = v.map(|p| normaliser_preparation(&p));
        } else if n.starts_with("EXIGENCE(S) PARTICULIERE(S) ACIER") {
            info.exigences_acier = v.into_iter().collect();
        } else if n.starts_with("EXIGENCE(S) PARTICULIERE(S) FAB") {
            info.exigence_fabrication = v;
        } else if n.starts_with("COMMENTAIRE") {
            // Cellule unique "Commentaire : texte libre".
            if let Some(commentaire) = apres_deux_points(&r[0]) {
                ajouter_remarque(remarques, &commentaire);
            }
        }
    }
}

/// None si le document n'est pas un RDE (pas de tableau d'en-tête "Revue
/// des exigences techniques").
fn extraire(blocs: &[Bloc]) -> Option<InfoRde> {
    let est_en_tete = |t: &[Vec<String>]| {
        t.first().and_then(|r| r.first()).is_some_and(|c| cle(c).starts_with("REVUE DES EXIGENCES TECHNIQUES"))
    };
    if !blocs.iter().any(|b| matches!(b, Bloc::Tableau(t) if est_en_tete(t))) {
        return None;
    }

    let mut info = InfoRde::default();
    let mut remarques: Vec<String> = Vec::new();
    let mut section = Section::Autre;
    let mut dans_traitement = false;
    let mut fer_t = false;

    for bloc in blocs {
        match bloc {
            Bloc::Paragraphe(p) => {
                let n = cle(p);
                if info.type_affaire.is_none() && n.contains("TYPE D'AFFAIRE") {
                    // L'Excel écrit "autre" en minuscules.
                    info.type_affaire = apres_libelle(p, "TYPE D'AFFAIRE")
                        .map(|t| if cle(&t) == "AUTRE" { "autre".to_string() } else { t });
                    section = Section::Autre;
                } else if n.starts_with("TYPE DE POUTRE") {
                    info.type_poutre = apres_deux_points(p);
                } else if n.starts_with("OPERATIONS A PREVOIR") {
                    section = Section::Operations;
                } else if n.starts_with("MONTAGE A BLANC") {
                    section = Section::Autre;
                } else if n.starts_with("ACCESSOIRES") {
                    section = Section::Accessoires;
                } else if n == "ROUTAGE" {
                    section = Section::Routage;
                } else if n == "TRAITEMENT DE SURFACE" {
                    dans_traitement = true;
                    section = Section::Autre;
                } else if n == "EXIGENCES NORMATIVES" {
                    dans_traitement = false;
                    section = Section::Exigences;
                } else if dans_traitement && matches!(n.as_str(), "OPERATIONS :" | "OPERATIONS:") {
                    section = Section::Traitements;
                } else if dans_traitement && n.starts_with("DETAILS PEINTURE") {
                    section = Section::Autre;
                } else if dans_traitement && n.starts_with("REMARQUES") {
                    if let Some(r) = apres_deux_points(p) {
                        ajouter_remarque(&mut remarques, &r);
                    }
                    section = Section::Remarques;
                } else if matches!(section, Section::Accessoires | Section::Remarques) {
                    ajouter_remarque(&mut remarques, p);
                }
            }
            Bloc::Tableau(t) => {
                let titre = t.first().and_then(|r| r.first()).map(|c| cle(c)).unwrap_or_default();
                if est_en_tete(t) {
                    en_tete(&mut info, t);
                } else if titre.starts_with("N°S CDE LAMINAGE") {
                    commandes(&mut info, &t[0]);
                } else if titre.starts_with("VERSION N°") {
                    if let Some(r) = t.get(1) {
                        info.version = r.first().and_then(|v| valeur(v));
                        info.date_version = r.get(1).and_then(|d| date_version(d));
                    }
                } else if t.first().is_some_and(|r| r.iter().any(|c| cle(c) == "POIDS KG")) {
                    laminage(&mut info, t);
                } else {
                    match section {
                        Section::Routage => routage(&mut info, t),
                        Section::Operations => {
                            for libelle in cellules(t) {
                                fer_t |= matches!(cle(&libelle).replace('-', " ").as_str(), "FERS T" | "FER T");
                                for op in operations::operations_rde_word(&libelle) {
                                    if !info.operations.iter().any(|(c, _)| c == op) {
                                        info.operations.push((op.to_string(), libelle.clone()));
                                    }
                                }
                            }
                        }
                        Section::Accessoires => info.accessoires = cellules(t),
                        Section::Traitements => info.traitements.extend(cellules(t)),
                        Section::Exigences => exigences(&mut info, t, &mut remarques),
                        Section::Autre | Section::Remarques => {}
                    }
                    // Un seul tableau par titre ; après les accessoires
                    // viennent les remarques de fabrication.
                    section = match section {
                        Section::Accessoires | Section::Remarques => Section::Remarques,
                        _ => Section::Autre,
                    };
                }
            }
        }
    }

    // "Fers-T" est listé parmi les opérations ; dans l'Excel c'est le type
    // de poutre, que les types de production utilisent.
    if fer_t && info.type_poutre.is_none() {
        info.type_poutre = Some("Fer T".to_string());
    }
    info.traitement_surface = Some(if info.traitements.is_empty() { "non" } else { "oui" }.to_string());
    info.remarques = (!remarques.is_empty()).then(|| remarques.join("\n"));
    Some(info)
}

/// true si le .docx est un RDE (false aussi s'il est illisible).
pub fn est_un_rde(chemin: &Path) -> bool {
    lire_blocs(chemin).is_ok_and(|blocs| extraire(&blocs).is_some())
}

pub fn extraire_rde(chemin_fichier: &str) -> Result<Option<InfoRde>, String> {
    Ok(extraire(&lire_blocs(Path::new(chemin_fichier))?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(texte: &str) -> String {
        format!("<w:p><w:pPr><w:tabs><w:tab w:val=\"left\" w:pos=\"100\"/></w:tabs></w:pPr><w:r><w:t>{texte}</w:t></w:r></w:p>")
    }

    fn ligne(cellules: &[&str]) -> String {
        let tc: String = cellules.iter().map(|c| format!("<w:tc>{}</w:tc>", p(c))).collect();
        format!("<w:tr>{tc}</w:tr>")
    }

    fn tableau(lignes: &[&[&str]]) -> String {
        format!("<w:tbl>{}</w:tbl>", lignes.iter().map(|l| ligne(l)).collect::<String>())
    }

    fn document(corps: &str) -> String {
        format!("\u{feff}<?xml version=\"1.0\"?><w:document><w:body>{corps}</w:body></w:document>")
    }

    #[test]
    fn blocs_a_plat_malgre_les_controles_de_contenu() {
        // Ligne et cellule enveloppées dans w:sdt, coordonnées d'un dessin
        // (hors w:t), texte en deux morceaux, tabulation.
        let xml = document(
            "<w:tbl><w:sdt><w:sdtContent><w:tr><w:tc><w:p><w:r><w:t>Client</w:t></w:r></w:p></w:tc>\
             <w:sdt><w:sdtContent><w:tc><w:p><w:r><w:t>Spaeter </w:t></w:r><w:r><w:t>AG</w:t></w:r></w:p>\
             <w:p><w:r><w:t>Suisse</w:t></w:r></w:p></w:tc></w:sdtContent></w:sdt></w:tr></w:sdtContent></w:sdt></w:tbl>\
             <w:p><w:r><w:drawing><wp:posOffset>317505</wp:posOffset></w:drawing></w:r>\
             <w:r><w:t>Plans BPE</w:t><w:tab/><w:t xml:space=\"preserve\">Type d’affaire\u{a0}: Autre</w:t></w:r></w:p>\
             <w:p></w:p>",
        );
        assert_eq!(
            blocs_document(&xml).unwrap(),
            vec![
                Bloc::Tableau(vec![vec!["Client".to_string(), "Spaeter AG\nSuisse".to_string()]]),
                Bloc::Paragraphe("Plans BPE Type d’affaire : Autre".to_string()),
            ]
        );
    }

    #[test]
    fn dates() {
        assert_eq!(date_entete("17-04-2026").as_deref(), Some("2026-04-17"));
        assert_eq!(date_entete("11/20/2025 7:52:52 AM").as_deref(), Some("2025-11-20"));
        assert_eq!(date_entete("1/5/2026 12:02:10 PM").as_deref(), Some("2026-01-05"));
        assert_eq!(date_version("04-09-2026 10:33").as_deref(), Some("2026-09-04 10:33"));
        assert_eq!(nombre("212 000.00"), Some(212000.0));
    }

    #[test]
    fn rde_word_synthetique() {
        let xml = document(&[
            tableau(&[
                &["Revue des exigences techniques"],
                &["Date", "11/20/2025 7:52:52 AM"],
                &["Nom projet", "Pont de test"],
                &["N° offre AM", "5122CH25"],
                &["Client", "Spaeter AG"],
                &["Référence client", "E-Mail"],
            ]),
            tableau(&[&["N°s cde laminage", "1900017795", "N°s cde client", "1100755660,1100757055"]]),
            tableau(&[&["Version n°", "Date", "Modifié par"], &["V3", "29-06-2026 15:10", "X"]]),
            p("Commande de laminage"),
            tableau(&[
                &["Commande", "Poste", "Profil", "Longueur", "Nuance", "Poids kg", "Nombre", "Usine", "Date laminage", "US"],
                &["1900017795", "1", "HD400X347", "12500", "S460M", "17 799.60", "2", "Grey", "06.06.26", "Yes"],
                &["1900017795", "2", "HD400X347", "0", "S460M", "0.00", "0", "‘", "", "No"],
            ]),
            p("Commande client"),
            tableau(&[&["Commande", "Poste", "Profil", "Longueur", "Nuance", "Poste lam", "Nombre", "Remarques/délais"]]),
            p("Routage"),
            tableau(&[&["", "", "", "", "Délai actuel"], &["", "Prégrenaillage", "Kleinlux", ""]]),
            p("Plans BPE Type d’affaire\u{a0}: Autre"),
            tableau(&[&["Transmis", "No"]]),
            p("Type de poutre\u{a0}: -"),
            p("Opérations à prévoir\u{a0}:"),
            tableau(&[&["Contre flèche Axe fort"], &["Coupe droite"], &["Coupe biaise"], &["Fers-T"], &["Inconnue"]]),
            p("Montage à blanc\u{a0}: No Lieu :"),
            p("Accessoires :"),
            tableau(&[&["Eclisses"]]),
            p("Couper une extrémité à 90°"),
            p("Traitement de surface"),
            p("Opérations :"),
            tableau(&[&["Grenaillage"], &["Peinture"]]),
            p("Détails peinture"),
            tableau(&[&["RAL", "RAL7040"]]),
            p("Remarques: SA 2,5"),
            p("Exigences normatives"),
            tableau(&[
                &["Exigences de réparation suivant", "EN10163-3: 2004, Cl. C,S-Cl. 1"],
                &["Classe d’exécution selon EN 1090", "EXC3"],
                &["Classe de tolérance selon EN 1090", "Tolérances client"],
                &["Type de traçabilité", "Suivant EN 1090 et Classe EXC"],
                &["Degré de préparation selon EN 8501-3", "P3 aile inférieure"],
                &["Exigence(s) particulière(s)\u{a0}acier", "DBS"],
                &["Exigence(s) particulière(s) fabrication", "-"],
                &["Commentaire\u{a0}: 2/3 de la norme"],
            ]),
            p("Modifications"),
            tableau(&[&["Champ", "Ancienne valeur", "Nouvelle valeur"], &["Remarques2", "a", "b"]]),
        ]
        .concat());
        let rde = extraire(&blocs_document(&xml).unwrap()).unwrap();
        assert_eq!(rde.date.as_deref(), Some("2025-11-20"));
        assert_eq!(rde.projet.as_deref(), Some("Pont de test"));
        assert_eq!(rde.offre.as_deref(), Some("5122CH25"));
        assert_eq!(rde.client.as_deref(), Some("Spaeter AG"));
        assert_eq!(rde.cde_laminage.as_deref(), Some("1900017795"));
        assert_eq!(rde.affaire.as_deref(), Some("1100755660"));
        assert_eq!(rde.autres_affaires, vec!["1100757055"]);
        assert_eq!(rde.version.as_deref(), Some("V3"));
        assert_eq!(rde.date_version.as_deref(), Some("2026-06-29 15:10"));
        assert_eq!(rde.laminage.len(), 1);
        assert_eq!(rde.laminage[0].profil, "HD400X347");
        assert_eq!(rde.laminage[0].poids_kg, Some(17799.6));
        assert_eq!(rde.laminage[0].date_laminage.as_deref(), Some("2026-06-06"));
        assert_eq!(rde.classe_us.as_deref(), Some(US_SANS_CLASSE));
        assert_eq!(rde.type_affaire.as_deref(), Some("autre"));
        assert_eq!(rde.type_poutre.as_deref(), Some("Fer T"));
        let cles: Vec<&str> = rde.operations.iter().map(|(c, _)| c.as_str()).collect();
        assert_eq!(cles, vec!["contre_fleche", "cfl_axe_fort", "coupe", "coupe_droite", "coupe_biaise"]);
        assert_eq!(rde.accessoires, vec!["Eclisses"]);
        assert_eq!(rde.traitements, vec!["Prégrenaillage", "Grenaillage", "Peinture"]);
        assert_eq!(rde.traitement_surface.as_deref(), Some("oui"));
        assert_eq!(rde.remarques.as_deref(), Some("Couper une extrémité à 90°\nSA 2,5\n2/3 de la norme"));
        assert_eq!(rde.exc.as_deref(), Some("EXC3"));
        assert_eq!(rde.tolerance.as_deref(), Some("tolérances client"));
        assert_eq!(rde.prep_en8501.as_deref(), Some("P3 aile inferieure"));
        assert_eq!(rde.exigences_acier, vec!["DBS"]);
        assert_eq!(rde.exigence_fabrication, None);
    }

    #[test]
    fn autre_document_word() {
        let xml = document(&[p("Schweissplan"), tableau(&[&["Champ", "Valeur"]])].concat());
        assert!(extraire(&blocs_document(&xml).unwrap()).is_none());
    }

    const RDE_TEREX: &str = "../../COMMANDES FINIES/1a COMMANDES FINIES 2026/1100752651 TEREX NOELL/5501ST26 - Hofmann-Rieg + Terex Noell - HE 600 B Crane Girders_V2_2026-09-04T08_34_16.8039368Z.docx";

    #[test]
    fn rde_reel_terex() {
        if !Path::new(RDE_TEREX).exists() {
            return;
        }
        assert!(est_un_rde(Path::new(RDE_TEREX)));
        let rde = extraire_rde(RDE_TEREX).unwrap().unwrap();
        assert_eq!(rde.date.as_deref(), Some("2026-04-17"));
        assert_eq!(rde.projet.as_deref(), Some("5501ST26 - Hofmann-Rieg + Terex Noell - HE 600 B Crane Girders"));
        assert_eq!(rde.offre.as_deref(), Some("5501ST26"));
        assert_eq!(rde.client.as_deref(), Some("Hofmann-Rieg Stahlhandel GmbH"));
        assert_eq!(rde.cde_laminage.as_deref(), Some("1900017798"));
        assert_eq!(rde.affaire.as_deref(), Some("1100752651"));
        assert_eq!(rde.version.as_deref(), Some("V2"));
        assert_eq!(rde.date_version.as_deref(), Some("2026-09-04 10:33"));
        assert_eq!(rde.laminage.len(), 1);
        assert_eq!(rde.laminage[0].profil, "HE600B");
        assert_eq!(rde.laminage[0].longueur, Some(12500.0));
        assert_eq!(rde.laminage[0].poids_kg, Some(212000.0));
        assert_eq!(rde.laminage[0].nombre, Some(80.0));
        assert_eq!(rde.laminage[0].usine.as_deref(), Some("Grey"));
        assert_eq!(rde.laminage[0].date_laminage.as_deref(), Some("2026-06-06"));
        assert_eq!(rde.type_affaire.as_deref(), Some("Chemin de roulement"));
        let cles: Vec<&str> = rde.operations.iter().map(|(c, _)| c.as_str()).collect();
        assert_eq!(cles, vec!["double_redressage", "coupe", "coupe_droite"]);
        assert_eq!(rde.traitement_surface.as_deref(), Some("non"));
        assert_eq!(rde.exc.as_deref(), Some("EXC2"));
        assert_eq!(rde.tolerance.as_deref(), Some("tolérances client"));
        assert_eq!(rde.prep_en8501.as_deref(), Some("P1"));
        assert_eq!(
            rde.remarques.as_deref(),
            Some("Couper une extrité à 90°+Coupe à la longueur de 12 barres\n2/3 de la norme rect.+ équ.")
        );
    }
}
