import * as React from "react"
import { IconArrowsSort, IconChevronDown, IconChevronLeft, IconChevronRight, IconChevronsLeft, IconChevronsRight, IconDotsVertical, IconLayoutColumns, IconPlus, IconArrowNarrowUp, IconArrowNarrowDown } from "@tabler/icons-react"
import {
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"
import { Input } from "@base-ui/react"

// Shape of each affaire as it comes out of affaires.json: one affaire can
// carry several poutres (beams), each with its own machine-value entries.
export const affaireSchema = z.object({
  id: z.number(),
  client: z.string(),
  numero: z.string(),
  status: z.string(),
  semaine: z.string(),
  reviewer: z.string(),
  poutres: z.array(
    z.object({
      nb_poutre: z.number(),
      profil: z.string(),
      machines: z.record(z.string(), z.number().nullable()),
    })
  ),
})

// Shape of a table row: one row per poutres[] entry, so a single affaire
// can expand into several rows.
export const schema = z.object({
  id: z.string(),
  client: z.string(),
  numero: z.string(),
  status: z.string(),
  semaine: z.string(),
  reviewer: z.string(),
  nb_poutre: z.number(),
  profil: z.string(),
  machines: z.record(z.string(), z.number().nullable()),
})

function flattenAffaires(
  affaires: z.infer<typeof affaireSchema>[]
): z.infer<typeof schema>[] {
  return affaires.flatMap((affaire) =>
    affaire.poutres.map((poutre, index) => ({
      id: `${affaire.id}-${index}`,
      client: affaire.client,
      numero: affaire.numero,
      status: affaire.status,
      semaine: affaire.semaine,
      reviewer: affaire.reviewer,
      nb_poutre: poutre.nb_poutre,
      profil: poutre.profil,
      machines: poutre.machines,
    }))
  )
}

// Clickable column header that toggles asc/desc/none sorting
function SortableHeader({
  column,
  children,
}: {
  column: Column<z.infer<typeof schema>, unknown>
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

//----------------- CheckBox ------------------------------
const selectColumn: ColumnDef<z.infer<typeof schema>> = {
  id: "select",
  header: ({ table }) => (
    <div className="flex items-center justify-center">
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && undefined)
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all"
      />
    </div>
  ),
  cell: ({ row }) => (
    <div className="flex items-center justify-center">
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
      />
    </div>
  ),
  enableSorting: false,
  enableHiding: false,
}

//----------------- Profil Column ---------------------------
const profilColumn: ColumnDef<z.infer<typeof schema>> = {
  accessorKey: "profil",
  header: ({ column }) => <SortableHeader column={column}>Profil</SortableHeader>,
  cell: ({ row }) => (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          toast.promise(new Promise((resolve) => setTimeout(resolve, 1000)), {
            loading: `Saving ${row.original.client}`,
            success: "Done",
            error: "Error",
          })
        }}
      >
        <Label htmlFor={`${row.original.id}-target`} className="sr-only">
          Target
        </Label>
        <Input
          className="h-8 w-16 border-transparent bg-transparent text-right shadow-none hover:bg-input/30 focus-visible:border focus-visible:bg-background dark:bg-transparent dark:hover:bg-input/30 dark:focus-visible:bg-input/30"
          defaultValue={row.original.profil}
          id={`${row.original.id}-target`}
        />
      </form>
    ),
}


//----------------- nb_poutre Column ---------------------------
const nbPoutreColumn: ColumnDef<z.infer<typeof schema>> = {
  accessorKey: "nb_poutre",
  header: ({ column }) => (
    <SortableHeader column={column}>Nb poutres</SortableHeader>
  ),
  cell: ({ row }) =>  (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          toast.promise(new Promise((resolve) => setTimeout(resolve, 1000)), {
            loading: `Saving ${row.original.client}`,
            success: "Done",
            error: "Error",
          })
        }}
      >
        <Label htmlFor={`${row.original.id}-target`} className="sr-only">
          Target
        </Label>
        <Input
          className="h-8 w-16 border-transparent bg-transparent text-right shadow-none hover:bg-input/30 focus-visible:border focus-visible:bg-background dark:bg-transparent dark:hover:bg-input/30 dark:focus-visible:bg-input/30"
          defaultValue={row.original.nb_poutre}
          id={`${row.original.id}-target`}
        />
      </form>
    ),
}

//----------------- Total ---------------------------
const totalColumn: ColumnDef<z.infer<typeof schema>> = {
  id: "total",
  header: () => <div className="text-right">Total</div>,
  cell: ({ row }) => {
    const total = Object.values(row.original.machines).reduce<number>(
      (sum, value) => sum + (value ?? 0),
      0
    )
    return (<form
        onSubmit={(e) => {
          e.preventDefault()
          toast.promise(new Promise((resolve) => setTimeout(resolve, 1000)), {
            loading: `Saving ${row.original.client}`,
            success: "Done",
            error: "Error",
          })
        }}
      >
        <Label htmlFor={`${row.original.id}-target`} className="sr-only">
          Target
        </Label>
        <Input
          className="h-8 w-16 border-transparent bg-transparent text-right shadow-none hover:bg-input/30 focus-visible:border focus-visible:bg-background dark:bg-transparent dark:hover:bg-input/30 dark:focus-visible:bg-input/30"
          defaultValue={total}
          id={`${row.original.id}-target`}
        />
      </form>)
  },
}

//----------------- Three Dot ---------------------------
const actionsColumn: ColumnDef<z.infer<typeof schema>> = {
  id: "actions",
  cell: () => (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="flex size-8 text-muted-foreground data-[state=open]:bg-muted"
            size="icon"
          />
        }
      >
        <IconDotsVertical />
        <span className="sr-only">Open menu</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-32">
        <DropdownMenuItem>Edit</DropdownMenuItem>
        <DropdownMenuItem>Make a copy</DropdownMenuItem>
        <DropdownMenuItem>Favorite</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}

// One column per machine, built from whatever machine names appear in the
// dataset. Cells only render a value when it"s different than null.
function useMachineColumns(data: z.infer<typeof schema>[]) {
  return React.useMemo<ColumnDef<z.infer<typeof schema>>[]>(() => {
    const machineNames = Array.from(
      new Set(data.flatMap((row) => Object.keys(row.machines)))
    )
      .filter((name) => data.some((row) => row.machines[name] != null))
      .sort()

    return machineNames.map((name) => ({
      id: name,
      accessorFn: (row) => row.machines[name],
      header: ({ column }) => (
        <SortableHeader column={column}>{name}</SortableHeader>
      ),
      cell: ({ row }) => {
        const value = row.original.machines[name]
        return value != null ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              toast.promise(new Promise((resolve) => setTimeout(resolve, 1000)), {
                loading: `Saving ${row.original.client}`,
                success: "Done",
                error: "Error",
              })
            }}
          >
            <Label htmlFor={`${row.original.id}-target`} className="sr-only">
              Target
            </Label>
            <Input
              className="h-8 w-16 border-transparent bg-transparent text-right shadow-none hover:bg-input/30 focus-visible:border focus-visible:bg-background dark:bg-transparent dark:hover:bg-input/30 dark:focus-visible:bg-input/30"
              defaultValue={value}
              id={`${row.original.id}-target`}
            />
          </form>
        ) : null
      },
    }))
  }, [data])
}

const sectionOptions = [
  "Assemblag/Tracage",
  "Manutention",
  "Enfilage",
  "Forage Manuel",
  "Forage Numerique",
  "Goujonnage",
  "Mise a longueur",
  "P3",
  "OxyCoupage",
  "Presse/Cintrage",
  "Robot",
  "Soudage",
  "Soudage sous flux",
  "Control CND"
] as const

export function DataTablePrevi({
  data: initialData,
}: {
  data: z.infer<typeof affaireSchema>[]
}) {
  const [data] = React.useState(() => flattenAffaires(initialData))
  const [rowSelection, setRowSelection] = React.useState({})
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({})
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  )
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: 10,
  })
  const machineColumns = useMachineColumns(data)
  const columns = React.useMemo<ColumnDef<z.infer<typeof schema>>[]>(
    () => [
      selectColumn,
      profilColumn,
      nbPoutreColumn,
      ...machineColumns,
      actionsColumn,
      totalColumn,
    ],
    [machineColumns]
  )

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      pagination,
    },
    getRowId: (row) => row.id.toString(),
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  })

  return (
    <Tabs defaultValue="outline" className="w-full flex-col justify-start gap-6">
      <div className="flex items-center justify-between px-4 lg:px-6">
        <Label htmlFor="view-selector" className="sr-only">
          View
        </Label>
        <Select defaultValue="outline">
          <SelectTrigger className="flex w-fit @4xl/main:hidden" size="sm" id="view-selector">
            <SelectValue placeholder="Select a view" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="outline">Previsions</SelectItem>
            <SelectItem value="past-performance">Chiffrage</SelectItem>
            <SelectItem value="ket-personnel">Plans</SelectItem>
            <SelectItem value="focus-documents">Commandes</SelectItem>
          </SelectContent>
        </Select>
        <TabsList className="hidden **:data-[slot=badge]:size-5 **:data-[slot=badge]:rounded-full **:data-[slot=badge]:bg-muted-foreground/30 **:data-[slot=badge]:px-1 @4xl/main:flex">
          <TabsTrigger value="outline">Previsions</TabsTrigger>
          <TabsTrigger value="past-performance">Chiffrage</TabsTrigger>
          <TabsTrigger value="key-personnel">Plans</TabsTrigger>
          <TabsTrigger value="focus-documents">Commandes annex</TabsTrigger>
        </TabsList>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="sm" />}
            >
              <IconLayoutColumns />
              <span className="hidden lg:inline">Customize Columns</span>
              <span className="lg:hidden">Columns</span>
              <IconChevronDown />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {table
                .getAllColumns()
                .filter(
                  (column) =>
                    typeof column.accessorFn !== "undefined" &&
                    column.getCanHide()
                )
                .map((column) => {
                  return (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      className="capitalize"
                      checked={column.getIsVisible()}
                      onCheckedChange={(value) =>
                        column.toggleVisibility(!!value)
                      }
                    >
                      {column.id}
                    </DropdownMenuCheckboxItem>
                  )
                })}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="sm" />}
            >
              <IconPlus />
              <span className="hidden lg:inline">Add Section</span>
              <IconChevronDown />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {sectionOptions.map((section) => (
                <DropdownMenuItem
                  key={section}
                  onSelect={() => {
                    toast.promise(
                      new Promise((resolve) => setTimeout(resolve, 1000)),
                      {
                        loading: `Adding ${section}`,
                        success: `${section} added`,
                        error: "Error",
                      }
                    )
                  }}
                >
                  {section}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
{/* Vu Sur le tableau de Previ */}
      <TabsContent value="outline" className="relative flex flex-col gap-4 overflow-auto px-4 lg:px-6">
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    return (
                      <TableHead key={header.id} colSpan={header.colSpan}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                      </TableHead>
                    )
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody className="**:data-[slot=table-cell]:first:w-8">
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="h-24 text-center"
                  >
                    No results.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {/* bottom of the page, to choose the nbr of rows and change page */}
        <div className="flex items-center justify-between px-4">
          <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
            {table.getFilteredSelectedRowModel().rows.length} of{" "}
            {table.getFilteredRowModel().rows.length} row(s) selected.
          </div>
          <div className="flex w-full items-center gap-8 lg:w-fit">
            <div className="hidden items-center gap-2 lg:flex">
              <Label htmlFor="rows-per-page" className="text-sm font-medium">
                Rows per page
              </Label>
              <Select
                value={`${table.getState().pagination.pageSize}`}
                onValueChange={(value) => {
                  table.setPageSize(Number(value))
                }}
              >
                <SelectTrigger size="sm" className="w-20" id="rows-per-page">
                  <SelectValue
                    placeholder={table.getState().pagination.pageSize}
                  />
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
      </TabsContent>
{/* Vu sur la parti de chiffrage */}
      <TabsContent value="past-performance" className="flex flex-col px-4 lg:px-6">
        <div className="aspect-video w-full flex-1 rounded-lg border border-dashed"></div>
      </TabsContent>
{/* Vu les plans et tout les documents en pdf */}
      <TabsContent value="key-personnel" className="flex flex-col px-4 lg:px-6">
        <div className="aspect-video w-full flex-1 rounded-lg border border-dashed"></div>
      </TabsContent>
{/* Vu sur tout les mails */}
      <TabsContent value="focus-documents" className="flex flex-col px-4 lg:px-6">
        <div className="aspect-video w-full flex-1 rounded-lg border border-dashed"></div>
      </TabsContent>
    </Tabs>
  )
}