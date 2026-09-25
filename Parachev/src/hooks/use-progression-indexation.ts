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
  /** Début de l'analyse du fichier en cours (secondes Unix). */
  debut_fichier: number | null
  /** Débit sur la dernière minute et temps restant estimé. */
  fichiers_par_minute: number | null
  restant_secondes: number | null
  termine_le: string | null
}

/** Pendant une analyse, relecture de l'état toutes les 2 s : un fichier qui
 *  bloque n'émet plus d'événement, seul l'état partagé le montre. */
const INTERVALLE_RELECTURE_MS = 2000

export const EVENEMENT_PROGRESSION = "indexation-progression"

/**
 * Avancement de l'analyse des fichiers du dossier surveillé : état courant
 * au montage (le scan a pu commencer avant l'ouverture de la page), puis
 * mis à jour à chaque événement émis par le thread d'indexation.
 */
export function useProgressionIndexation() {
  const [progression, setProgression] = React.useState<ProgressionIndexation | null>(null)
  const enCours = progression?.en_cours ?? false

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

  React.useEffect(() => {
    if (!enCours) return
    const minuteur = setInterval(() => {
      invoke<ProgressionIndexation>("obtenir_progression_indexation")
        .then(setProgression)
        .catch(() => {})
    }, INTERVALLE_RELECTURE_MS)
    return () => clearInterval(minuteur)
  }, [enCours])

  return progression
}
