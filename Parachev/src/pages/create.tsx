import * as React from "react"
import { NavLink } from "react-router-dom"
import { IconPlus, IconX } from "@tabler/icons-react"
import { z } from "zod"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

import searchData from "@/data/search.json"

// machines[] entries aren't all shaped the same across search.json (some
// carry stray "profil"/"nb_poutre" keys), so keep values loosely typed and
// sum defensively rather than assuming every key is a machine value.
const affaireSchema = z.object({
  id: z.number(),
  client: z.string(),
  numero: z.string(),
  status: z.string(),
  semaine: z.string(),
  reviewer: z.string(),
  machines: z.array(z.record(z.string(), z.unknown())),
})

type Affaire = z.infer<typeof affaireSchema>

const items: Affaire[] = searchData

const profilOptions = Array.from(
  new Set(
    items.flatMap((item) =>
      item.machines
        .map((entry) => entry.profil)
        .filter((value): value is string => typeof value === "string")
    )
  )
).sort()

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

export default function Create() {
  const [clientText, setClientText] = React.useState("")
  const [numeroText, setNumeroText] = React.useState("")
  const [status, setStatus] = React.useState("all")
  const [reviewer, setReviewer] = React.useState("all")
  const [semaine, setSemaine] = React.useState("all")
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

  const statusOptions = React.useMemo(
    () => Array.from(new Set(items.map((item) => item.status))).sort(),
    []
  )
  const reviewerOptions = React.useMemo(
    () => Array.from(new Set(items.map((item) => item.reviewer))).sort(),
    []
  )
  const semaineOptions = React.useMemo(
    () => Array.from(new Set(items.map((item) => item.semaine))).sort(),
    []
  )

  // const results = React.useMemo(() => {
  //   const client = clientText.trim().toLowerCase()
  //   const numero = numeroText.trim().toLowerCase()
  //   return items.filter((item) => {
  //     const matchesClient =
  //       !client || item.client.toLowerCase().includes(client)
  //     const matchesNumero =
  //       !numero || item.numero.toLowerCase().includes(numero)
  //     const matchesStatus = status === "all" || item.status === status
  //     const matchesReviewer = reviewer === "all" || item.reviewer === reviewer
  //     const matchesSemaine = semaine === "all" || item.semaine === semaine
  //     return (
  //       matchesClient &&
  //       matchesNumero &&
  //       matchesStatus &&
  //       matchesReviewer &&
  //       matchesSemaine
  //     )
  //   })
  // }, [clientText, numeroText, status, reviewer, semaine])

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
          <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 ring-1 ring-foreground/10 md:flex-row md:items-end">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="client-filter">Client</Label>
              <Input
                id="client-filter"
                placeholder="Client"
                value={clientText}
                onChange={(e) => setClientText(e.target.value)}
              />
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="numero-filter">Numéro client</Label>
              <Input
                id="numero-filter"
                placeholder="Numéro client"
                value={numeroText}
                onChange={(e) => setNumeroText(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="status-filter">Status</Label>
              <Select
                value={status}
                onValueChange={(value) => setStatus(value ?? "all")}
              >
                <SelectTrigger id="status-filter" className="w-full md:w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {statusOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="reviewer-filter">Reviewer</Label>
              <Select
                value={reviewer}
                onValueChange={(value) => setReviewer(value ?? "all")}
              >
                <SelectTrigger id="reviewer-filter" className="w-full md:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All reviewers</SelectItem>
                  {reviewerOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="semaine-filter">Semaine</Label>
              <Select
                value={semaine}
                onValueChange={(value) => setSemaine(value ?? "all")}
              >
                <SelectTrigger id="semaine-filter" className="w-full md:w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All weeks</SelectItem>
                  {semaineOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="rounded-full"
              onClick={addPoutreRow}
            >
              <IconPlus />
              <span className="sr-only">Ajouter une ligne de profil</span>
            </Button>
          </div>

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
                      <SelectTrigger
                        id={`profil-${row.id}`}
                        className="w-full md:w-36"
                      >
                        <SelectValue placeholder="Profil" />
                      </SelectTrigger>
                      <SelectContent>
                        {profilOptions.map((option) => (
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
                      <SelectTrigger
                        id={`methode-${row.id}`}
                        className="w-full md:w-40"
                      >
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

          <div className="flex justify-end">
            <Button render={<NavLink to="/prevision" />}>
              Create Affaire
            </Button>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
