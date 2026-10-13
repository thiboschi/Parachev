// Temps barème du robot d'oxycoupage, repris de la feuille "ROBOT" des fiches
// de prévision : c'est le temps que l'atelier porte sur la ligne "ROBOT" de
// la fiche. Dans le chiffrage, il chiffre le poste à la place de la
// calibration dès qu'une opération aux bouts ou des oblongs sont saisis.

import { designationProfil } from "@/lib/profils"

/** Opérations du barème, faites aux bouts de la barre. */
export const OPERATIONS_ROBOT = {
  oxy_90: "Oxycoupage à 90°",
  chanfrein_sncf: "Chanfrein SNCF",
  skanska_wip: "Skanska ou WIP",
  chanfrein_hd: "Préparation chanfrein HD",
} as const

export type OperationRobot = keyof typeof OPERATIONS_ROBOT

// Hauteur du profil en mm, borne haute de chaque ligne du barème ("200-300",
// "400-500"… : un profil entre deux lignes prend la suivante).
const HAUTEURS_MAX = [300, 500, 700, 900, 1100]

// Heures par barre selon la hauteur du profil, pour un bout puis pour les
// deux ; null = case vide du barème. Le barème les donne pour les HEA, HEB
// et HEM : elles sont étendues aux autres profils de même hauteur, sauf aux
// HD 400, qui ont leur propre colonne.
const HEURES_PAR_HAUTEUR: Record<
  Exclude<OperationRobot, "chanfrein_hd">,
  [unBout: number | null, deuxBouts: number | null][]
> = {
  oxy_90: [[0.5, 0.6], [0.6, 0.8], [0.9, 1.1], [1.1, 1.4], [1.3, 1.6]],
  chanfrein_sncf: [[0.6, 0.7], [0.8, 1], [0.9, 1.2], [1.3, 1.6], [1.7, 2]],
  skanska_wip: [[null, null], [null, 2.5], [null, 3], [null, 4], [null, 4]],
}

// Préparation de chanfrein des HD 400, aux deux bouts : heures par barre
// selon la masse linéique (borne haute de chaque ligne, en kg/m) ; null =
// case vide du barème.
const CHANFREIN_HD400: [masseMax: number, heures: number | null][] = [
  [314, null],
  [509, 2.5],
  [818, 3],
  [1086, 3.5],
  [1299, 4],
]

// Barre de plus de 30 m, transportée avec deux ponts : 0,9 h de plus par
// barre (colonnes "2 BTS > 30m" ; appliqué aussi là où le barème n'a pas
// cette colonne).
const LONGUEUR_DEUX_PONTS_M = 30
const SUPPLEMENT_DEUX_PONTS_H = 0.9

/**
 * Heures barème de l'opération `operation` faite à `bouts` bouts (1 ou 2) de
 * `nbBarres` barres de `longueur` m (0 si elle n'est pas saisie : barre de
 * 30 m au plus). Null sans barre, ou hors barème : profil de plus de
 * 1100 mm ou sans hauteur lisible, opération qui n'est pas celle du profil
 * (HD 400 ou non), case vide.
 */
export function heuresBoutsRobot({
  profil,
  nbBarres,
  longueur,
  operation,
  bouts,
}: {
  profil: string
  nbBarres: number
  longueur: number
  operation: OperationRobot
  bouts: 1 | 2
}): number | null {
  if (!(nbBarres > 0)) return null
  const designation = designationProfil(profil) ?? profil
  // "HD 400 x 509" -> 509.
  const masseHd400 = designation.match(/^HD 400 x ([\d.]+)$/)?.[1]
  let table: number | null | undefined
  if (operation === "chanfrein_hd") {
    table =
      masseHd400 !== undefined && bouts === 2
        ? CHANFREIN_HD400.find(([max]) => Number(masseHd400) <= max)?.[1]
        : null
  } else if (masseHd400 === undefined) {
    // "HE 600 B" -> 600, "HL 1000 x 477" -> 1000, "IPE A 500" -> 500.
    const hauteur = Number(designation.match(/\d+/)?.[0])
    table = HEURES_PAR_HAUTEUR[operation][HAUTEURS_MAX.findIndex((max) => hauteur <= max)]?.[bouts - 1]
  }
  if (table == null) return null
  const supplement = longueur > LONGUEUR_DEUX_PONTS_M ? SUPPLEMENT_DEUX_PONTS_H : 0
  return nbBarres * (table + supplement)
}

// Trous oblongs oxycoupés au robot : heures par oblong, pour les HEA et HEB
// (âme de 8 à 19 mm) puis pour les HEM (âme de 21 mm).
const HEURES_PAR_OBLONG = 0.073
const HEURES_PAR_OBLONG_HEM = 0.083

/**
 * Heures barème d'oxycoupage de `nbOblongs` trous oblongs au robot. Null
 * sans oblong, ou hors barème : profil autre que HEA, HEB ou HEM.
 */
export function heuresOblongsRobot(profil: string, nbOblongs: number): number | null {
  const serie = designationProfil(profil)?.match(/^HE \d+ (AA|A|B|M)$/)?.[1]
  if (!(nbOblongs > 0) || serie === undefined) return null
  return nbOblongs * (serie === "M" ? HEURES_PAR_OBLONG_HEM : HEURES_PAR_OBLONG)
}
