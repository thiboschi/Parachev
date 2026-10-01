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
  GraphiqueTonnage,
  Legende,
  NuagePrevuReel,
  StatTile,
  formatHeures,
  formatTonnes,
} from "@/components/dashboard/graphiques"
import { TableAffaires } from "@/components/dashboard/table-affaires"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { AffaireRecherche } from "@/hooks/use-recherche-affaires"
import { useRechercheAffaires } from "@/hooks/use-recherche-affaires"
import { EVENEMENT_PROGRESSION, type ProgressionIndexation } from "@/hooks/use-progression-indexation"
import {
  BASES_TONNAGE,
  FILTRES_DASHBOARD_VIDES,
  GRANULARITES,
  PRESETS,
  affairesParType,
  affairesTonnage,
  appliquerFiltres,
  bornesPreset,
  comparaisonPostes,
  heuresParMois,
  heuresParPoste,
  indicateurs,
  indicateursTonnage,
  pointsPrevuReel,
  tonnageParClient,
  tonnageParPeriode,
  tonnageParType,
  trierPostes,
  trousAffaire,
  type BaseTonnage,
  type FiltresDashboard,
  type Granularite,
  type Mesure,
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
const decimal = new Intl.NumberFormat("fr-BE", { maximumFractionDigits: 1 })

const pluriel = (n: number) => (n > 1 ? "s" : "")

/** Libellés et formats d'un onglet "mesure par affaire" (tonnage, trous, barres). */
const ONGLETS_MESURE: Record<
  Mesure,
  {
    nom: string
    source: string
    /** "pesée" -> "12 affaires pesées". */
    qualificatif: string
    format: (v: number) => string
    ratio: string
    formatRatio: (heuresParUnite: number) => string
    heuresRatio: string
    sans: string
  }
> = {
  tonnage: {
    nom: "Tonnage",
    source: "Poids de la fiche, sinon du RDE laminage",
    qualificatif: "pesée",
    format: formatTonnes,
    ratio: "Heures par tonne",
    formatRatio: (r) => `${decimal.format(r)} h/t`,
    heuresRatio: "heures ERP totales",
    sans: "Affaires sans poids",
  },
  percage: {
    nom: "Trous",
    source: "Trous de forage manuel (fiche) et numérique (programmes CN ou saisie)",
    qualificatif: "percée",
    format: (v) => `${nombre.format(v)} trous`,
    ratio: "Forage par trou",
    formatRatio: (r) => `${decimal.format(r * 60)} min/trou`,
    heuresRatio: "heures ERP de forage manuel et numérique",
    sans: "Affaires sans nombre de trous",
  },
  barres: {
    nom: "Barres",
    source: "Nombre de barres de la fiche de prévision",
    qualificatif: "comptée",
    format: (v) => `${nombre.format(v)} barres`,
    ratio: "Heures par barre",
    formatRatio: (r) => `${decimal.format(r)} h/barre`,
    heuresRatio: "heures ERP totales",
    sans: "Affaires sans nombre de barres",
  },
}

/**
 * Onglet d'une mesure d'affaire : indicateurs, évolution par période,
 * répartition par client et par type de production. Les données sont
 * datées par la commande ou la fin de production (pas par les pointages)
 * -- voir lib/dashboard.ts.
 */
function OngletMesure({
  mesure,
  affaires,
  types,
  filtres,
  clients,
  onClient,
  onType,
}: {
  mesure: Mesure
  affaires: AffaireRecherche[]
  types: Map<string, string[]>
  filtres: FiltresDashboard
  clients: string[]
  onClient: (client: string) => void
  onType: (type: string) => void
}) {
  const [base, setBase] = React.useState<BaseTonnage>("commande")
  const [granularite, setGranularite] = React.useState<Granularite>("annee")
  const l = ONGLETS_MESURE[mesure]

  const { lignes, sansPoids } = React.useMemo(
    () => affairesTonnage(affaires, types, filtres, base, mesure),
    [affaires, types, filtres, base, mesure]
  )
  const kpi = indicateursTonnage(lignes)
  const periodes = React.useMemo(() => tonnageParPeriode(lignes, granularite), [lignes, granularite])
  const parClient = React.useMemo(
    () => tonnageParClient(lignes).map((c) => ({ cle: c.client, libelle: c.client, valeur: c.tonnes })),
    [lignes]
  )
  const parType = React.useMemo(
    () => tonnageParType(lignes, types).map((t) => ({ cle: t.type, libelle: t.type, valeur: t.tonnes })),
    [lignes, types]
  )
  // Perçage : part du forage numérique et du forage manuel dans le total.
  const trous = React.useMemo(() => {
    if (mesure !== "percage") return null
    const retenues = new Set(lignes.map((x) => x.affaire))
    return affaires
      .filter((a) => retenues.has(a.affaire))
      .reduce(
        (s, a) => ({ manuel: s.manuel + trousAffaire(a).manuel, numerique: s.numerique + trousAffaire(a).numerique }),
        { manuel: 0, numerique: 0 }
      )
  }, [mesure, lignes, affaires])

  const basePhrase = base === "commande" ? "date de commande (RDE, sinon fiche)" : "date de fin de production"
  const nomMin = l.nom.toLowerCase()
  const vide = (
    <p className="py-8 text-center text-sm text-muted-foreground">
      Aucune affaire {l.qualificatif} sur ce périmètre.
    </p>
  )

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {l.source} · période appliquée à la {basePhrase} · hors affaires annulées
          </p>
          <BoutonsTri valeur={base} options={BASES_TONNAGE} onChange={setBase} />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label={l.nom}
            valeur={l.format(kpi.tonnes)}
            detail={
              trous
                ? `${nombre.format(trous.numerique)} en numérique · ${nombre.format(trous.manuel)} en manuel`
                : `${nombre.format(kpi.nbAffaires)} affaire${pluriel(kpi.nbAffaires)} ${l.qualificatif}${pluriel(kpi.nbAffaires)}`
            }
          />
          <StatTile
            label={`${l.nom} par affaire`}
            valeur={kpi.tonnesMedianesParAffaire == null ? "—" : l.format(kpi.tonnesMedianesParAffaire)}
            detail={`médiane sur ${nombre.format(kpi.nbAffaires)} affaire${pluriel(kpi.nbAffaires)}`}
          />
          <StatTile
            label={l.ratio}
            valeur={kpi.heuresParTonne == null ? "—" : l.formatRatio(kpi.heuresParTonne)}
            detail={`médiane sur ${kpi.nbAffairesPointees} affaire${pluriel(kpi.nbAffairesPointees)} pointée${pluriel(kpi.nbAffairesPointees)} (${l.heuresRatio})`}
          />
          <StatTile label={l.sans} valeur={nombre.format(sansPoids)} detail="datées dans la période, exclues des graphiques" />
        </div>
      </div>

      <CarteGraphique
        titre={`${l.nom} par ${GRANULARITES[granularite].toLowerCase()}`}
        sousTitre={`Selon la ${basePhrase}`}
        actions={<BoutonsTri valeur={granularite} options={GRANULARITES} onChange={setGranularite} />}
      >
        {periodes.length > 0 ? (
          <GraphiqueTonnage
            donnees={periodes}
            formatValeur={l.format}
            nomValeur={nomMin}
            formatRatio={l.formatRatio}
            nomRatio={l.heuresRatio}
          />
        ) : (
          vide
        )}
      </CarteGraphique>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
        <CarteGraphique titre={`${l.nom} par client`} sousTitre="10 premiers clients · cliquer une barre pour filtrer">
          {parClient.length > 0 ? (
            <BarresClassees
              donnees={parClient}
              selection={filtres.client === "all" ? [] : [filtres.client]}
              onSelection={(client) => clients.includes(client) && onClient(client)}
              formatValeur={l.format}
              nomValeur={nomMin}
            />
          ) : (
            vide
          )}
        </CarteGraphique>

        <CarteGraphique
          titre={`${l.nom} par type de production`}
          sousTitre="Une affaire compte dans chacun de ses types · cliquer une barre pour filtrer"
        >
          {parType.length > 0 ? (
            <BarresClassees
              donnees={parType}
              selection={filtres.typesProduction}
              onSelection={onType}
              formatValeur={l.format}
              nomValeur={nomMin}
            />
          ) : (
            vide
          )}
        </CarteGraphique>
      </div>
    </div>
  )
}

const ONGLETS = { erp: "ERP", tonnage: "Tonnage", percage: "Perçage", barres: "Barres" } as const

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

  const basculerType = (type: string) =>
    modifier({
      typesProduction: filtres.typesProduction.includes(type)
        ? filtres.typesProduction.filter((t) => t !== type)
        : [...filtres.typesProduction, type],
    })

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
              <Label className="text-xs text-muted-foreground">Période</Label>
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

          {/* Un onglet par sujet ; les filtres ci-dessus s'appliquent à tous.
              Pendant un rechargement, l'affichage précédent reste en place, atténué. */}
          <Tabs defaultValue="erp" className={`gap-4 transition-opacity lg:gap-6 ${loading ? "opacity-60" : ""}`}>
            <TabsList>
              {Object.entries(ONGLETS).map(([valeur, libelle]) => (
                <TabsTrigger key={valeur} value={valeur} className="px-3">
                  {libelle}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="erp" className="flex flex-col gap-4 lg:gap-6">
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
                      onSelection={basculerType}
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
            </TabsContent>

            {(["tonnage", "percage", "barres"] as const).map((mesure) => (
              <TabsContent key={mesure} value={mesure}>
                <OngletMesure
                  mesure={mesure}
                  affaires={affaires}
                  types={donnees.types}
                  filtres={filtres}
                  clients={options.clients}
                  onClient={(client) => modifier({ client: filtres.client === client ? "all" : client })}
                  onType={basculerType}
                />
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
