import * as React from "react"
import { toast } from "sonner"
import { useProgressionIndexation } from "@/hooks/use-progression-indexation"

const formatNombre = (n: number) => n.toLocaleString("fr-BE")

/**
 * Barre de chargement de l'analyse des fichiers, affichée dans l'en-tête
 * de toutes les pages tant qu'un scan est en cours : un libellé avec le
 * compte de fichiers, et une fine barre sur toute la largeur en bas de
 * l'en-tête. Notifie la fin de l'analyse.
 */
export function IndexationProgress() {
  const progression = useProgressionIndexation()
  const etaitEnCours = React.useRef(false)

  React.useEffect(() => {
    if (!progression) return
    if (etaitEnCours.current && !progression.en_cours) {
      const erreurs = progression.erreurs
      toast.success(
        `Analyse terminée : ${formatNombre(progression.total)} fichiers` +
          (erreurs > 0 ? ` (${erreurs} illisible${erreurs > 1 ? "s" : ""})` : "")
      )
    }
    etaitEnCours.current = progression.en_cours
  }, [progression])

  if (!progression?.en_cours) return null

  const { etape, total, traites, fichier } = progression
  const pourcentage = total > 0 ? Math.min(100, Math.round((traites / total) * 100)) : 0
  const libelle =
    etape === "comptage"
      ? "Inventaire des fichiers…"
      : etape === "finalisation"
        ? "Finalisation de l'analyse…"
        : `Analyse des fichiers : ${formatNombre(traites)} / ${formatNombre(total)} (${pourcentage} %)`

  return (
    <>
      <div
        className="hidden min-w-0 flex-col items-end text-xs md:flex"
        role="status"
        aria-live="polite"
      >
        <span className="text-muted-foreground tabular-nums">{libelle}</span>
        {fichier && etape === "analyse" && (
          <span className="max-w-64 truncate text-muted-foreground/70" title={fichier}>
            {fichier}
          </span>
        )}
      </div>
      <div
        className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-muted"
        role="progressbar"
        aria-label="Analyse des fichiers"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={etape === "analyse" ? pourcentage : undefined}
      >
        {etape === "analyse" ? (
          <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${pourcentage}%` }} />
        ) : (
          // Total pas encore connu (inventaire) ou étape finale : barre animée.
          <div className="h-full w-1/3 animate-pulse bg-primary" />
        )}
      </div>
    </>
  )
}
