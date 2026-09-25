import { useNavigate } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { AffaireRecherche, ResultatTexte } from "@/hooks/use-recherche-affaires"
import { POSTES_HORS_MACHINES, libellePoste } from "@/lib/postes"

interface AffaireResultsProps {
  results: AffaireRecherche[]
  /** Documents trouvés par la recherche plein texte, par affaire. */
  documentsTrouves: Map<string, ResultatTexte[]> | null
  loading: boolean
  error: string | null
}

const formatHeures = (value: number) =>
  value.toLocaleString("fr-BE", { maximumFractionDigits: 1 })

const formatDate = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("fr-BE") : null

/** Nombre maximum de cartes affichées d'un coup (le reste : affiner les filtres). */
const MAX_RESULTATS_AFFICHES = 200

export function AffaireResults({ results, documentsTrouves, loading, error }: AffaireResultsProps) {
  const navigate = useNavigate()
  const affiches = results.slice(0, MAX_RESULTATS_AFFICHES)

  return (
    <>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {loading
            ? "Chargement des affaires…"
            : `${results.length} affaire${results.length !== 1 ? "s" : ""}`}
          {results.length > MAX_RESULTATS_AFFICHES &&
            ` (${MAX_RESULTATS_AFFICHES} premières affichées, affinez les filtres)`}
        </span>
        {error && !loading && (
          <span className="text-destructive">Impossible de lire la base ({error})</span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {affiches.map((item) => {
          const ouvrir = () => navigate(`/prevision/${item.affaire}`)
          const machines = item.postes_realises.filter((p) => !POSTES_HORS_MACHINES.has(p))
          const documents = documentsTrouves?.get(item.affaire) ?? []
          const periode = [formatDate(item.date_production_debut), formatDate(item.date_production_fin)]
            .filter(Boolean)
            .join(" → ")

          return (
            <Card
              key={item.affaire}
              role="button"
              tabIndex={0}
              onClick={ouvrir}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  ouvrir()
                }
              }}
              className="cursor-pointer transition-colors hover:bg-muted/50"
            >
              <CardHeader>
                <CardTitle>{item.client ?? "Client inconnu"}</CardTitle>
                {item.projet && <span className="text-sm text-muted-foreground">{item.projet}</span>}
                <CardDescription className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="px-1.5 text-muted-foreground">
                    {item.affaire}
                  </Badge>
                  {item.offre && (
                    <Badge variant="outline" className="px-1.5 text-muted-foreground">
                      {item.offre}
                    </Badge>
                  )}
                  {item.cde_laminage && (
                    <Badge variant="outline" className="px-1.5 text-muted-foreground">
                      {item.cde_laminage}
                    </Badge>
                  )}
                  {item.annule && <Badge variant="destructive">Annulée</Badge>}
                  {item.non_conformite && <Badge variant="destructive">Non-conformité</Badge>}
                  {item.type_affaire && item.type_affaire !== "autre" && (
                    <Badge variant="secondary">{item.type_affaire}</Badge>
                  )}
                  {item.exc && <Badge variant="secondary">{item.exc}</Badge>}
                  {item.tolerance && <Badge variant="secondary">{item.tolerance}</Badge>}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Heures réelles</span>
                  <span className="font-medium tabular-nums">{formatHeures(item.heures_reelles)}</span>
                </div>
                {item.heures_prevues != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Heures prévues (fiche)</span>
                    <span className="tabular-nums">{formatHeures(item.heures_prevues)}</span>
                  </div>
                )}
                {(item.nb_barres != null || item.poids_t != null) && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Barres / poids</span>
                    <span className="tabular-nums">
                      {item.nb_barres != null ? formatHeures(item.nb_barres) : "–"}
                      {" / "}
                      {item.poids_t != null ? `${formatHeures(item.poids_t)} t` : "–"}
                    </span>
                  </div>
                )}
                {item.date_commande && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Commande</span>
                    <span className="tabular-nums">{formatDate(item.date_commande)}</span>
                  </div>
                )}
                {periode && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Production</span>
                    <span className="text-right tabular-nums">{periode}</span>
                  </div>
                )}
                {item.profils.length > 0 && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Profils</span>
                    <span className="truncate text-right">{item.profils.slice(0, 3).join(", ")}</span>
                  </div>
                )}

                {machines.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1 border-t pt-2">
                    {machines.map((p) => (
                      <Badge key={p} variant="outline" className="px-1.5 text-xs font-normal">
                        {libellePoste(p)}
                      </Badge>
                    ))}
                  </div>
                )}

                {documents.length > 0 && (
                  <div className="mt-1 flex flex-col gap-1 border-t pt-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase">
                      Trouvé dans {documents.length} document{documents.length > 1 ? "s" : ""}
                    </span>
                    {documents.slice(0, 2).map((d) => (
                      <div key={d.chemin} className="text-xs">
                        <span className="font-medium">{d.titre}</span>
                        {d.extrait && <span className="text-muted-foreground"> — {d.extrait}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
        {!loading && results.length === 0 && (
          <div className="col-span-full py-12 text-center text-sm text-muted-foreground">
            Aucune affaire ne correspond.
          </div>
        )}
      </div>
    </>
  )
}
