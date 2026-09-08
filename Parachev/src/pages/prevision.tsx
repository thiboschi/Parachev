import { useParams } from "react-router-dom"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useAffaireDb } from "@/hooks/use-affaire-db"
import { libellePoste } from "@/lib/postes"

const formatHeures = (value: number) =>
  value.toLocaleString("fr-BE", { maximumFractionDigits: 1 })

export default function Prevision() {
  // "affaire" est la clé privée (numéro d'affaire) qui identifie quelle
  // affaire afficher -- toutes les données viennent de la base SQLite via
  // les commandes Tauri scopées par affaire, plus aucun mock JSON.
  const { affaire } = useParams<{ affaire: string }>()
  const {
    client,
    variables,
    heuresParPoste,
    totalHeures,
    previsions,
    loading,
    error,
    refetch,
  } = useAffaireDb(affaire)

  function executerPrevision() {
    console.log("try executing previ")
    if (!affaire) return
    toast.promise(
      invoke("previsualiser_affaire", { affaire }).then((resultat) => {
        refetch()
        return resultat
      }),
      {
        loading: `Calcul de la prévision pour ${affaire}…`,
        success: "Prévision calculée",
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
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-semibold">
                    {loading ? "Chargement…" : client ?? "Client inconnu"}
                  </h1>
                  {affaire && (
                    <Badge variant="outline" className="text-muted-foreground">
                      {affaire}
                    </Badge>
                  )}
                </div>
                <Button className="w-fit" onClick={executerPrevision} disabled={!affaire}>
                  previ
                </Button>
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
                  <CardHeader>
                    <CardTitle className="text-sm text-muted-foreground">Variables</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-1.5 text-sm">
                    {!variables && (
                      <span className="text-muted-foreground">Affaire introuvable en base</span>
                    )}
                    {variables && (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Nb barres</span>
                          <span className="tabular-nums">{variables.nb_barres ?? "—"}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Nb goujons</span>
                          <span className="tabular-nums">{variables.nb_goujons ?? "—"}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Trous (manuel)</span>
                          <span className="tabular-nums">
                            {variables.nb_trous_manuel ?? "—"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Trous (numérique)</span>
                          <span className="tabular-nums">
                            {variables.nb_trous_numerique ?? "—"}
                          </span>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground">
                    Prévisions enregistrées
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-1.5 text-sm">
                  {previsions.length === 0 && (
                    <span className="text-muted-foreground">
                      Aucune prévision calculée pour cette affaire
                    </span>
                  )}
                  {previsions.map((p) => (
                    <div key={p.poste} className="flex items-center justify-between">
                      <span className="text-muted-foreground">{libellePoste(p.poste)}</span>
                      <span className="tabular-nums">{formatHeures(p.heures_prevues)}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
