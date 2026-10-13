import type { ChampNorme } from "@/lib/recherche"

// Textes fixes de l'offre PDF (voir components/chiffrage/offre-pdf.tsx), les
// mêmes pour toutes les offres. Modifiables depuis la page "Modèle d'offre" :
// le modèle enregistré (commande `obtenir_modele_offre`) remplace celui par
// défaut ci-dessous.

export interface ListeAnnexe {
  titre: string
  lignes: string[]
}

export interface ConditionOffre {
  label: string
  valeur: string
}

export interface ModeleOffre {
  /** Signataire de l'offre, affiché dans l'en-tête et sous la formule de politesse. */
  auteur: string
  /** Phrase d'introduction de la première page, au-dessus du trait de l'en-tête. */
  accroche: string
  /** Normes rédigées, dans l'ordre de l'offre : le début de la phrase, que
   *  termine la valeur choisie. */
  phrasesNormes: { key: ChampNorme; phrase: string }[]
  tracabilite: string
  /** Listes à puces de l'annexe. */
  listesAnnexe: ListeAnnexe[]
  /** Tableau "Informations" de l'annexe. */
  conditions: ConditionOffre[]
  /** Derniers paragraphes de l'annexe, avant la formule de politesse. */
  cloture: string[]
  politesse: string
}

export const MODELE_PAR_DEFAUT: ModeleOffre = {
  auteur: "Damien Schils",
  accroche:
    "Nous vous remercions pour votre demande et l'intérêt porté à nos services.\nSur la base des éléments transmis, nous avons le plaisir de vous présenter notre proposition",
  phrasesNormes: [
    { key: "exc", phrase: "Fabrication suivant EN 1090-2:2018, classe d'exécution" },
    { key: "tolerance", phrase: "Tolérances géométriques selon EN 1090-2 :" },
    { key: "prep", phrase: "Degré de préparation selon EN ISO 8501-3 :" },
    { key: "classeUs", phrase: "Contrôle par ultrasons :" },
    { key: "en10204", phrase: "Document de contrôle :" },
    { key: "en10163", phrase: "Exigences de réparation :" },
    { key: "exigencesFabrication", phrase: "Exigences particulières de fabrication :" },
    { key: "exigencesAcier", phrase: "Exigences particulières acier :" },
  ],
  tracabilite:
    "Traçabilité des produits garantie jusqu'à l'assemblage (plusieurs documents de contrôle possibles).",
  listesAnnexe: [
    {
      titre: "À votre charge",
      lignes: [
        "Fourniture des profils, avec une surlongueur suffisante",
        "Stockage intermédiaire et acheminement des profils jusqu'à notre atelier, à notre demande, au fur et à mesure de l'avancement de l'affaire",
        "Fourniture des plans d'exécution BPE au format DWG (traçage des plans d'assemblage et des plans de débit) et des fichiers DSTV, le tout sur barre droite",
        "Fourniture des nomenclatures associées (expédition, assemblage et débit)",
        "Traitements de surface",
        "Transports",
      ],
    },
    {
      titre: "Non compris dans notre offre",
      lignes: [
        "Fourniture de la boulonnerie",
        "Fourniture des tôles de calage",
        "Fourniture des platines d'ancrage",
        "Toute prestation non mentionnée dans la présente offre",
      ],
    },
  ],
  conditions: [
    {
      label: "Délais",
      valeur:
        "Les délais de fabrication pourront vous être communiqués par Victor / Mario, en fonction de vos besoins et du planning de production en cours.",
    },
    {
      label: "Validité de l'offre",
      valeur:
        "Le prix matière des tôles ne peut être garanti, en raison des fluctuations de leur prix d'achat. Toute augmentation sera répercutée à la date de réception de la commande. Le prix de la main-d'œuvre est valable 3 mois.",
    },
    { label: "Prix", valeur: "Tous nos prix s'entendent hors taxes (H.T.)." },
    {
      label: "Remarques",
      valeur:
        "Toute modification ou tout ajout par rapport aux clauses de notre devis donnera lieu à un recalcul de notre prix et à une révision de notre offre. Si, pour des raisons esthétiques, les poutres nécessitent une finition ou un soin particulier, nous vous prions de nous consulter afin que nous adaptions notre prix.",
    },
    { label: "Conditions de paiement", valeur: "Paiement à 30 jours fin de mois." },
  ],
  cloture: [
    "Si cette proposition ne correspond pas entièrement à vos attentes, nous vous invitons à nous en informer. Nous pourrons alors analyser une alternative technique ou commerciale afin de vous proposer la solution la plus adaptée.",
    "Pour toute question ou précision supplémentaire, nous restons à votre entière disposition.",
  ],
  politesse:
    "Dans l'attente de votre retour, nous vous prions d'agréer, Madame, Monsieur, l'expression de nos sentiments les meilleurs.",
}

const estObjet = (valeur: unknown): valeur is Record<string, unknown> =>
  typeof valeur === "object" && valeur !== null && !Array.isArray(valeur)

const texte = (valeur: unknown, defaut: string) => (typeof valeur === "string" ? valeur : defaut)

const textes = (valeur: unknown): string[] =>
  Array.isArray(valeur) ? valeur.filter((v): v is string => typeof v === "string") : []

/**
 * Modèle à partir du JSON enregistré (null si rien ne l'a été). Tout ce qui
 * manque ou n'a pas la forme attendue reprend le texte par défaut : un
 * modèle enregistré par une version précédente de l'app reste lisible.
 */
export function lireModeleOffre(json: string | null): ModeleOffre {
  let brut: unknown = null
  try {
    brut = json === null ? null : JSON.parse(json)
  } catch {
    // JSON illisible : modèle par défaut.
  }
  if (!estObjet(brut)) return MODELE_PAR_DEFAUT

  const defaut = MODELE_PAR_DEFAUT
  const phrases = Array.isArray(brut.phrasesNormes) ? brut.phrasesNormes.filter(estObjet) : []
  return {
    auteur: texte(brut.auteur, defaut.auteur),
    accroche: texte(brut.accroche, defaut.accroche),
    // Les normes et leur ordre restent ceux de l'app, seules les phrases
    // sont reprises.
    phrasesNormes: defaut.phrasesNormes.map(({ key, phrase }) => ({
      key,
      phrase: texte(phrases.find((p) => p.key === key)?.phrase, phrase),
    })),
    tracabilite: texte(brut.tracabilite, defaut.tracabilite),
    listesAnnexe: Array.isArray(brut.listesAnnexe)
      ? brut.listesAnnexe.filter(estObjet).map((l) => ({ titre: texte(l.titre, ""), lignes: textes(l.lignes) }))
      : defaut.listesAnnexe,
    conditions: Array.isArray(brut.conditions)
      ? brut.conditions.filter(estObjet).map((c) => ({ label: texte(c.label, ""), valeur: texte(c.valeur, "") }))
      : defaut.conditions,
    cloture: Array.isArray(brut.cloture) ? textes(brut.cloture) : defaut.cloture,
    politesse: texte(brut.politesse, defaut.politesse),
  }
}

/** Modèle tel qu'il est enregistré : sans les lignes laissées vides. */
export function nettoyerModeleOffre(modele: ModeleOffre): ModeleOffre {
  const rempli = (t: string) => t.trim() !== ""
  return {
    auteur: modele.auteur.trim(),
    accroche: modele.accroche.trim(),
    phrasesNormes: modele.phrasesNormes.map(({ key, phrase }) => ({ key, phrase: phrase.trim() })),
    tracabilite: modele.tracabilite.trim(),
    listesAnnexe: modele.listesAnnexe
      .map(({ titre, lignes }) => ({ titre: titre.trim(), lignes: lignes.map((l) => l.trim()).filter(rempli) }))
      .filter(({ titre, lignes }) => rempli(titre) || lignes.length > 0),
    conditions: modele.conditions
      .map(({ label, valeur }) => ({ label: label.trim(), valeur: valeur.trim() }))
      .filter(({ label, valeur }) => rempli(label) || rempli(valeur)),
    cloture: modele.cloture.map((p) => p.trim()).filter(rempli),
    politesse: modele.politesse.trim(),
  }
}
