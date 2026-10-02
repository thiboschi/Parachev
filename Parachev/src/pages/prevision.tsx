import { useEffect, useState } from "react"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from "@/components/ui/collapsible"
import { IconArrowLeft, IconChevronRight } from "@tabler/icons-react"
import { LIBELLES_ZONE_GOUJONS, useAffaireDb, type MentionMail } from "@/hooks/use-affaire-db"
import type { VariablesAffaireRow } from "@/hooks/use-affaires-db"
import { libellePoste } from "@/lib/postes"
import { DossierAffaire } from "@/components/affaires/dossier-affaire"
import { RETOUR_RECHERCHE, type EtatNavigationRecherche } from "@/lib/recherche"

const formatHeures = (value: number) =>
  value.toLocaleString("fr-BE", { maximumFractionDigits: 1 })

// Origine d'une valeur de variables_affaires (voir quantites.rs).
const LIBELLES_SOURCE: Record<string, string> = {
  cn: "programmes CN",
  mails: "mails",
  "fc-gouj": "fiche (FC-GOUJ)",
  manuel: "saisie manuelle",
}

const LIBELLES_UNITE: Record<MentionMail["unite"], string> = {
  total: "",
  poutre: " / poutre",
  extremite: " / extrémité",
  appui: " / appui",
}

function LigneSource({ children }: { children: React.ReactNode }) {
  return <span className="-mt-1 pl-2 text-xs text-muted-foreground">{children}</span>
}

function ouvrirDocument(chemin: string) {
  invoke("ouvrir_document", { chemin }).catch((e) =>
    toast.error(e instanceof Error ? e.message : String(e))
  )
}

// Champs de `variables_affaires` modifiables depuis cet écran -- exclut
// diametre_moyen_numerique/longueur_coupe (issus du parsing Excel, pas
// éditables ici) et affaire/client (identité de l'affaire, non éditable).
type ChampEditable =
  | "profil"
  | "numero_plan"
  | "numero_offre"
  | "nb_barres"
  | "nb_goujons"
  | "nb_trous_manuel"
  | "nb_trous_numerique"
  | "contre_fleche"

type VariablesEdition = Record<ChampEditable, string>

function versEdition(variables: VariablesAffaireRow | null): VariablesEdition {
  const valeur = (v: string | number | null | undefined) => (v == null ? "" : String(v))
  return {
    profil: valeur(variables?.profil),
    numero_plan: valeur(variables?.numero_plan),
    numero_offre: valeur(variables?.numero_offre),
    nb_barres: valeur(variables?.nb_barres),
    nb_goujons: valeur(variables?.nb_goujons),
    nb_trous_manuel: valeur(variables?.nb_trous_manuel),
    nb_trous_numerique: valeur(variables?.nb_trous_numerique),
    contre_fleche: valeur(variables?.contre_fleche),
  }
}

export default function Prevision() {
  // "affaire" est la clé privée (numéro d'affaire) qui identifie quelle
  // affaire afficher -- toutes les données viennent de la base SQLite via
  // les commandes Tauri scopées par affaire, plus aucun mock JSON.
  const { affaire } = useParams<{ affaire: string }>()
  const navigate = useNavigate()
  const depuisRecherche = (useLocation().state as EtatNavigationRecherche | null)?.depuisRecherche === true
  const {
    client,
    variables,
    profils,
    goujonsParPoutre,
    zonesGoujons,
    cflParBarre,
    quantites,
    heuresParPoste,
    totalHeures,
    loading,
    error,
    refetch,
  } = useAffaireDb(affaire)

  const [edition, setEdition] = useState<VariablesEdition>(() => versEdition(null))
  const [saving, setSaving] = useState(false)

  // Resynchronise le formulaire à chaque (re)chargement des variables --
  // changement d'affaire, ou refetch après une sauvegarde.
  useEffect(() => {
    setEdition(versEdition(variables))
  }, [variables])

  const original = versEdition(variables)
  const modifie =
    variables != null &&
    (Object.keys(edition) as ChampEditable[]).some((champ) => edition[champ] !== original[champ])

  function modifierChamp(champ: ChampEditable, valeur: string) {
    setEdition((prev) => ({ ...prev, [champ]: valeur }))
  }

  const CHAMPS_NUMERIQUES: ChampEditable[] = [
    "nb_barres",
    "nb_goujons",
    "nb_trous_manuel",
    "nb_trous_numerique",
    "contre_fleche",
  ]

  function sauvegarderVariables() {
    if (!affaire) return
    const versNombre = (s: string) => (s.trim() === "" ? null : Number(s))
    const versTexte = (s: string) => (s.trim() === "" ? null : s.trim())

    const champInvalide = CHAMPS_NUMERIQUES.find((champ) => {
      const n = versNombre(edition[champ])
      return n !== null && Number.isNaN(n)
    })
    if (champInvalide) {
      toast.error(`Valeur invalide pour "${champInvalide}"`)
      return
    }

    setSaving(true)
    toast.promise(
      invoke("mettre_a_jour_variables_affaire", {
        affaire,
        variables: {
          profil: versTexte(edition.profil),
          numero_plan: versTexte(edition.numero_plan),
          numero_offre: versTexte(edition.numero_offre),
          nb_barres: versNombre(edition.nb_barres),
          nb_goujons: versNombre(edition.nb_goujons),
          nb_trous_manuel: versNombre(edition.nb_trous_manuel),
          nb_trous_numerique: versNombre(edition.nb_trous_numerique),
          contre_fleche: versNombre(edition.contre_fleche),
        },
      })
        .then(() => refetch())
        .finally(() => setSaving(false)),
      {
        loading: "Sauvegarde des variables…",
        success: "Variables mises à jour",
        error: (e) => (e instanceof Error ? e.message : String(e)),
      }
    )
  }

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
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6">
            <div className="flex flex-col gap-4 px-4 lg:px-6">
              <div className="flex items-center gap-2">
                {depuisRecherche && (
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Retour à la recherche"
                    aria-label="Retour à la recherche"
                    onClick={() => navigate("/search", { state: RETOUR_RECHERCHE })}
                  >
                    <IconArrowLeft />
                  </Button>
                )}
                <h1 className="text-xl font-semibold">
                  {loading ? "Chargement…" : client ?? "Client inconnu"}
                </h1>
                {affaire && (
                  <Badge variant="outline" className="text-muted-foreground">
                    {affaire}
                  </Badge>
                )}
                {variables?.numero_plan && (
                  <Badge variant="outline" className="text-muted-foreground">
                    {variables.numero_plan}
                  </Badge>
                )}
                {variables?.numero_offre && (
                  <Badge variant="outline" className="text-muted-foreground">
                    {variables.numero_offre}
                  </Badge>
                )}
              </div>

              {error && !loading && (
                <span className="text-sm text-destructive">
                  Impossible de lire la base ({error})
                </span>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm text-muted-foreground">
                      Total heures pointées
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-2xl font-medium tabular-nums">
                    {formatHeures(totalHeures)}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm text-muted-foreground">
                      Heures par poste
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-1.5 text-sm">
                    {heuresParPoste.length === 0 && (
                      <span className="text-muted-foreground">Aucune heure pointée</span>
                    )}
                    {heuresParPoste.map(({ poste, heures }) => (
                      <div key={poste} className="flex items-center justify-between">
                        <span className="text-muted-foreground">{libellePoste(poste)}</span>
                        <span className="tabular-nums">{formatHeures(heures)}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-2">
                    <CardTitle className="text-sm text-muted-foreground">Variables</CardTitle>
                    {variables && modifie && (
                      <Button size="xs" onClick={sauvegarderVariables} disabled={saving}>
                        {saving ? "Sauvegarde…" : "Sauvegarder"}
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent className="flex flex-col gap-1.5 text-sm">
                    {!variables && (
                      <span className="text-muted-foreground">Affaire introuvable en base</span>
                    )}
                    {variables && (
                      <>
                        <div className="flex items-center justify-between gap-2">
                          <span className="shrink-0 text-muted-foreground">Profil</span>
                          <Input
                            className="h-7 max-w-32 text-right tabular-nums"
                            value={edition.profil}
                            onChange={(e) => modifierChamp("profil", e.target.value)}
                          />
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="shrink-0 text-muted-foreground">Nb barres</span>
                          <Input
                            type="number"
                            className="h-7 max-w-32 text-right tabular-nums"
                            value={edition.nb_barres}
                            onChange={(e) => modifierChamp("nb_barres", e.target.value)}
                          />
                        </div>
                        {(profils.length > 1 || cflParBarre.length > 0) && (
                          <Collapsible className="flex flex-col gap-1.5 pb-1.5">
                            <CollapsibleTrigger className="group flex items-center gap-1 text-muted-foreground">
                              <IconChevronRight className="size-3.5 transition-transform group-data-panel-open:rotate-90" />
                              <span>Details</span>
                            </CollapsibleTrigger>
                            <CollapsiblePanel>
                              <div className="flex flex-col gap-1 pt-1.5">
                                {profils.map(({ profil, longueur, l_lam, nb_barres }) => (
                                  <div
                                    key={`${profil}-${longueur}`}
                                    className="flex items-center justify-between pl-2"
                                  >
                                    <span>
                                      {profil} · {longueur}mm
                                      {l_lam != null && (
                                        <span className="text-muted-foreground"> (L-LAM {l_lam})</span>
                                      )}
                                    </span>
                                    <span className="tabular-nums">{nb_barres}</span>
                                  </div>
                                ))}
                              </div>
                              {cflParBarre.length > 0 && (
                                <div className="flex flex-col gap-0.5 pt-1.5">
                                  <span className="pl-2 text-xs text-muted-foreground">
                                    Contre-flèche par barre
                                  </span>
                                  {cflParBarre.map((barre) => (
                                    <div
                                      key={barre.rep}
                                      className="flex items-center justify-between pl-4 text-muted-foreground"
                                    >
                                      <span>
                                        {barre.rep} · {barre.profil} · {barre.longueur}mm
                                      </span>
                                      <span className="tabular-nums">
                                        {barre.cfl != null ? `${barre.cfl}` : "CFL ?"}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </CollapsiblePanel>
                          </Collapsible>
                        )}
                        <div className="flex items-center justify-between gap-2">
                          <span className="shrink-0 text-muted-foreground">Nb goujons</span>
                          <Input
                            type="number"
                            className="h-7 max-w-32 text-right tabular-nums"
                            value={edition.nb_goujons}
                            onChange={(e) => modifierChamp("nb_goujons", e.target.value)}
                          />
                        </div>
                        {quantites && (quantites.source_nb_goujons || quantites.nb_goujons_mails != null) && (
                          <LigneSource>
                            {quantites.source_nb_goujons &&
                              `source : ${LIBELLES_SOURCE[quantites.source_nb_goujons] ?? quantites.source_nb_goujons}`}
                            {quantites.nb_goujons_mails != null &&
                              quantites.source_nb_goujons !== "mails" &&
                              `${quantites.source_nb_goujons ? " · " : ""}besoin cité dans les mails : ${quantites.nb_goujons_mails}`}
                          </LigneSource>
                        )}
                        {zonesGoujons && (
                          <LigneSource>
                            {zonesGoujons.zones
                              .map((z) => `${LIBELLES_ZONE_GOUJONS[z.zone]} : ${z.nb_goujons}`)
                              .join(" · ")}
                            {` · ${zonesGoujons.retournements} retournement${zonesGoujons.retournements > 1 ? "s" : ""} de poutre`}
                          </LigneSource>
                        )}
                        {goujonsParPoutre.length > 0 && (
                          <Collapsible className="flex flex-col gap-1.5 pb-1.5">
                            <CollapsibleTrigger className="group flex items-center gap-1 text-muted-foreground">
                              <IconChevronRight className="size-3.5 transition-transform group-data-panel-open:rotate-90" />
                              <span>Details</span>
                            </CollapsibleTrigger>
                            <CollapsiblePanel>
                              <div className="flex flex-col gap-1.5 pt-1.5">
                                {goujonsParPoutre.map((poutre) => (
                                  <div key={poutre.rep} className="flex flex-col gap-0.5 pl-2">
                                    <span>
                                      {poutre.rep} · {poutre.profil} · {poutre.longueur}mm
                                    </span>
                                    {poutre.groupes.map((g, i) => (
                                      <div
                                        key={i}
                                        className="flex items-center justify-between pl-2 text-muted-foreground"
                                      >
                                        <span>
                                          {g.diametre != null ? `Ø${g.diametre}` : "Ø ?"}
                                          {g.hauteur != null ? ` × ${g.hauteur}mm` : ""}
                                          {g.zone != null ? ` · ${LIBELLES_ZONE_GOUJONS[g.zone]}` : ""}
                                        </span>
                                        <span className="tabular-nums">{g.nb_goujons}</span>
                                      </div>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            </CollapsiblePanel>
                          </Collapsible>
                        )}
                        <div className="flex items-center justify-between gap-2">
                          <span className="shrink-0 text-muted-foreground">Trous (manuel)</span>
                          <Input
                            type="number"
                            className="h-7 max-w-32 text-right tabular-nums"
                            value={edition.nb_trous_manuel}
                            onChange={(e) => modifierChamp("nb_trous_manuel", e.target.value)}
                          />
                        </div>
                        {variables.diametre_moyen_manuel != null && (
                          <LigneSource>
                            Ø moyen {variables.diametre_moyen_manuel.toLocaleString("fr-BE", { maximumFractionDigits: 1 })}
                          </LigneSource>
                        )}
                        <div className="flex items-center justify-between gap-2">
                          <span className="shrink-0 text-muted-foreground">Trous (numérique)</span>
                          <Input
                            type="number"
                            className="h-7 max-w-32 text-right tabular-nums"
                            value={edition.nb_trous_numerique}
                            onChange={(e) => modifierChamp("nb_trous_numerique", e.target.value)}
                          />
                        </div>
                        {quantites && (quantites.source_trous_numerique || quantites.nb_programmes_cn > 0) && (
                          <LigneSource>
                            {quantites.source_trous_numerique &&
                              `source : ${LIBELLES_SOURCE[quantites.source_trous_numerique] ?? quantites.source_trous_numerique}`}
                            {quantites.nb_programmes_cn > 0 && ` · ${quantites.nb_programmes_cn} programme(s) CN`}
                            {variables.diametre_moyen_numerique != null &&
                              ` · Ø moyen ${variables.diametre_moyen_numerique.toLocaleString("fr-BE", { maximumFractionDigits: 1 })}`}
                            {quantites.nb_pointeaux_numerique != null &&
                              ` · ${quantites.nb_pointeaux_numerique} pointeaux`}
                          </LigneSource>
                        )}
                        {quantites && quantites.percages_cn.length > 0 && (
                          <Collapsible className="flex flex-col gap-1.5 pb-1.5">
                            <CollapsibleTrigger className="group flex items-center gap-1 text-muted-foreground">
                              <IconChevronRight className="size-3.5 transition-transform group-data-panel-open:rotate-90" />
                              <span>Perçages CN par diamètre</span>
                            </CollapsibleTrigger>
                            <CollapsiblePanel>
                              <div className="flex flex-col gap-1 pt-1.5">
                                {quantites.percages_cn.map(({ diametre, nb }) => (
                                  <div key={diametre} className="flex items-center justify-between pl-2">
                                    <span>Ø{diametre}</span>
                                    <span className="tabular-nums">{nb}</span>
                                  </div>
                                ))}
                              </div>
                            </CollapsiblePanel>
                          </Collapsible>
                        )}
                        {quantites && quantites.mentions_mails.length > 0 && (
                          <Collapsible className="flex flex-col gap-1.5 pb-1.5">
                            <CollapsibleTrigger className="group flex items-center gap-1 text-muted-foreground">
                              <IconChevronRight className="size-3.5 transition-transform group-data-panel-open:rotate-90" />
                              <span>Quantités citées dans les mails ({quantites.mentions_mails.length})</span>
                            </CollapsibleTrigger>
                            <CollapsiblePanel>
                              <div className="flex flex-col gap-1 pt-1.5">
                                {quantites.mentions_mails.map((m, i) => (
                                  <button
                                    key={i}
                                    type="button"
                                    title={m.extrait ?? undefined}
                                    onClick={() => ouvrirDocument(m.chemin)}
                                    className="flex items-center justify-between gap-2 rounded pl-2 text-left hover:bg-muted"
                                  >
                                    <span>
                                      {m.nature === "goujons" ? "Goujons" : "Trous"}
                                      {m.diametre != null && ` Ø${m.diametre}`}
                                      {m.hauteur != null && `×${m.hauteur}`}
                                      {m.nature === "goujons" && !m.besoin && " (commandés)"}
                                      {m.date_mail && (
                                        <span className="text-muted-foreground"> · {m.date_mail.slice(0, 10)}</span>
                                      )}
                                    </span>
                                    <span className="tabular-nums">
                                      {m.nombre}
                                      {LIBELLES_UNITE[m.unite]}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            </CollapsiblePanel>
                          </Collapsible>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>

              {affaire && (
                <DossierAffaire key={affaire} affaire={affaire} heuresParPoste={heuresParPoste} />
              )}
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
