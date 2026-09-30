import * as React from "react"
import { useLocation } from "react-router-dom"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import { AffaireResults } from "@/components/affaires/affaires-result"
import { AffaireSearchBar } from "@/components/affaires/affaires-search-bar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { useEtatSession } from "@/hooks/use-etat-session"
import { useRechercheAffaires, useRechercheTexte } from "@/hooks/use-recherche-affaires"
import {
  FILTRES_VIDES,
  filtrerAffaires,
  nbFiltresAvances,
  optionsFiltres,
  trierAffaires,
  type EtatNavigationRecherche,
  type Filtres,
  type Tri,
} from "@/lib/recherche"

export default function Search() {
  // Une nouvelle clé à chaque navigation vers /search : recliquer sur Search
  // dans la sidebar remonte la page (critères remis à zéro) même si on y est.
  const location = useLocation()
  const restaurer = (location.state as EtatNavigationRecherche | null)?.restaurerRecherche === true
  return <PageRecherche key={location.key} restaurer={restaurer} />
}

function PageRecherche({ restaurer }: { restaurer: boolean }) {
  const { affaires, loading, error } = useRechercheAffaires()
  // Enregistrés en session, repris seulement via le bouton retour d'une affaire.
  const [filtres, setFiltres] = useEtatSession<Filtres>("recherche.filtres", FILTRES_VIDES, {
    restaurer,
    fusion: (f) => ({ ...FILTRES_VIDES, ...f }),
  })
  const [tri, setTri] = useEtatSession<Tri>("recherche.tri", "affaire", { restaurer })
  const documentsTrouves = useRechercheTexte(filtres.texte)

  const options = React.useMemo(
    () => optionsFiltres(affaires, filtres.fluxStrict),
    [affaires, filtres.fluxStrict]
  )

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
            restaurer={restaurer}
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
