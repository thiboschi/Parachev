// Filtres de l'écran de recherche : définition, options proposées (tirées
// des données) et application. Tout est calculé côté interface sur la
// liste complète renvoyée par `lister_affaires_recherche`.

import type { AffaireRecherche } from "@/hooks/use-recherche-affaires"
import { TYPES_PRODUCTION, affaireCorrespondAuType } from "@/lib/flux-production"
import { POSTES_HORS_MACHINES, libellePoste } from "@/lib/postes"
import { famillesProfils, profilsNormalises } from "@/lib/profils"

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
  redressage: "Redressage",
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

// Champs "Normes et exigences" du RDE, dans l'ordre d'affichage, avec les
// valeurs de leur liste déroulante (feuille "liste" du gabarit Excel) : la
// recherche ne propose que celles portées par une affaire, le chiffrage les
// propose toutes (voir chiffrage.tsx).
export const CHAMPS_NORMES = [
  {
    key: "exigencesFabrication",
    label: "Exigences particulières de fabrication",
    valeurs: ["DBS", "Pologne", "F66", "UK", "SNCF", "Roumanie", "ZTV-ING"],
  },
  {
    key: "exigencesAcier",
    label: "Exigences particulières acier",
    valeurs: ["AUBI", "Acier NF", "DBS", "autres"],
  },
  {
    key: "en10163",
    label: "Exigences de réparation",
    valeurs: [
      "EN10163-3: 2004, Cl. C,S-Cl. 1",
      "EN10163-3: 2004, Cl. C,S-Cl. 2",
      "EN10163-3: 2004, Cl. C,S-Cl. 3",
      "EN10163-3: 2004, Cl. D,S-Cl. 1",
      "EN10163-3: 2004, Cl. D,S-Cl. 2",
      "EN10163-3: 2004, Cl. D,S-Cl. 3",
      "Surface svt. ASTM/A6",
    ],
  },
  {
    key: "tolerance",
    label: "Classe de tolérance géométrique selon EN 1090",
    valeurs: ["Classe 1", "Classe 2", "tolérances client"],
  },
  {
    key: "exc",
    label: "Classe d'exécution selon EN 1090",
    valeurs: ["EXC1", "EXC2", "EXC3", "EXC4"],
  },
  {
    key: "prep",
    label: "Degré de préparation selon EN 8501-3",
    valeurs: ["P1", "P2", "P3", "P3 aile inferieure", "Sans ébavurage"],
  },
  {
    key: "classeUs",
    label: "Classe US",
    valeurs: [
      "US contr. EN 10306:2002 cl.2.1",
      "US contr. EN 10306:2002 cl.2.2",
      "US contr. EN 10306:2002 cl.2.3",
      "US contr. EN 10306:2002 cl.2.4",
      "US contr. EN 10306:2002 cl.1.1",
      "US contr. EN 10306:2002 cl.1.2",
    ],
  },
  {
    key: "en10204",
    label: "Document de contrôle (EN 10204)",
    valeurs: ["EN 10204 - 2.1", "EN 10204 - 2.2", "EN 10204 - 3.1", "EN 10204 - 3.2", "ASTM A6"],
  },
] as const

export type ChampNorme = (typeof CHAMPS_NORMES)[number]["key"]

// États de navigation (location.state) entre la recherche et une affaire :
// une affaire ouverte depuis la recherche propose un retour qui restaure les
// critères ; toute autre arrivée sur /search (sidebar…) repart de zéro.
export interface EtatNavigationRecherche {
  depuisRecherche?: boolean
  restaurerRecherche?: boolean
}
export const DEPUIS_RECHERCHE: EtatNavigationRecherche = { depuisRecherche: true }
export const RETOUR_RECHERCHE: EtatNavigationRecherche = { restaurerRecherche: true }

export type CleQuantite =
  | "nbBarres"
  | "poids"
  | "heuresReelles"
  | "heuresPrevues"
  | "nbGoujons"
  | "nbTrousManuel"
  | "nbTrousNumerique"
  | "diametreMoyen"
  | "diametreMoyenManuel"
  | "longueurCoupe"
  | "contreFleche"

/**
 * Quantités filtrables par intervalle min / max, dans l'ordre d'affichage.
 * `valeur` est exprimée dans l'unité du libellé (la longueur de coupe est
 * stockée en mm mais saisie en m). Sans valeur (null), l'affaire est écartée
 * dès qu'une borne est saisie.
 */
export const QUANTITES: {
  cle: CleQuantite
  label: string
  valeur: (a: AffaireRecherche) => number | null | undefined
}[] = [
  { cle: "nbBarres", label: "Nombre de barres", valeur: (a) => a.nb_barres },
  { cle: "poids", label: "Poids (t)", valeur: (a) => a.poids_t },
  { cle: "heuresReelles", label: "Heures réelles (ERP)", valeur: (a) => a.heures_reelles },
  { cle: "heuresPrevues", label: "Heures prévues (fiche)", valeur: (a) => a.heures_prevues },
  { cle: "nbGoujons", label: "Nombre de goujons", valeur: (a) => a.variables?.nb_goujons },
  { cle: "nbTrousManuel", label: "Trous (forage manuel)", valeur: (a) => a.variables?.nb_trous_manuel },
  { cle: "nbTrousNumerique", label: "Trous (forage numérique)", valeur: (a) => a.variables?.nb_trous_numerique },
  { cle: "diametreMoyen", label: "Ø moyen des trous numériques (mm)", valeur: (a) => a.variables?.diametre_moyen_numerique },
  {
    cle: "diametreMoyenManuel",
    label: "Ø moyen des trous manuels (mm)",
    valeur: (a) => a.variables?.diametre_moyen_manuel,
  },
  {
    cle: "longueurCoupe",
    label: "Longueur de coupe (m)",
    valeur: (a) => (a.variables?.longueur_coupe == null ? null : a.variables.longueur_coupe / 1000),
  },
  { cle: "contreFleche", label: "Contre-flèche moyenne (mm)", valeur: (a) => a.variables?.contre_fleche },
]

export interface IntervalleFiltre {
  min: string
  max: string
}

export const INTERVALLE_VIDE: IntervalleFiltre = { min: "", max: "" }

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
  exigencesFabrication: string[]
  exigencesAcier: string[]
  familles: string[]
  profils: string[]
  nuances: string[]
  usines: string[]
  /** Bornes saisies par quantité (voir QUANTITES) ; absente = pas de filtre. */
  quantites: Partial<Record<CleQuantite, IntervalleFiltre>>
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
  exigencesFabrication: [],
  exigencesAcier: [],
  familles: [],
  profils: [],
  nuances: [],
  usines: [],
  quantites: {},
  avecNonConformite: false,
  avecRde: false,
  avecFiche: false,
}

/** Nombre de filtres actifs hors texte libre (pour le badge du bouton). */
export function nbFiltresAvances(f: Filtres): number {
  let n = 0
  for (const cle of Object.keys(FILTRES_VIDES) as (keyof Filtres)[]) {
    if (["texte", "client", "champDate", "sourceMachines", "fluxStrict", "quantites"].includes(cle)) continue
    const v = f[cle]
    if (Array.isArray(v) ? v.length > 0 : typeof v === "boolean" ? v : v !== FILTRES_VIDES[cle]) n++
  }
  n += Object.values(f.quantites).filter((i) => i.min.trim() !== "" || i.max.trim() !== "").length
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
  exigencesFabrication: OptionFiltre[]
  exigencesAcier: OptionFiltre[]
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
    exigencesFabrication: compter(affaires, (a) => [a.exigence_fabrication]),
    exigencesAcier: compter(affaires, (a) => a.exigences_acier),
    familles: compter(affaires, (a) => famillesProfils(a.profils)),
    profils: compter(affaires, (a) => profilsNormalises(a.profils)),
    nuances: compter(affaires, (a) => a.nuances),
    usines: compter(affaires, (a) => a.usines),
  }
}

/** Borne saisie ; null si vide ou illisible (la borne est alors ignorée). */
function borne(s: string): number | null {
  if (s.trim() === "") return null
  const n = Number(s.replace(",", "."))
  return Number.isNaN(n) ? null : n
}

/** true si les deux bornes sont saisies et que min dépasse max (aucun résultat possible). */
export function intervalleInverse({ min, max }: IntervalleFiltre): boolean {
  const bas = borne(min)
  const haut = borne(max)
  return bas != null && haut != null && bas > haut
}

function dansIntervalle(valeur: number | null | undefined, { min, max }: IntervalleFiltre): boolean {
  const bas = borne(min)
  const haut = borne(max)
  if (bas == null && haut == null) return true
  if (valeur == null) return false
  return (bas == null || valeur >= bas) && (haut == null || valeur <= haut)
}

export interface EtendueQuantite {
  /** Nombre d'affaires où la quantité est renseignée. */
  nombre: number
  min: number
  max: number
}

/** Étendue de chaque quantité dans les données, affichée comme repère de saisie. */
export function etenduesQuantites(affaires: AffaireRecherche[]): Partial<Record<CleQuantite, EtendueQuantite>> {
  const etendues: Partial<Record<CleQuantite, EtendueQuantite>> = {}
  for (const { cle, valeur } of QUANTITES) {
    for (const a of affaires) {
      const v = valeur(a)
      if (v == null) continue
      const e = etendues[cle]
      if (e) {
        e.nombre++
        e.min = Math.min(e.min, v)
        e.max = Math.max(e.max, v)
      } else {
        etendues[cle] = { nombre: 1, min: v, max: v }
      }
    }
  }
  return etendues
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
  const quantites = QUANTITES.flatMap(({ cle, valeur }) => {
    const intervalle = f.quantites[cle]
    return intervalle ? [{ valeur, intervalle }] : []
  })

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
    if (!unParmi(f.exigencesFabrication, [a.exigence_fabrication])) return false
    if (!unParmi(f.exigencesAcier, a.exigences_acier)) return false
    if (!unParmi(f.familles, famillesProfils(a.profils))) return false
    if (!unParmi(f.profils, profilsNormalises(a.profils))) return false
    if (!unParmi(f.nuances, a.nuances)) return false
    if (!unParmi(f.usines, a.usines)) return false

    return quantites.every(({ valeur, intervalle }) => dansIntervalle(valeur(a), intervalle))
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
