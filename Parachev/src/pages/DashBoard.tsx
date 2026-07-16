import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { EllipsisIcon, ChevronDown, Plus, Columns2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableCaption } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import * as React from "react"
import { Marker } from "@/components/ui/marker"
import { CreateAffaire } from "./subPages/CreateAffaire";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";
import { useReactTable, getCoreRowModel, flexRender, type ColumnDef, type VisibilityState } from "@tanstack/react-table"
import { SectionCards } from "@/components/custom/section-cards";


import "./DashBoard.css"

type Invoice = {
  id: string;
  semaine: string;
  numero: string;
  client: string;
  previ?: boolean;
  preparer?: boolean;
  controler?: boolean;
  bpe?: boolean;
}

const invoices: Invoice[] = [
  {
    id : "1",
    semaine: "S35",
    numero: "1100756282",
    client: "ALU NORF FER-T",
  },
  {
    id : "2",
    semaine: "S28",
    numero: "1100750658",
    client: "DK29 Krosno",
  },
  {
    id : "3",
    semaine: "S28",
    numero: "1100750291",
    client: "TOARC",
  },
  {
    id : "4",
    semaine: "S42",
    numero: "1100756837",
    client: "Pont Bois Rouge",
  },
  {
    id: "5",
    semaine: "S36",
    numero: "1100756339",
    client: "T2C",
  },
  {
    id: "6",
    semaine: "S36",
    numero: "1100754887",
    client: "Strabag Un Walim",
  },
  {
    id: "7",
    semaine: "S39",
    numero: "1100754337",
    client: "Bridge OEBB Linz-Weld",
  },
  {
    id: "8",
    semaine: "S38",
    numero: "1100757502",
    client: "Liebherr",
  },
  {
    id: "9",
    semaine: "S31",
    numero: "1100752365",
    client: "DW-878 Kielnarowa",
  },
  {
    id:"10",
    semaine: "S32",
    numero: "1100755809",
    client: "DP-2075D",
  },
]

const columns: ColumnDef<Invoice>[] = [
  { accessorKey: "semaine", header: "Semaine" },
  { accessorKey: "numero", header: "N°" },
  { accessorKey: "client", header: "Nom" },
  {
    accessorKey: "previ",
    header: "Previ",
    cell: ({ row }) => <Checkbox checked={row.original.previ ?? false} />,
  },
  {
    accessorKey: "preparer",
    header: "Preparer",
    cell: ({ row }) => <Checkbox checked={row.original.preparer ?? false} />,
  },
  {
    accessorKey: "controler",
    header: "Controler",
    cell: ({ row }) => <Checkbox checked={row.original.controler ?? false} />,
  },
  {
    accessorKey: "bpe",
    header: "BPE",
    cell: ({ row }) => <Checkbox checked={row.original.bpe ?? false} />,
  },
]

export default function DashBoard() {

const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})

const table = useReactTable({
  data: invoices,
  columns,
  getCoreRowModel: getCoreRowModel(),
  onColumnVisibilityChange: setColumnVisibility,
  state: { columnVisibility },
})

const [selectedRows, setSelectedRows] = React.useState<Set<string>>(
  new Set(["1"])
)

const selectAll = selectedRows.size === invoices.length

const handleSelectAll = (checked: boolean) => {
  if (checked) {
    setSelectedRows(new Set(invoices.map((row) => row.id)))
  } else {
    setSelectedRows(new Set())
  }
}

const handleSelectRow = (id: string, checked: boolean) => {
  const newSelected = new Set(selectedRows)
  if (checked) {
    newSelected.add(id)
  } else {
    newSelected.delete(id)
  }
  setSelectedRows(newSelected)
}

return (
  <div>
    <div className="header">
        <div className="flex items-center justify-between gap-1">
            <div>
                <Input placeholder="hello there" className="w-100"/>
                <Button variant="default" size="icon">
                    <EllipsisIcon />
                </Button>
                <Button variant="default">Search</Button>
            </div>
            <div>
                <ButtonGroup className="">
                    <CreateAffaire/>
                    <Button variant="outline">Import</Button>
                </ButtonGroup>
            </div>
        </div>
    </div>
    <SectionCards/>
    <div className="flex flex-col gap-4 h-full">
        {/* Ligne 1 : horizontale */}
        <div className="flex gap-4 h-full max-h-1/2 pb-1 p-3">
            <div className="w-1/2 bg-red-400 rounded-2xl"></div>
            <div className="w-2/3 bg-amber-700 rounded-2xl">
                <Table>
                    <TableHeader>
                        <TableRow>
                        <TableHead className="w-8" rounded-full-3>
                            <Checkbox
                            id="select-all-checkbox"
                            name="select-all-checkbox"
                            checked={selectAll}
                            onCheckedChange={handleSelectAll}
                            />
                        </TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {invoices.map((row) => (
                        <TableRow
                            key={row.id}
                            data-state={selectedRows.has(row.id) ? "selected" : undefined}
                        >
                            <TableCell>
                            <Checkbox
                                id={`row-${row.id}-checkbox`}
                                name={`row-${row.id}-checkbox`}
                                checked={selectedRows.has(row.id)}
                                onCheckedChange={(checked) =>
                                handleSelectRow(row.id, checked === true)
                                }
                            />
                            </TableCell>
                            <TableCell className="font-medium">{row.semaine}</TableCell>
                            <TableCell>{row.numero}</TableCell>
                            <TableCell>{row.client}</TableCell>
                        </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
        <Marker variant="border"></Marker>
        {/* Ligne 2 */}
        
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
              <Columns2 />
              <span className="hidden lg:inline">Customize Columns</span>
              <span className="lg:hidden">Columns</span>
              <ChevronDown />
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
          <Button variant="outline" size="sm">
            <Plus />
            <span className="hidden lg:inline">Add Section</span>
          </Button>
        </div>

        <div className="w-auto h-full max-h-1/2 px-4 pt-4">
            <div className=" bg-blue-500 rounded-2xl">
                <Table>
                    <TableCaption>Affaire en cour</TableCaption>
                    <TableHeader className="bg-gray-700">
                        {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id}>
                            {headerGroup.headers.map((header) => (
                            <TableHead key={header.id}>
                                {header.isPlaceholder
                                ? null
                                : flexRender(header.column.columnDef.header, header.getContext())}
                            </TableHead>
                            ))}
                        </TableRow>
                        ))}
                    </TableHeader>
                    <TableBody>
                        {table.getRowModel().rows.map((row) => (
                        <TableRow key={row.id}>
                            {row.getVisibleCells().map((cell) => (
                            <TableCell key={cell.id}>
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </TableCell>
                            ))}
                        </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    </div>

  </div>
);
}