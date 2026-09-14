import * as React from "react"
import { invoke } from "@tauri-apps/api/core"

// Shape returned by the `lister_heures` Tauri command (HeureRow in lib.rs).
export interface HeureRow {
  affaire: string
  ot: string | null
  date: string | null
  poste: string
  heures: number
}

// Shape returned by the `lister_variables_affaires` Tauri command
// (VariablesAffaireRow in lib.rs).
export interface VariablesAffaireRow {
  affaire: string
  client: string | null
  profil: string | null
  numero_plan: string | null
  nb_barres: number | null
  nb_goujons: number | null
  nb_trous_manuel: number | null
  nb_trous_numerique: number | null
  diametre_moyen_numerique: number | null
  longueur_coupe: number | null
  contre_fleche: number | null
}

export interface HeuresParPoste {
  poste: string
  heures: number
}

// Une affaire "reconstruite" uniquement à partir des tables DB `heures`
// et `variables_affaires` -- aucun champ mocké (pas de status/semaine/
// reviewer/id : ces colonnes n'existent pas dans le schéma SQLite réel).
export interface AffaireResume {
  numero: string
  client: string | null
  totalHeures: number
  heuresParPoste: HeuresParPoste[]
  variables: VariablesAffaireRow | null
}

interface UseAffairesDbResult {
  affaires: AffaireResume[]
  /** Clients distincts (non nuls), triés -- pour peupler un filtre. */
  clients: string[]
  loading: boolean
  error: string | null
}

/**
 * Charge `heures` (agrégées par poste) et `variables_affaires` depuis la
 * base SQLite via les commandes Tauri existantes, et reconstruit la liste
 * des affaires par jointure sur le numéro d'affaire. C'est la seule
 * source de données de l'écran de recherche -- plus aucun import JSON.
 *
 * En dehors du contexte Tauri (ex. dev dans un navigateur classique),
 * `invoke` rejette : l'erreur est capturée et exposée via `error` plutôt
 * que de faire planter l'app.
 */
export function useAffairesDb(): UseAffairesDbResult {
  const [heures, setHeures] = React.useState<HeureRow[]>([])
  const [variables, setVariables] = React.useState<VariablesAffaireRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let annule = false

    async function charger() {
      try {
        const [heuresRes, variablesRes] = await Promise.all([
          invoke<HeureRow[]>("lister_heures"),
          invoke<VariablesAffaireRow[]>("lister_variables_affaires"),
        ])
        if (!annule) {
          setHeures(heuresRes)
          setVariables(variablesRes)
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
  }, [])

  const { affaires, clients } = React.useMemo(() => {
    const variablesParAffaire = new Map(variables.map((v) => [v.affaire, v]))

    const postesParAffaire = new Map<string, Map<string, number>>()
    for (const ligne of heures) {
      let postes = postesParAffaire.get(ligne.affaire)
      if (!postes) {
        postes = new Map()
        postesParAffaire.set(ligne.affaire, postes)
      }
      postes.set(ligne.poste, (postes.get(ligne.poste) ?? 0) + ligne.heures)
    }

    const toutesLesAffaires = new Set<string>([
      ...postesParAffaire.keys(),
      ...variablesParAffaire.keys(),
    ])

    const affaires: AffaireResume[] = []
    const clientsSet = new Set<string>()

    for (const numero of toutesLesAffaires) {
      const postes = postesParAffaire.get(numero)
      const heuresParPoste = postes
        ? Array.from(postes.entries())
            .map(([poste, total]) => ({ poste, heures: total }))
            .sort((a, b) => b.heures - a.heures)
        : []
      const totalHeures = heuresParPoste.reduce((sum, p) => sum + p.heures, 0)
      const infoVariables = variablesParAffaire.get(numero) ?? null

      if (infoVariables?.client) clientsSet.add(infoVariables.client)

      affaires.push({
        numero,
        client: infoVariables?.client ?? null,
        totalHeures,
        heuresParPoste,
        variables: infoVariables,
      })
    }

    affaires.sort((a, b) => a.numero.localeCompare(b.numero))

    return { affaires, clients: Array.from(clientsSet).sort() }
  }, [heures, variables])

  return { affaires, clients, loading, error }
}