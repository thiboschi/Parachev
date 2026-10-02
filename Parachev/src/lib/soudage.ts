// Calcul des temps de soudage, transposé du classeur "00 Calcul des temps de
// soudage" (userforms type_II / type_V / type_demiV / type_X / type_K et
// feuille "11.Récapitulatif").
//
// Le classeur donne le nombre de passes, les pauses, le total par barre et
// la masse déposée. Les cadences (vitesse de soudage, meulage, EPI,
// manutention) y sont des formules de cellules non reprises ici : ce sont
// des paramètres modifiables, proposés avec les valeurs relevées dans les
// récapitulatifs du classeur (voir PARAMETRES_DEFAUT).

export type Preparation = "angle" | "II" | "V" | "demiV" | "X" | "K"

export const PREPARATIONS: { key: Preparation; label: string }[] = [
  { key: "angle", label: "Soudure d'angle" },
  { key: "II", label: "Type ||" },
  { key: "V", label: "Type V" },
  { key: "demiV", label: "Type demi V" },
  { key: "X", label: "Type X" },
  { key: "K", label: "Type K" },
]

// Champs d'une ligne, saisis en texte (vide = non renseigné).
export type ChampSoudure =
  | "nombre"
  | "longueur"
  | "passes"
  | "epaisseur"
  | "angle"
  | "angle2"
  | "jeu"
  | "talon"
  | "hauteur"
  | "surepaisseur"

export type LigneSoudure = { id: number; designation: string; preparation: Preparation } & Record<
  ChampSoudure,
  string
>

// Champs de préparation à saisir selon le type, avec leur libellé.
export const CHAMPS_PREPARATION: Record<Preparation, { key: ChampSoudure; label: string }[]> = {
  angle: [{ key: "passes", label: "Nombre de passes" }],
  II: [
    { key: "epaisseur", label: "Épaisseur (mm)" },
    { key: "jeu", label: "Jeu (mm)" },
    { key: "surepaisseur", label: "Surépaisseur (%)" },
  ],
  V: [
    { key: "epaisseur", label: "Épaisseur (mm)" },
    { key: "angle", label: "Angle (°)" },
    { key: "jeu", label: "Jeu (mm)" },
    { key: "talon", label: "Talon (mm)" },
    { key: "surepaisseur", label: "Surépaisseur (%)" },
  ],
  demiV: [
    { key: "epaisseur", label: "Épaisseur (mm)" },
    { key: "angle", label: "Angle (°)" },
    { key: "jeu", label: "Jeu (mm)" },
    { key: "talon", label: "Talon (mm)" },
    { key: "surepaisseur", label: "Surépaisseur (%)" },
  ],
  X: [
    { key: "epaisseur", label: "Épaisseur (mm)" },
    { key: "angle", label: "Angle 1 (°)" },
    { key: "angle2", label: "Angle 2 (°)" },
    { key: "jeu", label: "Jeu (mm)" },
    { key: "talon", label: "Talon (mm)" },
    { key: "hauteur", label: "Hauteur chanfrein 2 (mm)" },
    { key: "surepaisseur", label: "Surépaisseur (%)" },
  ],
  K: [
    { key: "epaisseur", label: "Épaisseur (mm)" },
    { key: "angle", label: "Angle 1 (°)" },
    { key: "angle2", label: "Angle 2 (°)" },
    { key: "jeu", label: "Jeu (mm)" },
    { key: "talon", label: "Talon (mm)" },
    { key: "hauteur", label: "Hauteur chanfrein 2 (mm)" },
    { key: "surepaisseur", label: "Surépaisseur (%)" },
  ],
}

// Valeurs par défaut des userforms du classeur (le talon du type V et la
// hauteur des types X / K y sont laissés vides).
export function ligneVide(id: number): LigneSoudure {
  return {
    id,
    designation: "",
    preparation: "angle",
    nombre: "1",
    longueur: "",
    passes: "1",
    epaisseur: "",
    angle: "40",
    angle2: "40",
    jeu: "4",
    talon: "2",
    hauteur: "",
    surepaisseur: "15",
  }
}

const nombre = (brut: string) => (brut.trim() === "" ? NaN : Number(brut.replace(",", ".")))

const rad = (degres: number) => (degres * Math.PI) / 180

// Section du chanfrein en mm², null si un champ manque.
export function sectionChanfrein(ligne: LigneSoudure): number | null {
  const e = nombre(ligne.epaisseur)
  const jeu = nombre(ligne.jeu)
  const a1 = nombre(ligne.angle)
  const a2 = nombre(ligne.angle2)
  const talon = nombre(ligne.talon)
  const h = nombre(ligne.hauteur)
  let section: number
  switch (ligne.preparation) {
    case "angle":
      return null
    case "II":
      section = e * jeu
      break
    case "V":
      section = e * jeu + Math.tan(rad(a1) / 2) * (e - talon) ** 2
      break
    case "demiV":
      section = e * jeu + (Math.tan(rad(a1)) * (e - talon) ** 2) / 2
      break
    case "X":
    case "K":
      section = e * jeu + Math.tan(rad(a1) / 2) * (e - talon - h) ** 2 + Math.tan(rad(a2) / 2) * h ** 2
      break
  }
  return Number.isFinite(section) ? Math.round(section) : null
}

// Nombre de passes : saisi pour une soudure d'angle, sinon section du
// chanfrein / section d'une passe (9π mm²), majorée de la surépaisseur, + 1.
export function nombrePasses(ligne: LigneSoudure): number | null {
  if (ligne.preparation === "angle") {
    const passes = nombre(ligne.passes)
    return passes > 0 ? passes : null
  }
  const section = sectionChanfrein(ligne)
  const surepaisseur = nombre(ligne.surepaisseur)
  if (section === null || Number.isNaN(surepaisseur)) return null
  return Math.round((section / (9 * Math.PI)) * ((100 + surepaisseur) / 100)) + 1
}

// Cadences à saisir (texte, vide = non renseigné).
export type ParametreSoudure = "vitesse" | "meulage" | "epi" | "manutention" | "retournements"

export type ParametresSoudure = Record<ParametreSoudure, string>

export const PARAMETRES: { key: ParametreSoudure; label: string }[] = [
  { key: "vitesse", label: "Vitesse de soudage (mm/min, par passe)" },
  { key: "meulage", label: "Meulage (min par m de soudure)" },
  { key: "epi", label: "Mise en place des EPI (min, par 6 h de travail)" },
  { key: "manutention", label: "Manutention par retournement (min)" },
  { key: "retournements", label: "Retournements de la barre (0 à 3)" },
]

// Cadences relevées dans les "Récapitulatif des temps de soudure du projet"
// de 4 commandes de 2025 (DW-241, Pont Peyramale, Frankfurt EÜ, Ostrow),
// identiques de l'une à l'autre : 280 mm/min par passe, 25 min d'EPI par 6 h,
// 17 min par retournement et 3 retournements (2 sur Frankfurt). Le meulage
// est celui des plaques de tête et platines (11,5 min/m) ; les goussets et
// raidisseurs y sont comptés de 28 à 45 min/m selon la pièce.
export const PARAMETRES_DEFAUT: ParametresSoudure = {
  vitesse: "280",
  meulage: "11,5",
  epi: "25",
  manutention: "17",
  retournements: "3",
}

// Section de cordon retenue par le classeur pour la masse déposée (36 mm²)
// × masse volumique de l'acier (7800 kg/m³), en kg par m de soudure.
const MASSE_DEPOSEE_KG_PAR_M = 0.000036 * 7800

// Pauses du classeur : temps avec pauses = temps sans pause × (1 + 2/6).
const COEFFICIENT_PAUSES = 1 + 2 / 6

export type TempsSoudage = {
  longueurM: number // longueur à souder par barre
  masseKg: number // masse déposée par barre
  soudage: number // heures par barre
  meulage: number
  epi: number
  manutention: number
  sansPause: number
  avecPause: number
  total: number // avec pauses, pour toutes les barres
}

// Temps de soudage du projet, null tant que la vitesse de soudage ou une
// ligne (longueur, nombre de passes) n'est pas renseignée.
export function calculerSoudage(
  lignes: LigneSoudure[],
  parametres: ParametresSoudure,
  nbBarres: number
): TempsSoudage | null {
  const vitesse = nombre(parametres.vitesse)
  if (lignes.length === 0 || !(vitesse > 0)) return null
  const ouZero = (brut: string) => nombre(brut) || 0

  let longueurMm = 0
  let minutesSoudage = 0
  for (const ligne of lignes) {
    const longueur = nombre(ligne.nombre) * nombre(ligne.longueur)
    const passes = nombrePasses(ligne)
    if (!(longueur > 0) || passes === null) return null
    longueurMm += longueur
    minutesSoudage += (longueur * passes) / vitesse
  }

  const longueurM = longueurMm / 1000
  const soudage = minutesSoudage / 60
  const meulage = (longueurM * ouZero(parametres.meulage)) / 60
  // Classeur : nombre de mises en place des EPI = temps de travail / 6.
  const epi = (((soudage + meulage) / 6) * ouZero(parametres.epi)) / 60
  const manutention = (ouZero(parametres.retournements) * ouZero(parametres.manutention)) / 60
  const sansPause = soudage + meulage + epi + manutention
  const avecPause = sansPause * COEFFICIENT_PAUSES
  return {
    longueurM,
    masseKg: longueurM * MASSE_DEPOSEE_KG_PAR_M,
    soudage,
    meulage,
    epi,
    manutention,
    sansPause,
    avecPause,
    total: avecPause * nbBarres,
  }
}
