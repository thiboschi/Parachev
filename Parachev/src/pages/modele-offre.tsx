import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { AppSidebar } from "@/components/app-sidebar"
import { EditeurModele } from "@/components/chiffrage/editeur-modele"
import { SiteHeader } from "@/components/dashboard/site-header"
import { Button } from "@/components/ui/button"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { MODELE_PAR_DEFAUT, lireModeleOffre, nettoyerModeleOffre, type ModeleOffre } from "@/lib/modele-offre"

// Textes fixes de l'offre PDF de la page "Chiffrage" : rien n'est enregistré
// avant le bouton "Enregistrer", et les offres ouvertes ensuite les reprennent.

export default function ModeleOffre() {
  const [modele, setModele] = useState<ModeleOffre | null>(null)
  // Dernier modèle enregistré : dit s'il reste des modifications à enregistrer.
  const [enregistre, setEnregistre] = useState<ModeleOffre | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [enregistrement, setEnregistrement] = useState(false)

  useEffect(() => {
    invoke<string | null>("obtenir_modele_offre")
      .then((json) => {
        const lu = lireModeleOffre(json)
        setModele(lu)
        setEnregistre(lu)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const modifie = JSON.stringify(modele) !== JSON.stringify(enregistre)

  async function enregistrer() {
    if (!modele) return
    const propre = nettoyerModeleOffre(modele)
    setEnregistrement(true)
    try {
      await invoke("enregistrer_modele_offre", { modele: JSON.stringify(propre) })
      setModele(propre)
      setEnregistre(propre)
      toast.success("Modèle d'offre enregistré")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setEnregistrement(false)
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
        <div className="flex w-full max-w-4xl flex-1 flex-col gap-4 p-4 lg:p-6">
          {error && <p className="text-sm text-destructive">Impossible de lire le modèle d'offre ({error})</p>}

          {!modele && !error && <p className="text-sm text-muted-foreground">Chargement…</p>}

          {modele && (
            <>
              <div className="sticky top-0 z-10 flex items-center gap-2 bg-background py-2">
                <Button onClick={enregistrer} disabled={!modifie || enregistrement}>
                  {enregistrement ? "Enregistrement…" : "Enregistrer"}
                </Button>
                <Button variant="ghost" onClick={() => setModele(enregistre)} disabled={!modifie || enregistrement}>
                  Annuler
                </Button>
                <Button variant="outline" onClick={() => setModele(MODELE_PAR_DEFAUT)} disabled={enregistrement}>
                  Textes par défaut
                </Button>
                {modifie && <span className="text-xs text-muted-foreground">Modifications non enregistrées</span>}
              </div>

              <EditeurModele modele={modele} onChange={setModele} />
            </>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
