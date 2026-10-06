// Temps barème de sciage (mise à longueur), repris des feuilles "DATA-TEMPS"
// (colonnes "SAWING [h/BEAM]", AMCS - Eurostructures v2.6) et "SCIE" des
// fiches de prévision. Dans le chiffrage, il chiffre le poste à la place de
// la calibration dès que des coupes sont saisies : la calibration ne connaît
// que la taille de la commande, pas le nombre de coupes.

import { designationProfil } from "@/lib/profils"

// Heures par barre coupée aux deux bouts à 90°, longueur jusqu'à 22,3 m.
const HEURES_DEUX_BOUTS: Record<string, number> = {
  // HD
  "HD 260 x 54.1": 0.283, "HD 260 x 68.2": 0.283, "HD 260 x 93.0": 0.305, "HD 260 x 114": 0.305,
  "HD 260 x 142": 0.305, "HD 260 x 172": 0.332, "HD 320 x 74.2": 0.351, "HD 320 x 97.6": 0.351,
  "HD 320 x 127": 0.373, "HD 320 x 158": 0.373, "HD 320 x 198": 0.381, "HD 320 x 245": 0.381,
  "HD 320 x 300": 0.386, "HD 360 x 134": 0.381, "HD 360 x 147": 0.386, "HD 360 x 162": 0.386,
  "HD 360 x 179": 0.386, "HD 360 x 196": 0.386, "HD 400 x 187": 0.6, "HD 400 x 216": 0.6,
  "HD 400 x 237": 0.6, "HD 400 x 262": 0.6, "HD 400 x 287": 0.8, "HD 400 x 314": 0.8,
  "HD 400 x 347": 0.8, "HD 400 x 382": 0.8, "HD 400 x 421": 1, "HD 400 x 463": 1,
  "HD 400 x 509": 1, "HD 400 x 551": 1, "HD 400 x 592": 1.4, "HD 400 x 634": 1.4,
  "HD 400 x 677": 1.4, "HD 400 x 744": 1.4, "HD 400 x 818": 2, "HD 400 x 900": 2,
  "HD 400 x 990": 2, "HD 400 x 1086": 2,
  // HE
  "HE 100 B": 0.229, "HE 100 M": 0.229, "HE 120 AA": 0.229, "HE 120 A": 0.229, "HE 120 B": 0.229,
  "HE 120 M": 0.229, "HE 140 AA": 0.229, "HE 140 A": 0.229, "HE 140 B": 0.229, "HE 140 M": 0.229,
  "HE 160 AA": 0.229, "HE 160 A": 0.229, "HE 160 B": 0.229, "HE 160 M": 0.229, "HE 180 AA": 0.229,
  "HE 180 A": 0.229, "HE 180 B": 0.229, "HE 180 M": 0.229, "HE 200 AA": 0.229, "HE 200 A": 0.229,
  "HE 200 B": 0.229, "HE 200 M": 0.253, "HE 220 AA": 0.253, "HE 220 A": 0.253, "HE 220 B": 0.253,
  "HE 220 M": 0.283, "HE 240 AA": 0.253, "HE 240 A": 0.253, "HE 240 B": 0.283, "HE 240 M": 0.305,
  "HE 260 AA": 0.283, "HE 260 A": 0.283, "HE 260 B": 0.305, "HE 260 M": 0.332, "HE 280 AA": 0.305,
  "HE 280 A": 0.305, "HE 280 B": 0.332, "HE 280 M": 0.351, "HE 300 AA": 0.332, "HE 300 A": 0.332,
  "HE 300 B": 0.351, "HE 300 M": 0.381, "HE 320 AA": 0.351, "HE 320 A": 0.351, "HE 320 B": 0.373,
  "HE 320 M": 0.381, "HE 340 AA": 0.373, "HE 340 A": 0.373, "HE 340 B": 0.381, "HE 340 M": 0.386,
  "HE 360 AA": 0.373, "HE 360 A": 0.381, "HE 360 B": 0.386, "HE 360 M": 0.386, "HE 400 AA": 0.386,
  "HE 400 A": 0.386, "HE 400 B": 0.403, "HE 400 M": 0.403, "HE 450 AA": 0.403, "HE 450 A": 0.403,
  "HE 450 B": 0.427, "HE 450 M": 0.427, "HE 500 AA": 0.427, "HE 500 A": 0.427, "HE 500 B": 0.446,
  "HE 500 M": 0.446, "HE 550 AA": 0.446, "HE 550 A": 0.446, "HE 550 B": 0.469, "HE 550 M": 0.469,
  "HE 600 AA": 0.469, "HE 600 A": 0.469, "HE 600 B": 0.49, "HE 600 M": 0.49, "HE 600 x 337": 0.49,
  "HE 600 x 399": 0.49, "HE 650 AA": 0.49, "HE 650 A": 0.49, "HE 650 B": 0.516, "HE 650 M": 0.516,
  "HE 650 x 343": 0.516, "HE 650 x 407": 0.516, "HE 700 AA": 0.516, "HE 700 A": 0.516,
  "HE 700 B": 0.538, "HE 700 M": 0.538, "HE 700 x 352": 0.538, "HE 700 x 418": 0.538,
  "HE 800 AA": 0.538, "HE 800 A": 0.538, "HE 800 B": 0.596, "HE 800 M": 0.596,
  "HE 800 x 373": 0.596, "HE 800 x 444": 0.596, "HE 900 AA": 0.596, "HE 900 A": 0.596,
  "HE 900 B": 0.634, "HE 900 M": 0.634, "HE 900 x 391": 0.634, "HE 900 x 466": 0.634,
  "HE 1000 AA": 0.634, "HE 1000 A": 0.634, "HE 1000 B": 0.688, "HE 1000 M": 0.688,
  "HE 1000 x 393": 0.688, "HE 1000 x 409": 0.688, "HE 1000 x 488": 0.688, "HE 1000 x 579": 0.688,
  // HL
  "HL 920 x 342": 0.634, "HL 920 x 365": 0.634, "HL 920 x 387": 0.634, "HL 920 x 417": 0.634,
  "HL 920 x 446": 0.634, "HL 920 x 488": 0.634, "HL 920 x 534": 0.634, "HL 920 x 585": 0.634,
  "HL 920 x 653": 0.634, "HL 920 x 784": 0.634, "HL 920 x 967": 0.688, "HL 1000 A": 0.634,
  "HL 1000 B": 0.688, "HL 1000 M": 0.688, "HL 1000 x 296": 0.634, "HL 1000 x 477": 0.688,
  "HL 1000 x 554": 0.688, "HL 1000 x 642": 0.688, "HL 1000 x 748": 1.6, "HL 1000 x 883": 1.6,
  "HL 1100 A": 1.6, "HL 1100 B": 1.6, "HL 1100 M": 1.6, "HL 1100 R": 1.6,
  // HP
  "HP 200 x 43": 0.229, "HP 200 x 53": 0.253, "HP 220 x 57": 0.253, "HP 260 x 75": 0.283,
  "HP 260 x 87": 0.283, "HP 305 x 79": 0.332, "HP 305 x 88": 0.351, "HP 305 x 95": 0.351,
  "HP 305 x 110": 0.351, "HP 305 x 126": 0.351, "HP 305 x 149": 0.351, "HP 305 x 180": 0.373,
  "HP 305 x 186": 0.373, "HP 305 x 223": 0.373, "HP 320 x 88": 0.351, "HP 320 x 103": 0.351,
  "HP 320 x 117": 0.351, "HP 320 x 147": 0.351, "HP 320 x 184": 0.373, "HP 360 x 84": 0.381,
  "HP 360 x 109": 0.381, "HP 360 x 133": 0.381, "HP 360 x 152": 0.381, "HP 360 x 174": 0.386,
  "HP 360 x 180": 0.386, "HP 400 x 122": 0.381, "HP 400 x 140": 0.381, "HP 400 x 158": 0.381,
  "HP 400 x 176": 0.386, "HP 400 x 194": 0.386, "HP 400 x 213": 0.386, "HP 400 x 231": 0.386,
  // IPE
  "IPE 100": 0.17, "IPE 120": 0.17, "IPE 140": 0.17, "IPE 160": 0.17, "IPE 180": 0.17,
  "IPE 200": 0.17, "IPE 220": 0.17, "IPE 240": 0.17, "IPE 270": 0.17, "IPE 300": 0.216,
  "IPE 330": 0.237, "IPE 360": 0.259, "IPE 400": 0.284, "IPE 450": 0.314, "IPE 500": 0.344,
  "IPE 550": 0.375, "IPE 600": 0.404, "IPE 750 x 147": 0.528, "IPE 750 x 173": 0.528,
  "IPE 750 x 196": 0.528, "IPE A 120": 0.17, "IPE A 140": 0.17, "IPE A 160": 0.17,
  "IPE A 180": 0.17, "IPE A 200": 0.17, "IPE A 220": 0.17, "IPE A 240": 0.17, "IPE A 270": 0.17,
  "IPE A 300": 0.216, "IPE A 330": 0.237, "IPE A 360": 0.259, "IPE A 400": 0.259,
  "IPE A 450": 0.284, "IPE A 500": 0.314, "IPE A 550": 0.344, "IPE A 600": 0.375,
  "IPE O 180": 0.17, "IPE O 200": 0.17, "IPE O 220": 0.17, "IPE O 240": 0.17, "IPE O 270": 0.17,
  "IPE O 300": 0.216, "IPE O 330": 0.237, "IPE O 360": 0.259, "IPE O 400": 0.284,
  "IPE O 450": 0.314, "IPE O 500": 0.344, "IPE O 550": 0.469, "IPE O 600": 0.49,
  // IPN
  "IPN 120": 0.229, "IPN 140": 0.229, "IPN 160": 0.229, "IPN 180": 0.229, "IPN 200": 0.229,
  "IPN 220": 0.253, "IPN 240": 0.283, "IPN 260": 0.305, "IPN 280": 0.332, "IPN 300": 0.351,
  "IPN 320": 0.373, "IPN 340": 0.381, "IPN 360": 0.386, "IPN 380": 0.386, "IPN 400": 0.403,
  "IPN 450": 0.427, "IPN 500": 0.446, "IPN 550": 0.469, "IPN 600": 0.49,
}

// Feuille SCIE : une barre coupée à un seul bout prend 75 % du temps d'une
// barre coupée aux deux (HE jusqu'à 700 et IPE ; 57 à 66 % sur les HE 800 à
// 1000, non repris) -- soit la moitié du temps pour la mise en place de la
// barre et un quart par coupe, prolongé au-delà de deux coupes.
const PART_MISE_EN_PLACE = 0.5
const PART_PAR_COUPE = 0.25

// Barres longues (plus de manutention) : heures en plus par barre, ou
// majoration en proportion sur les HD 400.
const LONGUEURS_MAJOREES: { auDela: number; heures: number; coefficientHd400: number }[] = [
  { auDela: 30, heures: 0.5, coefficientHd400: 1.44 },
  { auDela: 22.3, heures: 0.25, coefficientHd400: 1.2 },
]
// Les plus lourds des HL, à 1,6 h quelle que soit la longueur.
const SANS_SUPPLEMENT_LONGUEUR = /^HL 1100 |^HL 1000 x (748|883)$/

// Barre avec des coupes biaises (parallèles, 45° et 1150 mm au plus) : 0,2 h
// en plus, 10 % sur les HD 400. Le barème les renvoie au robot pour les
// profils que la scie ne coupe pas en biais.
const HEURES_BIAIS = 0.2
const COEFFICIENT_BIAIS_HD400 = 1.1
const BIAIS_AU_ROBOT = /^HL 1[01]00 |^HD 400 x 1086$/

/**
 * Heures barème de sciage de `nbBarres` barres de `longueur` m (0 si elle
 * n'est pas saisie : barre de 22,3 m au plus), chacune avec `coupesDroites`
 * coupes à 90° et `coupesBiaises` coupes biaises. Null sans barre ni coupe,
 * ou hors barème : profil absent, coupe biaise renvoyée au robot.
 */
export function heuresSciage({
  profil,
  nbBarres,
  longueur,
  coupesDroites,
  coupesBiaises,
}: {
  profil: string
  nbBarres: number
  longueur: number
  coupesDroites: number
  coupesBiaises: number
}): number | null {
  const designation = designationProfil(profil) ?? profil
  const deuxBouts = HEURES_DEUX_BOUTS[designation]
  const coupes = coupesDroites + coupesBiaises
  const biais = coupesBiaises > 0
  if (deuxBouts === undefined || !(nbBarres > 0) || !(coupes > 0) || coupesDroites < 0 || coupesBiaises < 0) {
    return null
  }
  if (biais && BIAIS_AU_ROBOT.test(designation)) return null

  const hd400 = designation.startsWith("HD 400 ")
  const majoration = SANS_SUPPLEMENT_LONGUEUR.test(designation)
    ? undefined
    : LONGUEURS_MAJOREES.find(({ auDela }) => longueur > auDela)
  let heures = deuxBouts * (PART_MISE_EN_PLACE + PART_PAR_COUPE * coupes)
  if (hd400) {
    heures *= (majoration?.coefficientHd400 ?? 1) * (biais ? COEFFICIENT_BIAIS_HD400 : 1)
  } else {
    heures += (majoration?.heures ?? 0) + (biais ? HEURES_BIAIS : 0)
  }
  return nbBarres * heures
}
