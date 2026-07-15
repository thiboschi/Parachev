import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { EllipsisIcon } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableCaption } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import * as React from "react"
import { Marker } from "@/components/ui/marker"
import { CreateAffaire } from "./subPages/CreateAffaire";


import "./DashBoard.css"

const invoices = [
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


export default function DashBoard() {

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

    <div className="flex flex-col gap-4 h-full">
        {/* Ligne 1 : horizontale */}
        <div className="flex gap-4 h-full max-h-1/2 pb-1 p-3">
            <div className="w-1/2 bg-red-400 rounded-2xl">
                <CreateAffaire/>
            </div>
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
        <div className="w-auto h-full max-h-1/2 px-4 pt-4">
            <div className=" bg-blue-500 rounded-2xl">
                <Table>
                    <TableCaption>Affaire en cour</TableCaption>
                    <TableHeader>
                        <TableRow>
                        <TableHead className="w-50">Semaine</TableHead>
                        <TableHead>N°</TableHead>
                        <TableHead>Nom</TableHead>
                        <TableHead>Previ</TableHead>
                        <TableHead>Preparer</TableHead>
                        <TableHead>Controler</TableHead>
                        <TableHead>BPE</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {invoices.map((invoice) => (
                        <TableRow key={invoice.id}>
                            <TableCell className="font-medium">{invoice.semaine}</TableCell>
                            <TableCell>{invoice.numero}</TableCell>
                            <TableCell>{invoice.client}</TableCell>
                            <TableCell> <Checkbox id="terms-checkbox-basic" name="terms-checkbox-basic" /> </TableCell>
                            <TableCell> <Checkbox id="terms-checkbox-basic" name="terms-checkbox-basic" /> </TableCell>
                            <TableCell> <Checkbox id="terms-checkbox-basic" name="terms-checkbox-basic" /> </TableCell>
                            <TableCell className="text-right"> <Checkbox id="terms-checkbox-basic" name="terms-checkbox-basic" /> </TableCell>
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