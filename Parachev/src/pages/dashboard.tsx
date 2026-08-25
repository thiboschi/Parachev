import { useState } from "react";
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { invoke } from "@tauri-apps/api/core";

export default function Page() {

  const [affaire, setAffaire] = useState("");
  const [resultat, setResultat] = useState<Record<string, number> | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(false);

  // ↓ la fonction handler, définie AVANT le return du composant
  async function handlePrevisualiser() {
    setChargement(true);
    setErreur(null);
    try {
      const heures = await invoke<Record<string, number>>("previsualiser_affaire", { affaire });
      setResultat(heures);
    } catch (e) {
      console.error("Erreur invoke:", e);
      setErreur(String(e));
      setResultat(null);
    } finally {
      setChargement(false);
    }
  }

  // On sépare le total des postes individuels pour l'afficher à part
  const { total, postes } = separerTotal(resultat);

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
                <div className="flex flex-1 flex-col gap-1.5">
                  <label htmlFor="affaire" className="text-sm font-medium">
                    Numéro d'affaire
                  </label>
                  <Input
                    id="affaire"
                    placeholder="ex. 1100706839"
                    value={affaire}
                    onChange={(e) => setAffaire(e.target.value)}
                  />
                </div>
                <Button onClick={handlePrevisualiser} disabled={!affaire || chargement}>
                  {chargement ? "Calcul en cours…" : "Prévisualiser"}
                </Button>
              </div>

              <div className="px-4 lg:px-6">
                {erreur && (
                  <p className="text-sm text-destructive">{erreur}</p>
                )}

                {resultat && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Prévision — Affaire {affaire}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Poste</TableHead>
                            <TableHead className="text-right">Heures prévues</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {postes.map(([poste, heures]) => (
                            <TableRow key={poste}>
                              <TableCell className="capitalize">
                                {formaterNomPoste(poste)}
                              </TableCell>
                              <TableCell className="text-right">
                                {heures.toFixed(2)} h
                              </TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="font-semibold">
                            <TableCell>Total</TableCell>
                            <TableCell className="text-right">
                              {total !== null ? total.toFixed(2) : "—"} h
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

/**
 * Sépare la clé "total" (renvoyée par la commande Tauri) des autres
 * postes, et trie les postes par ordre alphabétique pour un affichage
 * stable.
 */
function separerTotal(
  resultat: Record<string, number> | null
): { total: number | null; postes: [string, number][] } {
  if (!resultat) return { total: null, postes: [] };

  const { total, ...reste } = resultat;
  const postes = Object.entries(reste).sort(([a], [b]) => a.localeCompare(b));
  return { total: total ?? null, postes };
}

/** Convertit "forage_numerique" en "Forage numérique" pour l'affichage. */
function formaterNomPoste(poste: string): string {
  return poste
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}