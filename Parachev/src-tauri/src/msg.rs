//! Lecture des e-mails Outlook (.msg) : certaines variables de fabrication
//! (nb de trous, diamètre) sont communiquées par mail au lieu d'être
//! saisies dans l'Excel de l'affaire.
//!
//! Deux sources dans un mail : les pièces jointes (traitées comme des
//! fichiers normaux par le watcher, voir watcher::traiter_msg) et le corps,
//! analysé ici par regex. Extraction volontairement tolérante : un motif non
//! reconnu est loggé, jamais une erreur.

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

/// Variables trouvées dans le texte d'un mail. `affaire` (n° 11xxxxxxxx)
/// est indispensable pour rattacher les valeurs à une ligne de
/// variables_affaires.
#[derive(Debug, Default, PartialEq)]
pub struct VariablesMail {
    pub affaire: Option<String>,
    pub nb_trous_manuel: Option<f64>,
    pub diametre_moyen_numerique: Option<f64>,
}

impl VariablesMail {
    fn a_des_valeurs(&self) -> bool {
        self.nb_trous_manuel.is_some() || self.diametre_moyen_numerique.is_some()
    }
}

pub fn load_msg(path: &Path) -> Result<ParsedMsg, String> {
    let outlook = Outlook::from_path(path).map_err(|e| format!("msg illisible: {e:?}"))?;

    let attachments = outlook
        .attachments
        .iter()
        .filter(|a| !a.payload_bytes.is_empty())
        .map(|a| {
            let filename = [&a.long_file_name, &a.file_name, &a.display_name]
                .into_iter()
                .find(|n| !n.is_empty())
                .cloned()
                .unwrap_or_else(|| "piece_jointe".to_string());
            MsgAttachment {
                filename,
                bytes: a.payload_bytes.clone(),
            }
        })
        .collect();

    Ok(ParsedMsg {
        subject: outlook.subject,
        body_text: outlook.body,
        attachments,
    })
}

/// Extrait n° d'affaire et variables du sujet + corps du mail.
pub fn extraire_variables_depuis_texte(sujet: &str, corps: &str) -> VariablesMail {
    let texte = format!("{sujet}\n{corps}");
    let mut vars = VariablesMail::default();

    // Affaire : 10 chiffres commençant par 11 (les n° de plan commencent par 19).
    let re_affaire = Regex::new(r"\b(11\d{8})\b").unwrap();
    vars.affaire = re_affaire.captures(&texte).map(|c| c[1].to_string());

    // "12 trous", "10x trous", "nombre de trous : 8"
    let re_nb_trous =
        Regex::new(r"(?i)(?:(\d+)\s*(?:x\s*)?trous?|nombre\s+de\s+trous?\s*:?\s*(\d+))").unwrap();
    if let Some(c) = re_nb_trous.captures(&texte) {
        vars.nb_trous_manuel = c
            .get(1)
            .or_else(|| c.get(2))
            .and_then(|m| m.as_str().parse::<f64>().ok());
    }

    // "Ø10", "diamètre 8.5", "diametre: 8,5mm"
    let re_diametre = Regex::new(r"(?i)(?:Ø|diam[eè]tre\s*:?\s*)\s*(\d+(?:[.,]\d+)?)").unwrap();
    if let Some(c) = re_diametre.captures(&texte) {
        vars.diametre_moyen_numerique = c[1].replace(',', ".").parse::<f64>().ok();
    }

    if !vars.a_des_valeurs() {
        let extrait: String = corps.chars().take(200).collect();
        eprintln!("Aucune variable extraite du corps du mail, phrasé à vérifier : {extrait}");
    }
    vars
}

/// Met à jour l'affaire existante avec les valeurs du mail. On ne crée pas
/// de ligne : sans l'Excel, nb_barres etc. seraient inconnus. Retourne
/// l'affaire mise à jour, ou None s'il n'y avait rien à appliquer.
pub fn appliquer_variables_mail(conn: &Connection, vars: &VariablesMail) -> Result<Option<String>, String> {
    let Some(affaire) = &vars.affaire else {
        eprintln!("Mail sans n° d'affaire (11xxxxxxxx), variables du corps ignorées");
        return Ok(None);
    };
    if !vars.a_des_valeurs() {
        return Ok(None);
    }
    let n = conn
        .execute(
            "UPDATE variables_affaires SET
                nb_trous_manuel = COALESCE(?2, nb_trous_manuel),
                diametre_moyen_numerique = COALESCE(?3, diametre_moyen_numerique)
             WHERE affaire = ?1",
            params![affaire, vars.nb_trous_manuel, vars.diametre_moyen_numerique],
        )
        .map_err(|e| format!("Erreur mise à jour variables_affaires: {e}"))?;
    if n == 0 {
        eprintln!("Affaire {affaire} inconnue de variables_affaires (Excel pas encore traité), mail ignoré");
        return Ok(None);
    }
    Ok(Some(affaire.clone()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extrait_affaire_trous_et_diametre() {
        let v = extraire_variables_depuis_texte(
            "Affaire 1100546190",
            "Il faut prévoir 12 trous Ø10mm. Plan 1900016822.",
        );
        assert_eq!(v.affaire.as_deref(), Some("1100546190"));
        assert_eq!(v.nb_trous_manuel, Some(12.0));
        assert_eq!(v.diametre_moyen_numerique, Some(10.0));
    }

    #[test]
    fn diametre_virgule_et_nombre_de_trous() {
        let v = extraire_variables_depuis_texte("", "nombre de trous : 8, diamètre 8,5mm");
        assert_eq!(v.nb_trous_manuel, Some(8.0));
        assert_eq!(v.diametre_moyen_numerique, Some(8.5));
    }

    #[test]
    fn rien_a_extraire() {
        let v = extraire_variables_depuis_texte("", "Bonjour, voir fichier joint.");
        assert_eq!(v, VariablesMail::default());
    }
}
