import { useEffect, useMemo, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { IconArrowNarrowDown, IconArrowNarrowUp, IconArrowsSort,IconCalendar, IconChevronLeft, IconChevronRight, IconSearch, IconX } from "@tabler/icons-react"
import { type ColumnDef, type SortingState, flexRender, getCoreRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"

// Miroir de la struct HeureRow définie côté Rust (src-tauri/src/lib.rs).
type HeureRow = {
  affaire: string
  ot: string | null
  date: string | null
  poste: string
  heures: number
}

// Les affaires sont des numéros (ex. 11000, 11248...) : on les compare
// numériquement plutôt qu'alphabétiquement pour un tri correct
// (sinon "2" > "10" en tri texte).
function trierNumerique(a: string, b: string): number {
  const na = Number(a)
  const nb = Number(b)
  if (Number.isNaN(na) || Number.isNaN(nb)) return a.localeCompare(b)
  return na - nb
}

const formatHeures = (n: number) =>
  n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })

// Les dates viennent de l'ERP/Excel et peuvent être stockées en ISO
// ("2026-08-28") ou en format français ("28/08/2026") selon la source.
// On essaie les deux avant d'abandonner, pour que le tri et le graphique
// par date fonctionnent quel que soit le format réellement présent.
function parseDate(value: string | null): Date | null {
  if (!value) return null

  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    const [, y, m, d] = isoMatch
    return new Date(Number(y), Number(m) - 1, Number(d))
  }

  const frMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (frMatch) {
    const [, d, m, y] = frMatch
    return new Date(Number(y), Number(m) - 1, Number(d))
  }

  const fallback = new Date(value)
  return Number.isNaN(fallback.getTime()) ? null : fallback
}

// Convertit une Date en valeur attendue par <input type="date"> (YYYY-MM-DD),
// en heure locale -- éviter toISOString() qui bascule en UTC et peut décaler
// d'un jour selon le fuseau horaire.
function toInputValue(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function parseInputValue(value: string): Date | null {
  if (!value) return null
  const [y, m, d] = value.split("-").map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

export function HeuresTable() {
  const [data, setData] = useState<HeureRow[]>([])
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [recherche, setRecherche] = useState("")
  const [postesSelectionnes, setPostesSelectionnes] = useState<Set<string>>(
    new Set()
  )
  const [dateDebut, setDateDebut] = useState("")
  const [dateFin, setDateFin] = useState("")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "date", desc: true },
  ])

  useEffect(() => {
    invoke<HeureRow[]>("lister_heures")
      .then(setData)
      .catch((e) => setErreur(String(e)))
      .finally(() => setChargement(false))
  }, [])

  const postesDisponibles = useMemo(
    () => Array.from(new Set(data.map((d) => d.poste))).sort(),
    [data]
  )

  const donneesFiltrees = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    const bornDebut = parseInputValue(dateDebut)
    const bornFin = parseInputValue(dateFin)
    return data.filter((row) => {
      const matchRecherche =
        q === "" ||
        row.affaire.toLowerCase().includes(q) ||
        (row.ot ?? "").toLowerCase().includes(q)
      const matchPoste =
        postesSelectionnes.size === 0 || postesSelectionnes.has(row.poste)
      const matchPeriode = (() => {
        if (!bornDebut && !bornFin) return true
        const d = parseDate(row.date)
        if (!d) return false
        if (bornDebut && d.getTime() < bornDebut.getTime()) return false
        if (bornFin && d.getTime() > bornFin.getTime()) return false
        return true
      })()
      return matchRecherche && matchPoste && matchPeriode
    })
  }, [data, recherche, postesSelectionnes, dateDebut, dateFin])

  const totalHeures = useMemo(
    () => donneesFiltrees.reduce((sum, r) => sum + r.heures, 0),
    [donneesFiltrees]
  )

  const affairesUniques = useMemo(
    () => new Set(donneesFiltrees.map((r) => r.affaire)).size,
    [donneesFiltrees]
  )

  const heuresParPoste = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of donneesFiltrees) {
      map.set(r.poste, (map.get(r.poste) ?? 0) + r.heures)
    }
    return Array.from(map, ([poste, heures]) => ({ poste, heures })).sort(
      (a, b) => b.heures - a.heures
    )
  }, [donneesFiltrees])

  const togglePoste = (poste: string) => {
    setPostesSelectionnes((prev) => {
      const next = new Set(prev)
      if (next.has(poste)) {
        next.delete(poste)
      } else {
        next.add(poste)
      }
      return next
    })
  }

  const appliquerPreset = (
    preset: "tout" | "12mois" | "cetteAnnee" | "anneeDerniere"
  ) => {
    const aujourdhui = new Date()
    if (preset === "tout") {
      setDateDebut("")
      setDateFin("")
    } else if (preset === "12mois") {
      const debut = new Date(aujourdhui)
      debut.setMonth(debut.getMonth() - 12)
      setDateDebut(toInputValue(debut))
      setDateFin(toInputValue(aujourdhui))
    } else if (preset === "cetteAnnee") {
      setDateDebut(toInputValue(new Date(aujourdhui.getFullYear(), 0, 1)))
      setDateFin(toInputValue(aujourdhui))
    } else if (preset === "anneeDerniere") {
      const anneePrecedente = aujourdhui.getFullYear() - 1
      setDateDebut(toInputValue(new Date(anneePrecedente, 0, 1)))
      setDateFin(toInputValue(new Date(anneePrecedente, 11, 31)))
    }
  }

  const columns = useMemo<ColumnDef<HeureRow>[]>(
    () => [
      {
        accessorKey: "affaire",
        header: "Affaire",
        sortingFn: (a, b) =>
          trierNumerique(a.original.affaire, b.original.affaire),
      },
      {
        accessorKey: "ot",
        header: "OT",
        cell: ({ getValue }) => (getValue() as string | null) ?? "—",
        enableSorting: false,
      },
      {
        accessorKey: "date",
        header: "Date",
        cell: ({ getValue }) => (getValue() as string | null) ?? "—",
        sortingFn: (a, b) => {
          const da = parseDate(a.original.date)
          const db = parseDate(b.original.date)
          if (!da && !db) return 0
          if (!da) return 1
          if (!db) return -1
          return da.getTime() - db.getTime()
        },
      },
      {
        accessorKey: "poste",
        header: "Poste",
        cell: ({ getValue }) => (
          <Badge variant="secondary">{getValue() as string}</Badge>
        ),
        sortingFn: (a, b) => a.original.poste.localeCompare(b.original.poste),
      },
      {
        accessorKey: "heures",
        header: "Heures",
        cell: ({ getValue }) => formatHeures(getValue() as number),
        sortingFn: (a, b) => a.original.heures - b.original.heures,
      },
    ],
    []
  )

  const table = useReactTable({
    data: donneesFiltrees,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 20 } },
  })

  if (chargement) {
    return (
      <p className="px-4 text-sm text-muted-foreground lg:px-6">
        Chargement des données ERP...
      </p>
    )
  }

  if (erreur) {
    return (
      <p className="px-4 text-sm text-destructive lg:px-6">
        Erreur lors du chargement : {erreur}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      {/* Cartes de synthèse */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-muted p-4">
          <p className="text-xs text-muted-foreground">Total heures</p>
          <p className="text-2xl font-medium">{formatHeures(totalHeures)} h</p>
        </div>
        <div className="rounded-lg bg-muted p-4">
          <p className="text-xs text-muted-foreground">Affaires</p>
          <p className="text-2xl font-medium">{affairesUniques}</p>
        </div>
        <div className="rounded-lg bg-muted p-4">
          <p className="text-xs text-muted-foreground">Lignes</p>
          <p className="text-2xl font-medium">{donneesFiltrees.length}</p>
        </div>
      </div>

      {/* Barre d'outils : recherche, filtre poste, période */}
      <div className="flex flex-col gap-3">
        <div className="relative max-w-sm">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher une affaire ou un OT..."
            className="pl-8"
          />
        </div>

        {postesDisponibles.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {postesDisponibles.map((poste) => {
              const actif = postesSelectionnes.has(poste)
              return (
                <Button
                  key={poste}
                  variant={actif ? "secondary" : "outline"}
                  size="xs"
                  onClick={() => togglePoste(poste)}
                >
                  {poste}
                </Button>
              )
            })}
            {postesSelectionnes.size > 0 && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setPostesSelectionnes(new Set())}
              >
                Réinitialiser postes
              </Button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1.5">
            <Button variant="outline" size="xs" onClick={() => appliquerPreset("tout")}>
              Tout
            </Button>
            <Button variant="outline" size="xs" onClick={() => appliquerPreset("12mois")}>
              12 derniers mois
            </Button>
            <Button variant="outline" size="xs" onClick={() => appliquerPreset("cetteAnnee")}>
              Cette année
            </Button>
            <Button variant="outline" size="xs" onClick={() => appliquerPreset("anneeDerniere")}>
              Année dernière
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            <IconCalendar className="size-4 text-muted-foreground" />
            <Input
              type="date"
              value={dateDebut}
              onChange={(e) => setDateDebut(e.target.value)}
              className="w-auto"
            />
            <span className="text-sm text-muted-foreground">→</span>
            <Input
              type="date"
              value={dateFin}
              onChange={(e) => setDateFin(e.target.value)}
              className="w-auto"
            />
            {(dateDebut || dateFin) && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setDateDebut("")
                  setDateFin("")
                }}
              >
                <IconX className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Répartition par poste */}
      {heuresParPoste.length > 0 && (
        <div className="rounded-xl border bg-card p-4">
          <p className="mb-2 text-xs text-muted-foreground">Heures par poste</p>
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={heuresParPoste}>
                <CartesianGrid vertical={false} strokeOpacity={0.3} />
                <XAxis
                  dataKey="poste"
                  tick={{ fontSize: 11 }}
                  interval={0}
                  angle={-30}
                  textAnchor="end"
                  height={60}
                />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(value) => [
                    `${formatHeures(Number(value))} h`,
                    "Heures",
                  ]}
                />
                <Bar dataKey="heures" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Tableau */}
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sortDir = header.column.getIsSorted()
                  return (
                    <TableHead key={header.id}>
                      {header.column.getCanSort() ? (
                        <button
                          type="button"
                          className="flex items-center gap-1 hover:text-foreground"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                          {sortDir === "asc" && (
                            <IconArrowNarrowUp className="size-3.5" />
                          )}
                          {sortDir === "desc" && (
                            <IconArrowNarrowDown className="size-3.5" />
                          )}
                          {!sortDir && (
                            <IconArrowsSort className="size-3.5 opacity-40" />
                          )}
                        </button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="py-6 text-center text-muted-foreground"
                >
                  Aucune ligne ne correspond aux filtres.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between border-t px-3 py-2 text-sm text-muted-foreground">
          <span>
            Page {table.getState().pagination.pageIndex + 1} sur{" "}
            {Math.max(table.getPageCount(), 1)} — {donneesFiltrees.length} lignes
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <IconChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <IconChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}