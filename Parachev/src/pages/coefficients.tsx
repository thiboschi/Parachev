import { useEffect, useMemo, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"
import { libellePoste } from "@/lib/postes"

// Miroir de CoefficientLigne / CoefficientsInfo (src-tauri/src/lib.rs).
type CoefficientLigne = {
  poste: string
  variable: string
  valeur: number
}

type CoefficientsInfo = {
  version: number | null
  date_calibration: string | null
  lignes: CoefficientLigne[]
}

const CLE_INTERCEPT = "__intercept__"

const formatValeur = (n: number) =>
  n.toLocaleString("fr-BE", { maximumFractionDigits: 4 })

export default function Coefficients() {
  const [info, setInfo] = useState<CoefficientsInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  function charger() {
    setLoading(true)
    invoke<CoefficientsInfo>("lister_coefficients")
      .then((res) => {
        setInfo(res)
        setError(null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    charger()
    window.addEventListener("coefficients-updated", charger)
    return () => window.removeEventListener("coefficients-updated", charger)
  }, [])

  const parPoste = useMemo(() => {
    if (!info) return []
    const map = new Map<string, CoefficientLigne[]>()
    for (const ligne of info.lignes) {
      const liste = map.get(ligne.poste) ?? []
      liste.push(ligne)
      map.set(ligne.poste, liste)
    }
    return Array.from(map, ([poste, lignes]) => ({
      poste,
      intercept: lignes.find((l) => l.variable === CLE_INTERCEPT)?.valeur ?? 0,
      variables: lignes
        .filter((l) => l.variable !== CLE_INTERCEPT)
        .sort((a, b) => a.variable.localeCompare(b.variable)),
    })).sort((a, b) => a.poste.localeCompare(b.poste))
  }, [info])

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
        <div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
          <div className="flex items-center gap-2">
            {info?.version != null && (
              <Badge variant="outline">Version {info.version}</Badge>
            )}
            {info?.date_calibration && (
              <Badge variant="outline" className="text-muted-foreground">
                Calibrés le {info.date_calibration}
              </Badge>
            )}
          </div>

          {loading && (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          )}

          {error && !loading && (
            <p className="text-sm text-destructive">
              Impossible de lire les coefficients ({error})
            </p>
          )}

          {!loading && !error && parPoste.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Aucun coefficient en base -- lancez une calibration via le
              bouton "Calibrer" en haut de la page.
            </p>
          )}

          {!loading && !error && parPoste.length > 0 && (
            <div className="overflow-hidden rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Poste</TableHead>
                    <TableHead>Intercept</TableHead>
                    <TableHead>Variable</TableHead>
                    <TableHead className="text-right">Coefficient</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parPoste.map(({ poste, intercept, variables }) =>
                    variables.length === 0 ? (
                      <TableRow key={poste}>
                        <TableCell className="font-medium">
                          {libellePoste(poste)}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {formatValeur(intercept)}
                        </TableCell>
                        <TableCell colSpan={2} className="text-muted-foreground">
                          —
                        </TableCell>
                      </TableRow>
                    ) : (
                      variables.map((v, i) => (
                        <TableRow key={`${poste}-${v.variable}`}>
                          {i === 0 ? (
                            <>
                              <TableCell
                                className="font-medium align-top"
                                rowSpan={variables.length}
                              >
                                {libellePoste(poste)}
                              </TableCell>
                              <TableCell
                                className="tabular-nums align-top"
                                rowSpan={variables.length}
                              >
                                {formatValeur(intercept)}
                              </TableCell>
                            </>
                          ) : null}
                          <TableCell>{v.variable}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatValeur(v.valeur)}
                          </TableCell>
                        </TableRow>
                      ))
                    )
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
