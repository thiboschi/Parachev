//! Extraction des opérations réellement réalisées depuis la feuille SUIVI
//! ("SUIVI JOURNALIER") de la fiche de prévision.
//!
//! Structure observée (dossier "1a COMMANDES FINIES 2025") : une ligne
//! d'en-tête contenant PROFIL / L-LAM / LONG / POIDS / REP / N°LAM, puis,
//! à droite de N°LAM, une colonne par opération prévue (reprenant les
//! postes A-D de PREVI : "NR", "SCIE", "FINITION D'ARÊTES", "F.NUM"...),
//! et enfin des colonnes logistiques ("LKW", "WAGON", "DATE"...). Chaque
//! ligne est une barre ; une cellule datée = barre passée à cette
//! opération ce jour-là.
//!
//! Contrairement à la présence d'une feuille (le gabarit contient TOUTES
//! les feuilles FC-/FT- quelle que soit l'affaire), une date saisie ici est
//! une preuve fiable que l'opération a eu lieu.

use super::{cellule_vers_date, cellule_vers_texte, operations};
use calamine::{open_workbook, Reader, Xlsx};

const MAX_LIGNES_ENTETE: u32 = 20;
const MAX_COLONNES: u32 = 45;
const MAX_LIGNES_DONNEES: u32 = 5000;

#[derive(Debug, Clone, PartialEq)]
pub struct OperationSuivi {
    /// Libellé d'en-tête tel que saisi (ex. "F.NUM").
    pub libelle: String,
    /// Nombre de barres ayant une date dans cette colonne.
    pub nb_barres: usize,
    pub date_debut: String,
    pub date_fin: String,
}

#[derive(Debug, Default)]
pub struct ResultatSuivi {
    /// Colonnes de production (au moins une date).
    pub operations: Vec<OperationSuivi>,
    /// Colonnes logistiques (chargement, stockage) -- voir
    /// operations::est_logistique.
    pub logistique: Vec<OperationSuivi>,
}

/// None si la feuille SUIVI est absente ou n'a pas d'en-tête reconnaissable.
pub fn extraire_suivi(chemin_fichier: &str) -> Result<Option<ResultatSuivi>, String> {
    let mut workbook: Xlsx<_> =
        open_workbook(chemin_fichier).map_err(|e| format!("Ouverture impossible: {e}"))?;
    let range = match workbook.worksheet_range("SUIVI") {
        Ok(r) => r,
        Err(_) => return Ok(None),
    };

    let largeur = MAX_COLONNES.min(range.width() as u32);
    let texte = |r: u32, c: u32| range.get_value((r, c)).map(cellule_vers_texte).unwrap_or_default();

    let Some(ligne_entete) = (0..MAX_LIGNES_ENTETE.min(range.height() as u32))
        .find(|&r| (0..largeur).any(|c| texte(r, c).eq_ignore_ascii_case("PROFIL")))
    else {
        return Ok(None);
    };
    let Some(col_rep) = (0..largeur).find(|&c| texte(ligne_entete, c).eq_ignore_ascii_case("REP")) else {
        return Ok(None);
    };

    let fin = (ligne_entete + 1 + MAX_LIGNES_DONNEES).min(range.height() as u32);
    let mut resultat = ResultatSuivi::default();
    for c in (col_rep + 1)..largeur {
        let libelle = texte(ligne_entete, c);
        // N°LAM (numéro de laminage) suit toujours REP : identifiant, pas
        // une opération.
        if libelle.is_empty() || libelle.to_uppercase().contains("LAM") {
            continue;
        }
        let dates: Vec<String> = ((ligne_entete + 1)..fin)
            .filter_map(|r| range.get_value((r, c)).and_then(cellule_vers_date))
            .collect();
        let (Some(debut), Some(fin_op)) = (dates.iter().min(), dates.iter().max()) else {
            continue;
        };
        let op = OperationSuivi {
            libelle: libelle.clone(),
            nb_barres: dates.len(),
            date_debut: debut.clone(),
            date_fin: fin_op.clone(),
        };
        if operations::est_logistique(&libelle) {
            resultat.logistique.push(op);
        } else {
            resultat.operations.push(op);
        }
    }
    Ok(Some(resultat))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FICHE_HOFMANN: &str = "../../1a COMMANDES FINIES 2025/1100725621 HOFMANN RIEG/1100725621.xlsx";

    #[test]
    fn suivi_reel_hofmann() {
        // Données client non versionnées : test ignoré si le dossier est absent.
        if !std::path::Path::new(FICHE_HOFMANN).exists() {
            return;
        }
        let suivi = extraire_suivi(FICHE_HOFMANN).unwrap().unwrap();
        let nr = suivi.operations.iter().find(|o| o.libelle == "NR").expect("colonne NR");
        assert_eq!(nr.nb_barres, 80);
        assert!(nr.date_debut.starts_with("2025-06"));
        assert!(suivi.logistique.iter().any(|o| o.libelle == "LKW"));
        assert!(suivi.operations.iter().all(|o| !operations::est_logistique(&o.libelle)));
    }
}
