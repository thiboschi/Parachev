//! Quantités de goujons et de trous citées dans le texte des mails d'une
//! affaire -- source d'appoint quand la fiche (FC-GOUJ, FC FMAN) n'est pas
//! remplie.
//!
//! Goujons : les commandes de goujons passées par mail donnent la
//! spécification et le besoin réel, la quantité commandée incluant une
//! réserve : "13000 goujons Ø22x175 (503079) (besoin 12324 goujons)",
//! "2400 goujons Ø25x200 (besoin +/- 1984 goujons...)", ou un total
//! "total number of studs 2442 pcs".
//!
//! Trous : "8 Bohrungen Ø18", "32 Ø 26 mm ... par support", "4xØ20",
//! "Ø40mm / 40 drilling per beam end". L'unité (total, par poutre, par
//! extrémité, par appui) est relevée quand elle suit la mention ; ces
//! mentions sont gardées pour vérification, pas consolidées (l'unité et le
//! nombre de poutres concernées restent souvent ambigus).
//!
//! Les fils de mails citent les messages précédents : une même mention
//! revient dans plusieurs mails, la consolidation (quantites.rs) garde la
//! plus récente par spécification.

use regex::Regex;
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq)]
pub struct MentionQuantite {
    /// "goujons" ou "trous".
    pub nature: &'static str,
    pub diametre: Option<f64>,
    /// Longueur du goujon (Ø22x175 -> 175).
    pub hauteur: Option<f64>,
    pub nombre: f64,
    /// Goujons : `nombre` est le besoin réel (sinon la quantité commandée,
    /// réserve comprise).
    pub besoin: bool,
    /// "total", "poutre", "extremite" ou "appui".
    pub unite: &'static str,
    /// Texte autour de la mention, pour vérification.
    pub extrait: String,
    /// Position dans le mail : plus elle est petite, plus le message cité
    /// est récent (le fil est en ordre antichronologique).
    pub position: usize,
}

const MOTS_PERCAGE: &str = r"(?i)trous?\b|per[cç]ages?|forages?|bohrung|l[öo]cher|holes?\b|drilling|otw[oó]r";
const MOTS_GOUJON: &str = r"(?i)goujon|\bstuds?\b|kopfbolzen";

fn re(motif: &'static str, cellule: &'static OnceLock<Regex>) -> &'static Regex {
    cellule.get_or_init(|| Regex::new(motif).unwrap())
}

/// "13 000" / "2’442" / "1.984" -> 13000 / 2442 / 1984.
fn entier(texte: &str) -> Option<f64> {
    let chiffres: String = texte.chars().filter(char::is_ascii_digit).collect();
    chiffres.parse().ok()
}

/// Indice d'octet `n` caractères avant/après `i`, sur une frontière de caractère.
fn recul(texte: &str, i: usize, n: usize) -> usize {
    texte[..i].char_indices().rev().nth(n.saturating_sub(1)).map(|(j, _)| j).unwrap_or(0)
}

fn avance(texte: &str, i: usize, n: usize) -> usize {
    texte[i..].char_indices().nth(n).map(|(j, _)| i + j).unwrap_or(texte.len())
}

fn unite(suite: &str) -> &'static str {
    static EXTREMITE: OnceLock<Regex> = OnceLock::new();
    static POUTRE: OnceLock<Regex> = OnceLock::new();
    static APPUI: OnceLock<Regex> = OnceLock::new();
    if re(r"(?i)per beam end|par extr[ée]mit[ée]|pro tr[äa]gerende", &EXTREMITE).is_match(suite) {
        "extremite"
    } else if re(r"(?i)par (poutre|barre|pi[eè]ce)|per beam|pro (tr[äa]ger|st[üu]ck)|/\s*beam", &POUTRE).is_match(suite) {
        "poutre"
    } else if re(r"(?i)par (appui|support)|per support", &APPUI).is_match(suite) {
        "appui"
    } else {
        "total"
    }
}

fn goujons(texte: &str, mentions: &mut Vec<MentionQuantite>) {
    static SPEC: OnceLock<Regex> = OnceLock::new();
    static BESOIN: OnceLock<Regex> = OnceLock::new();
    static TOTAL: OnceLock<Regex> = OnceLock::new();
    static STOCK: OnceLock<Regex> = OnceLock::new();
    let spec = re(
        r"(?i)(\d[\d ’'.]{0,6}?)\s*(?:goujons?|studs?|kopfbolzen)\s*(?:de\s*)?[Øø⌀]?\s*(\d{2})\s*[x*×]\s*(\d{2,3})",
        &SPEC,
    );
    let besoin = re(r"(?i)besoin\s*(?:de\s*)?(?:\+/-\s*|env\.?\s*|~\s*)?(\d[\d ’'.]{0,6})", &BESOIN);
    let stock = re(r"(?i)\bstock\b", &STOCK);

    for c in spec.captures_iter(texte) {
        let m = c.get(0).unwrap();
        let debut = recul(texte, m.start(), 60);
        if stock.is_match(&texte[debut..m.end()]) {
            continue; // goujons en stock, pas un besoin de l'affaire
        }
        // Le besoin suit la spécification, avant la puce suivante.
        let fin_suite = avance(texte, m.end(), 160);
        let suite = &texte[m.end()..fin_suite];
        let suite = &suite[..suite.find(['•', '*']).unwrap_or(suite.len())];
        let quantite_besoin = besoin.captures(suite).and_then(|b| entier(&b[1]));
        let Some(nombre) = quantite_besoin.or_else(|| entier(&c[1])) else { continue };
        if !(0.0..100_000.0).contains(&nombre) || nombre == 0.0 {
            continue;
        }
        mentions.push(MentionQuantite {
            nature: "goujons",
            diametre: c[2].parse().ok(),
            hauteur: c[3].parse().ok(),
            nombre,
            besoin: quantite_besoin.is_some(),
            unite: "total",
            extrait: texte[debut..avance(texte, m.end(), 80)].to_string(),
            position: m.start(),
        });
    }

    let total = re(r"(?i)total number of studs\s*:?\s*(\d[\d ’'.]{0,6})", &TOTAL);
    for c in total.captures_iter(texte) {
        let m = c.get(0).unwrap();
        if let Some(nombre) = entier(&c[1]).filter(|n| *n > 0.0) {
            mentions.push(MentionQuantite {
                nature: "goujons",
                diametre: None,
                hauteur: None,
                nombre,
                besoin: true,
                unite: "total",
                extrait: texte[recul(texte, m.start(), 60)..avance(texte, m.end(), 80)].to_string(),
                position: m.start(),
            });
        }
    }
}

fn trous(texte: &str, mentions: &mut Vec<MentionQuantite>) {
    static NOMBRE_PUIS_DIAM: OnceLock<Regex> = OnceLock::new();
    static DIAM_PUIS_NOMBRE: OnceLock<Regex> = OnceLock::new();
    static PERCAGE: OnceLock<Regex> = OnceLock::new();
    static GOUJON: OnceLock<Regex> = OnceLock::new();
    let nombre_puis_diam = re(
        r"(?i)(?:^|[^\d.,])(\d{1,5})\s*[x×]?\s*(?:(?:trous?|per[cç]ages?|forages?|bohrungen?|l[öo]cher|holes?|drillings?)\s*(?:de\s*|mit\s*(?:einem\s*)?)?)?(?:[Øø⌀]|diam[eè]tre|durchmesser|dia\.?)\s*(\d{2,3})(?:[.,]\d+)?\s*(?:mm)?",
        &NOMBRE_PUIS_DIAM,
    );
    let diam_puis_nombre = re(
        r"(?i)[Øø⌀]\s*(\d{2,3})\s*(?:mm)?\s*(?:/\s*web\s*)?[/(]\s*(\d{1,5})\s*(?:x\s*)?(?:drillings?\s*)?(per [a-z ]{3,20})",
        &DIAM_PUIS_NOMBRE,
    );
    let percage = re(MOTS_PERCAGE, &PERCAGE);
    let goujon = re(MOTS_GOUJON, &GOUJON);

    let mut ajouter = |debut: usize, fin: usize, nombre: &str, diametre: &str| {
        let (Some(nombre), Ok(diametre)) = (entier(nombre), diametre.parse::<f64>()) else { return };
        if nombre == 0.0 || nombre > 20_000.0 || !(10.0..=150.0).contains(&diametre) {
            return;
        }
        let contexte = &texte[recul(texte, debut, 90)..fin];
        if !percage.is_match(contexte) || goujon.is_match(&texte[recul(texte, debut, 25)..fin]) {
            return;
        }
        let suite = &texte[fin..avance(texte, fin, 45)];
        mentions.push(MentionQuantite {
            nature: "trous",
            diametre: Some(diametre),
            hauteur: None,
            nombre,
            besoin: false,
            unite: unite(suite),
            extrait: texte[recul(texte, debut, 90)..avance(texte, fin, 45)].to_string(),
            position: debut,
        });
    };
    for c in nombre_puis_diam.captures_iter(texte) {
        let m = c.get(0).unwrap();
        ajouter(c.get(1).unwrap().start(), m.end(), &c[1], &c[2]);
    }
    for c in diam_puis_nombre.captures_iter(texte) {
        let m = c.get(0).unwrap();
        // L'unité est dans la mention elle-même ("per beam end").
        ajouter(m.start(), c.get(2).unwrap().end(), &c[2], &c[1]);
    }
}

/// Mentions de goujons et de trous dans un texte de mail (sujet + corps),
/// dans l'ordre du texte. Une mention répétée à l'identique dans le même
/// mail n'est gardée qu'une fois (la première, la plus récente).
pub fn extraire_quantites(texte: &str) -> Vec<MentionQuantite> {
    let plat = texte.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut mentions = Vec::new();
    goujons(&plat, &mut mentions);
    trous(&plat, &mut mentions);
    mentions.sort_by_key(|m| m.position);
    let mut uniques: Vec<MentionQuantite> = Vec::new();
    for m in mentions {
        if !uniques.iter().any(|u| {
            u.nature == m.nature && u.diametre == m.diametre && u.hauteur == m.hauteur && u.nombre == m.nombre && u.unite == m.unite
        }) {
            uniques.push(m);
        }
    }
    uniques
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resume(texte: &str) -> Vec<(&'static str, Option<f64>, Option<f64>, f64, bool, &'static str)> {
        extraire_quantites(texte)
            .into_iter()
            .map(|m| (m.nature, m.diametre, m.hauteur, m.nombre, m.besoin, m.unite))
            .collect()
    }

    #[test]
    fn commandes_de_goujons() {
        // Formulations réelles (Intercor MS-63.3, Himmel Papesch, Luszawa).
        assert_eq!(
            resume("Merci de bien vouloir commander : • 13000 goujons Ø22x175 (503079) (besoin 12324 goujons). Matière S235"),
            vec![("goujons", Some(22.0), Some(175.0), 12324.0, true, "total")]
        );
        assert_eq!(
            resume("* 500 goujons Ø22x250 (article 505603) (besoin 409 goujons, prévu 25% en plus) * 1625 goujons Ø22x300 (article 505926) (besoin 1301 goujons, prévu 25% en plus)"),
            vec![
                ("goujons", Some(22.0), Some(250.0), 409.0, true, "total"),
                ("goujons", Some(22.0), Some(300.0), 1301.0, true, "total"),
            ]
        );
        assert_eq!(
            resume("Studs are now ø25x150 and ø16x150mm – total number of studs 2442 pcs (initially foreseen 2640)"),
            vec![("goujons", None, None, 2442.0, true, "total")]
        );
        assert_eq!(resume("Merci de prévoir 144 goujons 16x150."), vec![("goujons", Some(16.0), Some(150.0), 144.0, false, "total")]);
    }

    #[test]
    fn goujons_en_stock_ignores() {
        assert!(resume("Il y a 1000 goujons de stock au para en Ø22x250.").is_empty());
        assert!(resume("On a 1000 goujons en stock Ø22x250").is_empty());
    }

    #[test]
    fn mentions_de_trous() {
        assert_eq!(
            resume("Wir gehen davon aus, dass 8 Bohrungen Ø18 auf der Position der Löcher"),
            vec![("trous", Some(18.0), None, 8.0, false, "total")]
        );
        assert_eq!(
            resume("Perçage d'env. 32 Ø 26 mm / 62 Ø 60 mm dans l'âme par support"),
            vec![
                ("trous", Some(26.0), None, 32.0, false, "appui"),
                ("trous", Some(60.0), None, 62.0, false, "appui"),
            ]
        );
        assert_eq!(
            resume("Drilling in the web: * Ø40mm / 40 drilling per beam end / rebars"),
            vec![("trous", Some(40.0), None, 40.0, false, "extremite")]
        );
        assert_eq!(
            resume("Das ergibt ca. 1600 Bohrungen Durchmesser 26 im Obergurt."),
            vec![("trous", Some(26.0), None, 1600.0, false, "total")]
        );
    }

    #[test]
    fn diametres_de_goujons_pas_des_trous() {
        // "goujons Ø22" ne doit pas être compté comme 22 trous.
        assert!(resume("Pour les goujons Ø22 le perçage n'est pas prévu").iter().all(|m| m.0 == "goujons"));
        // Référence/date avant un diamètre : pas de trou.
        assert!(resume("plan 1100729147 Ø35 sans perçage").is_empty());
    }
}
