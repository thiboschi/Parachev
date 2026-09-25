import * as React from "react"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import { AffaireResults } from "@/components/affaires/affaires-result"
import { AffaireSearchBar } from "@/components/affaires/affaires-search-bar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { useRechercheAffaires, useRechercheTexte } from "@/hooks/use-recherche-affaires"
import {
  FILTRES_VIDES,
  filtrerAffaires,
  nbFiltresAvances,
  optionsFiltres,
  trierAffaires,
  type Filtres,
  type Tri,
} from "@/lib/recherche"

export default function Search() {
  const { affaires, loading, error } = useRechercheAffaires()
  const [filtres, setFiltres] = React.useState<Filtres>(FILTRES_VIDES)
  const [tri, setTri] = React.useState<Tri>("affaire")
  const documentsTrouves = useRechercheTexte(filtres.texte)

  const options = React.useMemo(() => optionsFiltres(affaires), [affaires])

  const results = React.useMemo(() => {
    const affairesTexte = documentsTrouves ? new Set(documentsTrouves.keys()) : null
    return trierAffaires(filtrerAffaires(affaires, filtres, affairesTexte), tri)
  }, [affaires, filtres, documentsTrouves, tri])

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
        <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
          <AffaireSearchBar
            filtres={filtres}
            onChange={(modif) => setFiltres((prev) => ({ ...prev, ...modif }))}
            onReset={() => setFiltres((prev) => ({ ...FILTRES_VIDES, texte: prev.texte, client: prev.client }))}
            options={options}
            nbFiltresAvances={nbFiltresAvances(filtres)}
            tri={tri}
            onTriChange={setTri}
          />

          <AffaireResults
            results={results}
            documentsTrouves={documentsTrouves}
            loading={loading}
            error={error}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
