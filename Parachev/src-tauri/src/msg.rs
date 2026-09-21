//! Lecture des e-mails Outlook (.msg) de demande de prix ArcelorMittal
//! (réf. du type "5301ST26") : profils, quantités, longueurs, parachèvements
//! demandés et estimation éventuelle (heures / €). Stockés dans
//! `demandes_mail` / `demandes_mail_lignes`, indépendamment des affaires.
//!
//! Les mails sont des transferts en chaîne (Fwd/RE) : le message le plus
//! récent est en tête, les anciens sont cités dessous. Deux formats de
//! lignes sont reconnus : phrase ("12x HEB 1000 L = 20950mm", "12 pcs
//! HE 1000 B à 20'950 mm") ou tableau (Profil / Qualité / Pcs / L mm,
//! une cellule par ligne une fois le HTML aplati).

use msg_parser::Outlook;
use regex::Regex;
use rusqlite::{params, Connection};
use std::path::Path;

#[derive(Debug)]
pub struct ParsedMsg {
    pub subject: String,
    pub body_text: String,
    pub attachments: Vec<MsgAttachment>,
}

#[derive(Debug)]
pub struct MsgAttachment {
    pub filename: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LigneDemande {
    pub profil: String,
    pub longueur: f64,
    pub nb_barres: f64,
}

#[derive(Debug, Default, PartialEq)]
pub struct DemandeMail {
    pub reference: Option<String>,
    pub lignes: Vec<LigneDemande>,
    pub coupe: bool,
    pub contre_fleche: bool,
    pub contre_fleche_mm: Option<f64>,
    pub heures_estimees: Option<f64>,
    pub prix_estime: Option<f64>,
}

pub fn load_msg(path: &Path) -> Result<ParsedMsg, String> {
    let outlook = Outlook::from_path(path).map_err(|e| format!("msg illisible: {e:?}"))?;

    let attachments = outlook
        .attachments
        .iter()
        .filter(|a| !a.payload_bytes.is_empty())
        .filter_map(|a| {
            let filename = [&a.long_file_name, &a.file_name, &a.display_name]
                .into_iter()
                .map(|n| n.trim_end_matches('\0').trim())
                .find(|n| !n.is_empty())?
                .to_string();
            Some(MsgAttachment { filename, bytes: a.payload_bytes.clone() })
        })
        .collect();

    // Le corps HTML est fourni encodé en hexadécimal par msg_parser.
    let corps = if !outlook.body.trim().is_empty() {
        outlook.body.clone()
    } else {
        html_vers_texte(&decoder_hex_si_besoin(&outlook.html))
    };

    Ok(ParsedMsg {
        subject: outlook.subject.trim_end_matches('\0').trim().to_string(),
        body_text: corps,
        attachments,
    })
}

fn decoder_hex_si_besoin(s: &str) -> String {
    let s = s.trim();
    if s.len() % 2 != 0 || s.is_empty() || !s.bytes().all(|b| b.is_ascii_hexdigit()) {
        return s.to_string();
    }
    let octets: Vec<u8> = (0..s.len())
        .step_by(2)
        .filter_map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect();
    String::from_utf8_lossy(&octets).into_owned()
}

/// Aplatit le HTML : un saut de ligne par bloc/cellule, sauts de ligne
/// bruts du source traités comme des espaces.
fn html_vers_texte(html: &str) -> String {
    let re_bruit = Regex::new(r"(?is)<style\b.*?</style>|<head\b.*?</head>|<script\b.*?</script>").unwrap();
    let re_blocs = Regex::new(r"(?i)<br\s*/?>|</(p|div|tr|td|th|li|h\d|table)>").unwrap();
    let re_tags = Regex::new(r"<[^>]*>").unwrap();
    let re_num = Regex::new(r"&#(\d+);").unwrap();

    let s = html.replace(['\r', '\n', '\t'], " ");
    let s = re_bruit.replace_all(&s, "");
    let s = re_blocs.replace_all(&s, "\n");
    let s = re_tags.replace_all(&s, "");
    let s = re_num.replace_all(&s, |c: &regex::Captures| {
        c[1].parse::<u32>().ok().and_then(char::from_u32).map(String::from).unwrap_or_default()
    });
    let s = s
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&rsquo;", "’")
        .replace("&euro;", "€")
        .replace("&amp;", "&");
    s.lines()
        .map(|l| l.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

const PROFIL: &str = r"(?:HE\s*(?:[ABM]{1,2})\s*\d{3,4}|HE\s*\d{3,4}\s*[ABM]{1,2}|(?:IPE|IPN|UPN|HD|HL)\s*\d{2,4})";

/// "HE 300 B" / "HEB 300" / "HE300B" -> "HEB 300".
fn normaliser_profil(brut: &str) -> String {
    let s: String = brut.chars().filter(|c| !c.is_whitespace()).collect::<String>().to_uppercase();
    if let Some(r) = s.strip_prefix("HE") {
        let lettres: String = r.chars().filter(|c| c.is_ascii_alphabetic()).collect();
        let chiffres: String = r.chars().filter(|c| c.is_ascii_digit()).collect();
        return format!("HE{lettres} {chiffres}");
    }
    let i = s.find(|c: char| c.is_ascii_digit()).unwrap_or(s.len());
    format!("{} {}", &s[..i], &s[i..])
}

fn nombre(s: &str) -> Option<f64> {
    let net: String = s.chars().filter(|c| c.is_ascii_digit() || *c == '.' || *c == ',').collect();
    net.replace(',', ".").parse().ok()
}

fn fusionner(lignes: Vec<LigneDemande>) -> Vec<LigneDemande> {
    let mut res: Vec<LigneDemande> = Vec::new();
    for l in lignes {
        match res.iter_mut().find(|r| r.profil == l.profil && r.longueur == l.longueur) {
            Some(r) => r.nb_barres += l.nb_barres,
            None => res.push(l),
        }
    }
    res
}

fn lignes_tableau(texte: &str) -> Vec<LigneDemande> {
    let re_profil = Regex::new(&format!(r"(?i)^{PROFIL}$")).unwrap();
    let re_qualite = Regex::new(r"^S\d{3}[A-Z0-9+/]*$").unwrap();
    let re_entier = Regex::new(r"^\d+$").unwrap();
    let re_long = Regex::new(r"^\d[\d’' .]*$").unwrap();
    let l: Vec<&str> = texte.lines().map(str::trim).collect();
    let mut res = Vec::new();
    let mut i = 0;
    while i + 3 < l.len() {
        if re_profil.is_match(l[i]) && re_qualite.is_match(l[i + 1]) && re_entier.is_match(l[i + 2]) && re_long.is_match(l[i + 3]) {
            if let (Some(nb), Some(long)) = (nombre(l[i + 2]), nombre(l[i + 3])) {
                res.push(LigneDemande { profil: normaliser_profil(l[i]), longueur: long, nb_barres: nb });
            }
            i += 4;
        } else {
            i += 1;
        }
    }
    res
}

fn lignes_phrases(texte: &str) -> Vec<LigneDemande> {
    let re = Regex::new(&format!(
        r"(?i)(\d+)\s*(?:x|pcs|pc|pi[eè]ces?|st[uü]ck)\s*({PROFIL})\D{{0,40}}?(\d[\d’' ]*\d)\s*mm"
    ))
    .unwrap();
    let plat = texte.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut vues: Vec<LigneDemande> = Vec::new();
    for c in re.captures_iter(&plat) {
        if let (Some(nb), Some(long)) = (nombre(&c[1]), nombre(&c[3])) {
            let l = LigneDemande { profil: normaliser_profil(&c[2]), longueur: long, nb_barres: nb };
            // La même demande est citée plusieurs fois dans la chaîne.
            if !vues.contains(&l) {
                vues.push(l);
            }
        }
    }
    vues
}

pub fn extraire_demande(sujet: &str, corps: &str) -> DemandeMail {
    let texte = format!("{sujet}\n{corps}");
    let mut d = DemandeMail::default();

    let re_ref = Regex::new(r"(?i)\b(\d{4}[A-Z]{2}\d{2})\b").unwrap();
    d.reference = re_ref.captures(&texte).map(|c| c[1].to_uppercase());

    let tableau = lignes_tableau(&texte);
    d.lignes = fusionner(if tableau.is_empty() { lignes_phrases(&texte) } else { tableau });

    let bas = texte.to_lowercase();
    d.coupe = bas.contains("coupe");
    let plat = texte.split_whitespace().collect::<Vec<_>>().join(" ");
    let re_cf = Regex::new(r"(?i)(?:fl[eè]che|\bCF|[Δ∆]f|[uü]berh[oö]hung)\D{0,30}?(\d+)\s*mm").unwrap();
    d.contre_fleche_mm = re_cf.captures(&plat).and_then(|c| nombre(&c[1]));
    d.contre_fleche = d.contre_fleche_mm.is_some() || bas.contains("flèche") || bas.contains("fleche");

    let re_h = Regex::new(r"(?i)(\d[\d’' ]*)\s*heures?\b").unwrap();
    d.heures_estimees = re_h.captures(&plat).and_then(|c| nombre(&c[1]));
    let re_prix = Regex::new(r"(\d[\d’' .]*)\s*€").unwrap();
    d.prix_estime = re_prix.captures(&plat).and_then(|c| nombre(&c[1]));

    if d.lignes.is_empty() {
        eprintln!("Aucune ligne profil/longueur reconnue dans le mail {:?}", d.reference);
    }
    d
}

/// Enregistre (remplace) la demande. Retourne la référence, ou None si le
/// mail n'a pas de référence ou aucune ligne exploitable.
pub fn enregistrer_demande(conn: &mut Connection, sujet: &str, d: &DemandeMail) -> Result<Option<String>, String> {
    let Some(reference) = &d.reference else {
        eprintln!("Mail {sujet:?} sans référence (ex. 5301ST26), ignoré");
        return Ok(None);
    };
    if d.lignes.is_empty() {
        return Ok(None);
    }
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS demandes_mail (
            reference TEXT PRIMARY KEY, sujet TEXT, coupe INTEGER, contre_fleche INTEGER,
            contre_fleche_mm REAL, heures_estimees REAL, prix_estime REAL
        );
        CREATE TABLE IF NOT EXISTS demandes_mail_lignes (
            reference TEXT NOT NULL, profil TEXT NOT NULL, longueur REAL NOT NULL,
            nb_barres REAL NOT NULL, PRIMARY KEY (reference, profil, longueur)
        );",
    )
    .map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM demandes_mail_lignes WHERE reference = ?1", params![reference])
        .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT OR REPLACE INTO demandes_mail
            (reference, sujet, coupe, contre_fleche, contre_fleche_mm, heures_estimees, prix_estime)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![reference, sujet, d.coupe, d.contre_fleche, d.contre_fleche_mm, d.heures_estimees, d.prix_estime],
    )
    .map_err(|e| e.to_string())?;
    for l in &d.lignes {
        tx.execute(
            "INSERT INTO demandes_mail_lignes (reference, profil, longueur, nb_barres) VALUES (?1, ?2, ?3, ?4)",
            params![reference, l.profil, l.longueur, l.nb_barres],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(Some(reference.clone()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reference_format_0000aa00() {
        let d = extraire_demande("RE: 5102at26 info", "");
        assert_eq!(d.reference.as_deref(), Some("5102AT26"));
        assert_eq!(extraire_demande("Plan 1900016822", "").reference, None);
    }
}
