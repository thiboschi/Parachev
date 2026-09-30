//! Lecture des programmes CN au format DSTV (.nc / .nc1), générés par Vacam
//! (ou exportés de BOCAD) : une pièce par fichier.
//!
//! En-tête (après "ST", lignes de commentaire "**" ignorées) : n° de
//! commande, dessin, phase, pièce, nuance, QUANTITÉ, profil, CODE PROFIL,
//! longueur... Puis des blocs de deux lettres (AK contour, BO perçages, SI
//! marquage, KO...) terminés par "EN".
//!
//! Code profil : I (poutrelle), U, L, SO (spécial)... et B pour les tôles
//! et fers plats (raidisseurs, lamelles, "FL 35X25"), qui ne passent pas
//! par la foreuse à poutrelles -- voir `est_tole`.
//!
//! Bloc BO : une ligne par position "o|v|u|h  x[suffixe]  y  diamètre ...".
//! Convention Vacam de l'atelier (mail DW-241) : les petits diamètres ne
//! sont pas des trous mais des pointeaux de marquage -- Ø1 goujon aile sup,
//! Ø2 / Ø7 goujon âme (dessus / dessous), Ø4 contre-flèche, Ø5 coupe ;
//! certains programmes marquent avec Ø0. Ils sont comptés à part : ils
//! prennent du temps machine (le poste forage numérique les inclut) mais ne
//! sont pas des perçages.
//!
//! Bloc KO (marquage) : les programmes machine de Vacam ("REP A PROD",
//! dossier des programmes Vacam) convertissent chaque pointeau du bloc BO
//! en un bloc KO (petite croix) -- 327 KO pour 327 pointeaux Ø1-7 sur
//! DW-241 REP A, 233 KO pour 233 Ø0 sur DIP Parkhaus pièce 85. Chaque bloc
//! KO compte donc comme un pointeau (sur Donawitz, les KO sont des traits
//! de marquage, qui prennent aussi du temps machine).

use std::collections::BTreeMap;

/// Diamètre (mm) jusqu'auquel une position BO est un pointeau de marquage.
pub const DIAMETRE_MAX_POINTEAU_MM: f64 = 10.0;

#[derive(Debug, Default, Clone, PartialEq)]
pub struct ProgrammeCn {
    /// Champ commande de l'en-tête : "C086 TA" (code affaire atelier) dans
    /// les exports Voortman de Vacam, "25PA0115-POINT" chez Wallerich...
    pub commande: Option<String>,
    pub piece: Option<String>,
    pub profil: Option<String>,
    /// Code DSTV du type de profil ("I", "U", "B"...).
    pub code_profil: Option<String>,
    /// Nombre de pièces identiques produites avec ce programme.
    pub quantite: f64,
    /// Positions du bloc BO par diamètre (clé en dixièmes de mm pour rester
    /// un entier ordonnable), déjà multipliées par `quantite`.
    pub positions_par_diametre: BTreeMap<i64, f64>,
    /// Blocs KO (marquages), déjà multipliés par `quantite`.
    pub nb_marquages: f64,
}

impl ProgrammeCn {
    /// Tôle ou fer plat (code DSTV "B").
    pub fn est_tole(&self) -> bool {
        self.code_profil.as_deref() == Some("B")
    }

    fn diametres(&self) -> impl Iterator<Item = (f64, f64)> + '_ {
        self.positions_par_diametre.iter().map(|(&d, &n)| (d as f64 / 10.0, n))
    }

    pub fn nb_trous(&self) -> f64 {
        self.diametres().filter(|(d, _)| *d > DIAMETRE_MAX_POINTEAU_MM).map(|(_, n)| n).sum()
    }

    /// Pointeaux du bloc BO et marquages KO.
    pub fn nb_pointeaux(&self) -> f64 {
        self.diametres().filter(|(d, _)| *d <= DIAMETRE_MAX_POINTEAU_MM).map(|(_, n)| n).sum::<f64>() + self.nb_marquages
    }

    /// Somme des diamètres des vrais trous (pour une moyenne pondérée sur
    /// plusieurs programmes).
    pub fn somme_diametres_trous(&self) -> f64 {
        self.diametres().filter(|(d, _)| *d > DIAMETRE_MAX_POINTEAU_MM).map(|(d, n)| d * n).sum()
    }

    /// Perçages (hors pointeaux) par diamètre en mm.
    pub fn trous_par_diametre(&self) -> Vec<(f64, f64)> {
        self.diametres().filter(|(d, _)| *d > DIAMETRE_MAX_POINTEAU_MM).collect()
    }
}

/// Lit un programme DSTV. None si le contenu n'est pas un DSTV ("ST" en
/// première ligne utile) -- un .nc peut aussi être un programme ISO.
pub fn lire_programme(contenu: &str) -> Option<ProgrammeCn> {
    let mut lignes = contenu
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with("**"));
    if lignes.next()? != "ST" {
        return None;
    }
    // Champs d'en-tête : 0 commande, 1 dessin, 2 phase, 3 pièce, 4 nuance,
    // 5 quantité, 6 profil, 7 code profil.
    let entete: Vec<&str> = lignes.by_ref().take(8).collect();
    let champ = |i: usize| entete.get(i).map(|s| s.to_string()).filter(|s| !s.is_empty());
    let quantite = entete
        .get(5)
        .and_then(|q| q.replace(',', ".").parse::<f64>().ok())
        .filter(|q| *q > 0.0)
        .unwrap_or(1.0);

    let mut programme = ProgrammeCn {
        commande: champ(0),
        piece: champ(3),
        profil: champ(6),
        code_profil: champ(7),
        quantite,
        ..Default::default()
    };

    let mut bloc = "";
    for ligne in contenu.lines().map(str::trim) {
        if ligne.len() == 2 && ligne.chars().all(|c| c.is_ascii_uppercase()) {
            bloc = if ligne == "BO" { "BO" } else { "" };
            if ligne == "KO" {
                programme.nb_marquages += quantite;
            }
            continue;
        }
        if bloc != "BO" {
            continue;
        }
        let mut champs = ligne.split_whitespace();
        if !matches!(champs.next(), Some("o" | "v" | "u" | "h")) {
            continue;
        }
        // x (avec suffixe de référence éventuel, ex. "150.00s"), y, diamètre.
        let Some(diametre) = champs.nth(2).and_then(|d| d.parse::<f64>().ok()) else {
            continue;
        };
        *programme.positions_par_diametre.entry((diametre * 10.0).round() as i64).or_default() += quantite;
    }
    Some(programme)
}

/// Lit un fichier DSTV (encodage indifférent : seuls des chiffres et des
/// codes ASCII sont exploités).
pub fn lire_fichier(chemin: &std::path::Path) -> Result<Option<ProgrammeCn>, String> {
    let octets = std::fs::read(chemin).map_err(|e| format!("Lecture impossible: {e}"))?;
    Ok(lire_programme(&String::from_utf8_lossy(&octets)))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Extrait réel (Ofenhalle Donawitz, EAF4264.nc), bloc BO raccourci.
    const EAF4264: &str = "ST
** EAF4264.nc
  29930
  EAF4264
  53
  EAF4264
  S355J2
  2
  HL1000/642
  I
   14032.00
AK
  v       0.00s     25.00       0.00       0.00       0.00       0.00       0.00
BO
  o     150.00s    337.00      45.00
  o    1313.00s     36.00      26.00
  o    1313.00s    376.00      26.00
BO
  u     150.00s    337.00      45.00
  v     500.00s    200.00       2.00
  v     900.00s    200.00       0.00
SI
  v     100.00s     50.00       0.00      10r EAF4264
EN
";

    #[test]
    fn programme_reel() {
        let p = lire_programme(EAF4264).unwrap();
        assert_eq!(p.piece.as_deref(), Some("EAF4264"));
        assert_eq!(p.profil.as_deref(), Some("HL1000/642"));
        assert!(!p.est_tole());
        assert_eq!(p.quantite, 2.0);
        // 4 trous (2 × Ø45, 2 × Ø26) et 2 pointeaux (Ø2, Ø0), × 2 pièces.
        assert_eq!(p.nb_trous(), 8.0);
        assert_eq!(p.nb_pointeaux(), 4.0);
        assert_eq!(p.trous_par_diametre(), vec![(26.0, 4.0), (45.0, 4.0)]);
        assert_eq!(p.somme_diametres_trous(), 26.0 * 4.0 + 45.0 * 4.0);
    }

    #[test]
    fn tole_bocad_avec_commentaire() {
        // En-tête BOCAD réel (Frasso Telesino) : commentaire puis 6 pièces.
        let p = lire_programme(
            "ST\n**NC-DSTV-Schnittstelle BOCAD-3D\n  248-22-VI000\n  2\n  T5\n  1015\n  S355J2\n  6\n  PIATTO210*25\n  B\n  400.00\nBO\n  v  50.00s  100.00  22.00\nEN\n",
        )
        .unwrap();
        assert_eq!(p.quantite, 6.0);
        assert!(p.est_tole());
        assert_eq!(p.nb_trous(), 6.0);
    }

    #[test]
    fn programme_vacam_prod_pointeaux_en_ko() {
        // "REP A PROD" (DW-241) raccourci : le trou reste en BO, les
        // pointeaux deviennent des blocs KO.
        let p = lire_programme(
            "ST\n** Voortman DSTV export module, Version 2.0\n  D036\n  1\n  *\n  REP A PROD\n  S460J2W+M\n  2\n  HL 1100 B\n  I\n  30144.42\nBO\n  v   892.23o   250.14     60.00     0.00\nKO\n  o  2312.21s   295.00     0.00\n     2312.21    305.00     0.00\nKO\n  o  2512.21s    95.00     0.00\n     2512.21    105.00     0.00\nEN\n",
        )
        .unwrap();
        assert_eq!(p.commande.as_deref(), Some("D036"));
        assert_eq!(p.nb_trous(), 2.0);
        assert_eq!(p.nb_pointeaux(), 4.0);
    }

    #[test]
    fn pas_un_dstv() {
        assert_eq!(lire_programme("%\nO1000\nG90 G54\n"), None);
    }
}
