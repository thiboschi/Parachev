// Agrégations du tableau de bord. Deux niveaux, qui ne se mélangent pas :
// - les POINTAGES ERP (une ligne datée par jour/poste) : filtrés par la
//   période, ils alimentent "heures sur la période", l'évolution mensuelle
//   et la répartition par poste ;
// - les AFFAIRES : une affaire est retenue si elle a au moins un pointage
//   dans la période ; ses indicateurs (prévu/réel, type de production)
//   portent sur ses heures totales.

import type { AffaireRecherche } from "@/hooks/use-recherche-affaires"
import { TYPES_PRODUCTION, affaireCorrespondAuType } from "@/lib/flux-production"
import { POSTES_HORS_MACHINES } from "@/lib/postes"

// Ligne de la commande `lister_heures` (HeureRow dans lib.rs).
export interface Pointage {
  affaire: string
  ot: string | null
  date: string | null
  poste: string
  heures: number
}

export interface FiltresDashboard {
  /** Bornes ISO incluses ("" = pas de borne). */
  du: string
  au: string
  client: string
  typesProduction: string[]
  /** Poste sélectionné en cliquant sur une barre (null = tous). */
  poste: string | null
}

export const FILTRES_DASHBOARD_VIDES: FiltresDashboard = {
  du: "",
  au: "",
  client: "all",
  typesProduction: [],
  poste: null,
}

export type Preset = "tout" | "12mois" | "annee" | "anneePrecedente"

export const PRESETS: Record<Preset, string> = {
  tout: "Tout",
  "12mois": "12 derniers mois",
  annee: "Cette année",
  anneePrecedente: "Année dernière",
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

export function bornesPreset(preset: Preset, aujourdhui = new Date()): { du: string; au: string } {
  const annee = aujourdhui.getFullYear()
  switch (preset) {
    case "tout":
      return { du: "", au: "" }
    case "12mois": {
      const debut = new Date(aujourdhui)
      debut.setMonth(debut.getMonth() - 12)
      return { du: iso(debut), au: iso(aujourdhui) }
    }
    case "annee":
      return { du: `${annee}-01-01`, au: iso(aujourdhui) }
    case "anneePrecedente":
      return { du: `${annee - 1}-01-01`, au: `${annee - 1}-12-31` }
  }
}

const dansPeriode = (date: string | null, f: FiltresDashboard) =>
  !!date && (!f.du || date >= f.du) && (!f.au || date <= f.au)

/**
 * Types de production de l'affaire, du plus précis au plus général : d'abord
 * ceux que l'affaire déclare (RDE, nom de dossier), puis par longueur
 * d'itinéraire -- "Ponts Mixtes" (5 étapes) avant "Redressage" (1 étape),
 * que presque toutes les affaires satisfont.
 */
function typesAffaire(a: AffaireRecherche): string[] {
  const postes = new Set([...a.postes_prevus, ...a.postes_realises].filter((p) => !POSTES_HORS_MACHINES.has(p)))
  const indices = { typeAffaire: a.type_affaire, typePoutre: a.type_poutre, nomDossier: a.nom_dossier }
  const precision = (t: (typeof TYPES_PRODUCTION)[number]) =>
    (affaireCorrespondAuType(new Set(), t, indices) ? 100 : 0) + Math.max(0, ...t.itineraires.map((i) => i.length))
  return TYPES_PRODUCTION.filter((t) => affaireCorrespondAuType(postes, t, indices))
    .sort((x, y) => precision(y) - precision(x))
    .map((t) => t.nom)
}

export interface DonneesDashboard {
  /** Pointages retenus (période, affaires filtrées, poste). */
  pointages: Pointage[]
  /** Affaires ayant au moins un pointage retenu. */
  affaires: AffaireRecherche[]
  /** Types de production de chaque affaire (calculés une fois). */
  types: Map<string, string[]>
}

/** Applique les filtres aux pointages et en déduit les affaires actives. */
export function appliquerFiltres(
  pointages: Pointage[],
  affaires: AffaireRecherche[],
  f: FiltresDashboard
): DonneesDashboard {
  const types = new Map(affaires.map((a) => [a.affaire, typesAffaire(a)]))
  const retenues = new Set(
    affaires
      .filter((a) => f.client === "all" || a.client === f.client)
      .filter(
        (a) =>
          f.typesProduction.length === 0 || f.typesProduction.some((t) => types.get(a.affaire)?.includes(t))
      )
      .map((a) => a.affaire)
  )
  const pointagesRetenus = pointages.filter(
    (p) => retenues.has(p.affaire) && dansPeriode(p.date, f) && (!f.poste || p.poste === f.poste)
  )
  const actives = new Set(pointagesRetenus.map((p) => p.affaire))
  return {
    pointages: pointagesRetenus,
    affaires: affaires.filter((a) => actives.has(a.affaire)),
    types,
  }
}

const mediane = (valeurs: number[]) => {
  if (valeurs.length === 0) return null
  const tri = [...valeurs].sort((a, b) => a - b)
  const m = Math.floor(tri.length / 2)
  return tri.length % 2 ? tri[m] : (tri[m - 1] + tri[m]) / 2
}

export interface Indicateurs {
  heures: number
  nbAffaires: number
  heuresMedianesParAffaire: number | null
  /** Médiane réel / prévu sur les affaires qui ont une fiche. */
  ratioReelPrevu: number | null
  nbAffairesAvecFiche: number
}

export function indicateurs(d: DonneesDashboard): Indicateurs {
  const parAffaire = new Map<string, number>()
  for (const p of d.pointages) parAffaire.set(p.affaire, (parAffaire.get(p.affaire) ?? 0) + p.heures)
  const avecFiche = d.affaires.filter((a) => (a.heures_prevues ?? 0) > 0 && a.heures_reelles > 0)
  return {
    heures: d.pointages.reduce((s, p) => s + p.heures, 0),
    nbAffaires: d.affaires.length,
    heuresMedianesParAffaire: mediane([...parAffaire.values()]),
    ratioReelPrevu: mediane(avecFiche.map((a) => a.heures_reelles / a.heures_prevues!)),
    nbAffairesAvecFiche: avecFiche.length,
  }
}

/** Heures par mois ("2025-04"), mois sans pointage inclus (axe continu). */
export function heuresParMois(pointages: Pointage[]): { mois: string; heures: number }[] {
  const parMois = new Map<string, number>()
  for (const p of pointages) {
    if (!p.date) continue
    const mois = p.date.slice(0, 7)
    parMois.set(mois, (parMois.get(mois) ?? 0) + p.heures)
  }
  const mois = [...parMois.keys()].sort()
  if (mois.length === 0) return []
  const resultat: { mois: string; heures: number }[] = []
  let [annee, m] = mois[0].split("-").map(Number)
  const [anneeFin, mFin] = mois[mois.length - 1].split("-").map(Number)
  while (annee < anneeFin || (annee === anneeFin && m <= mFin)) {
    const cle = `${annee}-${String(m).padStart(2, "0")}`
    resultat.push({ mois: cle, heures: parMois.get(cle) ?? 0 })
    m += 1
    if (m > 12) {
      m = 1
      annee += 1
    }
  }
  return resultat
}

export type TriPostes = "heures" | "alpha" | "ecart"

export function heuresParPoste(pointages: Pointage[]): { poste: string; heures: number }[] {
  const parPoste = new Map<string, number>()
  for (const p of pointages) parPoste.set(p.poste, (parPoste.get(p.poste) ?? 0) + p.heures)
  return [...parPoste].map(([poste, heures]) => ({ poste, heures }))
}

export interface ComparaisonPoste {
  poste: string
  reel: number
  prevu: number
}

/**
 * Prévu (fiche) contre réel (ERP, heures totales) par poste, sur les seules
 * affaires qui ont une fiche avec des heures -- sinon le "réel" compterait
 * des affaires que la fiche n'a jamais chiffrées.
 */
export function comparaisonPostes(affaires: AffaireRecherche[]): ComparaisonPoste[] {
  const parPoste = new Map<string, ComparaisonPoste>()
  const ligne = (poste: string) => {
    let l = parPoste.get(poste)
    if (!l) {
      l = { poste, reel: 0, prevu: 0 }
      parPoste.set(poste, l)
    }
    return l
  }
  for (const a of affaires) {
    if (a.heures_prevues_par_poste.length === 0) continue
    for (const h of a.heures_prevues_par_poste) ligne(h.poste).prevu += h.heures
    for (const h of a.heures_par_poste) ligne(h.poste).reel += h.heures
  }
  return [...parPoste.values()].filter(
    (l) => !POSTES_HORS_MACHINES.has(l.poste) && (l.reel > 0 || l.prevu > 0)
  )
}

export function trierPostes<T extends { poste: string }>(
  lignes: T[],
  tri: TriPostes,
  valeur: (l: T) => number,
  libelle: (poste: string) => string,
  ecart?: (l: T) => number
): T[] {
  const copie = [...lignes]
  if (tri === "alpha") return copie.sort((a, b) => libelle(a.poste).localeCompare(libelle(b.poste)))
  if (tri === "ecart" && ecart) return copie.sort((a, b) => ecart(b) - ecart(a))
  return copie.sort((a, b) => valeur(b) - valeur(a))
}

/** Nombre d'affaires actives par type de production (une affaire peut en avoir plusieurs). */
export function affairesParType(d: DonneesDashboard): { type: string; affaires: number }[] {
  const compte = new Map<string, number>()
  for (const a of d.affaires) {
    for (const t of d.types.get(a.affaire) ?? []) compte.set(t, (compte.get(t) ?? 0) + 1)
  }
  return [...compte].map(([type, affaires]) => ({ type, affaires })).sort((a, b) => b.affaires - a.affaires)
}

/** Points du nuage prévu/réel : affaires avec fiche et heures des deux côtés. */
export function pointsPrevuReel(affaires: AffaireRecherche[]) {
  return affaires
    .filter((a) => (a.heures_prevues ?? 0) > 0 && a.heures_reelles > 0)
    .map((a) => ({
      affaire: a.affaire,
      client: a.client,
      prevu: a.heures_prevues!,
      reel: a.heures_reelles,
    }))
}

// ---------------------------------------------------------------------------
// Tonnage
// ---------------------------------------------------------------------------
// Le tonnage est une donnée d'AFFAIRE (fiche, sinon somme du RDE laminage),
// datée par la commande ou par la fin de production. Il ne passe donc pas
// par les pointages : une affaire commandée mais pas encore pointée compte
// dans le tonnage commandé. La période filtre cette date ; le filtre poste
// ne s'applique pas (le poids n'est pas ventilé par poste).

export type BaseTonnage = "commande" | "production"
export type Granularite = "mois" | "trimestre" | "annee"

export const BASES_TONNAGE: Record<BaseTonnage, string> = { commande: "Commande", production: "Fin de production" }
export const GRANULARITES: Record<Granularite, string> = { mois: "Mois", trimestre: "Trimestre", annee: "Année" }

export interface LigneTonnage {
  affaire: string
  client: string | null
  /** Date ISO retenue selon la base (commande ou fin de production). */
  date: string
  /** Valeur de la mesure : tonnes, ou trous / barres (voir MESURES). */
  tonnes: number
  heures: number
}

// Les onglets Perçage et Barres réutilisent les agrégations du tonnage sur
// une autre donnée d'affaire : nombre de trous (forage manuel + numérique,
// rapporté aux heures ERP des deux postes de forage) ou nombre de barres
// (rapporté aux heures ERP totales).
export type Mesure = "tonnage" | "percage" | "barres"

const POSTES_FORAGE = new Set(["forage_manuel", "forage_numerique"])

export const trousAffaire = (a: AffaireRecherche) => ({
  manuel: a.variables?.nb_trous_manuel ?? 0,
  numerique: a.variables?.nb_trous_numerique ?? 0,
})

const MESURES: Record<Mesure, { valeur: (a: AffaireRecherche) => number | null; heures: (a: AffaireRecherche) => number }> = {
  tonnage: { valeur: (a) => a.poids_t, heures: (a) => a.heures_reelles },
  percage: {
    valeur: (a) => trousAffaire(a).manuel + trousAffaire(a).numerique,
    heures: (a) => a.heures_par_poste.filter((h) => POSTES_FORAGE.has(h.poste)).reduce((s, h) => s + h.heures, 0),
  },
  barres: { valeur: (a) => a.nb_barres, heures: (a) => a.heures_reelles },
}

const dateTonnage = (a: AffaireRecherche, base: BaseTonnage) =>
  base === "commande" ? (a.date_commande ?? a.date_fiche) : a.date_production_fin

/**
 * Affaires pesées du périmètre (client, type de production, période sur la
 * date de la base), hors affaires annulées. `sansPoids` compte les affaires
 * du même périmètre écartées faute de poids (ou de trous, de barres selon
 * la mesure), pour afficher la couverture.
 */
export function affairesTonnage(
  affaires: AffaireRecherche[],
  types: Map<string, string[]>,
  f: FiltresDashboard,
  base: BaseTonnage,
  mesure: Mesure = "tonnage"
): { lignes: LigneTonnage[]; sansPoids: number } {
  const { valeur, heures } = MESURES[mesure]
  const lignes: LigneTonnage[] = []
  let sansPoids = 0
  for (const a of affaires) {
    if (a.annule) continue
    if (f.client !== "all" && a.client !== f.client) continue
    if (f.typesProduction.length > 0 && !f.typesProduction.some((t) => types.get(a.affaire)?.includes(t))) continue
    const date = dateTonnage(a, base)
    if (!date || !dansPeriode(date, f)) continue
    const v = valeur(a)
    if (!v || v <= 0) {
      sansPoids += 1
      continue
    }
    lignes.push({ affaire: a.affaire, client: a.client, date, tonnes: v, heures: heures(a) })
  }
  return { lignes, sansPoids }
}

const clePeriode = (date: string, g: Granularite) => {
  const annee = date.slice(0, 4)
  if (g === "annee") return annee
  const mois = Number(date.slice(5, 7))
  return g === "mois" ? `${annee}-${String(mois).padStart(2, "0")}` : `${annee}-T${Math.ceil(mois / 3)}`
}

/** Période suivante : "2025-12" -> "2026-01", "2025-T4" -> "2026-T1", "2025" -> "2026". */
const periodeSuivante = (cle: string, g: Granularite) => {
  if (g === "annee") return String(Number(cle) + 1)
  const [annee, reste] = cle.split("-")
  const n = Number(g === "trimestre" ? reste.slice(1) : reste) + 1
  const max = g === "trimestre" ? 4 : 12
  const [a, m] = n > max ? [Number(annee) + 1, 1] : [Number(annee), n]
  return g === "trimestre" ? `${a}-T${m}` : `${a}-${String(m).padStart(2, "0")}`
}

export interface TonnagePeriode {
  periode: string
  tonnes: number
  affaires: number
  /** Heures ERP par tonne (ratio des sommes) des affaires pointées ; null sans pointage. */
  heuresParTonne: number | null
}

/** Tonnage par période, périodes vides incluses (axe continu). */
export function tonnageParPeriode(lignes: LigneTonnage[], g: Granularite): TonnagePeriode[] {
  const parPeriode = new Map<string, { tonnes: number; affaires: number; heures: number; tonnesPointees: number }>()
  for (const l of lignes) {
    const cle = clePeriode(l.date, g)
    const p = parPeriode.get(cle) ?? { tonnes: 0, affaires: 0, heures: 0, tonnesPointees: 0 }
    p.tonnes += l.tonnes
    p.affaires += 1
    if (l.heures > 0) {
      p.heures += l.heures
      p.tonnesPointees += l.tonnes
    }
    parPeriode.set(cle, p)
  }
  const cles = [...parPeriode.keys()].sort()
  if (cles.length === 0) return []
  const resultat: TonnagePeriode[] = []
  for (let cle = cles[0]; cle <= cles[cles.length - 1]; cle = periodeSuivante(cle, g)) {
    const p = parPeriode.get(cle)
    resultat.push({
      periode: cle,
      tonnes: p?.tonnes ?? 0,
      affaires: p?.affaires ?? 0,
      heuresParTonne: p && p.tonnesPointees > 0 ? p.heures / p.tonnesPointees : null,
    })
  }
  return resultat
}

export const AUTRES_CLIENTS = "Autres clients"

/** Tonnage par client, les `max` premiers puis le reste regroupé. */
export function tonnageParClient(lignes: LigneTonnage[], max = 10): { client: string; tonnes: number }[] {
  const parClient = new Map<string, number>()
  for (const l of lignes) {
    const c = l.client ?? "Client inconnu"
    parClient.set(c, (parClient.get(c) ?? 0) + l.tonnes)
  }
  const tri = [...parClient].map(([client, tonnes]) => ({ client, tonnes })).sort((a, b) => b.tonnes - a.tonnes)
  if (tri.length <= max + 1) return tri
  const reste = tri.slice(max).reduce((s, c) => s + c.tonnes, 0)
  return [...tri.slice(0, max), { client: AUTRES_CLIENTS, tonnes: reste }]
}

/** Tonnage par type de production (une affaire peut compter dans plusieurs types). */
export function tonnageParType(lignes: LigneTonnage[], types: Map<string, string[]>): { type: string; tonnes: number }[] {
  const parType = new Map<string, number>()
  for (const l of lignes) {
    for (const t of types.get(l.affaire) ?? []) parType.set(t, (parType.get(t) ?? 0) + l.tonnes)
  }
  return [...parType].map(([type, tonnes]) => ({ type, tonnes })).sort((a, b) => b.tonnes - a.tonnes)
}

export interface IndicateursTonnage {
  tonnes: number
  nbAffaires: number
  tonnesMedianesParAffaire: number | null
  /** Médiane des heures ERP par tonne, sur les affaires pointées. */
  heuresParTonne: number | null
  nbAffairesPointees: number
}

export function indicateursTonnage(lignes: LigneTonnage[]): IndicateursTonnage {
  const pointees = lignes.filter((l) => l.heures > 0)
  return {
    tonnes: lignes.reduce((s, l) => s + l.tonnes, 0),
    nbAffaires: lignes.length,
    tonnesMedianesParAffaire: mediane(lignes.map((l) => l.tonnes)),
    heuresParTonne: mediane(pointees.map((l) => l.heures / l.tonnes)),
    nbAffairesPointees: pointees.length,
  }
}
