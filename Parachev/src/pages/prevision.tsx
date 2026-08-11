import { AppSidebar } from "@/components/app-sidebar"
import { DataTablePrevi } from "@/components/prevision/data-table-previ"
import { SiteHeader } from "@/components/dashboard/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { TimelineHorizontal } from "@/components/prevision/timeline-horizontal"

import data from "../data/affaires.json"
import item from "../data/timeline.json"
import { AffaireDescription } from "@/components/prevision/description"

export default function Prevision() {
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
                <TimelineHorizontal items={item.items}/>
                <AffaireDescription affaire={data[0]}/>
              </div>
              <DataTablePrevi data={data} />
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
