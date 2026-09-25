import * as React from "react"
import { Link } from "react-router-dom"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { IconChevronRight, IconExternalLink } from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible"
import { POSTES_HORS_MACHINES, libellePoste } from "@/lib/postes"
import { libelleOperationRde } from "@/lib/recherche"

// Shape returned by the `obtenir_dossier_affaire` Tauri command
// (DossierAffaire in recherche.rs).
interface DossierAffaireData {
  dossier: { nom_dossier: string; chemin: string; annule: boolean; non_conformite: boolean } | null
  rde: {
    chemin: string
    champs: [string, string][]
    traitements: string[]
    exigences_acier: string[]
    accessoires: string[]
  } | null
  laminage: {
    profil: string
    longueur: number | null
    nuance: string | null
    poids_kg: number | null
    nombre: number | null
    usine: string | null
    date_laminage: string | null
  }[]
  fiche: {
    chemin: string | null
    date_fiche: string | null
    poids_t: number | null
    taux_horaire: number | null
    heures_prevues: number | null
  } | null
  operations: {
    source: "rde" | "fiche" | "suivi"
    operation: string
    libelle: string | null
    heures: number | null
    nb_barres: number | null
    date_debut: string | null
    date_fin: string | null
  }[]
  documents: {
    chemin: string
    type_doc: string
    nom: string
    titre: string | null
    dossier_relatif: string | null
    date_modif: string | null
    ancien: boolean
    reference: boolean
  }[]
  references: { affaire: string; nom_dossier: string | null; chemin: string | null }[]
  cite_par: { affaire: string; nom_dossier: string | null; chemin: string | null }[]
}

const TYPES_DOCUMENT: Record<string, string> = {
  rde: "RDE",
  fiche: "Fiches de prévision",
  mail: "Mails",
  pdf: "PDF",
  plan: "Plans (DWG/DXF)",
  cn: "Programmes CN",
  excel: "Autres classeurs Excel",
  bureautique: "Word / PowerPoint",
  image: "Images",
  texte: "Textes",
  autre: "Autres",
}

const formatNombre = (v: number) => v.toLocaleString("fr-BE", { maximumFractionDigits: 1 })
const formatDate = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("fr-BE") : ""

function ouvrir(chemin: string) {
  invoke("ouvrir_document", { chemin }).catch((e) =>
    toast.error(e instanceof Error ? e.message : String(e))
  )
}

interface DossierAffaireProps {
  affaire: string
  /** Heures ERP par poste (déjà chargées par la page). */
  heuresParPoste: { poste: string; heures: number }[]
}

export function DossierAffaire({ affaire, heuresParPoste }: DossierAffaireProps) {
  const [data, setData] = React.useState<DossierAffaireData | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let annule = false
    invoke<DossierAffaireData>("obtenir_dossier_affaire", { affaire })
      .then((d) => !annule && setData(d))
      .catch((e) => !annule && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      annule = true
    }
  }, [affaire])

  if (error) return <span className="text-sm text-destructive">Dossier illisible ({error})</span>
  if (!data) return null

  // Tableau des machines : une ligne par poste, colonnes prévu / SUIVI / ERP.
  const prevu = new Map(data.operations.filter((o) => o.source === "fiche").map((o) => [o.operation, o]))
  const suivi = new Map(data.operations.filter((o) => o.source === "suivi").map((o) => [o.operation, o]))
  const erp = new Map(heuresParPoste.map((h) => [h.poste, h.heures]))
  const postes = Array.from(new Set([...prevu.keys(), ...suivi.keys(), ...erp.keys()]))
    .filter((p) => !POSTES_HORS_MACHINES.has(p))
    .sort((a, b) => libellePoste(a).localeCompare(libellePoste(b)))
  const operationsRde = data.operations.filter((o) => o.source === "rde")
  const expedition = suivi.get("expedition")

  const documentsParType = new Map<string, DossierAffaireData["documents"]>()
  for (const d of data.documents) {
    documentsParType.set(d.type_doc, [...(documentsParType.get(d.type_doc) ?? []), d])
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {data.dossier && (
          <Button variant="outline" size="sm" onClick={() => ouvrir(data.dossier!.chemin)}>
            <IconExternalLink />
            {data.dossier.nom_dossier}
          </Button>
        )}
        {data.dossier?.annule && <Badge variant="destructive">Annulée</Badge>}
        {data.dossier?.non_conformite && <Badge variant="destructive">Non-conformité</Badge>}
        {!data.dossier && (
          <span className="text-sm text-muted-foreground">
            Aucun dossier d'affaire trouvé dans le dossier surveillé.
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm text-muted-foreground">Revue des exigences (RDE)</CardTitle>
            {data.rde && (
              <Button variant="ghost" size="xs" onClick={() => ouvrir(data.rde!.chemin)}>
                Ouvrir
              </Button>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5 text-sm">
            {!data.rde && <span className="text-muted-foreground">Aucun RDE pour cette affaire</span>}
            {data.rde?.champs.map(([libelle, valeur]) => (
              <div key={libelle} className="flex items-start justify-between gap-4">
                <span className="shrink-0 text-muted-foreground">{libelle}</span>
                <span className="text-right">{valeur}</span>
              </div>
            ))}
            {data.rde && operationsRde.length > 0 && (
              <div className="flex flex-wrap gap-1 border-t pt-2">
                {operationsRde.map((o) => (
                  <Badge key={o.operation} variant="secondary">
                    {libelleOperationRde(o.operation)}
                  </Badge>
                ))}
              </div>
            )}
            {data.rde &&
              [...data.rde.traitements, ...data.rde.exigences_acier, ...data.rde.accessoires].length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {[...data.rde.traitements, ...data.rde.exigences_acier, ...data.rde.accessoires].map((t) => (
                    <Badge key={t} variant="outline">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}
            {data.laminage.length > 0 && (
              <div className="flex flex-col gap-1 border-t pt-2">
                <span className="text-xs font-medium text-muted-foreground uppercase">Commande de laminage</span>
                {data.laminage.map((l, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 tabular-nums">
                    <span>
                      {l.nombre != null && `${formatNombre(l.nombre)} × `}
                      {l.profil}
                      {l.longueur != null && ` · ${formatNombre(l.longueur)} mm`}
                    </span>
                    <span className="text-right text-muted-foreground">
                      {[l.nuance, l.usine, formatDate(l.date_laminage)].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm text-muted-foreground">Machines : prévu / réalisé</CardTitle>
            {data.fiche?.chemin && (
              <Button variant="ghost" size="xs" onClick={() => ouvrir(data.fiche!.chemin!)}>
                Ouvrir la fiche
              </Button>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5 text-sm">
            {data.fiche && (
              <span className="text-xs text-muted-foreground">
                Fiche du {formatDate(data.fiche.date_fiche) || "?"}
                {data.fiche.poids_t != null && ` · ${formatNombre(data.fiche.poids_t)} t`}
                {data.fiche.taux_horaire != null && ` · ${formatNombre(data.fiche.taux_horaire)} €/h`}
              </span>
            )}
            {postes.length === 0 ? (
              <span className="text-muted-foreground">Aucune opération connue</span>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 text-left font-normal">Poste</th>
                    <th className="py-1 text-right font-normal">Prévu (h)</th>
                    <th className="py-1 text-right font-normal">SUIVI</th>
                    <th className="py-1 text-right font-normal">ERP (h)</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {postes.map((p) => {
                    const s = suivi.get(p)
                    return (
                      <tr key={p} className="border-t">
                        <td className="py-1" title={[prevu.get(p)?.libelle, s?.libelle].filter(Boolean).join(" · ")}>
                          {libellePoste(p)}
                        </td>
                        <td className="py-1 text-right">
                          {prevu.get(p)?.heures != null ? formatNombre(prevu.get(p)!.heures!) : ""}
                        </td>
                        <td className="py-1 text-right text-muted-foreground">
                          {s ? `${formatNombre(s.nb_barres ?? 0)} b. · ${formatDate(s.date_debut)} → ${formatDate(s.date_fin)}` : ""}
                        </td>
                        <td className="py-1 text-right">{erp.has(p) ? formatNombre(erp.get(p)!) : ""}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
            {expedition && (
              <span className="text-xs text-muted-foreground">
                Expédition : {formatDate(expedition.date_debut)} → {formatDate(expedition.date_fin)} (
                {expedition.libelle})
              </span>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">
            Documents ({data.documents.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {data.documents.length === 0 && <span className="text-muted-foreground">Aucun document indexé</span>}
          {Array.from(documentsParType, ([type, docs]) => (
            <Collapsible key={type} className="flex flex-col gap-1">
              <CollapsibleTrigger className="group flex items-center gap-1 text-left">
                <IconChevronRight className="size-4 transition-transform group-data-[panel-open]:rotate-90" />
                <span>{TYPES_DOCUMENT[type] ?? type}</span>
                <span className="text-muted-foreground">({docs.length})</span>
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <div className="flex flex-col gap-0.5 pt-1 pl-5">
                  {docs.map((d) => (
                    <button
                      key={d.chemin}
                      type="button"
                      onClick={() => ouvrir(d.chemin)}
                      className="flex items-center justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-muted"
                    >
                      <span className="min-w-0 truncate">
                        {d.type_doc === "mail" && d.titre ? d.titre : d.nom}
                        {d.dossier_relatif && (
                          <span className="text-muted-foreground"> · {d.dossier_relatif}</span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        {d.ancien && <Badge variant="outline">ancien</Badge>}
                        {d.reference && <Badge variant="outline">référence</Badge>}
                        {formatDate(d.date_modif)}
                      </span>
                    </button>
                  ))}
                </div>
              </CollapsiblePanel>
            </Collapsible>
          ))}
        </CardContent>
      </Card>

      {(data.references.length > 0 || data.cite_par.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Affaires liées</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5 text-sm">
            {data.references.map((r) => (
              <div key={`ref-${r.affaire}`} className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Référence utilisée pour la préparation</span>
                <Link to={`/prevision/${r.affaire}`} className="underline-offset-2 hover:underline">
                  {r.nom_dossier ?? r.affaire}
                </Link>
              </div>
            ))}
            {data.cite_par.map((r) => (
              <div key={`cite-${r.affaire}`} className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Sert de référence à</span>
                <Link to={`/prevision/${r.affaire}`} className="underline-offset-2 hover:underline">
                  {r.nom_dossier ?? r.affaire}
                </Link>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
