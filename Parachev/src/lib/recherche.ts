// Filtres de l'écran de recherche : définition, options proposées (tirées
// des données) et application. Tout est calculé côté interface sur la
// liste complète renvoyée par `lister_affaires_recherche`.

import type { AffaireRecherche } from "@/hooks/use-recherche-affaires"
import { TYPES_PRODUCTION, affaireCorrespondAuType } from "@/lib/flux-production"
import { POSTES_HORS_MACHINES, libellePoste } from "@/lib/postes"
import { CHAMPS_VARIABLES_NUMERIQUES } from "@/lib/variables-affaires"

type ChampVariableKey = (typeof CHAMPS_VARIABLES_NUMERIQUES)[number]["key"]

// Cases "Opérations de fabrication" du RDE (clés de parsing/operations.rs).
export const OPERATIONS_RDE: Record<string, string> = {
  coupe: "Coupe",
  coupe_droite: "Coupe droite 90°",
  coupe_biaise: "Coupe biaise",
  ouverture_ame: "Ouverture d'âme",
  percage: "Perçage",
  oblong: "Oblong",
  grugeage: "Grugeage",
  preparation_bord: "Préparation de bord",
  contre_fleche: "Contre-flèche",
  cfl_axe_fort: "Contre-flèche axe fort",
  cfl_axe_faible: "Contre-flèche axe faible",
  double_redressage: "Double redressage",
  assemblage: "Assemblage",
  soudage: "Soudage",
  goujonnage: "Goujonnage",
  usinage_tetes: "Usinage des têtes",
}

export const libelleOperationRde = (cle: string) => OPERATIONS_RDE[cle] ?? cle

export const CHAMPS_DATE = {
  date_commande: "Commande (RDE)",
  date_fiche: "Fiche de prévision",
  date_laminage: "Laminage",
  date_production_debut: "Début de production",
  date_production_fin: "Fin de production",
  date_expedition: "Expédition",
} as const

export type ChampDate = keyof typeof CHAMPS_DATE

/**
 * "HE 600 B" (RDE) et "HEB 600" (fiche) désignent le même profil : forme
 * commune "HEB 600". Les autres profils sont seulement mis en majuscules
 * avec des espaces réguliers.
 */
export function normaliserProfil(profil: string): string {
  const texte = profil.toUpperCase().replace(/\s+/g, " ").trim()
  const compact = texte.replace(/\s/g, "")
  const he = compact.match(/^HE(\d+)(AA|A|B|M)$/)
  if (he) return `HE${he[2]} ${he[1]}`
  const simple = compact.match(/^(HEAA|HEA|HEB|HEM|IPEA|IPE|HD|HLA|HLB|HLM|HLZ|HL|UPE|UPN)(\d+)$/)
  if (simple) return `${simple[1]} ${simple[2]}`
  return texte
}

/** Famille d'un profil : lettres de tête de la forme normalisée (HEB, HD, HL…). */
export function familleProfil(profil: string): string {
  const n = normaliserProfil(profil)
  return n.match(/^[A-Z]+/)?.[0] ?? n
}

/** Postes/machines de l'affaire selon la source choisie. */
export type SourceMachines = "toutes" | "prevu" | "realise"

function machinesAffaire(a: AffaireRecherche, source: SourceMachines): Set<string> {
  const postes =
    source === "prevu"
      ? a.postes_prevus
      : source === "realise"
        ? a.postes_realises
        : [...a.postes_prevus, ...a.postes_realises]
  return new Set(postes.filter((p) => !POSTES_HORS_MACHINES.has(p)))
}

function exigencesAffaire(a: AffaireRecherche): string[] {
  return [...(a.exigence_fabrication ? [a.exigence_fabrication] : []), ...a.exigences_acier]
}

export interface Filtres {
  texte: string
  client: string
  statut: "toutes" | "actives" | "annulees"
  champDate: ChampDate
  dateDu: string
  dateAu: string
  typesProduction: string[]
  /** Correspondance stricte au Flux (aucune autre machine que l'itinéraire). */
  fluxStrict: boolean
  /** Toutes les machines cochées doivent avoir été utilisées (ET). */
  machines: string[]
  sourceMachines: SourceMachines
  /** Toutes les opérations cochées doivent être demandées dans le RDE (ET). */
  operationsRde: string[]
  typesAffaire: string[]
  traitements: string[]
  exc: string[]
  en10163: string[]
  tolerance: string[]
  en10204: string[]
  prep: string[]
  classeUs: string[]
  exigences: string[]
  familles: string[]
  profils: string[]
  nuances: string[]
  usines: string[]
  nbBarresMin: string
  nbBarresMax: string
  poidsMin: string
  poidsMax: string
  heuresMin: string
  heuresMax: string
  variables: Partial<Record<ChampVariableKey, string>>
  avecNonConformite: boolean
  avecRde: boolean
  avecFiche: boolean
}

export const FILTRES_VIDES: Filtres = {
  texte: "",
  client: "all",
  statut: "toutes",
  champDate: "date_commande",
  dateDu: "",
  dateAu: "",
  typesProduction: [],
  fluxStrict: false,
  machines: [],
  sourceMachines: "toutes",
  operationsRde: [],
  typesAffaire: [],
  traitements: [],
  exc: [],
  en10163: [],
  tolerance: [],
  en10204: [],
  prep: [],
  classeUs: [],
  exigences: [],
  familles: [],
  profils: [],
  nuances: [],
  usines: [],
  nbBarresMin: "",
  nbBarresMax: "",
  poidsMin: "",
  poidsMax: "",
  heuresMin: "",
  heuresMax: "",
  variables: {},
  avecNonConformite: false,
  avecRde: false,
  avecFiche: false,
}

/** Nombre de filtres actifs hors texte libre (pour le badge du bouton). */
export function nbFiltresAvances(f: Filtres): number {
  let n = 0
  for (const cle of Object.keys(FILTRES_VIDES) as (keyof Filtres)[]) {
    if (["texte", "client", "champDate", "sourceMachines", "fluxStrict", "variables"].includes(cle)) continue
    const v = f[cle]
    if (Array.isArray(v) ? v.length > 0 : typeof v === "boolean" ? v : v !== FILTRES_VIDES[cle]) n++
  }
  n += Object.values(f.variables).filter((v) => v && v.trim()).length
  return n
}

export interface OptionFiltre {
  valeur: string
  libelle: string
  nombre: number
}

/** Valeurs distinctes (avec leur nombre d'affaires), triées par fréquence. */
function compter(
  affaires: AffaireRecherche[],
  valeurs: (a: AffaireRecherche) => (string | null | undefined)[],
  libelle: (v: string) => string = (v) => v
): OptionFiltre[] {
  const compte = new Map<string, number>()
  for (const a of affaires) {
    for (const v of new Set(valeurs(a).filter((x): x is string => !!x && x.trim() !== ""))) {
      compte.set(v, (compte.get(v) ?? 0) + 1)
    }
  }
  return Array.from(compte, ([valeur, nombre]) => ({ valeur, libelle: libelle(valeur), nombre })).sort(
    (a, b) => b.nombre - a.nombre || a.libelle.localeCompare(b.libelle)
  )
}

export interface OptionsFiltres {
  clients: string[]
  typesProduction: OptionFiltre[]
  machines: OptionFiltre[]
  operationsRde: OptionFiltre[]
  typesAffaire: OptionFiltre[]
  traitements: OptionFiltre[]
  exc: OptionFiltre[]
  en10163: OptionFiltre[]
  tolerance: OptionFiltre[]
  en10204: OptionFiltre[]
  prep: OptionFiltre[]
  classeUs: OptionFiltre[]
  exigences: OptionFiltre[]
  familles: OptionFiltre[]
  profils: OptionFiltre[]
  nuances: OptionFiltre[]
  usines: OptionFiltre[]
}

function typesProductionAffaire(a: AffaireRecherche, strict: boolean): string[] {
  const postes = machinesAffaire(a, "toutes")
  const indices = { typeAffaire: a.type_affaire, typePoutre: a.type_poutre, nomDossier: a.nom_dossier }
  return TYPES_PRODUCTION.filter((t) => affaireCorrespondAuType(postes, t, indices, strict)).map((t) => t.nom)
}

/** `fluxStrict` : les nombres affichés pour les types de production suivent le mode choisi. */
export function optionsFiltres(affaires: AffaireRecherche[], fluxStrict = false): OptionsFiltres {
  return {
    clients: Array.from(new Set(affaires.map((a) => a.client).filter((c): c is string => !!c))).sort(),
    typesProduction: compter(affaires, (a) => typesProductionAffaire(a, fluxStrict)),
    machines: compter(affaires, (a) => [...machinesAffaire(a, "toutes")], libellePoste),
    operationsRde: compter(affaires, (a) => a.operations_rde, libelleOperationRde),
    typesAffaire: compter(affaires, (a) => [a.type_affaire]),
    traitements: compter(affaires, (a) => a.traitements),
    exc: compter(affaires, (a) => [a.exc]),
    en10163: compter(affaires, (a) => [a.en10163]),
    tolerance: compter(affaires, (a) => [a.tolerance]),
    en10204: compter(affaires, (a) => [a.en10204]),
    prep: compter(affaires, (a) => [a.prep_en8501]),
    classeUs: compter(affaires, (a) => [a.classe_us]),
    exigences: compter(affaires, exigencesAffaire),
    familles: compter(affaires, (a) => a.profils.map(familleProfil)),
    profils: compter(affaires, (a) => a.profils.map(normaliserProfil)),
    nuances: compter(affaires, (a) => a.nuances),
    usines: compter(affaires, (a) => a.usines),
  }
}

const nombre = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")))

function dansIntervalle(valeur: number | null, min: string, max: string): boolean {
  const bas = nombre(min)
  const haut = nombre(max)
  if ((bas == null || Number.isNaN(bas)) && (haut == null || Number.isNaN(haut))) return true
  if (valeur == null) return false
  return (bas == null || Number.isNaN(bas) || valeur >= bas) && (haut == null || Number.isNaN(haut) || valeur <= haut)
}

/** OU : au moins une valeur de l'affaire parmi les valeurs cochées. */
function unParmi(cochees: string[], valeurs: (string | null | undefined)[]): boolean {
  return cochees.length === 0 || valeurs.some((v) => v != null && cochees.includes(v))
}

/** ET : toutes les valeurs cochées présentes dans l'affaire. */
function toutesParmi(cochees: string[], valeurs: Iterable<string>): boolean {
  const ensemble = new Set(valeurs)
  return cochees.every((c) => ensemble.has(c))
}

function correspondTexte(a: AffaireRecherche, requete: string): boolean {
  return [
    a.affaire,
    a.client,
    a.projet,
    a.nom_dossier,
    a.donneur_ordre,
    a.offre,
    a.cde_laminage,
    a.variables?.numero_plan,
    ...a.profils,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(requete)
}

/**
 * Applique les filtres. `affairesTexte` : affaires trouvées par la
 * recherche plein texte dans les documents (null = pas de texte saisi) ;
 * une affaire correspond au texte si ses champs le contiennent OU si un de
 * ses documents le contient.
 */
export function filtrerAffaires(
  affaires: AffaireRecherche[],
  f: Filtres,
  affairesTexte: ReadonlySet<string> | null
): AffaireRecherche[] {
  const requete = f.texte.trim().toLowerCase()
  const typesProduction = TYPES_PRODUCTION.filter((t) => f.typesProduction.includes(t.nom))

  return affaires.filter((a) => {
    if (requete && !correspondTexte(a, requete) && !affairesTexte?.has(a.affaire)) return false
    if (f.client !== "all" && a.client !== f.client) return false
    if (f.statut === "actives" && a.annule) return false
    if (f.statut === "annulees" && !a.annule) return false
    if (f.avecNonConformite && !a.non_conformite) return false
    if (f.avecRde && !a.a_rde) return false
    if (f.avecFiche && !a.a_fiche) return false

    if (f.dateDu || f.dateAu) {
      const date = a[f.champDate]
      if (!date) return false
      if (f.dateDu && date < f.dateDu) return false
      if (f.dateAu && date > f.dateAu) return false
    }

    if (typesProduction.length > 0) {
      const postes = machinesAffaire(a, "toutes")
      const indices = { typeAffaire: a.type_affaire, typePoutre: a.type_poutre, nomDossier: a.nom_dossier }
      if (!typesProduction.some((t) => affaireCorrespondAuType(postes, t, indices, f.fluxStrict))) return false
    }
    if (!toutesParmi(f.machines, machinesAffaire(a, f.sourceMachines))) return false
    if (!toutesParmi(f.operationsRde, a.operations_rde)) return false

    if (!unParmi(f.typesAffaire, [a.type_affaire])) return false
    if (!unParmi(f.traitements, a.traitements)) return false
    if (!unParmi(f.exc, [a.exc])) return false
    if (!unParmi(f.en10163, [a.en10163])) return false
    if (!unParmi(f.tolerance, [a.tolerance])) return false
    if (!unParmi(f.en10204, [a.en10204])) return false
    if (!unParmi(f.prep, [a.prep_en8501])) return false
    if (!unParmi(f.classeUs, [a.classe_us])) return false
    if (!unParmi(f.exigences, exigencesAffaire(a))) return false
    if (!unParmi(f.familles, a.profils.map(familleProfil))) return false
    if (!unParmi(f.profils, a.profils.map(normaliserProfil))) return false
    if (!unParmi(f.nuances, a.nuances)) return false
    if (!unParmi(f.usines, a.usines)) return false

    if (!dansIntervalle(a.nb_barres, f.nbBarresMin, f.nbBarresMax)) return false
    if (!dansIntervalle(a.poids_t, f.poidsMin, f.poidsMax)) return false
    if (!dansIntervalle(a.heures_reelles, f.heuresMin, f.heuresMax)) return false

    return CHAMPS_VARIABLES_NUMERIQUES.every(({ key }) => {
      const filtre = f.variables[key]?.trim()
      if (!filtre || !filtre.startsWith(">")) return true
      const seuil = Number(filtre.slice(1))
      if (Number.isNaN(seuil)) return true
      const valeur = a.variables?.[key]
      return typeof valeur === "number" && valeur > seuil
    })
  })
}

export type Tri = "affaire" | "date_commande" | "heures"

export const TRIS: Record<Tri, string> = {
  affaire: "N° d'affaire",
  date_commande: "Date de commande",
  heures: "Heures réelles",
}

export function trierAffaires(affaires: AffaireRecherche[], tri: Tri): AffaireRecherche[] {
  const copie = [...affaires]
  if (tri === "heures") return copie.sort((a, b) => b.heures_reelles - a.heures_reelles)
  if (tri === "date_commande")
    return copie.sort((a, b) => (b.date_commande ?? "").localeCompare(a.date_commande ?? ""))
  return copie.sort((a, b) => b.affaire.localeCompare(a.affaire))
}

export type { ChampVariableKey }
