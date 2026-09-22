import { useEffect, useMemo, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { libellePoste, POSTE_KEYS } from "@/lib/postes"

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

// Champ éditable pour un coefficient : sauvegarde au blur/Entrée, pas à
// chaque frappe -- voir sauvegarderCoefficient dans Coefficients().
function ChampCoefficient({
  valeur,
  onChange,
  onValider,
}: {
  valeur: string
  onChange: (v: string) => void
  onValider: () => void
}) {
  return (
    <Input
      className="h-7 w-28 text-right tabular-nums"
      inputMode="decimal"
      value={valeur}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onValider}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur()
      }}
    />
  )
}

export default function Coefficients() {
  const [info, setInfo] = useState<CoefficientsInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Valeurs affichées dans les champs, indexées par "poste|variable" --
  // distinctes de `info` pour permettre la saisie sans attendre le retour
  // du backend, tout en restant resynchronisées à chaque `charger()`.
  const [edition, setEdition] = useState<Record<string, string>>({})
  // Variables explicatives connues par poste (voir calibration::poste_variables
  // côté Rust) -- permet de proposer les bons champs même sur un poste pas
  // encore calibré, en plus de celles déjà présentes en base.
  const [variablesParPoste, setVariablesParPoste] = useState<Record<string, string[]>>({})

  function charger() {
    setLoading(true)
    invoke<CoefficientsInfo>("lister_coefficients")
      .then((res) => {
        setInfo(res)
        setEdition(
          Object.fromEntries(res.lignes.map((l) => [`${l.poste}|${l.variable}`, String(l.valeur)]))
        )
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

  useEffect(() => {
    invoke<Record<string, string[]>>("lister_variables_poste").then(setVariablesParPoste)
  }, [])

  function modifierEdition(cle: string, valeur: string) {
    setEdition((prev) => ({ ...prev, [cle]: valeur }))
  }

  // Appelée au blur / Entrée d'un champ. Ne sauvegarde que si la valeur a
  // réellement changé et reste un nombre valide -- sinon le champ reprend
  // silencieusement la dernière valeur connue (0 si le coefficient n'existe
  // pas encore en base, ex. poste pas encore calibré).
  function sauvegarderCoefficient(poste: string, variable: string) {
    const cle = `${poste}|${variable}`
    const brut = edition[cle]?.trim().replace(",", ".") ?? ""
    const valeurActuelle =
      variable === CLE_INTERCEPT
        ? (parPoste.find((p) => p.poste === poste)?.intercept ?? 0)
        : (parPoste
            .find((p) => p.poste === poste)
            ?.variables.find((v) => v.variable === variable)?.valeur ?? 0)

    const nombre = Number(brut)
    if (brut === "" || Number.isNaN(nombre)) {
      modifierEdition(cle, String(valeurActuelle))
      return
    }
    if (nombre === valeurActuelle) {
      return
    }

    invoke("modifier_coefficient", { poste, variable, valeur: nombre })
      .then(() => {
        setInfo((prev) => {
          if (!prev) return prev
          const existe = prev.lignes.some((l) => l.poste === poste && l.variable === variable)
          const lignes = existe
            ? prev.lignes.map((l) =>
                l.poste === poste && l.variable === variable ? { ...l, valeur: nombre } : l
              )
            : [...prev.lignes, { poste, variable, valeur: nombre }]
          return { ...prev, lignes }
        })
      })
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : String(e))
        modifierEdition(cle, String(valeurActuelle))
      })
  }

  // Regroupe les lignes par poste, puis complète avec TOUS les postes
  // connus (même sans coefficient calibré) et toutes leurs variables
  // explicatives connues (même sans coefficient calibré pour cette
  // variable précise) -- pour que la page permette d'éditer/ajouter
  // n'importe quel coefficient, pas seulement ceux déjà en base.
  const parPoste = useMemo(() => {
    const map = new Map<string, CoefficientLigne[]>()
    for (const ligne of info?.lignes ?? []) {
      const liste = map.get(ligne.poste) ?? []
      liste.push(ligne)
      map.set(ligne.poste, liste)
    }

    const tousLesPostes = new Set([...POSTE_KEYS, ...map.keys()])

    return Array.from(tousLesPostes, (poste) => {
      const lignes = map.get(poste) ?? []
      const nomsVariables = new Set([
        ...(variablesParPoste[poste] ?? []),
        ...lignes.filter((l) => l.variable !== CLE_INTERCEPT).map((l) => l.variable),
      ])
      return {
        poste,
        intercept: lignes.find((l) => l.variable === CLE_INTERCEPT)?.valeur ?? null,
        variables: Array.from(nomsVariables, (variable) => ({
          variable,
          valeur: lignes.find((l) => l.variable === variable)?.valeur ?? null,
        })).sort((a, b) => a.variable.localeCompare(b.variable)),
      }
    }).sort((a, b) => a.poste.localeCompare(b.poste))
  }, [info, variablesParPoste])

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

          {!loading && !error && (!info || info.lignes.length === 0) && (
            <p className="text-sm text-muted-foreground">
              Aucun coefficient calibré pour l'instant -- lancez une
              calibration via le bouton "Calibrer" en haut de la page. Tous
              les postes connus sont listés ci-dessous en attendant.
            </p>
          )}

          {!loading && !error && (
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
                  {parPoste.map(({ poste, variables }) =>
                    variables.length === 0 ? (
                      <TableRow key={poste}>
                        <TableCell className="font-medium">
                          {libellePoste(poste)}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          <ChampCoefficient
                            valeur={edition[`${poste}|${CLE_INTERCEPT}`] ?? "0"}
                            onChange={(v) => modifierEdition(`${poste}|${CLE_INTERCEPT}`, v)}
                            onValider={() => sauvegarderCoefficient(poste, CLE_INTERCEPT)}
                          />
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
                                <ChampCoefficient
                                  valeur={edition[`${poste}|${CLE_INTERCEPT}`] ?? "0"}
                                  onChange={(v) => modifierEdition(`${poste}|${CLE_INTERCEPT}`, v)}
                                  onValider={() => sauvegarderCoefficient(poste, CLE_INTERCEPT)}
                                />
                              </TableCell>
                            </>
                          ) : null}
                          <TableCell>{v.variable}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            <ChampCoefficient
                              valeur={edition[`${poste}|${v.variable}`] ?? "0"}
                              onChange={(val) => modifierEdition(`${poste}|${v.variable}`, val)}
                              onValider={() => sauvegarderCoefficient(poste, v.variable)}
                            />
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
