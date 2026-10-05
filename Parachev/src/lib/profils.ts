// Désignations des profils : forme du catalogue ArcelorMittal, celle du
// barème atelier (feuille "DATA-TEMPS" des fiches de prévision, AMCS -
// Eurostructures v2.6) et du RDE. Les fiches, l'ERP et les mails écrivent le
// même profil de plusieurs façons ("HEB 600", "HE600B", "HD400*237") : tout
// est ramené à cette forme avant d'être filtré ou proposé.

/** Profils du barème atelier (DATA-TEMPS), par famille puis par taille. */
export const PROFILS_CATALOGUE: readonly string[] = [
  // HD (38)
  "HD 260 x 54.1", "HD 260 x 68.2", "HD 260 x 93.0", "HD 260 x 114", "HD 260 x 142", "HD 260 x 172",
  "HD 320 x 74.2", "HD 320 x 97.6", "HD 320 x 127", "HD 320 x 158", "HD 320 x 198", "HD 320 x 245",
  "HD 320 x 300", "HD 360 x 134", "HD 360 x 147", "HD 360 x 162", "HD 360 x 179", "HD 360 x 196",
  "HD 400 x 187", "HD 400 x 216", "HD 400 x 237", "HD 400 x 262", "HD 400 x 287", "HD 400 x 314",
  "HD 400 x 347", "HD 400 x 382", "HD 400 x 421", "HD 400 x 463", "HD 400 x 509", "HD 400 x 551",
  "HD 400 x 592", "HD 400 x 634", "HD 400 x 677", "HD 400 x 744", "HD 400 x 818", "HD 400 x 900",
  "HD 400 x 990", "HD 400 x 1086",
  // HE (108)
  "HE 100 B", "HE 100 M", "HE 120 AA", "HE 120 A", "HE 120 B", "HE 120 M", "HE 140 AA", "HE 140 A",
  "HE 140 B", "HE 140 M", "HE 160 AA", "HE 160 A", "HE 160 B", "HE 160 M", "HE 180 AA", "HE 180 A",
  "HE 180 B", "HE 180 M", "HE 200 AA", "HE 200 A", "HE 200 B", "HE 200 M", "HE 220 AA", "HE 220 A",
  "HE 220 B", "HE 220 M", "HE 240 AA", "HE 240 A", "HE 240 B", "HE 240 M", "HE 260 AA", "HE 260 A",
  "HE 260 B", "HE 260 M", "HE 280 AA", "HE 280 A", "HE 280 B", "HE 280 M", "HE 300 AA", "HE 300 A",
  "HE 300 B", "HE 300 M", "HE 320 AA", "HE 320 A", "HE 320 B", "HE 320 M", "HE 340 AA", "HE 340 A",
  "HE 340 B", "HE 340 M", "HE 360 AA", "HE 360 A", "HE 360 B", "HE 360 M", "HE 400 AA", "HE 400 A",
  "HE 400 B", "HE 400 M", "HE 450 AA", "HE 450 A", "HE 450 B", "HE 450 M", "HE 500 AA", "HE 500 A",
  "HE 500 B", "HE 500 M", "HE 550 AA", "HE 550 A", "HE 550 B", "HE 550 M", "HE 600 AA", "HE 600 A",
  "HE 600 B", "HE 600 M", "HE 600 x 337", "HE 600 x 399", "HE 650 AA", "HE 650 A", "HE 650 B",
  "HE 650 M", "HE 650 x 343", "HE 650 x 407", "HE 700 AA", "HE 700 A", "HE 700 B", "HE 700 M",
  "HE 700 x 352", "HE 700 x 418", "HE 800 AA", "HE 800 A", "HE 800 B", "HE 800 M", "HE 800 x 373",
  "HE 800 x 444", "HE 900 AA", "HE 900 A", "HE 900 B", "HE 900 M", "HE 900 x 391", "HE 900 x 466",
  "HE 1000 AA", "HE 1000 A", "HE 1000 B", "HE 1000 M", "HE 1000 x 393", "HE 1000 x 409",
  "HE 1000 x 488", "HE 1000 x 579",
  // HL (24)
  "HL 920 x 342", "HL 920 x 365", "HL 920 x 387", "HL 920 x 417", "HL 920 x 446", "HL 920 x 488",
  "HL 920 x 534", "HL 920 x 585", "HL 920 x 653", "HL 920 x 784", "HL 920 x 967", "HL 1000 A",
  "HL 1000 B", "HL 1000 M", "HL 1000 x 296", "HL 1000 x 477", "HL 1000 x 554", "HL 1000 x 642",
  "HL 1000 x 748", "HL 1000 x 883", "HL 1100 A", "HL 1100 B", "HL 1100 M", "HL 1100 R",
  // HP (32)
  "HP 200 x 43", "HP 200 x 53", "HP 220 x 57", "HP 260 x 75", "HP 260 x 87", "HP 305 x 79",
  "HP 305 x 88", "HP 305 x 95", "HP 305 x 110", "HP 305 x 126", "HP 305 x 149", "HP 305 x 180",
  "HP 305 x 186", "HP 305 x 223", "HP 320 x 88", "HP 320 x 103", "HP 320 x 117", "HP 320 x 147",
  "HP 320 x 184", "HP 360 x 84", "HP 360 x 109", "HP 360 x 133", "HP 360 x 152", "HP 360 x 174",
  "HP 360 x 180", "HP 400 x 122", "HP 400 x 140", "HP 400 x 158", "HP 400 x 176", "HP 400 x 194",
  "HP 400 x 213", "HP 400 x 231",
  // IPE (49)
  "IPE 100", "IPE 120", "IPE 140", "IPE 160", "IPE 180", "IPE 200", "IPE 220", "IPE 240", "IPE 270",
  "IPE 300", "IPE 330", "IPE 360", "IPE 400", "IPE 450", "IPE 500", "IPE 550", "IPE 600",
  "IPE 750 x 147", "IPE 750 x 173", "IPE 750 x 196", "IPE A 120", "IPE A 140", "IPE A 160",
  "IPE A 180", "IPE A 200", "IPE A 220", "IPE A 240", "IPE A 270", "IPE A 300", "IPE A 330",
  "IPE A 360", "IPE A 400", "IPE A 450", "IPE A 500", "IPE A 550", "IPE A 600", "IPE O 180",
  "IPE O 200", "IPE O 220", "IPE O 240", "IPE O 270", "IPE O 300", "IPE O 330", "IPE O 360",
  "IPE O 400", "IPE O 450", "IPE O 500", "IPE O 550", "IPE O 600",
  // IPN (19)
  "IPN 120", "IPN 140", "IPN 160", "IPN 180", "IPN 200", "IPN 220", "IPN 240", "IPN 260", "IPN 280",
  "IPN 300", "IPN 320", "IPN 340", "IPN 360", "IPN 380", "IPN 400", "IPN 450", "IPN 500", "IPN 550",
  "IPN 600",
]

// Familles reconnues : celles du barème, plus les profils britanniques et
// américains (UB, UC, W) et les U (UPE, UPN) rencontrés dans les affaires.
// Par famille : les séries admises et le nombre de dimensions écrites après
// la taille (masse linéique des HD, largeur et masse des UB/UC…). Un HE, un
// HL ou un IPE porte soit une série ("HE 600 B"), soit une masse
// ("HE 600 x 399"), les IPE pouvant n'avoir ni l'une ni l'autre.
const FAMILLES: Record<string, { series: string[]; dimensions: number[] }> = {
  HD: { series: [], dimensions: [1] },
  HE: { series: ["AA", "A", "B", "M"], dimensions: [1] },
  HL: { series: ["AA", "A", "B", "M", "R"], dimensions: [1] },
  HP: { series: [], dimensions: [1] },
  IPE: { series: ["AA", "A", "O"], dimensions: [0, 1] },
  IPN: { series: [], dimensions: [0] },
  UB: { series: [], dimensions: [2] },
  UC: { series: [], dimensions: [2] },
  UPE: { series: [], dimensions: [0] },
  UPN: { series: [], dimensions: [0] },
  W: { series: [], dimensions: [1] },
}
const NOMS_FAMILLES = Object.keys(FAMILLES).join("|")
const SERIE = "AA|[ABMOR]"
const DESIGNATION = new RegExp(`^(${NOMS_FAMILLES})(${SERIE})?(\\d+)(${SERIE})?((?:X\\d+(?:\\.\\d+)?)*)$`)
const DEBUT_DESIGNATION = new RegExp(`^(${NOMS_FAMILLES})(?:${SERIE})?\\d`)

/** Majuscules, sans espace, "x" / "*" / "×" et virgule décimale unifiés. */
function compacter(profil: string): string {
  return profil.toUpperCase().replace(/\s/g, "").replace(/[*×]/g, "X").replace(/,/g, ".")
}

/**
 * Désignation du catalogue : "HEB 600", "HE600B" -> "HE 600 B" ;
 * "HD400*237" -> "HD 400 x 237" ; "IPEA 500", "IPE500A" -> "IPE A 500" ;
 * "HLR 1100" -> "HL 1100 R". Null si le texte n'est pas une désignation
 * complète : plage ("HD400X237-262"), masse manquante ("HD 400"), libellé
 * hors profil ("DEBIT TOLE").
 */
export function designationProfil(profil: string): string | null {
  const m = compacter(profil).match(DESIGNATION)
  if (!m) return null
  const [, famille, avant, taille, apres, suite] = m
  const { series, dimensions } = FAMILLES[famille]
  const serie = avant ?? apres
  const masses = suite.split("X").filter(Boolean)
  if (avant && apres) return null
  if (serie ? !series.includes(serie) || masses.length > 0 : !dimensions.includes(masses.length)) return null
  const fin = masses.map((d) => ` x ${d}`).join("")
  // La série se lit avant la taille pour les IPE ("IPE A 500"), après pour
  // les HE et HL ("HE 600 B", "HL 1100 M").
  return famille === "IPE" && serie ? `IPE ${serie} ${taille}` : `${famille} ${taille}${serie ? ` ${serie}` : ""}${fin}`
}

/** Désignation du catalogue, ou à défaut le texte en majuscules avec des espaces réguliers. */
export function normaliserProfil(profil: string): string {
  return designationProfil(profil) ?? profil.toUpperCase().replace(/\s+/g, " ").trim()
}

/** Famille d'un profil (HD, HE, HL, IPE…), même incomplet ; null si ce n'est pas un profil. */
export function familleProfil(profil: string): string | null {
  return compacter(profil).match(DEBUT_DESIGNATION)?.[1] ?? null
}

/**
 * Recherche dans une liste de désignations : sans casse ni espaces, et
 * l'écriture atelier trouve aussi le profil ("HEB 6" -> "HE 600 B",
 * "HLM" -> "HL 1100 M").
 */
export function profilCorrespond(profil: string, requete: string): boolean {
  const cherche = compacter(requete)
  const designation = compacter(profil)
  const atelier = designation.replace(/^(HE|HL)(\d+)(AA|[ABMR])$/, "$1$3$2")
  return designation.includes(cherche) || atelier.includes(cherche)
}

/** Profils d'une affaire sous leur désignation du catalogue, sans doublon ni texte hors désignation. */
export function profilsNormalises(profils: string[]): string[] {
  return [...new Set(profils.map(designationProfil).filter((p): p is string => p !== null))]
}

/** Familles des profils d'une affaire, sans doublon. */
export function famillesProfils(profils: string[]): string[] {
  return [...new Set(profils.map(familleProfil).filter((f): f is string => f !== null))]
}
