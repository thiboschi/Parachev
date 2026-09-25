import * as React from "react"
import { invoke } from "@tauri-apps/api/core"
import type { VariablesAffaireRow } from "./use-affaires-db"

// Shape returned by the `lister_affaires_recherche` Tauri command
// (AffaireRecherche in recherche.rs) : une ligne par affaire, toutes
// sources fusionnées (dossier, RDE, fiche de prévision, SUIVI, heures ERP).
export interface AffaireRecherche {
  affaire: string
  nom_dossier: string | null
  annule: boolean
  non_conformite: boolean
  a_rde: boolean
  a_fiche: boolean
  client: string | null
  projet: string | null
  donneur_ordre: string | null
  offre: string | null
  cde_laminage: string | null
  type_affaire: string | null
  type_poutre: string | null
  traitement_surface: string | null
  traitements: string[]
  en10163: string | null
  tolerance: string | null
  exc: string | null
  en10204: string | null
  prep_en8501: string | null
  classe_us: string | null
  exigence_fabrication: string | null
  exigences_acier: string[]
  /** Cases cochées du RDE (clés operations::operation_rde côté Rust). */
  operations_rde: string[]
  /** Postes planifiés par la fiche (clés de poste). */
  postes_prevus: string[]
  /** Postes réalisés : colonnes SUIVI datées + postes ERP avec heures. */
  postes_realises: string[]
  profils: string[]
  nuances: string[]
  usines: string[]
  nb_barres: number | null
  poids_t: number | null
  heures_reelles: number
  heures_prevues: number | null
  heures_par_poste: { poste: string; heures: number }[]
  date_commande: string | null
  date_fiche: string | null
  date_laminage: string | null
  date_production_debut: string | null
  date_production_fin: string | null
  date_expedition: string | null
  nb_documents: number
  variables: VariablesAffaireRow | null
}

// Shape returned by the `rechercher_texte` Tauri command (ResultatTexte).
export interface ResultatTexte {
  affaire: string
  chemin: string
  titre: string
  type_doc: string | null
  /** Extrait du contenu, termes trouvés entre « ». */
  extrait: string
}

/** Charge toutes les affaires (une seule fois ; filtrage côté interface). */
export function useRechercheAffaires() {
  const [affaires, setAffaires] = React.useState<AffaireRecherche[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let annule = false
    invoke<AffaireRecherche[]>("lister_affaires_recherche")
      .then((res) => {
        if (!annule) {
          setAffaires(res)
          setError(null)
        }
      })
      .catch((e) => {
        if (!annule) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!annule) setLoading(false)
      })
    return () => {
      annule = true
    }
  }, [])

  return { affaires, loading, error }
}

/**
 * Recherche plein texte (mails, RDE, fiches, noms de fichiers), relancée
 * 300 ms après la dernière frappe. Résultats regroupés par affaire ; `null`
 * tant qu'aucun texte n'est saisi (pas de filtre plein texte).
 */
export function useRechercheTexte(texte: string) {
  const [resultats, setResultats] = React.useState<Map<string, ResultatTexte[]> | null>(null)

  React.useEffect(() => {
    const requete = texte.trim()
    if (!requete) {
      setResultats(null)
      return
    }
    let annule = false
    const minuteur = setTimeout(() => {
      invoke<ResultatTexte[]>("rechercher_texte", { texte: requete })
        .then((lignes) => {
          if (annule) return
          const parAffaire = new Map<string, ResultatTexte[]>()
          for (const l of lignes) {
            const liste = parAffaire.get(l.affaire) ?? []
            liste.push(l)
            parAffaire.set(l.affaire, liste)
          }
          setResultats(parAffaire)
        })
        .catch(() => {
          if (!annule) setResultats(new Map())
        })
    }, 300)
    return () => {
      annule = true
      clearTimeout(minuteur)
    }
  }, [texte])

  return resultats
}
