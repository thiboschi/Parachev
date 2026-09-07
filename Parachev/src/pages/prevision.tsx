import { useParams } from "react-router-dom"
import { AppSidebar } from "@/components/app-sidebar"
import { DataTablePrevi } from "@/components/prevision/data-table-previ"
import { SiteHeader } from "@/components/dashboard/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

import data from "../data/affaires.json"
import { AffaireDescription } from "@/components/prevision/description"

export default function Prevision() {
  // "affaire" est la clé privée (numéro d'affaire) qui identifie quelle
  // affaire afficher ; sans param dans l'URL (ex. via le lien générique
  // de la sidebar), on retombe sur la première de la liste.
  const { affaire } = useParams<{ affaire: string }>()
  const affaireCourante =
    data.find((a) => a.numero === affaire) ?? data[0]

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
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              <div className="px-4 lg:px-6">
                <AffaireDescription affaire={affaireCourante}/>
              </div>
              <DataTablePrevi data={[affaireCourante]} />
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
