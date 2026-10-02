import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  CHAMPS_PREPARATION,
  PARAMETRES,
  PARAMETRES_DEFAUT,
  PREPARATIONS,
  calculerSoudage,
  ligneVide,
  nombrePasses,
  type ChampSoudure,
  type LigneSoudure,
  type ParametresSoudure,
  type Preparation,
} from "@/lib/soudage"

// Les cadences sont propres à l'atelier, pas au projet : conservées d'un
// chiffrage à l'autre. Une cadence jamais saisie (ou effacée) reprend sa
// valeur par défaut.
const CLE_PARAMETRES = "chiffrage-parametres-soudage"

function lireParametres(): ParametresSoudure {
  try {
    const saisies: Partial<ParametresSoudure> = JSON.parse(localStorage.getItem(CLE_PARAMETRES) ?? "{}")
    const conservees = Object.entries(saisies).filter(([, valeur]) => typeof valeur === "string" && valeur.trim() !== "")
    return { ...PARAMETRES_DEFAUT, ...Object.fromEntries(conservees) }
  } catch {
    return PARAMETRES_DEFAUT
  }
}

const formatNombre = (value: number, decimales = 2) =>
  value.toLocaleString("fr-BE", { maximumFractionDigits: decimales })

// Calculateur de temps de soudage du chiffrage (voir lib/soudage.ts) :
// pièces à souder d'une barre, type de préparation et cadences. `onHeures`
// reçoit le temps pour toutes les barres, pauses comprises, ou null tant
// que le calcul est incomplet.
export function CalculateurSoudage({
  nbBarres,
  onHeures,
}: {
  nbBarres: number
  onHeures: (heures: number | null) => void
}) {
  const [lignes, setLignes] = useState<LigneSoudure[]>([ligneVide(0)])
  const [parametres, setParametres] = useState<ParametresSoudure>(lireParametres)

  const temps = useMemo(
    () => calculerSoudage(lignes, parametres, nbBarres),
    [lignes, parametres, nbBarres]
  )
  const total = temps?.total ?? null

  useEffect(() => {
    onHeures(total)
  }, [total, onHeures])

  // Le calculateur disparaît quand le module "Soudage" est décoché.
  useEffect(() => () => onHeures(null), [onHeures])

  useEffect(() => {
    try {
      localStorage.setItem(CLE_PARAMETRES, JSON.stringify(parametres))
    } catch {
      // stockage indisponible : les cadences ne sont pas conservées
    }
  }, [parametres])

  function modifierLigne(id: number, champ: ChampSoudure | "designation" | "preparation", valeur: string) {
    setLignes((prev) => prev.map((l) => (l.id === id ? { ...l, [champ]: valeur } : l)))
  }

  function ajouterLigne() {
    setLignes((prev) => [...prev, ligneVide(Math.max(-1, ...prev.map((l) => l.id)) + 1)])
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-muted-foreground">Calculateur de soudage</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <span className="text-muted-foreground">Pièces à souder sur une barre</span>
        {lignes.map((ligne) => {
          const passes = nombrePasses(ligne)
          return (
            <div key={ligne.id} className="flex flex-wrap items-end gap-2 rounded-md border p-2">
              <Champ label="Désignation" large>
                <Input
                  className="h-8"
                  value={ligne.designation}
                  onChange={(e) => modifierLigne(ligne.id, "designation", e.target.value)}
                />
              </Champ>
              <Champ label="Nombre">
                <Saisie valeur={ligne.nombre} onChange={(v) => modifierLigne(ligne.id, "nombre", v)} />
              </Champ>
              <Champ label="Longueur à souder par pièce (mm)" large>
                <Saisie valeur={ligne.longueur} onChange={(v) => modifierLigne(ligne.id, "longueur", v)} />
              </Champ>
              <Champ label="Préparation" large>
                <Select
                  value={ligne.preparation}
                  onValueChange={(value) =>
                    modifierLigne(ligne.id, "preparation", (value ?? "angle") as Preparation)
                  }
                >
                  <SelectTrigger className="h-8 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PREPARATIONS.map(({ key, label }) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Champ>
              {CHAMPS_PREPARATION[ligne.preparation].map(({ key, label }) => (
                <Champ key={key} label={label}>
                  <Saisie valeur={ligne[key]} onChange={(v) => modifierLigne(ligne.id, key, v)} />
                </Champ>
              ))}
              {ligne.preparation !== "angle" && (
                <span className="pb-1.5 tabular-nums text-muted-foreground">
                  {passes === null ? "passes : —" : `passes : ${passes}`}
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => setLignes((prev) => prev.filter((l) => l.id !== ligne.id))}
              >
                Retirer
              </Button>
            </div>
          )
        })}
        <div>
          <Button variant="outline" size="sm" onClick={ajouterLigne}>
            Ajouter une pièce
          </Button>
        </div>

        <div className="my-1 border-t" />
        <span className="text-muted-foreground">Cadences de l'atelier</span>
        <div className="grid gap-2 lg:grid-cols-2">
          {PARAMETRES.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">{label}</span>
              <Input
                className="h-8 max-w-24 text-right tabular-nums"
                inputMode="decimal"
                value={parametres[key]}
                onChange={(e) => setParametres((prev) => ({ ...prev, [key]: e.target.value }))}
              />
            </div>
          ))}
        </div>

        <div className="my-1 border-t" />
        {!temps && (
          <span className="text-muted-foreground">
            Renseignez la vitesse de soudage et, pour chaque pièce, la longueur à souder et la
            préparation.
          </span>
        )}
        {temps && (
          <div className="flex flex-col gap-1.5">
            <Resultat label="Longueur à souder par barre" valeur={`${formatNombre(temps.longueurM, 3)} m`} />
            <Resultat label="Masse déposée par barre" valeur={`${formatNombre(temps.masseKg)} kg`} />
            <Resultat label="Soudage" valeur={`${formatNombre(temps.soudage)} h`} />
            <Resultat label="Meulage" valeur={`${formatNombre(temps.meulage)} h`} />
            <Resultat label="EPI" valeur={`${formatNombre(temps.epi)} h`} />
            <Resultat label="Manutention" valeur={`${formatNombre(temps.manutention)} h`} />
            <Resultat label="Par barre, sans pause" valeur={`${formatNombre(temps.sansPause)} h`} />
            <Resultat label="Par barre, avec pauses (×4/3)" valeur={`${formatNombre(temps.avecPause)} h`} />
            <div className="flex items-center justify-between border-t pt-1.5 font-medium">
              <span>
                Soudage pour {formatNombre(nbBarres)} barre{nbBarres > 1 ? "s" : ""}
              </span>
              <span className="tabular-nums">{formatNombre(temps.total)} h</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Champ({ label, large, children }: { label: string; large?: boolean; children: React.ReactNode }) {
  return (
    <label className={`flex flex-col gap-1 ${large ? "w-48" : "w-28"}`}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function Saisie({ valeur, onChange }: { valeur: string; onChange: (valeur: string) => void }) {
  return (
    <Input
      className="h-8 text-right tabular-nums"
      inputMode="decimal"
      value={valeur}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

function Resultat({ label, valeur }: { label: string; valeur: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{valeur}</span>
    </div>
  )
}
