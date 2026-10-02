import * as React from "react"
import { invoke } from "@tauri-apps/api/core"
import type { HeureRow, HeuresParPoste, VariablesAffaireRow } from "./use-affaires-db"

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
// (GoujonAffaireRow in lib.rs) -- une ligne par poutre (rep), par type de
// goujon (diamètre x hauteur) et par zone ; une poutre peut mélanger
// plusieurs diamètres, d'où le regroupement par rep fait dans useAffaireDb.
// `zone` : case cochée dans FC-GOUJ, null si aucune (ou affaire parsée
// avant l'ajout de la zone).
export type ZoneGoujons = "ame" | "aile_sup" | "aile_inf" | "tete"

export const LIBELLES_ZONE_GOUJONS: Record<ZoneGoujons, string> = {
  ame: "Âme",
  aile_sup: "Aile sup",
  aile_inf: "Aile inf",
  tete: "Tête",
}

export interface GoujonAffaireRow {
  rep: string
  profil: string
  longueur: number
  diametre: number | null
  hauteur: number | null
  zone: ZoneGoujons | null
  nb_goujons: number
}

export interface GoujonsPoutre {
  rep: string
  profil: string
  longueur: number
  groupes: { diametre: number | null; hauteur: number | null; zone: ZoneGoujons | null; nb_goujons: number }[]
}

// Goujons de l'affaire par zone, et retournements de poutres qu'ils imposent
// (zones goujonnées d'une poutre − 1, sommées sur l'affaire -- même calcul
// que nb_retournements_goujons dans prevision.rs).
export interface ZonesGoujons {
  zones: { zone: ZoneGoujons; nb_goujons: number }[]
  retournements: number
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

// Shape returned by the `obtenir_quantites_affaire` Tauri command
// (quantites::QuantitesAffaire) -- trous des programmes CN (DSTV) et
// goujons / trous cités dans les mails, avec la source des valeurs
// retenues dans variables_affaires ("cn", "mails", "fc-gouj", "manuel").
export interface MentionMail {
  chemin: string
  date_mail: string | null
  nature: "goujons" | "trous"
  diametre: number | null
  hauteur: number | null
  nombre: number
  besoin: boolean
  unite: "total" | "poutre" | "extremite" | "appui"
  extrait: string | null
}

export interface QuantitesAffaire {
  source_trous_numerique: string | null
  source_nb_goujons: string | null
  nb_pointeaux_numerique: number | null
  nb_goujons_mails: number | null
  nb_programmes_cn: number
  percages_cn: { diametre: number; nb: number }[]
  mentions_mails: MentionMail[]
}

interface UseAffaireDbResult {
  client: string | null
  variables: VariablesAffaireRow | null
  profils: ProfilAffaireRow[]
  goujonsParPoutre: GoujonsPoutre[]
  /** null sans goujons, ou si la zone d'un groupe de goujons est inconnue. */
  zonesGoujons: ZonesGoujons | null
  cflParBarre: CflAffaireRow[]
  quantites: QuantitesAffaire | null
  heures: HeureRow[]
  heuresParPoste: HeuresParPoste[]
  totalHeures: number
  loading: boolean
  error: string | null
  /** Relit les tables -- à appeler après une modification des variables. */
  refetch: () => void
}

/**
 * Charge, pour une seule affaire (clé privée `affaire`), ses variables
 * (`obtenir_variables_affaire`), son détail par profil (`lister_profils_affaire`)
 * et ses heures pointées (`lister_heures_affaire`) -- les commandes Tauri
 * scopées par affaire, en parallèle.
 *
 * `obtenir_variables_affaire` échoue si l'affaire n'a pas encore de ligne
 * dans `variables_affaires` (ex. devis pas encore importé) : c'est traité
 * comme un cas normal (variables = null), pas comme une erreur globale --
 * seul un échec des commandes `lister_*` est reflété dans `error`.
 */
export function useAffaireDb(affaire: string | undefined): UseAffaireDbResult {
  const [variables, setVariables] = React.useState<VariablesAffaireRow | null>(null)
  const [profils, setProfils] = React.useState<ProfilAffaireRow[]>([])
  const [goujons, setGoujons] = React.useState<GoujonAffaireRow[]>([])
  const [cflParBarre, setCflParBarre] = React.useState<CflAffaireRow[]>([])
  const [quantites, setQuantites] = React.useState<QuantitesAffaire | null>(null)
  const [heures, setHeures] = React.useState<HeureRow[]>([])
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
        const [variablesRes, profilsRes, goujonsRes, cflRes, quantitesRes, heuresRes] = await Promise.all([
          invoke<VariablesAffaireRow>("obtenir_variables_affaire", { affaire }).catch(
            () => null
          ),
          invoke<ProfilAffaireRow[]>("lister_profils_affaire", { affaire }),
          invoke<GoujonAffaireRow[]>("lister_goujons_affaire", { affaire }),
          invoke<CflAffaireRow[]>("lister_cfl_affaire", { affaire }),
          invoke<QuantitesAffaire>("obtenir_quantites_affaire", { affaire }).catch(() => null),
          invoke<HeureRow[]>("lister_heures_affaire", { affaire }),
        ])
        if (!annule) {
          setVariables(variablesRes)
          setProfils(profilsRes)
          setGoujons(goujonsRes)
          setCflParBarre(cflRes)
          setQuantites(quantitesRes)
          setHeures(heuresRes)
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
    for (const { rep, profil, longueur, diametre, hauteur, zone, nb_goujons } of goujons) {
      let poutre = poutres.get(rep)
      if (!poutre) {
        poutre = { rep, profil, longueur, groupes: [] }
        poutres.set(rep, poutre)
      }
      poutre.groupes.push({ diametre, hauteur, zone, nb_goujons })
    }
    return Array.from(poutres.values())
  }, [goujons])

  const zonesGoujons = React.useMemo<ZonesGoujons | null>(() => {
    if (goujons.length === 0) return null
    const parZone = new Map<ZoneGoujons, number>()
    const zonesParPoutre = new Map<string, Set<ZoneGoujons>>()
    for (const { rep, zone, nb_goujons } of goujons) {
      if (zone == null) return null
      parZone.set(zone, (parZone.get(zone) ?? 0) + nb_goujons)
      let zones = zonesParPoutre.get(rep)
      if (!zones) {
        zones = new Set()
        zonesParPoutre.set(rep, zones)
      }
      zones.add(zone)
    }
    let retournements = 0
    for (const zones of zonesParPoutre.values()) retournements += zones.size - 1
    return {
      zones: Array.from(parZone, ([zone, nb_goujons]) => ({ zone, nb_goujons })),
      retournements,
    }
  }, [goujons])

  return {
    client: variables?.client ?? null,
    variables,
    profils,
    goujonsParPoutre,
    zonesGoujons,
    cflParBarre,
    quantites,
    heures,
    heuresParPoste,
    totalHeures,
    loading,
    error,
    refetch: () => setVersion((v) => v + 1),
  }
}
