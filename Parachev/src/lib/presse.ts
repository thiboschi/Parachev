// Temps barème de contre-flèche à la presse, repris de la feuille "PRESSE"
// ("PRESSE-PARA") des fiches de prévision : c'est le temps que l'atelier
// porte sur la ligne "PRESSE" de la fiche. Il ne couvre que la mise en
// contre-flèche : le redressage ("PRESSE NR") est une ligne à part de la
// fiche, sans barème. Dans le chiffrage, il chiffre le poste à la place de
// la calibration dès qu'une contre-flèche est saisie.

import { designationProfil } from "@/lib/profils"

// Contre-flèche en mm, borne haute de chaque colonne du barème.
const FLECHES_MAX = [50, 100, 150, 200, 250, 300, 350, 500, 750, 900]

// Heures par barre selon la hauteur du profil (borne haute de chaque ligne)
// et la contre-flèche ; null = case vide du barème.
const HEURES_PAR_HAUTEUR: [hauteurMax: number, heures: (number | null)[]][] = [
  [200, [0.2, 0.21, 0.26, 0.4, 0.45, 0.5, 0.55, 0.8, null, null]],
  [300, [0.21, 0.26, 0.32, 0.45, 0.53, 0.58, 0.63, 0.9, null, null]],
  [450, [0.24, 0.3, 0.4, 0.53, 0.59, 0.64, 0.7, 1, null, 1.1]],
  [650, [0.29, 0.4, 0.46, 0.59, 0.64, 0.69, 0.75, 1.25, null, null]],
  [800, [0.37, 0.53, 0.6, 0.64, 0.92, 0.97, 1.02, 1.75, null, null]],
  [1000, [0.5, 0.72, 0.8, 0.92, 1.12, 1.2, 1.3, 2, 2.4, 3.4]],
  [1100, [0.8, 1, 1.2, 1.4, 1.7, 2, 2.5, 3.5, null, null]],
]

// Mise en place de la barre, en heures selon sa longueur en m (borne haute
// de chaque classe) ; au-delà de 30 m, avec le pont.
const MISE_EN_PLACE: [longueurMax: number, heures: number][] = [
  [10, 0.1],
  [20, 0.3],
  [30, 0.5],
  [Infinity, 1.3],
]
// Barre de plus de 20 m : 0,1 h de plus par tranche de 5 m au-delà.
const LONGUEUR_SANS_SUPPLEMENT_M = 20
const SUPPLEMENT_PAR_METRE_H = 0.1 / 5

/**
 * Heures barème de mise en contre-flèche de `nbBarres` barres de `longueur` m,
 * chacune avec une contre-flèche de `contreFleche` mm. Null sans barre,
 * longueur ou contre-flèche, ou hors barème : profil de plus de 1100 mm ou
 * sans hauteur lisible, contre-flèche de plus de 900 mm, case vide.
 */
export function heuresContreFleche({
  profil,
  nbBarres,
  longueur,
  contreFleche,
}: {
  profil: string
  nbBarres: number
  longueur: number
  contreFleche: number
}): number | null {
  if (!(nbBarres > 0) || !(longueur > 0) || !(contreFleche > 0)) return null
  // "HE 600 B" -> 600, "HD 400 x 237" -> 400, "IPE A 500" -> 500.
  const hauteur = Number((designationProfil(profil) ?? profil).match(/\d+/)?.[0])
  const ligne = HEURES_PAR_HAUTEUR.find(([max]) => hauteur <= max)?.[1]
  const table = ligne?.[FLECHES_MAX.findIndex((max) => contreFleche <= max)]
  if (table == null) return null
  const miseEnPlace = MISE_EN_PLACE.find(([max]) => longueur <= max)![1]
  const supplement = Math.max(longueur - LONGUEUR_SANS_SUPPLEMENT_M, 0) * SUPPLEMENT_PAR_METRE_H
  return nbBarres * (table + supplement + miseEnPlace)
}
