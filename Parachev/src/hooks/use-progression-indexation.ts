import * as React from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"

// Shape of the `indexation-progression` event and of the
// `obtenir_progression_indexation` command (Progression in watcher.rs).
export interface ProgressionIndexation {
  en_cours: boolean
  /** "comptage" (inventaire des fichiers), "analyse", "finalisation". */
  etape: string
  dossier: string
  total: number
  traites: number
  erreurs: number
  fichier: string | null
  termine_le: string | null
}

export const EVENEMENT_PROGRESSION = "indexation-progression"

/**
 * Avancement de l'analyse des fichiers du dossier surveillé : état courant
 * au montage (le scan a pu commencer avant l'ouverture de la page), puis
 * mis à jour à chaque événement émis par le thread d'indexation.
 */
export function useProgressionIndexation() {
  const [progression, setProgression] = React.useState<ProgressionIndexation | null>(null)

  React.useEffect(() => {
    let actif = true
    invoke<ProgressionIndexation>("obtenir_progression_indexation")
      .then((p) => actif && setProgression((courant) => courant ?? p))
      .catch(() => {})
    const arret = listen<ProgressionIndexation>(EVENEMENT_PROGRESSION, (e) => {
      if (actif) setProgression(e.payload)
    })
    return () => {
      actif = false
      arret.then((f) => f()).catch(() => {})
    }
  }, [])

  return progression
}
