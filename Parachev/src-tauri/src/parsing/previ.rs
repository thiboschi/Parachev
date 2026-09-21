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
//!
//! LONG (longueur finale de la barre, après parachèvement) est disponible
//! directement dans ce tableau, juste à côté de PROFIL. L-LAM (longueur de
//! la barre telle que livrée par le laminoir, avant parachèvement) n'existe
//! en revanche pas dans PREVI -- elle est allée chercher dans la feuille
//! "SUIVI" (SUIVI JOURNALIER), qui détaille chaque barre individuellement
//! avec son PROFIL/L-LAM/LONG ; toutes les barres d'un même groupe
//! profil/longueur y partagent la même valeur de L-LAM, d'où la corrélation
//! par (PROFIL, LONG) plutôt qu'un simple index de ligne.

use super::cellule_vers_texte;
use calamine::{open_workbook, DataType, Reader, Xlsx};
use std::collections::HashMap;

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
    /// N° d'offre au format 0000AA00 (ex. 5301ST26), lu dans l'en-tête de PREVI (cellule à droite de "OFFRE N°"). Sert à relier l'affaire aux mails de demande de prix. None si non renseigné.
    pub numero_offre: Option<String>,
    pub nb_barres_total: f64,
    /// Répartition de nb_barres_total par groupe profil+longueur distinct
    /// (ex. HEB 600/11000mm:6, HEB 600/12800mm:12 si l'affaire mélange
    /// plusieurs longueurs d'un même profil) -- deux lignes ne sont
    /// fusionnées que si profil ET longueur coïncident tous les deux.
    /// Ordre d'apparition dans le fichier, pas alphabétique.
    pub groupes_profil: Vec<GroupeProfil>,
    /// false si la colonne NBR n'a pas pu être localisée dans ce fichier
    /// (structure de template différente) -- nb_barres_total vaut alors 0.0
    /// et cette absence doit être signalée plutôt qu'ignorée silencieusement.
    pub colonne_nbr_trouvee: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GroupeProfil {
    pub profil: String,
    /// Longueur finale de la barre (colonne LONG de PREVI), en mm.
    pub longueur: f64,
    /// Longueur brute livrée par le laminoir (colonne L-LAM de la feuille
    /// SUIVI), en mm. None si la feuille SUIVI est absente ou ne contient
    /// pas ce groupe profil/longueur (ex. affaire pas encore suivie).
    pub l_lam: Option<f64>,
    pub nb_barres: f64,
}

/// true si `s` ressemble à un n° de plan ArcelorMittal : préfixe "19" suivi
/// de chiffres, assez long pour ne pas confondre avec une autre valeur
/// (ex. année ou petit compteur qui commencerait aussi par "19").
fn ressemble_a_un_numero_plan(s: &str) -> bool {
    s.len() >= 8 && s.starts_with("19") && s.chars().take(4).all(|c| c.is_ascii_digit())
}

/// true si `s` est un n° d'offre au format 0000AA00.
pub fn est_un_numero_offre(s: &str) -> bool {
    let b = s.trim().as_bytes();
    b.len() == 8
        && b[..4].iter().all(u8::is_ascii_digit)
        && b[4..6].iter().all(u8::is_ascii_alphabetic)
        && b[6..].iter().all(u8::is_ascii_digit)
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

/// Cherche, dans les `max_ligne` premières lignes de `range`, une cellule
/// (n'importe quelle colonne dans `max_col`) valant exactement `texte`
/// (insensible à la casse). Retourne sa ligne. Contrairement à
/// `trouver_ligne_par_texte_col_a`, ne se limite pas à la colonne A --
/// utile pour la feuille SUIVI, où PROFIL n'est jamais en première colonne.
fn trouver_ligne_par_texte_cellule(range: &calamine::Range<calamine::Data>, texte: &str, max_ligne: u32, max_col: u32) -> Option<u32> {
    for r in 0..max_ligne.min(range.height() as u32) {
        for c in 0..max_col.min(range.width() as u32) {
            if let Some(v) = range.get_value((r, c)) {
                if cellule_vers_texte(v).eq_ignore_ascii_case(texte) {
                    return Some(r);
                }
            }
        }
    }
    None
}

/// Construit, à partir de la feuille SUIVI (SUIVI JOURNALIER, une ligne par
/// barre individuelle), la corrélation (PROFIL, LONG en texte) -> L-LAM.
/// Toutes les barres d'un même groupe profil/longueur y partagent la même
/// valeur de L-LAM (confirmé sur les 4 fichiers réels disponibles), d'où la
/// clé texte plutôt qu'un index de ligne. Retourne une map vide (pas une
/// erreur) si la feuille SUIVI est absente ou n'a pas le format attendu --
/// L-LAM est une donnée complémentaire, son absence ne doit pas faire
/// échouer tout le parsing PREVI.
fn construire_correlation_l_lam(range: &calamine::Range<calamine::Data>) -> HashMap<(String, String), f64> {
    let mut correlation = HashMap::new();

    const MAX_COLONNES_ENTETE: u32 = 30;
    let Some(ligne_entete) =
        trouver_ligne_par_texte_cellule(range, "PROFIL", MAX_LIGNES_RECHERCHE_ENTETE, MAX_COLONNES_ENTETE)
    else {
        return correlation;
    };

    let Some(col_profil) = trouver_colonne_par_motif(range, ligne_entete, "PROFIL", MAX_COLONNES_ENTETE)
    else {
        return correlation;
    };
    let Some(col_l_lam) = trouver_colonne_par_motif(range, ligne_entete, "L-LAM", MAX_COLONNES_ENTETE)
    else {
        return correlation;
    };
    let Some(col_long) = trouver_colonne_par_motif(range, ligne_entete, "LONG", MAX_COLONNES_ENTETE)
    else {
        return correlation;
    };

    for r in (ligne_entete + 1)..range.height() as u32 {
        let profil = range
            .get_value((r, col_profil))
            .map(cellule_vers_texte)
            .filter(|s| !s.is_empty());
        let longueur_texte = range.get_value((r, col_long)).map(cellule_vers_texte);
        let l_lam = range.get_value((r, col_l_lam)).and_then(|v| v.as_f64());

        if let (Some(profil), Some(longueur_texte), Some(l_lam)) = (profil, longueur_texte, l_lam) {
            correlation.insert((profil, longueur_texte), l_lam);
        }
    }

    correlation
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
    // Détection dynamique de la colonne CLIENT (comme PROFIL/NBR) plutôt
    // qu'un index fixe -- même principe que les autres colonnes du tableau,
    // dont la position varie d'un fichier à l'autre.
    let col_client = trouver_colonne_par_motif(&range, ligne_entete, "CLIENT", 20);
    let col_long = trouver_colonne_par_motif(&range, ligne_entete, "LONG", 20);

    // Corrélation profil/longueur -> L-LAM, depuis la feuille SUIVI (absente
    // de PREVI). Récupérée sur le classeur avant de consommer `range` --
    // voir la doc de `construire_correlation_l_lam`.
    let correlation_l_lam = match workbook.worksheet_range("SUIVI") {
        Ok(suivi) => construire_correlation_l_lam(&suivi),
        Err(_) => HashMap::new(),
    };

    // La commande et le client sont sur la première ligne de données,
    // juste en dessous de l'en-tête.
    let ligne_premiere_donnee = ligne_entete + 1;
    let commande = range
        .get_value((ligne_premiere_donnee, 0))
        .map(cellule_vers_texte)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("Numéro de commande introuvable dans PREVI de {chemin_fichier}"))?;

    let client = col_client.and_then(|col_client| {
        range
            .get_value((ligne_premiere_donnee, col_client))
            .map(cellule_vers_texte)
            .filter(|s| !s.is_empty())
    });

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
    // Le n° d'offre est saisi dans l'en-tête de la feuille, au-dessus du
    // tableau : on le cherche dans toutes les cellules de ces lignes.
    let numero_offre = (0..ligne_entete.min(range.height() as u32)).find_map(|r| {
        (0..range.width() as u32).find_map(|c| {
            range
                .get_value((r, c))
                .map(cellule_vers_texte)
                .filter(|t| est_un_numero_offre(t))
                .map(|t| t.trim().to_uppercase())
        })
    });
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

                        let longueur_ligne = col_long
                            .and_then(|c| range.get_value((r, c)))
                            .and_then(|v| v.as_f64())
                            .unwrap_or(0.0);
                        let longueur_texte = col_long
                            .and_then(|c| range.get_value((r, c)))
                            .map(cellule_vers_texte)
                            .unwrap_or_default();
                        let l_lam = correlation_l_lam
                            .get(&(profil_ligne.clone(), longueur_texte))
                            .copied();

                        match groupes_profil
                            .iter_mut()
                            .find(|g| g.profil == profil_ligne && g.longueur == longueur_ligne)
                        {
                            Some(groupe) => groupe.nb_barres += v,
                            None => groupes_profil.push(GroupeProfil {
                                profil: profil_ligne,
                                longueur: longueur_ligne,
                                l_lam,
                                nb_barres: v,
                            }),
                        }
                    }
                }
            }
            r += 1;
        }
    }

    Ok(Some(InfoPrevi {commande, client, profil, numero_plan, numero_offre, nb_barres_total, groupes_profil, colonne_nbr_trouvee}))
}