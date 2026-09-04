import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { HeuresTable } from "../components/dashboard/heures-barres";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export default function Page() {

type VariableAffaire = {
  affaire: string;
  client: string | null;
  nbBarres: number | null;
  nbGoujons: number | null;
  nbTrousManuel: number | null;
  nbTrousNumerique: number | null;
  diametreMoyenNumerique: number | null;
  longueurCoupe: number | null;
};
const [variables, setVariables] = useState<VariableAffaire[]>([]);

useEffect(() => {
  invoke<VariableAffaire[]>("lister_variables_affaires").then(setVariables);
}, []);

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
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              <div className="flex items-end gap-2 px-4 lg:px-6">
                <HeuresTable/>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Affaire</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead className="text-right">Barres</TableHead>
                      <TableHead className="text-right">Goujons</TableHead>
                      <TableHead className="text-right">Longueur coupe</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {variables.map((v) => (
                      <TableRow key={v.affaire}>
                        <TableCell>{v.affaire}</TableCell>
                        <TableCell>{v.client ?? "—"}</TableCell>
                        <TableCell className="text-right">{v.nbBarres ?? "—"}</TableCell>
                        <TableCell className="text-right">{v.nbGoujons ?? "—"}</TableCell>
                        <TableCell className="text-right">{v.longueurCoupe ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>              
              </div>
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}