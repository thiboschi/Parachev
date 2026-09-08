import * as React from "react"
import { invoke } from "@tauri-apps/api/core"
import type { HeureRow, HeuresParPoste, VariablesAffaireRow } from "./use-affaires-db"

// Shape returned by the `lister_previsions_affaire` Tauri command
// (PrevisionRow in lib.rs).
export interface PrevisionRow {
  affaire: string
  poste: string
  heures_prevues: number
  date_prevision: string
  version_coefficients: string | null
}

interface UseAffaireDbResult {
  client: string | null
  variables: VariablesAffaireRow | null
  heures: HeureRow[]
  heuresParPoste: HeuresParPoste[]
  totalHeures: number
  previsions: PrevisionRow[]
  loading: boolean
  error: string | null
  /** Relit les trois tables -- à appeler après un nouveau calcul de prévision. */
  refetch: () => void
}

/**
 * Charge, pour une seule affaire (clé privée `affaire`), ses variables
 * (`obtenir_variables_affaire`), ses heures pointées (`lister_heures_affaire`)
 * et ses prévisions déjà enregistrées (`lister_previsions_affaire`) --
 * les trois commandes Tauri scopées par affaire, en parallèle.
 *
 * `obtenir_variables_affaire` échoue si l'affaire n'a pas encore de ligne
 * dans `variables_affaires` (ex. devis pas encore importé) : c'est traité
 * comme un cas normal (variables = null), pas comme une erreur globale --
 * seul un échec de `lister_heures_affaire` ou `lister_previsions_affaire`
 * est reflété dans `error`.
 */
export function useAffaireDb(affaire: string | undefined): UseAffaireDbResult {
  const [variables, setVariables] = React.useState<VariablesAffaireRow | null>(null)
  const [heures, setHeures] = React.useState<HeureRow[]>([])
  const [previsions, setPrevisions] = React.useState<PrevisionRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [version, setVersion] = React.useState(0)

  React.useEffect(() => {
    if (!affaire) {
      setLoading(false)
      return
    }

    let annule = false
    setLoading(true)

    async function charger() {
      try {
        const [variablesRes, heuresRes, previsionsRes] = await Promise.all([
          invoke<VariablesAffaireRow>("obtenir_variables_affaire", { affaire }).catch(
            () => null
          ),
          invoke<HeureRow[]>("lister_heures_affaire", { affaire }),
          invoke<PrevisionRow[]>("lister_previsions_affaire", { affaire }),
        ])
        if (!annule) {
          setVariables(variablesRes)
          setHeures(heuresRes)
          setPrevisions(previsionsRes)
          setError(null)
        }
      } catch (e) {
        if (!annule) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!annule) setLoading(false)
      }
    }

    charger()
    return () => {
      annule = true
    }
  }, [affaire, version])

  const { heuresParPoste, totalHeures } = React.useMemo(() => {
    const postes = new Map<string, number>()
    for (const ligne of heures) {
      postes.set(ligne.poste, (postes.get(ligne.poste) ?? 0) + ligne.heures)
    }
    const heuresParPoste = Array.from(postes.entries())
      .map(([poste, total]) => ({ poste, heures: total }))
      .sort((a, b) => b.heures - a.heures)
    const totalHeures = heuresParPoste.reduce((sum, p) => sum + p.heures, 0)
    return { heuresParPoste, totalHeures }
  }, [heures])

  return {
    client: variables?.client ?? null,
    variables,
    heures,
    heuresParPoste,
    totalHeures,
    previsions,
    loading,
    error,
    refetch: () => setVersion((v) => v + 1),
  }
}
