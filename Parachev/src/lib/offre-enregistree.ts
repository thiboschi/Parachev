import type { DonneesOffre } from "@/components/chiffrage/offre-pdf"
import { normaliserModeleOffre, type ModeleOffre } from "@/lib/modele-offre"

// Offre telle que relue et retouchée avant l'export : ses données et ses
// textes, copiés du modèle d'offre à l'ouverture de la relecture. Enregistrée
// en JSON (commande `enregistrer_offre`) pour être réexportée plus tard.

export interface OffreEnCours {
  /** Id de l'offre enregistrée, null tant qu'elle ne l'a jamais été. */
  id: number | null
  offre: DonneesOffre
  modele: ModeleOffre
}

// Forme du JSON enregistré, à faire évoluer avec DonneesOffre.
const VERSION = 1

export function versJson({ offre, modele }: OffreEnCours): string {
  // La date sort au format ISO (Date.toJSON).
  return JSON.stringify({ version: VERSION, offre, modele })
}

export function lireOffreEnregistree(id: number, json: string): OffreEnCours {
  const { offre, modele } = JSON.parse(json)
  const date = new Date(offre.date)
  return {
    id,
    offre: { ...offre, date: Number.isNaN(date.getTime()) ? new Date() : date },
    modele: normaliserModeleOffre(modele),
  }
}

/** Nom proposé pour le fichier PDF, sans caractère interdit. */
export const nomFichierOffre = (offre: DonneesOffre) =>
  `Offre ${offre.numeroOffre || offre.client || "chiffrage"}.pdf`.replace(/[\\/:*?"<>|]/g, "-")
