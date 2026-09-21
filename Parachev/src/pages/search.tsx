import * as React from "react"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import { AffaireResults } from "@/components/affaires/affaires-result"
import { AffaireSearchBar, type ChampVariableKey } from "@/components/affaires/affaires-search-bar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { useAffairesDb } from "@/hooks/use-affaires-db"
import { CHAMPS_VARIABLES_NUMERIQUES } from "@/lib/variables-affaires"
import { TYPES_PRODUCTION, affaireCorrespondAuType } from "@/lib/flux-production"

type VariableFiltres = Partial<Record<ChampVariableKey, string>>

export default function Search() {
  const { affaires, clients, loading, error } = useAffairesDb()
  const [searchText, setSearchText] = React.useState("")
  const [client, setClient] = React.useState("all")
  const [profil, setProfil] = React.useState("all")
  const [type, setType] = React.useState("all")
  const [variableFiltres, setVariableFiltres] = React.useState<VariableFiltres>({})

  const setVariableFiltre = (key: ChampVariableKey, value: string) => {
    setVariableFiltres((prev) => ({ ...prev, [key]: value }))
  }

  const profilOptions = React.useMemo(
    () =>
      Array.from(
        new Set(
          affaires
            .map((item) => item.variables?.profil)
            .filter((p): p is string => !!p)
        )
      ).sort(),
    [affaires]
  )

  const typeSelectionne = React.useMemo(
    () => (type === "all" ? null : TYPES_PRODUCTION.find((t) => t.nom === type) ?? null),
    [type]
  )

  const results = React.useMemo(() => {
    const query = searchText.trim().toLowerCase()
    return affaires.filter((item) => {
      const matchesQuery =
        !query ||
        [
          item.numero,
          item.client ?? "",
          item.variables?.profil ?? "",
          item.variables?.numero_plan ?? "",
          item.variables?.numero_offre ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(query)
      const matchesClient = client === "all" || item.client === client
      const matchesProfil = profil === "all" || item.variables?.profil === profil
      const matchesVariables = CHAMPS_VARIABLES_NUMERIQUES.every(({ key }) => {
        const filtre = variableFiltres[key]?.trim()
        if (!filtre) return true
        const attendu = Number(filtre)
        if (Number.isNaN(attendu)) return true
        return item.variables?.[key] === attendu
      })
      const matchesType =
        !typeSelectionne ||
        affaireCorrespondAuType(
          new Set(item.heuresParPoste.map((h) => h.poste)),
          typeSelectionne
        )
      return matchesQuery && matchesClient && matchesProfil && matchesVariables && matchesType
    })
  }, [affaires, searchText, client, profil, variableFiltres, typeSelectionne])

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
            searchText={searchText}
            onSearchTextChange={setSearchText}
            client={client}
            onClientChange={setClient}
            clientOptions={clients}
            profil={profil}
            onProfilChange={setProfil}
            profilOptions={profilOptions}
            type={type}
            onTypeChange={setType}
            variableFiltres={variableFiltres}
            onVariableFiltreChange={setVariableFiltre}
            onResetVariables={() => setVariableFiltres({})}
          />

          <AffaireResults results={results} loading={loading} error={error} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}