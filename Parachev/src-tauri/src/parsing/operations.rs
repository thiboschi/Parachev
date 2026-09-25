//! Vocabulaire commun des machines / opérations, partagé entre les trois
//! sources qui les décrivent chacune à leur façon :
//! - la fiche PREVI (postes A-D : "PRESSE NR", "SCIE COMBI VOORTMAN"...),
//! - la feuille SUIVI (une colonne datée par opération : "F.NUM", "GOUJ"...),
//! - le RDE (cases cochées : "Soudage", "Goujonnage", "Biaise"...).
//!
//! Les libellés de fiche/SUIVI sont ramenés aux clés de poste ERP (voir
//! erp::normaliser_poste) pour rester comparables aux heures pointées, plus
//! trois clés sans équivalent ERP issues du "Flux de production BFC"
//! (ébavurage/meulage, contrôle visuel/géométrique, montage à blanc).
//! Les cases du RDE gardent leur propre vocabulaire (opérations demandées
//! par le client, plus fines qu'un poste : coupe biaise, oblong...).

/// Majuscules sans accents, espaces multiples réduits -- les libellés sont
/// saisis à la main et varient ("CONTRÔLE" / "CONTROLE", "F.NUM" / "F-NUM").
pub fn normaliser(libelle: &str) -> String {
    let sans_accents: String = libelle
        .chars()
        .map(|c| match c {
            'à' | 'â' | 'ä' | 'á' | 'À' | 'Â' | 'Ä' | 'Á' => 'A',
            'é' | 'è' | 'ê' | 'ë' | 'É' | 'È' | 'Ê' | 'Ë' => 'E',
            'î' | 'ï' | 'í' | 'Î' | 'Ï' | 'Í' => 'I',
            'ô' | 'ö' | 'ó' | 'Ô' | 'Ö' | 'Ó' => 'O',
            'ù' | 'û' | 'ü' | 'ú' | 'Ù' | 'Û' | 'Ü' | 'Ú' => 'U',
            'ç' | 'Ç' => 'C',
            c => c,
        })
        .collect();
    sans_accents
        .to_uppercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Mots (alphanumériques) d'un libellé normalisé -- pour tester "US",
/// "NR", "MT"... comme mots entiers et non comme sous-chaînes.
fn mots(n: &str) -> Vec<&str> {
    n.split(|c: char| !c.is_alphanumeric()).filter(|m| !m.is_empty()).collect()
}

/// Colonnes de SUIVI qui tracent la logistique (chargement camion/wagon,
/// zone de stockage) et non une opération de production -- leurs dates
/// servent de date d'expédition, pas de "machine utilisée".
pub fn est_logistique(libelle: &str) -> bool {
    let n = normaliser(libelle);
    mots(&n).iter().any(|m| {
        matches!(
            *m,
            "LKW" | "WAGON" | "CAMION" | "HALLE" | "QUAI" | "PARC" | "BATEAU" | "DATE" | "CHARGEMENT"
                | "EXPEDITION" | "WALLERICH"
        )
    })
}

/// Postes (clés ERP, plus `ebavurage_meulage`/`controle`/`montage_blanc`)
/// correspondant à un libellé de poste de fiche PREVI ou de colonne SUIVI.
/// Un libellé peut désigner plusieurs postes (machine combinée "COMBI
/// SCIE + FOR." -> sciage ET forage numérique). Vide si non reconnu.
pub fn postes_depuis_libelle(libelle: &str) -> Vec<&'static str> {
    let n = normaliser(libelle);
    let m = mots(&n);
    let a_mot = |x: &str| m.iter().any(|w| *w == x);
    let mut postes: Vec<&'static str> = Vec::new();
    let mut ajouter = |p: &'static str| {
        if !postes.contains(&p) {
            postes.push(p);
        }
    };

    let forage = n.contains("FOR") || n.contains("F.") || n.contains("F-") || n.starts_with('F');
    if n.contains("COMBI") || (n.contains("SCIE") && n.contains("FOR")) {
        ajouter("mise_a_longueur");
        ajouter("forage_numerique");
    }
    if n.contains("SCIE") || n.contains("SCIAGE") {
        ajouter("mise_a_longueur");
    }
    if n.contains("FNUM") || (forage && n.contains("NUM")) {
        ajouter("forage_numerique");
    }
    if n.contains("FMAN") || (forage && a_mot("MAN")) || n.contains("FOR.MAN") || n.contains("FOR MAN") {
        ajouter("forage_manuel");
    }
    if n.contains("PRESSE") || n.contains("REDRESS") || n.contains("CINTR") || a_mot("NR") || (a_mot("CFL") && !n.contains("FOR")) {
        ajouter("presse_cintrage");
    }
    if n.contains("ROBOT") {
        ajouter("robot");
    }
    if n.contains("OXY") || n.contains("KOIKE") {
        ajouter("oxycoupage");
    }
    if n.contains("SOUS FLUX") {
        ajouter("soudage_sous_flux");
    } else if n.contains("SOUD") {
        ajouter("soudage");
    }
    if n.contains("GOUJ") {
        ajouter("goujonnage");
    }
    if n.contains("ASSEM") {
        ajouter("assemblage_tracage");
    }
    if a_mot("P3") || n.contains("FINITION") || n.contains("ARETE") {
        ajouter("p3");
    }
    if n.contains("EBAVUR") || n.contains("MEULAGE") {
        ajouter("ebavurage_meulage");
    }
    if n.contains("RESSUAGE") || n.contains("CND") || n.contains("U.S") || ["US", "MT", "PT", "VT"].iter().any(|x| a_mot(x)) {
        ajouter("controle_cnd");
    }
    if n.contains("CTR") || n.contains("CONTR") || n.contains("VISUEL") || n.contains("GEOM") {
        ajouter("controle");
    }
    if n.contains("MONTAGE") {
        ajouter("montage_blanc");
    }
    if n.contains("MANUTENTION") {
        ajouter("manutention");
    }
    postes
}

/// Clé d'une case "Opérations de fabrication" du RDE (feuille parachèvement).
/// None pour un libellé qui n'est pas une case connue (ex. "Type poutre:").
pub fn operation_rde(libelle: &str) -> Option<&'static str> {
    let n = normaliser(libelle);
    let n = n.trim_end_matches(':').trim();
    Some(match n {
        "COUPE" => "coupe",
        "DROITE, 90°" | "DROITE 90°" | "DROITE" => "coupe_droite",
        "BIAISE" => "coupe_biaise",
        "OUVERTURE D'AME" => "ouverture_ame",
        "PERCAGE" => "percage",
        "OBLONG" => "oblong",
        "GRUGEAGE" => "grugeage",
        "PREPARATION BORD" => "preparation_bord",
        "CONTRE-FLECHE" | "CONTRE FLECHE" => "contre_fleche",
        "AXE FORT" => "cfl_axe_fort",
        "AXE FAIBLE" => "cfl_axe_faible",
        "DOUBLE REDRESSAGE" => "double_redressage",
        "ASSEMBLAGE" => "assemblage",
        "SOUDAGE" => "soudage",
        "GOUJONNAGE" => "goujonnage",
        "USINAGE DES TETES" => "usinage_tetes",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn libelles_de_fiche_et_de_suivi() {
        // Libellés réels relevés dans les fiches PREVI / feuilles SUIVI
        // du dossier "1a COMMANDES FINIES 2025".
        assert_eq!(postes_depuis_libelle("PRESSE NR"), vec!["presse_cintrage"]);
        assert_eq!(postes_depuis_libelle("SCIE COMBI VOORTMAN"), vec!["mise_a_longueur", "forage_numerique"]);
        assert_eq!(postes_depuis_libelle("COMBI SCIE + FOR."), vec!["mise_a_longueur", "forage_numerique"]);
        assert_eq!(postes_depuis_libelle("FOR. NUM"), vec!["forage_numerique"]);
        assert_eq!(postes_depuis_libelle("F-NUM"), vec!["forage_numerique"]);
        assert_eq!(postes_depuis_libelle("F.NUM"), vec!["forage_numerique"]);
        assert_eq!(postes_depuis_libelle("FOR.MAN"), vec!["forage_manuel"]);
        assert_eq!(postes_depuis_libelle("F-MAN"), vec!["forage_manuel"]);
        assert_eq!(postes_depuis_libelle("FOR.NUM CFL"), vec!["forage_numerique"]);
        assert_eq!(postes_depuis_libelle("GOUJ"), vec!["goujonnage"]);
        assert_eq!(postes_depuis_libelle("SOUD CHUTE"), vec!["soudage"]);
        assert_eq!(postes_depuis_libelle("FINITION D'ARÊTES"), vec!["p3"]);
        assert_eq!(postes_depuis_libelle("EBAVURAGE ÂME 2È CÔTÉ"), vec!["ebavurage_meulage"]);
        assert_eq!(postes_depuis_libelle("CONTRÔLE SURFACE"), vec!["controle"]);
        assert_eq!(postes_depuis_libelle("US POUTRE"), vec!["controle_cnd"]);
        assert_eq!(postes_depuis_libelle("1/2 T  NR  1/2 T"), vec!["presse_cintrage"]);
        assert_eq!(postes_depuis_libelle("KOIKE"), vec!["oxycoupage"]);
        assert!(postes_depuis_libelle("KLEINLUX").is_empty());
    }

    #[test]
    fn colonnes_logistiques() {
        for l in ["LKW", "WAGON", "HALLE 4", "QUAI 3", "DATE"] {
            assert!(est_logistique(l), "{l}");
        }
        for l in ["SCIE", "PRESSE", "ROBOT"] {
            assert!(!est_logistique(l), "{l}");
        }
    }

    #[test]
    fn cases_rde() {
        assert_eq!(operation_rde("Droite, 90°"), Some("coupe_droite"));
        assert_eq!(operation_rde("Contre-flèche"), Some("contre_fleche"));
        assert_eq!(operation_rde("Ouverture d'âme"), Some("ouverture_ame"));
        assert_eq!(operation_rde("Usinage des têtes"), Some("usinage_tetes"));
        assert_eq!(operation_rde("Type poutre:"), None);
    }
}
