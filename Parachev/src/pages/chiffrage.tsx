import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { libellePoste } from "@/lib/postes"

// Variables explicatives acceptées par `chiffrer_manuellement` (voir
// poste_variables dans calibration.rs) -- les mêmes que variables_affaires,
// mais saisies à la main pour un projet qui n'a pas (encore) de fichier
// Excel dans le dossier surveillé.
type Champ =
  | "nb_barres"
  | "nb_goujons"
  | "nb_trous_manuel"
  | "nb_trous_numerique"
  | "diametre_moyen_numerique"
  | "longueur_coupe"

const CHAMPS: { key: Champ; label: string }[] = [
  { key: "nb_barres", label: "Nombre de barres" },
  { key: "nb_goujons", label: "Nombre de goujons" },
  { key: "nb_trous_manuel", label: "Trous perçage manuel" },
  { key: "nb_trous_numerique", label: "Trous perçage numérique" },
  { key: "diametre_moyen_numerique", label: "Diamètre moyen numérique (mm)" },
  { key: "longueur_coupe", label: "Longueur de coupe totale (mm)" },
]

const CHAMPS_VIDES: Record<Champ, string> = {
  nb_barres: "",
  nb_goujons: "",
  nb_trous_manuel: "",
  nb_trous_numerique: "",
  diametre_moyen_numerique: "",
  longueur_coupe: "",
}

// Champs purement informatifs : ni envoyés à `chiffrer_manuellement`, ni
// utilisés dans le calcul (comme `profil`/`contre_fleche` dans
// variables_affaires, voir prevision.tsx) -- juste affichés à côté de
// l'estimation pour le contexte du projet.
type ChampInfo = "profil" | "contre_fleche" | "pourcentage"

const INFOS_VIDES: Record<ChampInfo, string> = {
  profil: "",
  contre_fleche: "",
  pourcentage: "",
}

const formatHeures = (value: number) =>
  value.toLocaleString("fr-BE", { maximumFractionDigits: 1 })

export default function Chiffrage() {
  const [valeurs, setValeurs] = useState<Record<Champ, string>>(CHAMPS_VIDES)
  const [infos, setInfos] = useState<Record<ChampInfo, string>>(INFOS_VIDES)
  const [resultat, setResultat] = useState<Record<string, number> | null>(null)
  const [calcul, setCalcul] = useState(false)

  function modifier(champ: Champ, valeur: string) {
    setValeurs((prev) => ({ ...prev, [champ]: valeur }))
  }

  function modifierInfo(champ: ChampInfo, valeur: string) {
    setInfos((prev) => ({ ...prev, [champ]: valeur }))
  }

  function reinitialiser() {
    setValeurs(CHAMPS_VIDES)
    setInfos(INFOS_VIDES)
    setResultat(null)
  }

  function chiffrer() {
    const champInvalide = CHAMPS.find(({ key }) => {
      const brut = valeurs[key].trim()
      return brut !== "" && Number.isNaN(Number(brut))
    })
    if (champInvalide) {
      toast.error(`Valeur invalide pour "${champInvalide.label}"`)
      return
    }

    const variables = Object.fromEntries(
      CHAMPS.map(({ key }) => [key, valeurs[key].trim() === "" ? 0 : Number(valeurs[key])])
    )

    setCalcul(true)
    invoke<Record<string, number>>("chiffrer_manuellement", { variables })
      .then(setResultat)
      .catch((e) => {
        setResultat(null)
        toast.error(e instanceof Error ? e.message : String(e))
      })
      .finally(() => setCalcul(false))
  }

  const heuresParPoste = resultat
    ? Object.entries(resultat)
        .filter(([poste, heures]) => poste !== "total" && heures > 0)
        .sort(([a], [b]) => a.localeCompare(b))
    : []

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
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold">Chiffrage</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Estime le temps de fabrication d'un projet qui n'est pas (encore)
              dans le dossier surveillé, à partir des coefficients calibrés --
              rien n'est enregistré en base, c'est une simulation.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">
                  Variables du projet
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="shrink-0 text-sm text-muted-foreground">Profil</span>
                  <Input
                    className="h-8 max-w-36 text-right"
                    value={infos.profil}
                    onChange={(e) => modifierInfo("profil", e.target.value)}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="shrink-0 text-sm text-muted-foreground">CFL</span>
                  <Input
                    className="h-8 max-w-36 text-right tabular-nums"
                    inputMode="decimal"
                    value={infos.contre_fleche}
                    onChange={(e) => modifierInfo("contre_fleche", e.target.value)}
                  />
                </div>
                <div className="my-1 border-t" />

                {CHAMPS.map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between gap-2">
                    <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
                    <Input
                      className="h-8 max-w-36 text-right tabular-nums"
                      inputMode="decimal"
                      value={valeurs[key]}
                      onChange={(e) => modifier(key, e.target.value)}
                    />
                  </div>
                ))}
                <div className="mt-2 flex items-center gap-2">
                  <Button onClick={chiffrer} disabled={calcul}>
                    {calcul ? "Calcul…" : "Chiffrer"}
                  </Button>
                  <Button variant="ghost" onClick={reinitialiser} disabled={calcul}>
                    Réinitialiser
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">Estimation</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1.5 text-sm">
                {!resultat && (
                  <span className="text-muted-foreground">
                    Renseignez les variables puis cliquez sur « Chiffrer ».
                  </span>
                )}
                {resultat && heuresParPoste.length === 0 && (
                  <span className="text-muted-foreground">
                    Aucune heure estimée avec ces variables.
                  </span>
                )}
                {heuresParPoste.map(([poste, heures]) => (
                  <div key={poste} className="flex items-center justify-between">
                    <span className="text-muted-foreground">{libellePoste(poste)}</span>
                    <span className="tabular-nums">{formatHeures(heures)} h</span>
                  </div>
                ))}
                {resultat && (
                  <div className="mt-1 flex items-center justify-between border-t pt-1.5 font-medium">
                    <span>Total</span>
                    <span className="tabular-nums">{formatHeures(resultat.total ?? 0)} h</span>
                  </div>
                )}

                <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
                  <span className="shrink-0 text-muted-foreground">%</span>
                  <Input
                    className="h-8 max-w-36 text-right tabular-nums"
                    inputMode="decimal"
                    value={infos.pourcentage}
                    onChange={(e) => modifierInfo("pourcentage", e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
