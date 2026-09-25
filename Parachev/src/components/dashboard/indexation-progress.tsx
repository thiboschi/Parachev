import * as React from "react"
import { toast } from "sonner"
import { useProgressionIndexation } from "@/hooks/use-progression-indexation"

const formatNombre = (n: number) => n.toLocaleString("fr-BE")

/** "2 h 05", "12 min", "45 s". */
function formatDuree(secondes: number): string {
  if (secondes < 60) return `${Math.round(secondes)} s`
  const minutes = Math.round(secondes / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`
}

/** Au-delà, le fichier en cours est signalé comme bloquant. */
const SEUIL_BLOCAGE_S = 15

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

  const { etape, total, traites, fichier, debut_fichier, fichiers_par_minute, restant_secondes } = progression
  const pourcentage = total > 0 ? Math.min(100, Math.round((traites / total) * 100)) : 0
  const libelle =
    etape === "comptage"
      ? "Inventaire des fichiers…"
      : etape === "finalisation"
        ? "Finalisation de l'analyse…"
        : `Analyse des fichiers : ${formatNombre(traites)} / ${formatNombre(total)} (${pourcentage} %)` +
          (restant_secondes != null ? ` · encore ~${formatDuree(restant_secondes)}` : "")
  const bloqueDepuis = debut_fichier != null ? Date.now() / 1000 - debut_fichier : 0
  const detail =
    etape !== "analyse" || !fichier
      ? null
      : bloqueDepuis >= SEUIL_BLOCAGE_S
        ? `${fichier} — en cours depuis ${formatDuree(bloqueDepuis)}`
        : fichiers_par_minute != null
          ? `${formatNombre(Math.round(fichiers_par_minute))} fichiers/min · ${fichier}`
          : fichier

  return (
    <>
      <div
        className="hidden min-w-0 flex-col items-end text-xs md:flex"
        role="status"
        aria-live="polite"
      >
        <span className="text-muted-foreground tabular-nums">{libelle}</span>
        {detail && (
          <span
            className={`max-w-80 truncate ${bloqueDepuis >= SEUIL_BLOCAGE_S ? "text-destructive" : "text-muted-foreground/70"}`}
            title={detail}
          >
            {detail}
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
