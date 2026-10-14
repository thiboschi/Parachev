import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { AppSidebar } from "@/components/app-sidebar"
import { RelectureOffre } from "@/components/chiffrage/relecture-offre"
import { SiteHeader } from "@/components/dashboard/site-header"
import { Button } from "@/components/ui/button"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { lireOffreEnregistree, type OffreEnCours } from "@/lib/offre-enregistree"

// Offres enregistrées depuis la relecture de la page "Chiffrage" : chacune se
// rouvre dans la même relecture, pour la retoucher ou la réexporter.

// Miroir de offres::ResumeOffre (src-tauri/src/offres.rs).
type ResumeOffre = {
  id: number
  numero: string
  client: string
  montant: number | null
  date_modification: string
}

const euros = (valeur: number) =>
  `${valeur.toLocaleString("fr-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

// "AAAA-MM-JJ HH:MM:SS" (SQLite, heure locale) à l'affichage.
const dateModification = (brut: string) => {
  const date = new Date(brut.replace(" ", "T"))
  return Number.isNaN(date.getTime())
    ? brut
    : date.toLocaleString("fr-BE", { dateStyle: "short", timeStyle: "short" })
}

export default function Offres() {
  const [offres, setOffres] = useState<ResumeOffre[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ouverte, setOuverte] = useState<OffreEnCours | null>(null)
  // Offre dont la suppression attend une confirmation (second clic).
  const [aSupprimer, setASupprimer] = useState<number | null>(null)

  function charger() {
    invoke<ResumeOffre[]>("lister_offres")
      .then((res) => {
        setOffres(res)
        setError(null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }

  useEffect(charger, [])

  async function ouvrir(id: number) {
    try {
      setOuverte(lireOffreEnregistree(id, await invoke<string>("obtenir_offre", { id })))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  async function supprimer(id: number) {
    try {
      await invoke("supprimer_offre", { id })
      setASupprimer(null)
      charger()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
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
        <div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
          {error && <p className="text-sm text-destructive">Impossible de lire les offres ({error})</p>}

          {!offres && !error && <p className="text-sm text-muted-foreground">Chargement…</p>}

          {offres?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Aucune offre enregistrée pour l'instant : une offre l'est à son export depuis la page Chiffrage (bouton
              « Offre PDF »).
            </p>
          )}

          {offres && offres.length > 0 && (
            <div className="overflow-hidden rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>N° d'offre</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead className="text-right">Montant HT</TableHead>
                    <TableHead>Modifiée le</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {offres.map(({ id, numero, client, montant, date_modification }) => (
                    <TableRow key={id}>
                      <TableCell className="font-medium">{numero || "—"}</TableCell>
                      <TableCell>{client || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{montant !== null ? euros(montant) : "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{dateModification(date_modification)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button variant="outline" size="sm" onClick={() => ouvrir(id)}>
                            Ouvrir
                          </Button>
                          {aSupprimer === id ? (
                            <>
                              <Button variant="destructive" size="sm" onClick={() => supprimer(id)}>
                                Confirmer
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => setASupprimer(null)}>
                                Annuler
                              </Button>
                            </>
                          ) : (
                            <Button variant="ghost" size="sm" onClick={() => setASupprimer(id)}>
                              Supprimer
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </SidebarInset>
      {ouverte && <RelectureOffre initiale={ouverte} onFermer={() => setOuverte(null)} onEnregistree={charger} />}
    </SidebarProvider>
  )
}
