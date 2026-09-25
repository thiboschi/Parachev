import * as React from "react"
import { useNavigate } from "react-router-dom"
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { IconArrowNarrowDown, IconArrowNarrowUp, IconArrowsSort, IconChevronLeft, IconChevronRight } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { AffaireRecherche } from "@/hooks/use-recherche-affaires"

const nombre = new Intl.NumberFormat("fr-BE", { maximumFractionDigits: 0 })
const formatDate = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("fr-BE") : "—"

// Colonnes optionnelles : `undefined` + `sortUndefined: "last"` range les
// affaires sans valeur en fin de liste, quel que soit le sens du tri.
const ratio = (a: AffaireRecherche) =>
  a.heures_prevues && a.heures_prevues > 0 && a.heures_reelles > 0 ? a.heures_reelles / a.heures_prevues : undefined

/** Tableau des affaires du périmètre filtré, triable par colonne. */
export function TableAffaires({ affaires, types }: { affaires: AffaireRecherche[]; types: Map<string, string[]> }) {
  const navigate = useNavigate()
  const [tri, setTri] = React.useState<SortingState>([{ id: "heures_reelles", desc: true }])

  const colonnes = React.useMemo<ColumnDef<AffaireRecherche>[]>(
    () => [
      { accessorKey: "affaire", header: "Affaire" },
      {
        id: "client",
        header: "Client / projet",
        accessorFn: (a) => a.client ?? "",
        cell: ({ row }) => (
          <div className="flex max-w-72 flex-col">
            <span className="truncate">{row.original.client ?? "—"}</span>
            {row.original.projet && (
              <span className="truncate text-xs text-muted-foreground">{row.original.projet}</span>
            )}
          </div>
        ),
      },
      {
        id: "types",
        header: "Type de production",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{(types.get(row.original.affaire) ?? []).slice(0, 2).join(", ") || "—"}</span>
        ),
      },
      {
        accessorKey: "heures_reelles",
        header: "Heures réelles",
        cell: ({ getValue }) => nombre.format(getValue() as number),
        meta: { numerique: true },
      },
      {
        id: "heures_prevues",
        header: "Prévues (fiche)",
        accessorFn: (a) => a.heures_prevues ?? undefined,
        sortUndefined: "last",
        cell: ({ getValue }) => (getValue() == null ? "—" : nombre.format(getValue() as number)),
        meta: { numerique: true },
      },
      {
        id: "ratio",
        header: "Réel / prévu",
        accessorFn: ratio,
        sortUndefined: "last",
        cell: ({ getValue }) => {
          const r = getValue() as number | undefined
          return r == null ? "—" : `×${r.toLocaleString("fr-BE", { maximumFractionDigits: 2 })}`
        },
        meta: { numerique: true },
      },
      {
        id: "date_commande",
        header: "Commande",
        accessorFn: (a) => a.date_commande ?? undefined,
        sortUndefined: "last",
        cell: ({ getValue }) => formatDate((getValue() as string | undefined) ?? null),
      },
      {
        id: "date_production_fin",
        header: "Fin de production",
        accessorFn: (a) => a.date_production_fin ?? undefined,
        sortUndefined: "last",
        cell: ({ getValue }) => formatDate((getValue() as string | undefined) ?? null),
      },
    ],
    [types]
  )

  const table = useReactTable({
    data: affaires,
    columns: colonnes,
    state: { sorting: tri },
    onSortingChange: setTri,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 12 } },
  })

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((groupe) => (
            <TableRow key={groupe.id}>
              {groupe.headers.map((entete) => {
                const sens = entete.column.getIsSorted()
                const numerique = (entete.column.columnDef.meta as { numerique?: boolean } | undefined)?.numerique
                return (
                  <TableHead key={entete.id} className={numerique ? "text-right" : undefined}>
                    {entete.column.getCanSort() ? (
                      <button
                        type="button"
                        className={`inline-flex items-center gap-1 hover:text-foreground ${numerique ? "flex-row-reverse" : ""}`}
                        onClick={entete.column.getToggleSortingHandler()}
                      >
                        {flexRender(entete.column.columnDef.header, entete.getContext())}
                        {sens === "asc" && <IconArrowNarrowUp className="size-3.5" />}
                        {sens === "desc" && <IconArrowNarrowDown className="size-3.5" />}
                        {!sens && <IconArrowsSort className="size-3.5 opacity-40" />}
                      </button>
                    ) : (
                      flexRender(entete.column.columnDef.header, entete.getContext())
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
              <TableCell colSpan={colonnes.length} className="py-6 text-center text-muted-foreground">
                Aucune affaire sur ce périmètre.
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((ligne) => (
              <TableRow
                key={ligne.id}
                className="cursor-pointer"
                tabIndex={0}
                onClick={() => navigate(`/prevision/${ligne.original.affaire}`)}
                onKeyDown={(e) => e.key === "Enter" && navigate(`/prevision/${ligne.original.affaire}`)}
              >
                {ligne.getVisibleCells().map((cellule) => {
                  const numerique = (cellule.column.columnDef.meta as { numerique?: boolean } | undefined)?.numerique
                  return (
                    <TableCell key={cellule.id} className={numerique ? "text-right tabular-nums" : undefined}>
                      {flexRender(cellule.column.columnDef.cell, cellule.getContext())}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between border-t px-3 py-2 text-sm text-muted-foreground">
        <span>
          Page {table.getState().pagination.pageIndex + 1} sur {Math.max(table.getPageCount(), 1)} —{" "}
          {affaires.length} affaire{affaires.length > 1 ? "s" : ""}
        </span>
        <div className="flex gap-1">
          <Button variant="outline" size="icon-sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            <IconChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="icon-sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            <IconChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
