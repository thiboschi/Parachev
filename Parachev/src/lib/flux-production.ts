// Types de projet et gammes de production, extraits de
// "Flux de production BFC.xlsx" (dossier Para/). Chaque ligne du fichier,
// pour un type donné, décrit un itinéraire de production (une suite
// d'actions/machines) ; un même type peut avoir plusieurs itinéraires
// (variantes de gamme).
//
// Chaque action du fichier est mappée ici vers un poste ERP (voir
// lib/postes.ts, alimenté par `heures`) quand une correspondance fiable
// existe. Certaines actions n'ont PAS d'équivalent poste (contrôles
// visuels type "Ebavurage et contrôle", "Contrôle", "Contrôle et marquage
// contreflèche" -- distincts du contrôle US `controle_cnd` -- et la
// logistique "Parc") : elles sont omises des itinéraires ci-dessous, donc
// `affaireCorrespondAuType` ne vérifie QUE les actions qui correspondent à
// un poste suivi. Seul le type "Contrôle U.S." (zone de contrôle US)
// exige `controle_cnd`.
//
// Une machine combinée ("Combi scie foreuse numérique") réalise plusieurs
// opérations à la fois -> traduite en plusieurs étapes (ET). Une
// alternative explicite ("Foreuse manuelle ou Koike ou Robot") reste une
// seule étape avec plusieurs postes possibles (OU) -- la Koike (découpe)
// est rattachée à l'oxycoupage, comme dans les fiches de prévision.
//
// Les postes comparés sont ceux prévus par la fiche ET ceux réalisés
// (colonnes datées de SUIVI, heures ERP). Un type peut aussi être reconnu
// directement par des indices déclarés (`indices`) : type d'affaire ou de
// poutre saisi dans le RDE, ou mot du nom de dossier ("CHARGEMENT").

/** Une étape est un OU logique entre un ou plusieurs postes alternatifs
 *  (l'affaire doit avoir des heures sur au moins un des postes listés). */
type Etape = string[]

/** Un itinéraire est un ET logique de toutes ses étapes. */
type Itineraire = Etape[]

/** Indices déclarés qui suffisent à reconnaître le type. Comparaison
 *  insensible à la casse ; `motsDossier` est cherché dans le nom du dossier. */
interface IndicesType {
  typesAffaire?: string[]
  typesPoutre?: string[]
  motsDossier?: string[]
}

export interface TypeProduction {
  nom: string
  itineraires: Itineraire[]
  indices?: IndicesType
}

export const TYPES_PRODUCTION: TypeProduction[] = [
  {
    nom: "Redressage",
    itineraires: [[["presse_cintrage"]]],
  },
  {
    nom: "Contrôle U.S.",
    itineraires: [[["controle_cnd"]]],
  },
  {
    nom: "Building",
    itineraires: [[["robot"]]],
    indices: { typesAffaire: ["Colonnes"] },
  },
  {
    nom: "Sciage",
    itineraires: [[["mise_a_longueur"]]],
  },
  {
    nom: "Parking",
    indices: { typesAffaire: ["Parking"] },
    itineraires: [
      // Combi scie foreuse numérique -> 2 étapes (ET)
      [["mise_a_longueur"], ["forage_numerique"]],
      [["mise_a_longueur"], ["forage_numerique"], ["presse_cintrage"]],
    ],
  },
  {
    nom: "Presse",
    itineraires: [
      [["mise_a_longueur"], ["forage_numerique"], ["presse_cintrage"]],
      [["forage_numerique"], ["presse_cintrage"], ["robot"]],
    ],
  },
  {
    nom: "Fers-T",
    indices: { typesPoutre: ["Fer T"], motsDossier: ["FER-T", "FERS-T"] },
    itineraires: [
      [["oxycoupage"], ["presse_cintrage"]],
      [["oxycoupage"], ["presse_cintrage"], ["mise_a_longueur"]],
      [["forage_numerique"], ["oxycoupage"], ["presse_cintrage"], ["mise_a_longueur"]],
    ],
  },
  {
    nom: "IFB",
    indices: { typesPoutre: ["IFB"] },
    itineraires: [
      [["oxycoupage"], ["presse_cintrage"], ["assemblage_tracage"], ["soudage"]],
      [["oxycoupage"], ["presse_cintrage"], ["assemblage_tracage"], ["soudage"], ["mise_a_longueur"]],
    ],
  },
  {
    nom: "Pont PPE",
    indices: { motsDossier: ["PPE"] },
    itineraires: [
      [["mise_a_longueur"], ["forage_numerique"], ["presse_cintrage"], ["forage_manuel", "oxycoupage", "robot"], ["p3"], ["soudage"]],
    ],
  },
  {
    nom: "Ponts Mixtes",
    indices: { typesAffaire: ["Pont mixte"] },
    itineraires: [
      [["forage_numerique"], ["presse_cintrage"], ["robot"], ["p3"], ["goujonnage"]],
    ],
  },
  {
    nom: "Ponts Complexes",
    itineraires: [
      [["forage_numerique"], ["presse_cintrage"], ["robot"], ["p3"], ["assemblage_tracage"], ["soudage"], ["goujonnage"]],
    ],
  },
  {
    nom: "Caisson",
    itineraires: [
      [["forage_numerique"], ["presse_cintrage"], ["assemblage_tracage"], ["soudage"], ["goujonnage"]],
    ],
  },
  {
    nom: "Murs Anti Bruit",
    itineraires: [
      [["oxycoupage"], ["presse_cintrage"], ["assemblage_tracage"], ["soudage"], ["soudage_sous_flux"], ["mise_a_longueur"]],
    ],
  },
  // Chargement : le fichier ne décrit que de la logistique de parc
  // (déchargement wagon / chargement camion), aucune action ne correspond
  // à un poste -- reconnu uniquement par le nom du dossier ("1100727101
  // CHARGEMENT WILLIAM HARE").
  {
    nom: "Chargement",
    itineraires: [],
    indices: { motsDossier: ["CHARGEMENT"] },
  },
]

/** Ce que l'affaire déclare d'elle-même (RDE, nom de dossier). */
export interface IndicesAffaire {
  typeAffaire?: string | null
  typePoutre?: string | null
  nomDossier?: string | null
}

const egal = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Postes ignorés par la correspondance stricte : présents sur presque
 * toutes les affaires sans faire partie d'une gamme (manutention), ou
 * étapes du Flux sans poste suivi dans les itinéraires ci-dessus
 * ("Ebavurage et contrôle", "Zone de contrôle").
 */
export const POSTES_ANNEXES = new Set(["manutention", "controle", "ebavurage_meulage"])

/**
 * true si l'affaire correspond au type.
 *
 * Mode normal :
 * - soit par un indice déclaré (type d'affaire/poutre du RDE, mot du nom de
 *   dossier),
 * - soit parce que `postesAffaire` (postes prévus et réalisés) satisfait au
 *   moins un itinéraire du type -- chaque itinéraire exige que TOUTES ses
 *   étapes soient couvertes, une étape étant couverte si AU MOINS UN de ses
 *   postes alternatifs est présent. Un itinéraire vide ne reconnaît rien.
 *
 * Mode strict : en plus, l'affaire ne doit être passée par AUCUN autre
 * poste que ceux de l'itinéraire (hors POSTES_ANNEXES) -- une affaire
 * presse + robot + goujonnage n'est plus un simple "Redressage". Un indice
 * déclaré ne suffit plus, sauf pour un type sans itinéraire (Chargement),
 * qui exige alors qu'aucun poste de production n'ait été utilisé.
 */
export function affaireCorrespondAuType(
  postesAffaire: ReadonlySet<string>,
  type: TypeProduction,
  indices: IndicesAffaire = {},
  strict = false
): boolean {
  const { typesAffaire = [], typesPoutre = [], motsDossier = [] } = type.indices ?? {}
  const declare =
    (indices.typeAffaire != null && typesAffaire.some((t) => egal(t, indices.typeAffaire!))) ||
    (indices.typePoutre != null && typesPoutre.some((t) => egal(t, indices.typePoutre!))) ||
    (indices.nomDossier != null &&
      motsDossier.some((m) => indices.nomDossier!.toUpperCase().includes(m.toUpperCase())))
  const postesProduction = [...postesAffaire].filter((p) => !POSTES_ANNEXES.has(p))

  if (strict && type.itineraires.length === 0) return declare && postesProduction.length === 0
  if (declare && !strict) return true
  return type.itineraires.some((itineraire) => {
    if (itineraire.length === 0) return false
    if (!itineraire.every((etape) => etape.some((poste) => postesAffaire.has(poste)))) return false
    if (!strict) return true
    const autorises = new Set(itineraire.flat())
    return postesProduction.every((p) => autorises.has(p))
  })
}
