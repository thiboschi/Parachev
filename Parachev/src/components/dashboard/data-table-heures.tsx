import * as React from "react"
import { IconArrowNarrowDown, IconArrowNarrowUp, IconArrowsSort, IconChevronLeft, IconChevronRight, IconChevronsLeft, IconChevronsRight } from "@tabler/icons-react"
import { flexRender, getCoreRowModel, getPaginationRowModel, useReactTable, type Column, type ColumnDef } from "@tanstack/react-table"
import { invoke } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type Heure = {
  affaire: string
  ot: string | null
  date: string | null
  poste: string
  heures: number
}

// Clickable column header that toggles asc/desc/none sorting
function SortableHeader({
  column,
  children,
}: {
  column: Column<Heure, unknown>
  children: React.ReactNode
}) {
  const sorted = column.getIsSorted()

  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 h-8"
      onClick={() => column.toggleSorting()}
    >
      {children}
      {sorted === "asc" ? (
        <IconArrowNarrowUp className="ml-2 size-4 text-muted-foreground" />
      ) : sorted === "desc" ? (
        <IconArrowNarrowDown className="ml-2 size-4 text-muted-foreground" />
      ) : (
        <IconArrowsSort className="ml-2 size-4 text-muted-foreground" />
      )}
    </Button>
  )
}

const columns: ColumnDef<Heure>[] = [
  {
    accessorKey: "affaire",
    header: ({ column }) => <SortableHeader column={column}>Affaire</SortableHeader>,
  },
  {
    accessorKey: "ot",
    header: ({ column }) => <SortableHeader column={column}>OT</SortableHeader>,
    cell: ({ row }) => row.original.ot ?? "—",
  },
  {
    accessorKey: "date",
    header: ({ column }) => <SortableHeader column={column}>Date</SortableHeader>,
    cell: ({ row }) => row.original.date ?? "—",
  },
  {
    accessorKey: "poste",
    header: ({ column }) => <SortableHeader column={column}>Poste</SortableHeader>,
    cell: ({ row }) => (
      <span className="capitalize">{row.original.poste.replace(/_/g, " ")}</span>
    ),
  },
  {
    accessorKey: "heures",
    header: ({ column }) => (
      <div className="flex justify-end">
        <SortableHeader column={column}>Heures</SortableHeader>
      </div>
    ),
    cell: ({ row }) => (
      <div className="text-right">{row.original.heures.toFixed(2)} h</div>
    ),
  },
]

export function DataTableHeures() {
  const [data, setData] = React.useState<Heure[]>([])
  const [chargement, setChargement] = React.useState(true)
  const [erreur, setErreur] = React.useState<string | null>(null)
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: 20,
  })

  React.useEffect(() => {
    let annule = false
    invoke<Heure[]>("lister_heures")
      .then((rows) => {
        if (!annule) setData(rows)
      })
      .catch((e) => {
        if (!annule) setErreur(String(e))
      })
      .finally(() => {
        if (!annule) setChargement(false)
      })
    return () => {
      annule = true
    }
  }, [])

  const table = useReactTable({
    data,
    columns,
    state: {
      pagination,
    },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableCaption>Heures — affaires.db</TableCaption>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {chargement ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  Chargement…
                </TableCell>
              </TableRow>
            ) : erreur ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-destructive">
                  {erreur}
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  Aucune donnée.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between px-4">
        <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
          {data.length} ligne(s) au total.
        </div>
        <div className="flex w-full items-center gap-8 lg:w-fit">
          <div className="hidden items-center gap-2 lg:flex">
            <Label htmlFor="rows-per-page-heures" className="text-sm font-medium">
              Rows per page
            </Label>
            <Select
              value={`${table.getState().pagination.pageSize}`}
              onValueChange={(value) => {
                table.setPageSize(Number(value))
              }}
            >
              <SelectTrigger size="sm" className="w-20" id="rows-per-page-heures">
                <SelectValue placeholder={table.getState().pagination.pageSize} />
              </SelectTrigger>
              <SelectContent side="top">
                {[10, 20, 30, 40, 50].map((pageSize) => (
                  <SelectItem key={pageSize} value={`${pageSize}`}>
                    {pageSize}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex w-fit items-center justify-center text-sm font-medium">
            Page {table.getState().pagination.pageIndex + 1} of{" "}
            {table.getPageCount()}
          </div>
          <div className="ml-auto flex items-center gap-2 lg:ml-0">
            <Button
              variant="outline"
              className="hidden h-8 w-8 p-0 lg:flex"
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
            >
              <span className="sr-only">Go to first page</span>
              <IconChevronsLeft />
            </Button>
            <Button
              variant="outline"
              className="size-8"
              size="icon"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <span className="sr-only">Go to previous page</span>
              <IconChevronLeft />
            </Button>
            <Button
              variant="outline"
              className="size-8"
              size="icon"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <span className="sr-only">Go to next page</span>
              <IconChevronRight />
            </Button>
            <Button
              variant="outline"
              className="hidden size-8 lg:flex"
              size="icon"
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
            >
              <span className="sr-only">Go to last page</span>
              <IconChevronsRight />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
