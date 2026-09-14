//! Extraction des infos principales depuis la feuille PREVI ("FICHE DE
//! PREVISIONS") : numéro de commande, client, nombre total de barres.
//!
//! Structure observée (confirmée sur 4 fichiers réels) :
//! - Une ligne d'en-tête où la colonne A vaut "COMMANDE", avec ensuite les
//!   colonnes NBR (ou "NBR FER-T"), PROFIL, LONG, TOTAL -- MAIS la position
//!   de ces colonnes varie d'un fichier à l'autre (décalage observé, et un
//!   fichier sans colonne NBR du tout). D'où une détection dynamique des
//!   colonnes par leur texte d'en-tête plutôt que des indices fixes.
//! - Une ou plusieurs lignes de données juste en dessous (une par groupe
//!   profil/longueur/lot), jusqu'à une ligne "TOTAL" en colonne A qui
//!   marque la fin du tableau.

use super::cellule_vers_texte;
use calamine::{open_workbook, DataType, Reader, Xlsx};

#[derive(Debug)]
pub struct InfoPrevi {
    pub commande: String,
    pub client: Option<String>,
    /// Profil du premier groupe barre/longueur de l'affaire (ex. "HEB 600").
    /// Simple résumé rapide à l'image de `commande`/`client` -- voir
    /// `groupes_profil` pour le détail complet quand l'affaire mélange
    /// plusieurs profils distincts.
    pub profil: Option<String>,
    /// N° de plan ArcelorMittal (ex. "1900016822", parfois avec suffixe
    /// "-NNNNN" pour une affaire à plusieurs plans). Toujours situé 2 lignes
    /// sous la première ligne de données, quel que soit le nombre de
    /// groupes profil/longueur réellement renseignés (confirmé sur les 4
    /// fichiers réels disponibles) -- identifié par son préfixe "19".
    pub numero_plan: Option<String>,
    pub nb_barres_total: f64,
    /// Répartition de nb_barres_total par profil distinct (ex. HEB 600:23,
    /// HEM 700:16 si l'affaire mélange plusieurs profils) -- les groupes
    /// partageant le même texte de profil (ex. deux longueurs différentes
    /// du même profil) sont fusionnés en une seule entrée dont nb_barres
    /// est la somme. Ordre d'apparition dans le fichier, pas alphabétique.
    pub groupes_profil: Vec<GroupeProfil>,
    /// false si la colonne NBR n'a pas pu être localisée dans ce fichier
    /// (structure de template différente) -- nb_barres_total vaut alors 0.0
    /// et cette absence doit être signalée plutôt qu'ignorée silencieusement.
    pub colonne_nbr_trouvee: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GroupeProfil {
    pub profil: String,
    pub nb_barres: f64,
}

/// true si `s` ressemble à un n° de plan ArcelorMittal : préfixe "19" suivi
/// de chiffres, assez long pour ne pas confondre avec une autre valeur
/// (ex. année ou petit compteur qui commencerait aussi par "19").
fn ressemble_a_un_numero_plan(s: &str) -> bool {
    s.len() >= 8 && s.starts_with("19") && s.chars().take(4).all(|c| c.is_ascii_digit())
}

const MAX_LIGNES_RECHERCHE_ENTETE: u32 = 15;
const MAX_LIGNES_DONNEES: u32 = 30; // garde-fou si jamais "TOTAL" n'est pas trouvé

/// Cherche dans `range`, ligne par ligne (0-based, jusqu'à `max_ligne`),
/// la ligne où la colonne A vaut exactement `texte_attendu` (insensible à
/// la casse). Retourne l'index de ligne 0-based si trouvé.
fn trouver_ligne_par_texte_col_a(
    range: &calamine::Range<calamine::Data>,
    texte_attendu: &str,
    max_ligne: u32,
) -> Option<u32> {
    for r in 0..max_ligne.min(range.height() as u32) {
        if let Some(v) = range.get_value((r, 0)) {
            if cellule_vers_texte(v).eq_ignore_ascii_case(texte_attendu) {
                return Some(r);
            }
        }
    }
    None
}

/// Cherche, sur une ligne donnée, la colonne dont le texte contient
/// `motif` (insensible à la casse). Utile car les libellés varient
/// légèrement selon les fichiers (ex. "NBR" vs "NBR FER-T").
fn trouver_colonne_par_motif(
    range: &calamine::Range<calamine::Data>,
    ligne: u32,
    motif: &str,
    max_col: u32,
) -> Option<u32> {
    for c in 0..max_col {
        if let Some(v) = range.get_value((ligne, c)) {
            let texte = cellule_vers_texte(v).to_uppercase();
            if texte.contains(&motif.to_uppercase()) {
                return Some(c);
            }
        }
    }
    None
}

/// Cherche, en remontant depuis `colonne_reference` (exclue) vers la gauche,
/// la colonne la plus proche dont le texte contient `motif`. Utilisé pour
/// NBR : certains fichiers ont plusieurs colonnes contenant "NBR" (ex.
/// "NBR POUTRES" ET "NBR FER-T" dans le même en-tête) -- celle qui compte
/// vraiment est toujours immédiatement adjacente à PROFIL, pas forcément
/// la première rencontrée en lisant de gauche à droite.
fn trouver_colonne_la_plus_proche_avant(
    range: &calamine::Range<calamine::Data>,
    ligne: u32,
    colonne_reference: u32,
    motif: &str,
) -> Option<u32> {
    for c in (0..colonne_reference).rev() {
        if let Some(v) = range.get_value((ligne, c)) {
            let texte = cellule_vers_texte(v).to_uppercase();
            if texte.contains(&motif.to_uppercase()) {
                return Some(c);
            }
        }
    }
    None
}

pub fn extraire_info_previ(chemin_fichier: &str) -> Result<Option<InfoPrevi>, String> {
    let mut workbook: Xlsx<_> =
        open_workbook(chemin_fichier).map_err(|e| format!("Ouverture impossible: {e}"))?;

    let range = match workbook.worksheet_range("PREVI") {
        Ok(r) => r,
        Err(_) => return Ok(None),
    };

    let Some(ligne_entete) =
        trouver_ligne_par_texte_col_a(&range, "COMMANDE", MAX_LIGNES_RECHERCHE_ENTETE)
    else {
        return Err(format!(
            "En-tête 'COMMANDE' introuvable dans PREVI de {chemin_fichier}"
        ));
    };

    let col_profil = trouver_colonne_par_motif(&range, ligne_entete, "PROFIL", 20);
    let col_nbr = col_profil
        .and_then(|cp| trouver_colonne_la_plus_proche_avant(&range, ligne_entete, cp, "NBR"));

    // La commande et le client sont sur la première ligne de données,
    // juste en dessous de l'en-tête.
    let ligne_premiere_donnee = ligne_entete + 1;
    let commande = range
        .get_value((ligne_premiere_donnee, 0))
        .map(cellule_vers_texte)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("Numéro de commande introuvable dans PREVI de {chemin_fichier}"))?;

    let client = range
        .get_value((ligne_premiere_donnee, 2))
        .map(cellule_vers_texte)
        .filter(|s| !s.is_empty());

    let profil = col_profil.and_then(|col_profil| {
        range
            .get_value((ligne_premiere_donnee, col_profil))
            .map(cellule_vers_texte)
            .filter(|s| !s.is_empty())
    });

    // Somme du NBR sur toutes les lignes de données valides (celles où
    // PROFIL est renseigné -- les lignes intermédiaires type "Lot"/"N°
    // Plan" dans la même colonne A n'ont pas de PROFIL et sont ignorées),
    // jusqu'à la ligne "TOTAL" qui marque la fin du tableau. On en profite
    // pour repérer, dans la même colonne A, la cellule "N° de plan" (préfixe
    // "19") au passage.
    let mut nb_barres_total = 0.0;
    let mut groupes_profil: Vec<GroupeProfil> = Vec::new();
    let mut numero_plan = None;
    let colonne_nbr_trouvee = col_nbr.is_some();

    {
        let mut r = ligne_premiere_donnee;
        let limite = (ligne_entete + MAX_LIGNES_DONNEES).min(range.height() as u32);
        while r < limite {
            let col_a = range.get_value((r, 0)).map(cellule_vers_texte);
            if let Some(texte) = &col_a {
                if texte.eq_ignore_ascii_case("TOTAL") {
                    break;
                }
                if numero_plan.is_none() && ressemble_a_un_numero_plan(texte) {
                    numero_plan = Some(texte.clone());
                }
            }
            if let (Some(col_nbr), Some(col_profil)) = (col_nbr, col_profil) {
                let profil_ligne = range
                    .get_value((r, col_profil))
                    .map(cellule_vers_texte)
                    .filter(|s| !s.is_empty());
                if let Some(profil_ligne) = profil_ligne {
                    if let Some(v) = range.get_value((r, col_nbr)).and_then(|v| v.as_f64()) {
                        nb_barres_total += v;
                        match groupes_profil.iter_mut().find(|g| g.profil == profil_ligne) {
                            Some(groupe) => groupe.nb_barres += v,
                            None => groupes_profil.push(GroupeProfil {
                                profil: profil_ligne,
                                nb_barres: v,
                            }),
                        }
                    }
                }
            }
            r += 1;
        }
    }

    Ok(Some(InfoPrevi {
        commande,
        client,
        profil,
        numero_plan,
        nb_barres_total,
        groupes_profil,
        colonne_nbr_trouvee,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_info_previ_706839() {
        let info = extraire_info_previ("1100706839.xlsx").unwrap().unwrap();
        assert_eq!(info.commande, "1100706839");
        assert_eq!(info.client.as_deref(), Some("KINZIGFLUTBRÜCKE"));
        assert_eq!(info.profil.as_deref(), Some("HEB 600"));
        assert_eq!(info.numero_plan.as_deref(), Some("1900016822"));
        assert!(info.colonne_nbr_trouvee);
        assert_eq!(info.nb_barres_total, 23.0);
        // Un seul profil réel sur cette affaire -> un seul groupe.
        assert_eq!(
            info.groupes_profil,
            vec![GroupeProfil { profil: "HEB 600".into(), nb_barres: 23.0 }]
        );
    }

    #[test]
    fn test_info_previ_719879() {
        let info = extraire_info_previ("1100719879.xlsx").unwrap().unwrap();
        assert_eq!(info.commande, "1100719879");
        assert!(info.colonne_nbr_trouvee);
        assert_eq!(info.nb_barres_total, 6.0);
    }

    #[test]
    fn test_info_previ_662668_plusieurs_lignes() {
        // Ce fichier a 2 groupes profil/longueur distincts (NBR=6 et
        // NBR=12), le total doit bien sommer les deux -> 18.
        // Piège : le fichier a DEUX colonnes contenant "NBR" (NBR POUTRES
        // et NBR FER-T) -- seule celle adjacente à PROFIL est la bonne.
        let info = extraire_info_previ("1100662668.xlsx").unwrap().unwrap();
        assert_eq!(info.commande, "1100662668");
        assert_eq!(info.profil.as_deref(), Some("HEB 600"));
        assert_eq!(info.numero_plan.as_deref(), Some("1900015874"));
        assert!(info.colonne_nbr_trouvee);
        assert_eq!(info.nb_barres_total, 18.0);
        // Les 2 groupes partagent le même profil "HEB 600" (seule la
        // longueur diffère) -> fusionnés en une seule entrée.
        assert_eq!(
            info.groupes_profil,
            vec![GroupeProfil { profil: "HEB 600".into(), nb_barres: 18.0 }]
        );
    }

    #[test]
    fn test_info_previ_546190_colonne_nbr_decalee() {
        // La colonne NBR existe bien dans ce fichier, juste à une position
        // différente des autres (détection dynamique -> pas un problème).
        // Deux lignes de données : NBR=16 et NBR=23 -> total 39.
        let info = extraire_info_previ("1100546190.xlsx").unwrap().unwrap();
        assert_eq!(info.commande, "1100546190");
        assert_eq!(info.profil.as_deref(), Some("HEM 700"));
        assert_eq!(info.numero_plan.as_deref(), Some("1900013594"));
        assert!(info.colonne_nbr_trouvee);
        assert_eq!(info.nb_barres_total, 39.0);
        // Là aussi les 2 groupes partagent le même profil "HEM 700".
        assert_eq!(
            info.groupes_profil,
            vec![GroupeProfil { profil: "HEM 700".into(), nb_barres: 39.0 }]
        );
    }
}