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
