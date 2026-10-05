// Temps barème de perçage et de trous oblongs, repris des feuilles "FMAN"
// (forage manuel), "FWAG" (forage numérique) et "DATA-TEMPS" (oblongs) des
// fiches de prévision. Indicatifs : affichés dans le chiffrage à côté des
// heures de la calibration, sans les remplacer.

import { designationProfil } from "@/lib/profils"

// Forage manuel avec avant-trou, minutes par trou selon le diamètre du foret
// (borne haute de chaque colonne de FMAN), ligne "épaisseur 14 mm" : les
// épaisseurs de 8 à 21 mm s'en écartent de moins de 10 %. Au-delà de 21 mm,
// FMAN majore (×1,25 à 26 mm, ×1,5 à 32 mm, ×2 à 40 mm) : non repris ici,
// l'épaisseur n'est pas saisie.
const MINUTES_MANUEL: [diametreMax: number, minutes: number][] = [
  [24, 0.65],
  [28, 0.67],
  [32, 0.69],
  [35, 0.72],
  [40, 0.83],
  [42, 0.87],
  [45, 0.97],
  [50, 1.46],
  [55, 1.65],
  [60, 2.1],
  [65, 2.8],
  [70, 3.06],
  [80, 3.3],
  [90, 3.6],
  [100, 4],
  [120, 5],
]

// FMAN, "TEMPS DE PERCAGE" : par trou, 0,25 min de positionnement et 15 %
// du temps de perçage en plus, puis 0,3 h de mise en route.
const POSITIONNEMENT_MANUEL_MIN = 0.25
const MAJORATION_MANUEL = 0.15
const MISE_EN_ROUTE_MANUEL_H = 0.3

/** Heures barème de forage manuel, null hors barème (Ø > 120 mm). */
export function heuresForageManuel(nbTrous: number, diametre: number): number | null {
  if (!(nbTrous > 0) || !(diametre > 0)) return null
  const minutes = MINUTES_MANUEL.find(([max]) => diametre <= max)?.[1]
  if (minutes === undefined) return null
  return (
    (nbTrous * (minutes * (1 + MAJORATION_MANUEL) + POSITIONNEMENT_MANUEL_MIN)) / 60 +
    MISE_EN_ROUTE_MANUEL_H
  )
}

// Forage numérique dans l'âme, minutes par trou Ø18 selon la famille et la
// hauteur du profil (borne haute de chaque ligne de FWAG).
const MINUTES_NUMERIQUE_AME: Record<string, [hauteurMax: number, minutes: number][]> = {
  HEA: [
    [280, 0.2],
    [360, 0.275],
    [500, 0.35],
    [700, 0.425],
    [1000, 0.5],
  ],
  HEB: [
    [280, 0.275],
    [360, 0.35],
    [500, 0.425],
    [700, 0.5],
    [1000, 0.575],
  ],
  HEM: [
    [280, 0.5],
    [1000, 0.65],
  ],
}

// FWAG : +0,1 min par classe de diamètre au-dessus de Ø18 (Ø20-24, Ø26-28,
// Ø30-32), un trou dans l'aile = 1,5 × un trou dans l'âme, et 0,3 min par
// trou en plus du perçage.
const CLASSES_DIAMETRE_NUMERIQUE = [18, 24, 28, 32]
const SUPPLEMENT_PAR_CLASSE_MIN = 0.1
const COEFFICIENT_AILE = 1.5
const POSITIONNEMENT_NUMERIQUE_MIN = 0.3

/**
 * Heures barème de forage numérique, tous les trous dans l'âme ou tous dans
 * l'aile. Null hors barème : profil autre que HEA / HEB / HEM jusqu'à 1000,
 * ou Ø > 32 mm.
 */
export function heuresForageNumerique(
  nbTrous: number,
  diametre: number,
  profil: string
): { ame: number; aile: number } | null {
  if (!(nbTrous > 0) || !(diametre > 0)) return null
  // "HE 600 B" -> barème HEB, hauteur 600.
  const [, hauteur, serie] = designationProfil(profil)?.match(/^HE (\d+) ([ABM])$/) ?? []
  const base = MINUTES_NUMERIQUE_AME[`HE${serie}`]?.find(([max]) => Number(hauteur) <= max)?.[1]
  const classe = CLASSES_DIAMETRE_NUMERIQUE.findIndex((max) => diametre <= max)
  if (base === undefined || classe < 0) return null
  const ame = base + classe * SUPPLEMENT_PAR_CLASSE_MIN
  const heures = (minutes: number) => (nbTrous * (minutes + POSITIONNEMENT_NUMERIQUE_MIN)) / 60
  return { ame: heures(ame), aile: heures(ame * COEFFICIENT_AILE) }
}

// Oblongs oxycoupés (DATA-TEMPS, colonnes "OBLONG") : temps = contour de
// l'oblong / vitesse de coupe, selon que le préforage est au programme ou non.
const VITESSE_OBLONG_AVEC_PREFORAGE_MM_MIN = 68.2
const VITESSE_OBLONG_SANS_PREFORAGE_MM_MIN = 52.8

/**
 * Heures barème d'oxycoupage de trous oblongs de `longueur` × `largeur` mm
 * (contour : deux demi-cercles de diamètre `largeur` et deux côtés droits).
 * Null si une dimension manque ou si la longueur est inférieure à la largeur.
 */
export function heuresOblongs(
  nbOblongs: number,
  longueur: number,
  largeur: number
): { avecPreforage: number; sansPreforage: number } | null {
  if (!(nbOblongs > 0) || !(largeur > 0) || !(longueur >= largeur)) return null
  const contour = Math.PI * largeur + (longueur - largeur) * 2
  const heures = (vitesse: number) => (nbOblongs * contour) / vitesse / 60
  return {
    avecPreforage: heures(VITESSE_OBLONG_AVEC_PREFORAGE_MM_MIN),
    sansPreforage: heures(VITESSE_OBLONG_SANS_PREFORAGE_MM_MIN),
  }
}
