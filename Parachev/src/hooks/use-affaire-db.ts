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

// Shape returned by the `lister_profils_affaire` Tauri command
// (ProfilAffaireRow in lib.rs) -- détail par profil+longueur distinct
// d'une affaire. `longueur` est la longueur finale de la barre, `l_lam` la
// longueur brute livrée par le laminoir (null si la feuille SUIVI de
// l'Excel ne couvre pas encore ce groupe).
export interface ProfilAffaireRow {
  profil: string
  longueur: number
  l_lam: number | null
  nb_barres: number
}

// Shape returned by the `lister_goujons_affaire` Tauri command
// (GoujonAffaireRow in lib.rs) -- une ligne par poutre (rep) et par type de
// goujon (diamètre x hauteur) ; une poutre peut mélanger plusieurs
// diamètres, d'où le regroupement par rep fait dans useAffaireDb.
export interface GoujonAffaireRow {
  rep: string
  profil: string
  longueur: number
  diametre: number | null
  hauteur: number | null
  nb_goujons: number
}

export interface GoujonsPoutre {
  rep: string
  profil: string
  longueur: number
  groupes: { diametre: number | null; hauteur: number | null; nb_goujons: number }[]
}

// Shape returned by the `lister_cfl_affaire` Tauri command (CflAffaireRow in
// lib.rs) -- une ligne par barre (rep de FC-PRES/FC-PRESS). `cfl` vaut null
// si cette barre précise n'a pas de valeur saisie.
export interface CflAffaireRow {
  rep: string
  profil: string
  longueur: number
  cfl: number | null
}

interface UseAffaireDbResult {
  client: string | null
  variables: VariablesAffaireRow | null
  profils: ProfilAffaireRow[]
  goujonsParPoutre: GoujonsPoutre[]
  cflParBarre: CflAffaireRow[]
  heures: HeureRow[]
  heuresParPoste: HeuresParPoste[]
  totalHeures: number
  previsions: PrevisionRow[]
  loading: boolean
  error: string | null
  /** Relit les quatre tables -- à appeler après un nouveau calcul de prévision. */
  refetch: () => void
}

/**
 * Charge, pour une seule affaire (clé privée `affaire`), ses variables
 * (`obtenir_variables_affaire`), son détail par profil (`lister_profils_affaire`),
 * ses heures pointées (`lister_heures_affaire`) et ses prévisions déjà
 * enregistrées (`lister_previsions_affaire`) -- les quatre commandes Tauri
 * scopées par affaire, en parallèle.
 *
 * `obtenir_variables_affaire` échoue si l'affaire n'a pas encore de ligne
 * dans `variables_affaires` (ex. devis pas encore importé) : c'est traité
 * comme un cas normal (variables = null), pas comme une erreur globale --
 * seul un échec de `lister_heures_affaire` ou `lister_previsions_affaire`
 * est reflété dans `error`.
 */
export function useAffaireDb(affaire: string | undefined): UseAffaireDbResult {
  const [variables, setVariables] = React.useState<VariablesAffaireRow | null>(null)
  const [profils, setProfils] = React.useState<ProfilAffaireRow[]>([])
  const [goujons, setGoujons] = React.useState<GoujonAffaireRow[]>([])
  const [cflParBarre, setCflParBarre] = React.useState<CflAffaireRow[]>([])
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
        const [variablesRes, profilsRes, goujonsRes, cflRes, heuresRes, previsionsRes] = await Promise.all([
          invoke<VariablesAffaireRow>("obtenir_variables_affaire", { affaire }).catch(
            () => null
          ),
          invoke<ProfilAffaireRow[]>("lister_profils_affaire", { affaire }),
          invoke<GoujonAffaireRow[]>("lister_goujons_affaire", { affaire }),
          invoke<CflAffaireRow[]>("lister_cfl_affaire", { affaire }),
          invoke<HeureRow[]>("lister_heures_affaire", { affaire }),
          invoke<PrevisionRow[]>("lister_previsions_affaire", { affaire }),
        ])
        if (!annule) {
          setVariables(variablesRes)
          setProfils(profilsRes)
          setGoujons(goujonsRes)
          setCflParBarre(cflRes)
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

  const goujonsParPoutre = React.useMemo<GoujonsPoutre[]>(() => {
    const poutres = new Map<string, GoujonsPoutre>()
    for (const { rep, profil, longueur, diametre, hauteur, nb_goujons } of goujons) {
      let poutre = poutres.get(rep)
      if (!poutre) {
        poutre = { rep, profil, longueur, groupes: [] }
        poutres.set(rep, poutre)
      }
      poutre.groupes.push({ diametre, hauteur, nb_goujons })
    }
    return Array.from(poutres.values())
  }, [goujons])

  return {
    client: variables?.client ?? null,
    variables,
    profils,
    goujonsParPoutre,
    cflParBarre,
    heures,
    heuresParPoste,
    totalHeures,
    previsions,
    loading,
    error,
    refetch: () => setVersion((v) => v + 1),
  }
}
