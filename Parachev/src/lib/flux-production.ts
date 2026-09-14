// Types de projet et gammes de production, extraits de
// "Flux de production BFC.xlsx" (dossier Para/). Chaque ligne du fichier,
// pour un type donné, décrit un itinéraire de production (une suite
// d'actions/machines) ; un même type peut avoir plusieurs itinéraires
// (variantes de gamme).
//
// Chaque action du fichier est mappée ici vers un poste ERP (voir
// lib/postes.ts, alimenté par `heures`) quand une correspondance fiable
// existe. Certaines actions n'ont PAS d'équivalent poste (contrôles
// visuels type "Ebavurage et contrôle", "Zone de contrôle" -- distinctes
// du poste `controle_cnd` -- et la logistique "Parc") : elles sont omises
// des itinéraires ci-dessous, donc `affaireCorrespondAuType` ne peut
// vérifier QUE les actions qui correspondent à un poste réellement suivi
// par l'ERP.
//
// Une machine combinée ("Combi scie foreuse numérique") réalise plusieurs
// opérations à la fois -> traduite en plusieurs étapes (ET). Une
// alternative explicite ("Foreuse manuelle ou Koike ou Robot") reste une
// seule étape avec plusieurs postes possibles (OU) -- "Koike" n'a pas
// d'équivalent poste et est donc omis de la liste d'alternatives.

/** Une étape est un OU logique entre un ou plusieurs postes alternatifs
 *  (l'affaire doit avoir des heures sur au moins un des postes listés). */
type Etape = string[]

/** Un itinéraire est un ET logique de toutes ses étapes. */
type Itineraire = Etape[]

export interface TypeProduction {
  nom: string
  itineraires: Itineraire[]
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
  },
  {
    nom: "Sciage",
    itineraires: [[["mise_a_longueur"]]],
  },
  {
    nom: "Parking",
    itineraires: [
      // Combi scie foreuse numérique -> 2 étapes (ET)
      [["mise_a_longueur"], ["forage_numerique"]],
      [["mise_a_longueur"], ["forage_numerique"], ["presse_cintrage"]],
    ],
  },
  {
    nom: "Presse",
    itineraires: [
      [["mise_a_longueur"], ["forage_numerique"], ["controle_cnd"], ["presse_cintrage"]],
      [["forage_numerique"], ["controle_cnd"], ["presse_cintrage"], ["robot"]],
    ],
  },
  {
    nom: "Fers-T",
    itineraires: [
      [["oxycoupage"], ["presse_cintrage"]],
      [["oxycoupage"], ["presse_cintrage"], ["mise_a_longueur"]],
      [["forage_numerique"], ["oxycoupage"], ["presse_cintrage"], ["mise_a_longueur"]],
    ],
  },
  {
    nom: "IFB",
    itineraires: [
      [["oxycoupage"], ["presse_cintrage"], ["assemblage_tracage"], ["soudage"]],
      [
        ["oxycoupage"],
        ["presse_cintrage"],
        ["assemblage_tracage"],
        ["soudage"],
        ["mise_a_longueur"],
      ],
    ],
  },
  {
    nom: "Pont PPE",
    itineraires: [
      [
        ["mise_a_longueur"],
        ["forage_numerique"],
        ["presse_cintrage"],
        ["forage_manuel", "robot"],
        ["p3"],
        ["soudage"],
      ],
    ],
  },
  {
    nom: "Ponts Mixtes",
    itineraires: [
      [
        ["forage_numerique"],
        ["controle_cnd"],
        ["presse_cintrage"],
        ["robot"],
        ["p3"],
        ["goujonnage"],
      ],
    ],
  },
  {
    nom: "Ponts Complexes",
    itineraires: [
      [
        ["forage_numerique"],
        ["controle_cnd"],
        ["presse_cintrage"],
        ["robot"],
        ["p3"],
        ["assemblage_tracage"],
        ["soudage"],
        ["goujonnage"],
      ],
    ],
  },
  {
    nom: "Caisson",
    itineraires: [
      [
        ["forage_numerique"],
        ["controle_cnd"],
        ["presse_cintrage"],
        ["assemblage_tracage"],
        ["soudage"],
        ["goujonnage"],
      ],
    ],
  },
  {
    nom: "Murs Anti Bruit",
    itineraires: [
      [
        ["oxycoupage"],
        ["presse_cintrage"],
        ["assemblage_tracage"],
        ["soudage"],
        ["soudage_sous_flux"],
        ["mise_a_longueur"],
      ],
    ],
  },
  // Chargement : le fichier ne décrit que de la logistique de parc
  // (déchargement wagon / chargement camion), aucune action ne correspond
  // à un poste ERP -- itinéraire vide, donc non filtrant (voir
  // affaireCorrespondAuType : un itinéraire vide est vide de contraintes).
  {
    nom: "Chargement",
    itineraires: [[]],
  },
]

/**
 * true si `postesAffaire` (les postes sur lesquels l'affaire a des heures
 * pointées) satisfait au moins un itinéraire du type -- chaque itinéraire
 * exige que TOUTES ses étapes soient couvertes, une étape étant couverte
 * si AU MOINS UN de ses postes alternatifs est présent.
 */
export function affaireCorrespondAuType(
  postesAffaire: ReadonlySet<string>,
  type: TypeProduction
): boolean {
  return type.itineraires.some((itineraire) =>
    itineraire.every((etape) => etape.some((poste) => postesAffaire.has(poste)))
  )
}
