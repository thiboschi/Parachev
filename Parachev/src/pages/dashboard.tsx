import * as React from "react"
import { useNavigate } from "react-router-dom"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { IconX } from "@tabler/icons-react"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import { MultiSelect } from "@/components/affaires/multi-select"
import {
  BarresClassees,
  BoutonsTri,
  CarteGraphique,
  COULEUR_ACCENT,
  COULEUR_CONTEXTE,
  GraphiqueComparaison,
  GraphiqueMois,
  Legende,
  NuagePrevuReel,
  StatTile,
  formatHeures,
} from "@/components/dashboard/graphiques"
import { TableAffaires } from "@/components/dashboard/table-affaires"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { useRechercheAffaires } from "@/hooks/use-recherche-affaires"
import { EVENEMENT_PROGRESSION, type ProgressionIndexation } from "@/hooks/use-progression-indexation"
import {
  FILTRES_DASHBOARD_VIDES,
  PRESETS,
  affairesParType,
  appliquerFiltres,
  bornesPreset,
  comparaisonPostes,
  heuresParMois,
  heuresParPoste,
  indicateurs,
  pointsPrevuReel,
  trierPostes,
  type FiltresDashboard,
  type Pointage,
  type Preset,
  type TriPostes,
} from "@/lib/dashboard"
import { libellePoste } from "@/lib/postes"
import { optionsFiltres } from "@/lib/recherche"

/** Pointages ERP, rechargés à la fin de chaque analyse des fichiers. */
function usePointages() {
  const [pointages, setPointages] = React.useState<Pointage[]>([])
  const [version, setVersion] = React.useState(0)
  const [erreur, setErreur] = React.useState<string | null>(null)

  React.useEffect(() => {
    let actif = true
    const arret = listen<ProgressionIndexation>(EVENEMENT_PROGRESSION, (e) => {
      if (actif && !e.payload.en_cours) setVersion((v) => v + 1)
    })
    return () => {
      actif = false
      arret.then((f) => f()).catch(() => {})
    }
  }, [])

  React.useEffect(() => {
    let actif = true
    invoke<Pointage[]>("lister_heures")
      .then((p) => actif && setPointages(p))
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : String(e)))
    return () => {
      actif = false
    }
  }, [version])

  return { pointages, erreur }
}

const TRIS_POSTES: Record<Exclude<TriPostes, "ecart">, string> = { heures: "Heures", alpha: "A → Z" }
const TRIS_COMPARAISON: Record<TriPostes, string> = { heures: "Réel", ecart: "Écart", alpha: "A → Z" }

const formatRatio = (r: number) => `×${r.toLocaleString("fr-BE", { maximumFractionDigits: 2 })}`
const nombre = new Intl.NumberFormat("fr-BE", { maximumFractionDigits: 0 })

export default function Page() {
  const navigate = useNavigate()
  const { affaires, loading, error } = useRechercheAffaires()
  const { pointages, erreur } = usePointages()
  const [filtres, setFiltres] = React.useState<FiltresDashboard>(FILTRES_DASHBOARD_VIDES)
  const [triPostes, setTriPostes] = React.useState<Exclude<TriPostes, "ecart">>("heures")
  const [triComparaison, setTriComparaison] = React.useState<TriPostes>("ecart")
  const modifier = (m: Partial<FiltresDashboard>) => setFiltres((f) => ({ ...f, ...m }))

  const options = React.useMemo(() => optionsFiltres(affaires), [affaires])
  const donnees = React.useMemo(() => appliquerFiltres(pointages, affaires, filtres), [pointages, affaires, filtres])
  // Les postes restent tous affichés quand l'un d'eux est sélectionné (la
  // sélection garde l'accent, les autres passent en gris).
  const donneesSansPoste = React.useMemo(
    () => (filtres.poste ? appliquerFiltres(pointages, affaires, { ...filtres, poste: null }) : donnees),
    [pointages, affaires, filtres, donnees]
  )

  const kpi = indicateurs(donnees)
  const mois = React.useMemo(() => heuresParMois(donnees.pointages), [donnees])
  const postes = React.useMemo(
    () =>
      trierPostes(heuresParPoste(donneesSansPoste.pointages), triPostes, (l) => l.heures, libellePoste).map((l) => ({
        cle: l.poste,
        libelle: libellePoste(l.poste),
        valeur: l.heures,
      })),
    [donneesSansPoste, triPostes]
  )
  const comparaison = React.useMemo(
    () =>
      trierPostes(
        comparaisonPostes(donnees.affaires),
        triComparaison,
        (l) => l.reel,
        libellePoste,
        (l) => l.reel - l.prevu
      ).map((l) => ({ cle: l.poste, libelle: libellePoste(l.poste), reel: l.reel, prevu: l.prevu })),
    [donnees, triComparaison]
  )
  const types = React.useMemo(
    () => affairesParType(donnees).map((t) => ({ cle: t.type, libelle: t.type, valeur: t.affaires })),
    [donnees]
  )
  const points = React.useMemo(() => pointsPrevuReel(donnees.affaires), [donnees])

  const presetActif = (Object.keys(PRESETS) as Preset[]).find((p) => {
    const b = bornesPreset(p)
    return b.du === filtres.du && b.au === filtres.au
  })
  const clientItems = { all: "Tous les clients", ...Object.fromEntries(options.clients.map((c) => [c, c])) }
  const filtreActif =
    filtres.du || filtres.au || filtres.client !== "all" || filtres.typesProduction.length > 0 || filtres.poste

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      {/* min-w-0 : le tableau large défile dans sa carte au lieu d'élargir la page. */}
      <SidebarInset className="min-w-0">
        <SiteHeader />
        <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
          {/* Filtres : une seule ligne, au-dessus de tout ce qu'ils filtrent. */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Période (pointages)</Label>
              <div className="flex gap-0.5 rounded-lg bg-muted p-0.5 text-sm" role="group" aria-label="Période">
                {(Object.keys(PRESETS) as Preset[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={presetActif === p}
                    onClick={() => modifier(bornesPreset(p))}
                    className={`rounded-md px-2.5 py-1 transition-colors ${
                      presetActif === p ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {PRESETS[p]}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-end gap-1.5">
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Du</Label>
                <Input type="date" className="w-auto" value={filtres.du} onChange={(e) => modifier({ du: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Au</Label>
                <Input type="date" className="w-auto" value={filtres.au} onChange={(e) => modifier({ au: e.target.value })} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Client</Label>
              <Select items={clientItems} value={filtres.client} onValueChange={(v) => modifier({ client: v ?? "all" })}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(clientItems).map(([valeur, libelle]) => (
                    <SelectItem key={valeur} value={valeur}>
                      {libelle}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-56">
              <MultiSelect
                label="Type de production (Flux)"
                options={options.typesProduction}
                valeurs={filtres.typesProduction}
                onChange={(typesProduction) => modifier({ typesProduction })}
              />
            </div>
            {filtres.poste && (
              <Button variant="secondary" size="sm" onClick={() => modifier({ poste: null })}>
                Poste : {libellePoste(filtres.poste)}
                <IconX />
              </Button>
            )}
            {filtreActif && (
              <Button variant="ghost" size="sm" onClick={() => setFiltres(FILTRES_DASHBOARD_VIDES)}>
                Réinitialiser
              </Button>
            )}
          </div>

          {(error || erreur) && (
            <p className="text-sm text-destructive">Impossible de lire la base ({error ?? erreur})</p>
          )}

          {/* Pendant un rechargement, l'affichage précédent reste en place, atténué. */}
          <div className={`flex flex-col gap-4 transition-opacity lg:gap-6 ${loading ? "opacity-60" : ""}`}>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="Heures pointées" valeur={formatHeures(kpi.heures)} detail={filtres.poste ? libellePoste(filtres.poste) : "sur la période"} />
              <StatTile label="Affaires actives" valeur={nombre.format(kpi.nbAffaires)} detail="avec au moins un pointage" />
              <StatTile
                label="Heures par affaire"
                valeur={kpi.heuresMedianesParAffaire == null ? "—" : formatHeures(kpi.heuresMedianesParAffaire)}
                detail="médiane sur la période"
              />
              <StatTile
                label="Réel / prévu (fiche)"
                valeur={kpi.ratioReelPrevu == null ? "—" : formatRatio(kpi.ratioReelPrevu)}
                detail={`médiane sur ${kpi.nbAffairesAvecFiche} affaire${kpi.nbAffairesAvecFiche > 1 ? "s" : ""} avec fiche`}
              />
            </div>

            <CarteGraphique
              titre="Heures pointées par mois"
              sousTitre={filtres.poste ? `Poste ${libellePoste(filtres.poste)}` : "Tous postes, pointages ERP"}
            >
              {mois.length > 0 ? (
                <GraphiqueMois donnees={mois} />
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">Aucun pointage sur ce périmètre.</p>
              )}
            </CarteGraphique>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
              <CarteGraphique
                titre="Heures par poste"
                sousTitre="Cliquer une barre pour filtrer le tableau de bord"
                actions={<BoutonsTri valeur={triPostes} options={TRIS_POSTES} onChange={setTriPostes} />}
              >
                <BarresClassees
                  donnees={postes}
                  selection={filtres.poste ? [filtres.poste] : []}
                  onSelection={(poste) => modifier({ poste: filtres.poste === poste ? null : poste })}
                  formatValeur={formatHeures}
                  nomValeur="pointées"
                />
              </CarteGraphique>

              <CarteGraphique
                titre="Prévu (fiche) et réel par poste"
                sousTitre="Affaires avec fiche de prévision, heures totales"
                actions={<BoutonsTri valeur={triComparaison} options={TRIS_COMPARAISON} onChange={setTriComparaison} />}
                legende={
                  <Legende
                    elements={[
                      { nom: "Réel (ERP)", couleur: COULEUR_ACCENT },
                      { nom: "Prévu (fiche)", couleur: COULEUR_CONTEXTE },
                    ]}
                  />
                }
              >
                {comparaison.length > 0 ? (
                  <GraphiqueComparaison donnees={comparaison} />
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">Aucune affaire avec fiche sur ce périmètre.</p>
                )}
              </CarteGraphique>

              <CarteGraphique
                titre="Prévu et réel par affaire"
                sousTitre="Au-dessus de la diagonale : plus d'heures que prévu. Cliquer un point ouvre l'affaire."
              >
                <NuagePrevuReel points={points} onOuvrir={(a) => navigate(`/prevision/${a}`)} />
              </CarteGraphique>

              <CarteGraphique
                titre="Affaires par type de production"
                sousTitre="Flux de production BFC · cliquer une barre pour filtrer"
              >
                {types.length > 0 ? (
                  <BarresClassees
                    donnees={types}
                    selection={filtres.typesProduction}
                    onSelection={(type) =>
                      modifier({
                        typesProduction: filtres.typesProduction.includes(type)
                          ? filtres.typesProduction.filter((t) => t !== type)
                          : [...filtres.typesProduction, type],
                      })
                    }
                    formatValeur={(v) => nombre.format(v)}
                    nomValeur="affaires"
                  />
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">Aucune affaire sur ce périmètre.</p>
                )}
              </CarteGraphique>
            </div>

            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">Affaires du périmètre</h2>
              <TableAffaires affaires={donnees.affaires} types={donnees.types} />
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
