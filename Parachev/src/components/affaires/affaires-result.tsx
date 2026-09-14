import { useNavigate } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { AffaireResume } from "@/hooks/use-affaires-db"
import { libellePoste } from "@/lib/postes"
import { CHAMPS_VARIABLES_NUMERIQUES, CHAMPS_VARIABLES_TEXTE } from "@/lib/variables-affaires"

interface AffaireResultsProps {
  results: AffaireResume[]
  loading: boolean
  error: string | null
}

const formatHeures = (value: number) =>
  value.toLocaleString("fr-BE", { maximumFractionDigits: 1 })

export function AffaireResults({ results, loading, error }: AffaireResultsProps) {
  const navigate = useNavigate()

  return (
    <>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {loading
            ? "Chargement des affaires…"
            : `${results.length} result${results.length !== 1 ? "s" : ""}`}
        </span>
        {error && !loading && (
          <span className="text-destructive">
            Impossible de lire la base ({error})
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {results.map((item) => {
          const variables = item.variables
          const champsTexteRenseignes = CHAMPS_VARIABLES_TEXTE.filter(
            ({ key }) => variables && variables[key] != null
          )
          const champsVariablesRenseignes = CHAMPS_VARIABLES_NUMERIQUES.filter(
            ({ key }) => variables && variables[key] != null
          )

          return (
            <Card
              key={item.numero}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/prevision/${item.numero}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  navigate(`/prevision/${item.numero}`)
                }
              }}
              className="cursor-pointer transition-colors hover:bg-muted/50"
            >
              <CardHeader>
                <CardTitle>{item.client ?? "Client inconnu"}</CardTitle>
                <CardDescription>
                  <Badge variant="outline" className="px-1.5 text-muted-foreground">
                    {item.numero}
                  </Badge>
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Total heures</span>
                  <span className="font-medium tabular-nums">
                    {formatHeures(item.totalHeures)}
                  </span>
                </div>

                {item.heuresParPoste.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1.5 border-t pt-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase">
                      Heures par poste
                    </span>
                    {item.heuresParPoste.map(({ poste, heures }) => (
                      <div key={poste} className="flex items-center justify-between">
                        <span className="text-muted-foreground">{libellePoste(poste)}</span>
                        <span className="tabular-nums">{formatHeures(heures)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {champsTexteRenseignes.length > 0 && variables && (
                  <div className="mt-2 flex flex-col gap-1.5 border-t pt-2">
                    {champsTexteRenseignes.map(({ key, label }) => (
                      <div key={key} className="flex items-center justify-between">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="tabular-nums">{variables[key]}</span>
                      </div>
                    ))}
                  </div>
                )}

                {champsVariablesRenseignes.length > 0 && variables && (
                  <div className="mt-2 flex flex-col gap-1.5 border-t pt-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase">
                      Variables
                    </span>
                    {champsVariablesRenseignes.map(({ key, label, format }) => {
                      const valeur = variables[key] as number
                      return (
                        <div key={key} className="flex items-center justify-between">
                          <span className="text-muted-foreground">{label}</span>
                          <span className="tabular-nums">
                            {format ? format(valeur) : formatHeures(valeur)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
        {!loading && results.length === 0 && (
          <div className="col-span-full py-12 text-center text-sm text-muted-foreground">
            No results.
          </div>
        )}
      </div>
    </>
  )
}