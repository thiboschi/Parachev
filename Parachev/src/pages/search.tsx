import * as React from "react"
import { IconX } from "@tabler/icons-react"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import { AffaireResults } from "@/components/affaires/affaires-result"
import { AffaireSearchBar } from "@/components/affaires/affaires-search-bar"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

import { useAffairesDb } from "@/hooks/use-affaires-db"
import { PROFIL_OPTIONS } from "@/lib/profils"

const METHODE_OPTIONS = [
  "Redressage",
  "Controle U.S",
  "Building",
  "Sciage",
  "Parking",
  "Presse",
  "Fers-T",
  "IFB",
  "Pont PPE",
  "Ponts Mixtes",
  "Ponts Complexes",
  "Caisson",
  "Murs Anti Bruit",
  "Chargement",
]

type PoutreRow = {
  id: number
  profil: string
  nbrProfil: string
  lgLam: string
  lgFinie: string
  cfl: boolean
  rayon: string
  methode: string
}

export default function Search() {
  const { affaires, clients, loading, error } = useAffairesDb()

  const [searchText, setSearchText] = React.useState("")
  const [client, setClient] = React.useState("all")
  const [poutreRows, setPoutreRows] = React.useState<PoutreRow[]>([])
  const nextPoutreRowId = React.useRef(0)

  function addPoutreRow() {
    nextPoutreRowId.current += 1
    setPoutreRows((rows) => [
      ...rows,
      {
        id: nextPoutreRowId.current,
        profil: "",
        nbrProfil: "",
        lgLam: "",
        lgFinie: "",
        cfl: false,
        rayon: "",
        methode: "",
      },
    ])
  }

  function updatePoutreRow(id: number, patch: Partial<PoutreRow>) {
    setPoutreRows((rows) =>
      rows.map((row) => (row.id === id ? { ...row, ...patch } : row))
    )
  }

  function removePoutreRow(id: number) {
    setPoutreRows((rows) => rows.filter((row) => row.id !== id))
  }

  const results = React.useMemo(() => {
    const query = searchText.trim().toLowerCase()
    return affaires.filter((item) => {
      const matchesQuery =
        !query ||
        [item.numero, item.client ?? ""].join(" ").toLowerCase().includes(query)
      const matchesClient = client === "all" || item.client === client
      return matchesQuery && matchesClient
    })
  }, [affaires, searchText, client])

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
            onAddPoutreRow={addPoutreRow}
          />

          {poutreRows.length > 0 && (
            <div className="flex flex-col gap-3">
              {poutreRows.map((row) => (
                <div
                  key={row.id}
                  className="flex flex-col gap-3 rounded-xl border bg-card p-4 ring-1 ring-foreground/10 md:flex-row md:flex-wrap md:items-end"
                >
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`profil-${row.id}`}>Profil</Label>
                    <Select
                      value={row.profil}
                      onValueChange={(value) =>
                        updatePoutreRow(row.id, { profil: value ?? "" })
                      }
                    >
                      <SelectTrigger id={`profil-${row.id}`} className="w-full md:w-36">
                        <SelectValue placeholder="Profil" />
                      </SelectTrigger>
                      <SelectContent>
                        {PROFIL_OPTIONS.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`nbr-profil-${row.id}`}>Nbr Profil</Label>
                    <Input
                      id={`nbr-profil-${row.id}`}
                      className="w-full md:w-28"
                      value={row.nbrProfil}
                      onChange={(e) =>
                        updatePoutreRow(row.id, { nbrProfil: e.target.value })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`lg-lam-${row.id}`}>Lg Lam</Label>
                    <Input
                      id={`lg-lam-${row.id}`}
                      className="w-full md:w-28"
                      value={row.lgLam}
                      onChange={(e) =>
                        updatePoutreRow(row.id, { lgLam: e.target.value })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`lg-finie-${row.id}`}>Lg Finie</Label>
                    <Input
                      id={`lg-finie-${row.id}`}
                      className="w-full md:w-28"
                      value={row.lgFinie}
                      onChange={(e) =>
                        updatePoutreRow(row.id, { lgFinie: e.target.value })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`methode-${row.id}`}>Méthode</Label>
                    <Select
                      value={row.methode}
                      onValueChange={(value) =>
                        updatePoutreRow(row.id, { methode: value ?? "" })
                      }
                    >
                      <SelectTrigger id={`methode-${row.id}`} className="w-full md:w-40">
                        <SelectValue placeholder="Méthode" />
                      </SelectTrigger>
                      <SelectContent>
                        {METHODE_OPTIONS.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2 pb-1.5">
                    <Checkbox
                      id={`cfl-${row.id}`}
                      checked={row.cfl}
                      onCheckedChange={(value) =>
                        updatePoutreRow(row.id, {
                          cfl: !!value,
                          rayon: value ? row.rayon : "",
                        })
                      }
                    />
                    <Label htmlFor={`cfl-${row.id}`}>CFL</Label>
                  </div>
                  {row.cfl && (
                    <div className="flex flex-col gap-2">
                      <Label htmlFor={`rayon-${row.id}`}>Rayon</Label>
                      <Input
                        id={`rayon-${row.id}`}
                        className="w-full md:w-28"
                        value={row.rayon}
                        onChange={(e) =>
                          updatePoutreRow(row.id, { rayon: e.target.value })
                        }
                      />
                    </div>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground md:ml-auto"
                    onClick={() => removePoutreRow(row.id)}
                  >
                    <IconX />
                    <span className="sr-only">Supprimer la ligne</span>
                  </Button>
                </div>
              ))}
            </div>
          )}

          <AffaireResults results={results} loading={loading} error={error} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}