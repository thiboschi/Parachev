//! Données de l'écran de recherche : une ligne par affaire qui fusionne
//! toutes les sources (dossier, RDE, fiche de prévision, SUIVI, heures ERP),
//! la recherche plein texte (FTS5) dans les documents indexés, et le détail
//! d'un dossier d'affaire. Le filtrage lui-même est fait côté interface
//! (quelques centaines à quelques milliers d'affaires : tout tient en
//! mémoire, et les filtres restent souples).

use rusqlite::{Connection, OptionalExtension, Row};
use serde::Serialize;
use std::collections::{BTreeSet, HashMap};

/// Même forme que `VariablesAffaireRow` côté TS (use-affaires-db.ts), pour
/// réutiliser les filtres par variable existants.
#[derive(Serialize, Default, Clone)]
pub struct VariablesLigne {
    pub affaire: String,
    pub client: Option<String>,
    pub profil: Option<String>,
    pub numero_plan: Option<String>,
    pub numero_offre: Option<String>,
    pub nb_barres: Option<f64>,
    pub nb_goujons: Option<f64>,
    pub nb_trous_manuel: Option<f64>,
    pub nb_trous_numerique: Option<f64>,
    pub diametre_moyen_numerique: Option<f64>,
    pub longueur_coupe: Option<f64>,
    pub contre_fleche: Option<f64>,
}

#[derive(Serialize, Clone)]
pub struct HeuresPoste {
    pub poste: String,
    pub heures: f64,
}

#[derive(Serialize, Default)]
pub struct AffaireRecherche {
    pub affaire: String,
    pub nom_dossier: Option<String>,
    pub annule: bool,
    pub non_conformite: bool,
    pub a_rde: bool,
    pub a_fiche: bool,
    pub client: Option<String>,
    pub projet: Option<String>,
    pub donneur_ordre: Option<String>,
    pub offre: Option<String>,
    pub cde_laminage: Option<String>,
    // RDE
    pub type_affaire: Option<String>,
    pub type_poutre: Option<String>,
    pub traitement_surface: Option<String>,
    pub traitements: Vec<String>,
    pub en10163: Option<String>,
    pub tolerance: Option<String>,
    pub exc: Option<String>,
    pub en10204: Option<String>,
    pub prep_en8501: Option<String>,
    pub classe_us: Option<String>,
    pub exigence_fabrication: Option<String>,
    pub exigences_acier: Vec<String>,
    // Opérations : demandées (cases RDE), prévues (postes de la fiche),
    // réalisées (colonnes SUIVI datées + postes ERP avec heures).
    pub operations_rde: Vec<String>,
    pub postes_prevus: Vec<String>,
    pub postes_realises: Vec<String>,
    // Matière
    pub profils: Vec<String>,
    pub nuances: Vec<String>,
    pub usines: Vec<String>,
    // Quantités
    pub nb_barres: Option<f64>,
    pub poids_t: Option<f64>,
    pub heures_reelles: f64,
    pub heures_prevues: Option<f64>,
    pub heures_par_poste: Vec<HeuresPoste>,
    // Dates (ISO)
    pub date_commande: Option<String>,
    pub date_fiche: Option<String>,
    pub date_laminage: Option<String>,
    pub date_production_debut: Option<String>,
    pub date_production_fin: Option<String>,
    pub date_expedition: Option<String>,
    pub nb_documents: i64,
    pub variables: Option<VariablesLigne>,
}

fn liste(texte: Option<String>) -> Vec<String> {
    texte
        .unwrap_or_default()
        .split(';')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

fn min_date(a: &mut Option<String>, b: Option<String>) {
    if let Some(b) = b {
        if a.as_ref().is_none_or(|a| b < *a) {
            *a = Some(b);
        }
    }
}

fn max_date(a: &mut Option<String>, b: Option<String>) {
    if let Some(b) = b {
        if a.as_ref().is_none_or(|a| b > *a) {
            *a = Some(b);
        }
    }
}

fn requete<T>(conn: &Connection, sql: &str, f: impl FnMut(&Row) -> rusqlite::Result<T>) -> Result<Vec<T>, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let lignes = stmt.query_map([], f).map_err(|e| e.to_string())?;
    lignes.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Ligne de l'affaire `a` (créée vide au besoin).
fn entree<'a>(affaires: &'a mut HashMap<String, AffaireRecherche>, a: &str) -> &'a mut AffaireRecherche {
    affaires
        .entry(a.to_string())
        .or_insert_with(|| AffaireRecherche { affaire: a.to_string(), ..Default::default() })
}

pub fn lister_affaires(conn: &Connection) -> Result<Vec<AffaireRecherche>, String> {
    let mut affaires: HashMap<String, AffaireRecherche> = HashMap::new();

    for (a, nom, annule, nc) in requete(conn, "SELECT affaire, nom_dossier, annule, non_conformite FROM dossiers_affaires", |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, bool>(2)?, r.get::<_, bool>(3)?))
    })? {
        let x = entree(&mut affaires, &a);
        x.nom_dossier = Some(nom);
        x.annule = annule;
        x.non_conformite = nc;
    }

    let variables = requete(
        conn,
        "SELECT affaire, client, profil, numero_plan, numero_offre, nb_barres, nb_goujons, nb_trous_manuel,
                nb_trous_numerique, diametre_moyen_numerique, longueur_coupe, contre_fleche,
                date_fiche, poids_t, heures_prevues_fiche, chemin_fiche
         FROM variables_affaires",
        |r| {
            Ok((
                VariablesLigne {
                    affaire: r.get(0)?,
                    client: r.get(1)?,
                    profil: r.get(2)?,
                    numero_plan: r.get(3)?,
                    numero_offre: r.get(4)?,
                    nb_barres: r.get(5)?,
                    nb_goujons: r.get(6)?,
                    nb_trous_manuel: r.get(7)?,
                    nb_trous_numerique: r.get(8)?,
                    diametre_moyen_numerique: r.get(9)?,
                    longueur_coupe: r.get(10)?,
                    contre_fleche: r.get(11)?,
                },
                r.get::<_, Option<String>>(12)?,
                r.get::<_, Option<f64>>(13)?,
                r.get::<_, Option<f64>>(14)?,
                r.get::<_, Option<String>>(15)?,
            ))
        },
    )?;
    for (v, date_fiche, poids_t, heures_prevues, chemin_fiche) in variables {
        let x = entree(&mut affaires, &v.affaire);
        x.client = v.client.clone();
        x.offre = v.numero_offre.clone();
        x.nb_barres = v.nb_barres;
        x.date_fiche = date_fiche;
        x.poids_t = poids_t;
        x.heures_prevues = heures_prevues;
        x.a_fiche = chemin_fiche.is_some();
        if let Some(p) = &v.profil {
            x.profils.push(p.clone());
        }
        x.variables = Some(v);
    }

    let rde = requete(
        conn,
        "SELECT affaire, date_rde, projet, offre, client, donneur_ordre, cde_laminage, type_affaire, type_poutre,
                traitement_surface, traitements, en10163, tolerance, exc, en10204, prep_en8501, classe_us,
                exigence_fabrication, exigences_acier
         FROM rde_affaires",
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
                    .iter()
                    .map(|&i| r.get::<_, Option<String>>(i))
                    .collect::<rusqlite::Result<Vec<_>>>()?,
            ))
        },
    )?;
    for (a, mut c) in rde {
        let x = entree(&mut affaires, &a);
        let mut prendre = |i: usize| c[i].take();
        x.a_rde = true;
        x.date_commande = prendre(0);
        x.projet = prendre(1);
        let offre = prendre(2);
        x.offre = x.offre.take().or(offre);
        let client = prendre(3);
        x.client = x.client.take().or(client);
        x.donneur_ordre = prendre(4);
        x.cde_laminage = prendre(5);
        x.type_affaire = prendre(6);
        x.type_poutre = prendre(7);
        x.traitement_surface = prendre(8);
        x.traitements = liste(prendre(9));
        x.en10163 = prendre(10);
        x.tolerance = prendre(11);
        x.exc = prendre(12);
        x.en10204 = prendre(13);
        x.prep_en8501 = prendre(14);
        x.classe_us = prendre(15);
        x.exigence_fabrication = prendre(16);
        x.exigences_acier = liste(prendre(17));
    }

    let mut nuances: HashMap<String, BTreeSet<String>> = HashMap::new();
    let mut usines: HashMap<String, BTreeSet<String>> = HashMap::new();
    let mut barres_rde: HashMap<String, (f64, f64)> = HashMap::new();
    for (a, profil, nuance, poids, nombre, usine, date_lam) in requete(
        conn,
        "SELECT affaire, profil, nuance, poids_kg, nombre, usine, date_laminage FROM rde_laminage",
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<f64>>(3)?,
                r.get::<_, Option<f64>>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, Option<String>>(6)?,
            ))
        },
    )? {
        let x = entree(&mut affaires, &a);
        x.profils.push(profil);
        min_date(&mut x.date_laminage, date_lam);
        if let Some(n) = nuance {
            nuances.entry(a.clone()).or_default().insert(n);
        }
        if let Some(u) = usine {
            // "GREY"/"Grey", "Differdang"/"Differdange" : même usine.
            let u = u.trim().to_uppercase();
            let u = if u.starts_with("DIFFERDANG") { "DIFFERDANGE".to_string() } else { u };
            usines.entry(a.clone()).or_default().insert(u);
        }
        let b = barres_rde.entry(a).or_default();
        b.0 += nombre.unwrap_or(0.0);
        b.1 += poids.unwrap_or(0.0);
    }

    for (a, profil) in requete(conn, "SELECT affaire, profil FROM profils_affaires", |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        entree(&mut affaires, &a).profils.push(profil);
    }

    for (a, source, operation, date_debut, date_fin) in requete(
        conn,
        "SELECT affaire, source, operation, date_debut, date_fin FROM affaire_operations",
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
            ))
        },
    )? {
        let x = entree(&mut affaires, &a);
        match (source.as_str(), operation.as_str()) {
            ("rde", _) => x.operations_rde.push(operation),
            (_, "autre") => {}
            ("fiche", _) => x.postes_prevus.push(operation),
            ("suivi", "expedition") => max_date(&mut x.date_expedition, date_fin),
            ("suivi", _) => {
                x.postes_realises.push(operation);
                min_date(&mut x.date_production_debut, date_debut);
                max_date(&mut x.date_production_fin, date_fin);
            }
            _ => {}
        }
    }

    // Heures ERP : par poste, et période de pointage (utilisée comme
    // période de production quand SUIVI n'est pas renseigné).
    let mut periodes_erp: HashMap<String, (Option<String>, Option<String>)> = HashMap::new();
    for (a, poste, heures, debut, fin) in requete(
        conn,
        "SELECT affaire, poste, SUM(heures), MIN(date), MAX(date) FROM heures GROUP BY affaire, poste",
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, f64>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
            ))
        },
    )? {
        let x = entree(&mut affaires, &a);
        x.heures_reelles += heures;
        if heures > 0.0 {
            x.postes_realises.push(poste.clone());
        }
        x.heures_par_poste.push(HeuresPoste { poste, heures });
        let p = periodes_erp.entry(a).or_default();
        min_date(&mut p.0, debut);
        max_date(&mut p.1, fin);
    }

    for (a, n) in requete(conn, "SELECT affaire, COUNT(*) FROM documents WHERE affaire IS NOT NULL AND doublon_de IS NULL GROUP BY affaire", |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
    })? {
        entree(&mut affaires, &a).nb_documents = n;
    }

    let mut resultat: Vec<AffaireRecherche> = affaires.into_values().collect();
    for x in resultat.iter_mut() {
        if x.date_production_debut.is_none() {
            if let Some((debut, fin)) = periodes_erp.remove(&x.affaire) {
                x.date_production_debut = debut;
                x.date_production_fin = fin;
            }
        }
        if let Some((nombre, poids)) = barres_rde.get(&x.affaire) {
            if x.nb_barres.is_none_or(|n| n <= 0.0) && *nombre > 0.0 {
                x.nb_barres = Some(*nombre);
            }
            if x.poids_t.is_none() && *poids > 0.0 {
                x.poids_t = Some(poids / 1000.0);
            }
        }
        x.nuances = nuances.remove(&x.affaire).map(|s| s.into_iter().collect()).unwrap_or_default();
        x.usines = usines.remove(&x.affaire).map(|s| s.into_iter().collect()).unwrap_or_default();
        for v in [&mut x.profils, &mut x.postes_prevus, &mut x.postes_realises, &mut x.operations_rde] {
            v.sort();
            v.dedup();
        }
        x.heures_par_poste.sort_by(|a, b| b.heures.total_cmp(&a.heures));
    }
    resultat.sort_by(|a, b| b.affaire.cmp(&a.affaire));
    Ok(resultat)
}

// ---------------------------------------------------------------------------
// Recherche plein texte
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct ResultatTexte {
    pub affaire: String,
    pub chemin: String,
    pub titre: String,
    pub type_doc: Option<String>,
    pub extrait: String,
}

/// Requête FTS5 : chaque mot saisi doit apparaître (préfixe accepté).
/// Les mots sont réduits aux caractères alphanumériques, ce qui évite
/// toute injection de syntaxe FTS.
fn requete_fts(texte: &str) -> Option<String> {
    let mots: Vec<String> = texte
        .split(|c: char| !c.is_alphanumeric())
        .filter(|m| !m.is_empty())
        .map(|m| format!("\"{m}\"*"))
        .collect();
    (!mots.is_empty()).then(|| mots.join(" "))
}

pub fn rechercher_texte(conn: &Connection, texte: &str) -> Result<Vec<ResultatTexte>, String> {
    let Some(requete) = requete_fts(texte) else {
        return Ok(Vec::new());
    };
    let mut stmt = conn
        .prepare(
            "SELECT f.affaire, f.chemin, f.titre, d.type,
                    snippet(documents_fts, 3, '«', '»', '…', 12)
             FROM documents_fts f
             LEFT JOIN documents d ON d.chemin = f.chemin
             WHERE documents_fts MATCH ?1 AND f.affaire IS NOT NULL AND d.doublon_de IS NULL
             ORDER BY rank
             LIMIT 2000",
        )
        .map_err(|e| e.to_string())?;
    let lignes = stmt
        .query_map([requete], |r| {
            Ok(ResultatTexte {
                affaire: r.get(0)?,
                chemin: r.get(1)?,
                titre: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                type_doc: r.get(3)?,
                extrait: r.get::<_, Option<String>>(4)?.unwrap_or_default(),
            })
        })
        .map_err(|e| e.to_string())?;
    lignes.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Détail d'un dossier d'affaire
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct DossierInfo {
    pub nom_dossier: String,
    pub chemin: String,
    pub annule: bool,
    pub non_conformite: bool,
}

#[derive(Serialize)]
pub struct RdeDetail {
    pub chemin: String,
    pub champs: Vec<(String, String)>,
    pub traitements: Vec<String>,
    pub exigences_acier: Vec<String>,
    pub accessoires: Vec<String>,
}

#[derive(Serialize)]
pub struct LaminageLigne {
    pub profil: String,
    pub longueur: Option<f64>,
    pub nuance: Option<String>,
    pub poids_kg: Option<f64>,
    pub nombre: Option<f64>,
    pub usine: Option<String>,
    pub date_laminage: Option<String>,
}

#[derive(Serialize)]
pub struct OperationLigne {
    pub source: String,
    pub operation: String,
    pub libelle: Option<String>,
    pub heures: Option<f64>,
    pub nb_barres: Option<f64>,
    pub date_debut: Option<String>,
    pub date_fin: Option<String>,
}

#[derive(Serialize)]
pub struct FicheInfo {
    pub chemin: Option<String>,
    pub date_fiche: Option<String>,
    pub poids_t: Option<f64>,
    pub taux_horaire: Option<f64>,
    pub heures_prevues: Option<f64>,
}

#[derive(Serialize)]
pub struct DocumentLigne {
    pub chemin: String,
    pub type_doc: String,
    pub nom: String,
    pub titre: Option<String>,
    pub dossier_relatif: Option<String>,
    pub date_modif: Option<String>,
    pub ancien: bool,
    pub reference: bool,
    /// Nombre d'autres copies du même fichier dans le dossier (non listées).
    pub nb_copies: i64,
}

#[derive(Serialize)]
pub struct ReferenceLigne {
    pub affaire: String,
    pub nom_dossier: Option<String>,
    pub chemin: Option<String>,
}

#[derive(Serialize)]
pub struct DossierAffaire {
    pub dossier: Option<DossierInfo>,
    pub rde: Option<RdeDetail>,
    pub laminage: Vec<LaminageLigne>,
    pub fiche: Option<FicheInfo>,
    pub operations: Vec<OperationLigne>,
    pub documents: Vec<DocumentLigne>,
    /// Affaires dont une fiche/RDE est rangé dans ce dossier (références).
    pub references: Vec<ReferenceLigne>,
    /// Affaires qui ont gardé celle-ci comme référence.
    pub cite_par: Vec<ReferenceLigne>,
}

fn requete_affaire<T>(conn: &Connection, sql: &str, affaire: &str, f: impl FnMut(&Row) -> rusqlite::Result<T>) -> Result<Vec<T>, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let lignes = stmt.query_map([affaire], f).map_err(|e| e.to_string())?;
    lignes.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Libellés affichés des champs RDE, dans l'ordre de la feuille.
const CHAMPS_RDE: [(&str, &str); 19] = [
    ("date_rde", "Date"),
    ("projet", "Projet"),
    ("offre", "N° offre"),
    ("client", "Client"),
    ("donneur_ordre", "Donneur d'ordre"),
    ("cde_laminage", "Cde laminage"),
    ("type_affaire", "Type d'affaire"),
    ("type_poutre", "Type de poutre"),
    ("traitement_surface", "Traitement de surface"),
    ("exigence_fabrication", "Exigence particulière"),
    ("en10163", "Réparation (EN 10163-3)"),
    ("tolerance", "Tolérance géométrique"),
    ("tolerance_speciale", "Tolérance spéciale"),
    ("exc", "Classe d'exécution (EN 1090)"),
    ("tracabilite", "Traçabilité"),
    ("en10204", "Document de contrôle (EN 10204)"),
    ("prep_en8501", "Préparation (EN 8501-3)"),
    ("classe_us", "Contrôle US"),
    ("remarques", "Remarques"),
];

pub fn obtenir_dossier(conn: &Connection, affaire: &str) -> Result<DossierAffaire, String> {
    let dossier = conn
        .query_row(
            "SELECT nom_dossier, chemin, annule, non_conformite FROM dossiers_affaires WHERE affaire = ?1",
            [affaire],
            |r| Ok(DossierInfo { nom_dossier: r.get(0)?, chemin: r.get(1)?, annule: r.get(2)?, non_conformite: r.get(3)? }),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let colonnes = CHAMPS_RDE.iter().map(|(c, _)| *c).collect::<Vec<_>>().join(", ");
    let rde = conn
        .query_row(
            &format!("SELECT chemin, traitements, exigences_acier, accessoires, {colonnes} FROM rde_affaires WHERE affaire = ?1"),
            [affaire],
            |r| {
                let mut champs = Vec::new();
                for (i, (_, libelle)) in CHAMPS_RDE.iter().enumerate() {
                    if let Some(v) = r.get::<_, Option<String>>(4 + i)? {
                        champs.push((libelle.to_string(), v));
                    }
                }
                Ok(RdeDetail {
                    chemin: r.get(0)?,
                    traitements: liste(r.get(1)?),
                    exigences_acier: liste(r.get(2)?),
                    accessoires: liste(r.get(3)?),
                    champs,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let laminage = requete_affaire(
        conn,
        "SELECT profil, longueur, nuance, poids_kg, nombre, usine, date_laminage FROM rde_laminage WHERE affaire = ?1",
        affaire,
        |r| {
            Ok(LaminageLigne {
                profil: r.get(0)?,
                longueur: r.get(1)?,
                nuance: r.get(2)?,
                poids_kg: r.get(3)?,
                nombre: r.get(4)?,
                usine: r.get(5)?,
                date_laminage: r.get(6)?,
            })
        },
    )?;

    let fiche = conn
        .query_row(
            "SELECT chemin_fiche, date_fiche, poids_t, taux_horaire, heures_prevues_fiche FROM variables_affaires WHERE affaire = ?1",
            [affaire],
            |r| {
                Ok(FicheInfo {
                    chemin: r.get(0)?,
                    date_fiche: r.get(1)?,
                    poids_t: r.get(2)?,
                    taux_horaire: r.get(3)?,
                    heures_prevues: r.get(4)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
        .filter(|f| f.chemin.is_some());

    let operations = requete_affaire(
        conn,
        "SELECT source, operation, libelle, heures, nb_barres, date_debut, date_fin
         FROM affaire_operations WHERE affaire = ?1 ORDER BY source, operation",
        affaire,
        |r| {
            Ok(OperationLigne {
                source: r.get(0)?,
                operation: r.get(1)?,
                libelle: r.get(2)?,
                heures: r.get(3)?,
                nb_barres: r.get(4)?,
                date_debut: r.get(5)?,
                date_fin: r.get(6)?,
            })
        },
    )?;

    let documents = requete_affaire(
        conn,
        "SELECT d.chemin, d.type, d.nom, d.titre, d.dossier_relatif, d.date_modif, d.ancien, d.reference,
                (SELECT COUNT(*) FROM documents c WHERE c.doublon_de = d.chemin)
         FROM documents d WHERE d.affaire = ?1 AND d.doublon_de IS NULL
         ORDER BY d.type, d.dossier_relatif, d.nom",
        affaire,
        |r| {
            Ok(DocumentLigne {
                chemin: r.get(0)?,
                type_doc: r.get(1)?,
                nom: r.get(2)?,
                titre: r.get(3)?,
                dossier_relatif: r.get(4)?,
                date_modif: r.get(5)?,
                ancien: r.get(6)?,
                reference: r.get(7)?,
                nb_copies: r.get(8)?,
            })
        },
    )?;

    let references = requete_affaire(
        conn,
        "SELECT r.affaire_reference, d.nom_dossier, MIN(r.chemin) FROM affaires_references r
         LEFT JOIN dossiers_affaires d ON d.affaire = r.affaire_reference
         WHERE r.affaire = ?1 GROUP BY r.affaire_reference",
        affaire,
        |r| Ok(ReferenceLigne { affaire: r.get(0)?, nom_dossier: r.get(1)?, chemin: r.get(2)? }),
    )?;
    let cite_par = requete_affaire(
        conn,
        "SELECT r.affaire, d.nom_dossier, MIN(r.chemin) FROM affaires_references r
         LEFT JOIN dossiers_affaires d ON d.affaire = r.affaire
         WHERE r.affaire_reference = ?1 GROUP BY r.affaire",
        affaire,
        |r| Ok(ReferenceLigne { affaire: r.get(0)?, nom_dossier: r.get(1)?, chemin: r.get(2)? }),
    )?;

    Ok(DossierAffaire { dossier, rde, laminage, fiche, operations, documents, references, cite_par })
}

/// true si `chemin` est un document ou un dossier d'affaire indexé -- seuls
/// ceux-là peuvent être ouverts depuis l'interface.
pub fn est_document_indexe(conn: &Connection, chemin: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT 1 FROM documents WHERE chemin = ?1 UNION SELECT 1 FROM dossiers_affaires WHERE chemin = ?1",
        [chemin],
        |_| Ok(()),
    )
        .optional()
        .map(|r| r.is_some())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requete_fts_sans_syntaxe() {
        assert_eq!(requete_fts("HEB 600"), Some("\"HEB\"* \"600\"*".to_string()));
        assert_eq!(requete_fts("\" OR x:*"), Some("\"OR\"* \"x\"*".to_string()));
        assert_eq!(requete_fts("  - "), None);
    }
}
