//! Extraction des variables explicatives depuis les fichiers Excel de
//! prévision par affaire (un fichier .xlsx par affaire, ~80-120 feuilles).
//!
//! Structure : un sous-module par feuille source, chacun responsable de
//! son propre format de colonnes. Ce fichier ne fait qu'orchestrer les
//! sous-parsers et fournir les helpers partagés entre eux (lecture de
//! cellule, détection des cellules d'erreur #REF!).

mod goujons;
pub mod operations;
mod oxycoupage;
mod presse;
mod previ;
pub mod rde;
pub mod suivi;
mod variables_parcing;

pub use goujons::{extraire_goujons_fc_gouj, BarreGoujons};
pub use oxycoupage::{extraire_oxycoupage};
pub use presse::{extraire_presse, BarreCfl};
pub use previ::{extraire_info_previ, GroupeProfil, PostePrevu};
pub use suivi::{extraire_suivi, ResultatSuivi};
pub use variables_parcing::{extraire_variables_forage};

use calamine::Data;
use rusqlite::{params, Connection};

/// L'ensemble des variables explicatives extraites pour une affaire,
/// prêtes à être insérées dans la table SQLite `variables_affaires`.
///
/// nb_barres/nb_goujons/longueur_coupe sont des f64 "connus" : 0.0 signifie
/// explicitement "ce poste n'est pas utilisé sur cette affaire" (ex. pas de
/// goujonnage), une valeur légitime et différente de "pas encore mesuré".
///
/// Les champs liés au Forage et la contre-flèche restent en Option<f64> :
/// None signifie "valeur inconnue" (feuille absente ou gabarit non rempli,
/// voir variables_parcing.rs). L'usage réel des postes se lit dans
/// `postes_prevus` (fiche) et `suivi` (dates de passage par opération).
#[derive(Debug, Default)]
pub struct VariablesAffaire {
    pub affaire: String,
    /// Nom du client, extrait de la feuille PREVI -- source de vérité
    /// préférée sur le nom du client ERP (voir erp::inserer_clients), qui
    /// peut souffrir d'une corruption d'encodage préexistante sur les
    /// caractères accentués.
    pub client: Option<String>,
    /// Profil du premier groupe barre/longueur (ex. "HEB 600"), et n° de
    /// plan ArcelorMittal (ex. "1900016822") -- tous deux extraits de la
    /// feuille PREVI, voir previ::InfoPrevi. None si non trouvés.
    pub profil: Option<String>,
    pub numero_plan: Option<String>,
    /// N° d'offre 0000AA00 (voir previ::InfoPrevi), lien avec les mails de demande de prix.
    pub numero_offre: Option<String>,
    /// Détail de nb_barres par profil distinct -- voir previ::GroupeProfil.
    /// Stocké séparément (table `profils_affaires`), pas dans cette ligne.
    pub groupes_profil: Vec<GroupeProfil>,
    /// Goujons par poutre (Rep de FC-GOUJ), chacune avec ses différents
    /// diamètres/hauteurs et leur nombre. Table `goujons_affaires`.
    pub goujons_par_poutre: Vec<BarreGoujons>,
    /// Contre-flèche par barre (Rep de FC-PRES/FC-PRESS), voir
    /// presse::BarreCfl. Table `cfl_affaires`.
    pub cfl_par_barre: Vec<BarreCfl>,
    pub nb_barres: f64,
    pub nb_goujons: f64,
    pub longueur_coupe: f64,
    pub nb_trous_manuel: Option<f64>,
    pub nb_trous_numerique: Option<f64>,
    pub diametre_moyen_numerique: Option<f64>,
    /// Contre-flèche (Cfl axe fort) moyenne, extraite de la feuille
    /// FC-PRES/FC-PRESS -- voir presse::extraire_presse. None si la feuille
    /// est absente ou sa colonne Cfl vide.
    pub contre_fleche: Option<f64>,
    /// Date de la fiche, postes A-D planifiés et bloc FINANCES -- voir
    /// previ::InfoPrevi.
    pub date_fiche: Option<String>,
    pub postes_prevus: Vec<PostePrevu>,
    pub poids_t: Option<f64>,
    pub taux_horaire: Option<f64>,
    /// Somme des heures des postes planifiés (le champ "TOTAL DES HEURES
    /// PRÉVUES" de la fiche n'est rempli que sur ~1 fiche sur 4).
    pub heures_prevues_fiche: Option<f64>,
    /// Opérations datées de la feuille SUIVI (None si feuille absente).
    pub suivi: Option<ResultatSuivi>,
}

/// Extrait toutes les variables disponibles pour une affaire en ouvrant
/// son fichier Excel une seule fois et en déléguant à chaque sous-parser.
pub fn extraire_variables_affaire(chemin_fichier: &str) -> Result<VariablesAffaire, String> {
    let info = extraire_info_previ(chemin_fichier)?
        .ok_or_else(|| format!("Feuille PREVI introuvable dans {chemin_fichier}"))?;

    let goujons = extraire_goujons_fc_gouj(chemin_fichier)?;
    let oxycoupage = extraire_oxycoupage(chemin_fichier)?;
    let forage = extraire_variables_forage(chemin_fichier)?;
    let presse = extraire_presse(chemin_fichier)?;
    let cfl_par_barre = presse.as_ref().map(|p| p.detail.clone()).unwrap_or_default();
    let contre_fleche = presse.and_then(|p| p.contre_fleche_moyenne);
    let goujons_par_poutre = goujons.as_ref().map(|g| g.detail.clone()).unwrap_or_default();
    let suivi = extraire_suivi(chemin_fichier)?;
    let somme_postes: f64 = info.postes_prevus.iter().map(|p| p.heures).sum();
    let heures_prevues_fiche = if somme_postes > 0.0 {
        Some(somme_postes)
    } else {
        info.total_heures_prevues.filter(|h| *h > 0.0)
    };

    Ok(VariablesAffaire {
        // "1100725621" même si la cellule porte un suffixe ("1100725621 PH2").
        affaire: numero_affaire(&info.commande).unwrap_or(info.commande),
        client: info.client,
        profil: info.profil,
        numero_plan: info.numero_plan,
        numero_offre: info.numero_offre,
        groupes_profil: info.groupes_profil,
        goujons_par_poutre,
        cfl_par_barre,
        nb_barres: info.nb_barres_total,
        nb_goujons: goujons.map(|g| g.nb_goujons_total).unwrap_or(0.0),
        longueur_coupe: oxycoupage.map(|o| o.longueur_coupe_totale).unwrap_or(0.0),
        nb_trous_manuel: forage.nb_trous_manuel,
        nb_trous_numerique: forage.nb_trous_numerique,
        diametre_moyen_numerique: forage.diametre_moyen_numerique,
        contre_fleche,
        date_fiche: info.date_fiche,
        postes_prevus: info.postes_prevus,
        poids_t: info.poids_t,
        taux_horaire: info.taux_horaire,
        heures_prevues_fiche,
        suivi,
    })
}

/// Insère ou met à jour une affaire dans variables_affaires. Idempotent
/// (INSERT OR REPLACE sur la clé primaire `affaire`) -- ré-extraire un
/// fichier modifié écrase proprement les anciennes valeurs, colonnes Forage
/// incluses : un None reflète maintenant un poste réellement absent de
/// l'affaire (feuille FT-MAN/FT-NUM manquante), pas un parser non
/// implémenté, donc plus de raison de le préserver artificiellement.
pub fn inserer_variables_affaire(conn: &Connection, variables: &VariablesAffaire) -> Result<(), String> {
    conn.execute(
        "INSERT INTO variables_affaires
            (affaire, client, profil, numero_plan, numero_offre, nb_barres, nb_goujons, longueur_coupe,
             nb_trous_manuel, nb_trous_numerique, diametre_moyen_numerique, contre_fleche,
             date_fiche, poids_t, taux_horaire, heures_prevues_fiche)
         VALUES (?1, ?2, ?3, ?4, ?12, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?13, ?14, ?15, ?16)
         ON CONFLICT(affaire) DO UPDATE SET
            -- Le nom client extrait de l'Excel (encodage fiable) prime sur
            -- celui du fichier ERP (voir erp::inserer_clients) -- on ne
            -- l'écrase donc que quand l'Excel en fournit un.
            client = COALESCE(excluded.client, variables_affaires.client),
            profil = excluded.profil,
            numero_plan = excluded.numero_plan,
            numero_offre = COALESCE(excluded.numero_offre, variables_affaires.numero_offre),
            nb_barres = excluded.nb_barres,
            nb_goujons = excluded.nb_goujons,
            longueur_coupe = excluded.longueur_coupe,
            nb_trous_manuel = excluded.nb_trous_manuel,
            nb_trous_numerique = excluded.nb_trous_numerique,
            diametre_moyen_numerique = excluded.diametre_moyen_numerique,
            contre_fleche = excluded.contre_fleche,
            date_fiche = excluded.date_fiche,
            poids_t = excluded.poids_t,
            taux_horaire = excluded.taux_horaire,
            heures_prevues_fiche = excluded.heures_prevues_fiche",
        params![
            variables.affaire,
            variables.client,
            variables.profil,
            variables.numero_plan,
            variables.nb_barres,
            variables.nb_goujons,
            variables.longueur_coupe,
            variables.nb_trous_manuel,
            variables.nb_trous_numerique,
            variables.diametre_moyen_numerique,
            variables.contre_fleche,
            variables.numero_offre,
            variables.date_fiche,
            variables.poids_t,
            variables.taux_horaire,
            variables.heures_prevues_fiche,
        ],
    )
    .map_err(|e| format!("Erreur insertion variables_affaires: {e}"))?;

    Ok(())
}

/// Remplace intégralement le détail par profil d'une affaire dans
/// `profils_affaires` (DELETE puis INSERT, comme enregistrer_prevision) --
/// un remplacement complet plutôt qu'un upsert car le nombre de profils
/// distincts peut changer d'une extraction à l'autre (fichier corrigé).
pub fn inserer_profils_affaire(conn: &mut Connection, affaire: &str, groupes: &[GroupeProfil]) -> Result<(), String> {
    let tx = conn.savepoint().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM profils_affaires WHERE affaire = ?1", params![affaire])
        .map_err(|e| e.to_string())?;

    for groupe in groupes {
        tx.execute(
            "INSERT INTO profils_affaires (affaire, profil, longueur, l_lam, nb_barres)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![affaire, groupe.profil, groupe.longueur, groupe.l_lam, groupe.nb_barres],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Remplace le détail des goujons d'une affaire dans `goujons_affaires` :
/// une ligne par poutre (rep) et par type de goujon (diamètre x hauteur).
pub fn inserer_goujons_affaire(conn: &mut Connection, affaire: &str, poutres: &[BarreGoujons]) -> Result<(), String> {
    let tx = conn.savepoint().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM goujons_affaires WHERE affaire = ?1", params![affaire])
        .map_err(|e| e.to_string())?;
    for poutre in poutres {
        for g in &poutre.groupes {
            tx.execute(
                "INSERT INTO goujons_affaires (affaire, rep, profil, longueur, diametre, hauteur, nb_goujons)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![affaire, poutre.rep, poutre.profil, poutre.longueur, g.diametre, g.hauteur, g.nb_goujons],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Remplace le détail de la contre-flèche d'une affaire dans `cfl_affaires` :
/// une ligne par barre (Rep de FC-PRES/FC-PRESS).
pub fn inserer_cfl_affaire(conn: &mut Connection, affaire: &str, barres: &[BarreCfl]) -> Result<(), String> {
    let tx = conn.savepoint().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM cfl_affaires WHERE affaire = ?1", params![affaire])
        .map_err(|e| e.to_string())?;
    for barre in barres {
        tx.execute(
            "INSERT INTO cfl_affaires (affaire, rep, profil, longueur, cfl)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![affaire, barre.rep, barre.profil, barre.longueur, barre.cfl],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Postes planifiés de la fiche (table `fiche_postes`), dans l'ordre A-D.
pub fn inserer_fiche_postes(conn: &mut Connection, affaire: &str, postes: &[PostePrevu]) -> Result<(), String> {
    let tx = conn.savepoint().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM fiche_postes WHERE affaire = ?1", params![affaire])
        .map_err(|e| e.to_string())?;
    for (ordre, poste) in postes.iter().enumerate() {
        tx.execute(
            "INSERT INTO fiche_postes (affaire, ordre, libelle, heures) VALUES (?1, ?2, ?3, ?4)",
            params![affaire, ordre as i64, poste.libelle, poste.heures],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Une ligne de `affaire_operations` en préparation (agrégée par clé).
#[derive(Debug, Default)]
pub(crate) struct LigneOperation {
    pub operation: String,
    pub libelles: Vec<String>,
    pub heures: Option<f64>,
    pub nb_barres: Option<f64>,
    pub date_debut: Option<String>,
    pub date_fin: Option<String>,
}

/// Remplace les opérations d'une affaire pour une source donnée ("rde",
/// "fiche" ou "suivi") dans `affaire_operations`.
pub(crate) fn remplacer_operations(conn: &mut Connection, affaire: &str, source: &str, lignes: &[LigneOperation]) -> Result<(), String> {
    let tx = conn.savepoint().map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM affaire_operations WHERE affaire = ?1 AND source = ?2",
        params![affaire, source],
    )
    .map_err(|e| e.to_string())?;
    for l in lignes {
        tx.execute(
            "INSERT INTO affaire_operations (affaire, source, operation, libelle, heures, nb_barres, date_debut, date_fin)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![affaire, source, l.operation, l.libelles.join(" / "), l.heures, l.nb_barres, l.date_debut, l.date_fin],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Ajoute `valeur` à la ligne de clé `operation` (créée au besoin).
fn ligne_operation<'a>(lignes: &'a mut Vec<LigneOperation>, operation: &str, libelle: &str) -> &'a mut LigneOperation {
    let i = match lignes.iter().position(|l| l.operation == operation) {
        Some(i) => i,
        None => {
            lignes.push(LigneOperation { operation: operation.to_string(), ..Default::default() });
            lignes.len() - 1
        }
    };
    let ligne = &mut lignes[i];
    if !libelle.is_empty() && !ligne.libelles.iter().any(|l| l == libelle) {
        ligne.libelles.push(libelle.to_string());
    }
    ligne
}

/// Opérations prévues par la fiche : chaque poste A-D ramené à ses clés de
/// poste (operations::postes_depuis_libelle), heures réparties entre les
/// clés d'une machine combinée. Libellé non reconnu -> clé "autre".
/// Un poste sans heures n'est pas prévu : le gabarit pré-remplit les
/// libellés ("PRESSE", "FOR.MAN"...) même quand la case reste vide.
pub(crate) fn operations_fiche(postes: &[PostePrevu]) -> Vec<LigneOperation> {
    let mut lignes = Vec::new();
    for poste in postes.iter().filter(|p| p.heures > 0.0) {
        let mut cles = operations::postes_depuis_libelle(&poste.libelle);
        if cles.is_empty() {
            cles.push("autre");
        }
        let part = poste.heures / cles.len() as f64;
        for cle in cles {
            let l = ligne_operation(&mut lignes, cle, &poste.libelle);
            l.heures = Some(l.heures.unwrap_or(0.0) + part);
        }
    }
    lignes
}

/// Opérations réalisées d'après SUIVI : clé de poste, nombre de barres
/// (maximum sur les colonnes de même clé), première et dernière date. Les
/// colonnes logistiques sont regroupées sous la clé "expedition".
pub(crate) fn operations_suivi(suivi: &ResultatSuivi) -> Vec<LigneOperation> {
    let mut lignes = Vec::new();
    let colonnes = suivi
        .operations
        .iter()
        .map(|o| (o, operations::postes_depuis_libelle(&o.libelle)))
        .chain(suivi.logistique.iter().map(|o| (o, vec!["expedition"])));
    for (op, mut cles) in colonnes {
        if cles.is_empty() {
            cles.push("autre");
        }
        for cle in cles {
            let l = ligne_operation(&mut lignes, cle, &op.libelle);
            l.nb_barres = Some(l.nb_barres.unwrap_or(0.0).max(op.nb_barres as f64));
            if l.date_debut.as_ref().is_none_or(|d| op.date_debut < *d) {
                l.date_debut = Some(op.date_debut.clone());
            }
            if l.date_fin.as_ref().is_none_or(|d| op.date_fin > *d) {
                l.date_fin = Some(op.date_fin.clone());
            }
        }
    }
    lignes
}

/// Écrit toutes les données d'une fiche de prévision (variables, profils,
/// goujons, CFL, postes planifiés, opérations prévues et réalisées).
/// L'appelant (indexeur) a déjà vérifié que cette fiche est la fiche
/// principale de l'affaire.
pub fn enregistrer_fiche(conn: &mut Connection, variables: &VariablesAffaire) -> Result<(), String> {
    let affaire = variables.affaire.as_str();
    inserer_variables_affaire(conn, variables)?;
    inserer_profils_affaire(conn, affaire, &variables.groupes_profil)?;
    inserer_goujons_affaire(conn, affaire, &variables.goujons_par_poutre)?;
    inserer_cfl_affaire(conn, affaire, &variables.cfl_par_barre)?;
    inserer_fiche_postes(conn, affaire, &variables.postes_prevus)?;
    remplacer_operations(conn, affaire, "fiche", &operations_fiche(&variables.postes_prevus))?;
    let suivi = variables.suivi.as_ref().map(operations_suivi).unwrap_or_default();
    remplacer_operations(conn, affaire, "suivi", &suivi)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers partagés entre tous les sous-parsers de feuille
// ---------------------------------------------------------------------------

/// Convertit une cellule Calamine en texte, quel que soit son type source.
pub(crate) fn cellule_vers_texte(v: &Data) -> String {
    match v {
        Data::String(s) => s.trim().to_string(),
        Data::Float(f) => {
            if f.fract() == 0.0 {
                format!("{}", *f as i64)
            } else {
                f.to_string()
            }
        }
        Data::Int(i) => i.to_string(),
        _ => String::new(),
    }
}

/// Détecte les cellules d'erreur Excel (#REF!, #N/A, etc.) -- artefact
/// récurrent dans ces templates après la dernière ligne de données réelle
/// (copier-coller avec suppression de lignes dans le fichier source).
/// Commun à toutes les feuilles de détail par ligne (FC-*, FT-*).
pub(crate) fn cellule_est_erreur(v: Option<&Data>) -> bool {
    matches!(v, Some(Data::Error(_)))
}

pub(crate) fn cellule_vide(v: Option<&Data>) -> bool {
    match v {
        None => true,
        Some(val) => cellule_vers_texte(val).trim().is_empty(),
    }
}

/// Lit une date de cellule en ISO "YYYY-MM-DD" : date Excel native (numéro
/// de série, époque 1899-12-30), date ISO, ou texte saisi à la main
/// ("17/04/2025", "17.04.2025"). None si la cellule n'est pas une date --
/// un nombre simple n'est jamais interprété comme date (ambigu).
pub(crate) fn cellule_vers_date(v: &Data) -> Option<String> {
    match v {
        Data::DateTime(d) => {
            // Plage 1955-2119 : écarte les durées ([hh]:mm, < 1 jour) que
            // calamine range aussi en DateTime sans la feature "dates".
            let serie = d.as_f64();
            if !(20_000.0..80_000.0).contains(&serie) {
                return None;
            }
            let epoque = chrono::NaiveDate::from_ymd_opt(1899, 12, 30)?;
            let date = epoque.checked_add_signed(chrono::Duration::days(serie.floor() as i64))?;
            Some(date.format("%Y-%m-%d").to_string())
        }
        Data::DateTimeIso(s) => texte_vers_date(s),
        Data::String(s) => texte_vers_date(s),
        _ => None,
    }
}

/// "YYYY-MM-DD[...]", "DD/MM/YYYY" ou "DD.MM.YYYY" -> "YYYY-MM-DD".
pub(crate) fn texte_vers_date(texte: &str) -> Option<String> {
    use chrono::Datelike;
    let t = texte.trim();
    let formats = ["%Y-%m-%d", "%d/%m/%Y", "%d.%m.%Y", "%d-%m-%Y"];
    let debut: String = t.chars().take(10).collect();
    let date = formats.iter().find_map(|f| chrono::NaiveDate::parse_from_str(&debut, f).ok())?;
    // "29/10/25" : %Y lit l'année 25 -- année à 2 chiffres = 20xx.
    let date = if date.year() < 100 { date.with_year(date.year() + 2000)? } else { date };
    Some(date.format("%Y-%m-%d").to_string())
}

/// Le premier n° d'affaire "1100xxxxxx" (10 chiffres) trouvé dans un texte
/// (cellule "COMMANDE" de PREVI, "No de cde client" du RDE, nom de dossier).
pub(crate) fn numero_affaire(texte: &str) -> Option<String> {
    let chiffres: Vec<char> = texte.chars().collect();
    (0..chiffres.len()).find_map(|i| {
        let precedent_ok = i == 0 || !chiffres[i - 1].is_ascii_digit();
        let fin = i + 10;
        if !precedent_ok || fin > chiffres.len() {
            return None;
        }
        let candidat: String = chiffres[i..fin].iter().collect();
        let suivant_ok = fin == chiffres.len() || !chiffres[fin].is_ascii_digit();
        (candidat.starts_with("1100") && candidat.chars().all(|c| c.is_ascii_digit()) && suivant_ok)
            .then_some(candidat)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn postes_de_fiche_sans_heures_ignores() {
        let postes = vec![
            PostePrevu { libelle: "PRESSE".into(), heures: 0.0 },
            PostePrevu { libelle: "COMBI SCIE + FOR.".into(), heures: 10.0 },
        ];
        let lignes = operations_fiche(&postes);
        let cles: Vec<&str> = lignes.iter().map(|l| l.operation.as_str()).collect();
        assert_eq!(cles, vec!["mise_a_longueur", "forage_numerique"]);
        assert_eq!(lignes[0].heures, Some(5.0));
    }

    #[test]
    fn dates_texte() {
        assert_eq!(texte_vers_date("17/04/2025").as_deref(), Some("2025-04-17"));
        assert_eq!(texte_vers_date("29/10/25").as_deref(), Some("2025-10-29"));
        assert_eq!(texte_vers_date("2025-05-22 00:00:00").as_deref(), Some("2025-05-22"));
        assert_eq!(texte_vers_date("Lam 24-5"), None);
    }

    #[test]
    fn numero_affaire_dans_texte() {
        assert_eq!(numero_affaire("1100725621 HOFMANN").as_deref(), Some("1100725621"));
        assert_eq!(numero_affaire("RDE - 1900017221 - 1100724988.xlsx").as_deref(), Some("1100724988"));
        assert_eq!(numero_affaire("11007256210"), None);
        assert_eq!(numero_affaire("1100......"), None);
    }
}
