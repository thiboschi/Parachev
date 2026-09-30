import { useEffect, useMemo, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAffairesDb } from "@/hooks/use-affaires-db"
import { libellePoste } from "@/lib/postes"

// Sentinelle pour "aucun profil sélectionné" -- un Select ne peut pas
// prendre une valeur vide comme item.
const PROFIL_NON_RENSEIGNE = "none"

// Variables explicatives acceptées par `chiffrer_manuellement` (voir
// poste_variables dans calibration.rs) -- les mêmes que variables_affaires,
// mais saisies à la main pour un projet qui n'a pas (encore) de fichier
// Excel dans le dossier surveillé.
type Champ =
  | "nb_barres"
  | "poids_t"
  | "metres"
  | "nb_barres_cfl"
  | "nb_goujons"
  | "nb_trous_manuel"
  | "nb_trous_numerique"
  | "diametre_moyen_numerique"
  | "longueur_coupe"

const CHAMPS: { key: Champ; label: string }[] = [
  { key: "nb_barres", label: "Nombre de barres" },
  { key: "poids_t", label: "Poids total (t)" },
  { key: "metres", label: "Longueur totale de poutres (m)" },
  { key: "nb_barres_cfl", label: "Barres avec contre-flèche" },
  { key: "nb_goujons", label: "Nombre de goujons" },
  { key: "nb_trous_manuel", label: "Trous perçage manuel" },
  { key: "nb_trous_numerique", label: "Trous perçage numérique" },
  { key: "diametre_moyen_numerique", label: "Diamètre moyen numérique (mm)" },
  { key: "longueur_coupe", label: "Longueur de coupe totale (mm)" },
]

// Cases "Opérations de fabrication" du RDE qui rendent des postes
// nécessaires (clés de operations::operation_rde, correspondance dans
// operations::postes_depuis_operation_rde) : contre-flèche -> presse et
// forage numérique, assemblage/soudage -> soudage et assemblage, etc.
const OPERATIONS_RDE: { key: string; label: string }[] = [
  { key: "contre_fleche", label: "Contre-flèche" },
  { key: "double_redressage", label: "Double redressage" },
  { key: "usinage_tetes", label: "Usinage des têtes" },
  { key: "assemblage", label: "Assemblage" },
  { key: "soudage", label: "Soudage" },
  { key: "goujonnage", label: "Goujonnage" },
  { key: "grugeage", label: "Grugeage" },
  { key: "preparation_bord", label: "Préparation bord" },
]

// Postes cochables directement, en plus de ceux déduits des cases du RDE :
// leur temps dépend de leur présence dans le projet (voir POSTES_PREVUS /
// POSTES_FORFAIT dans prevision.rs) -- envoyés à `chiffrer_manuellement`,
// qui en dérive les variables de ces postes (nombre de barres qui passent
// à la presse, forfait CND...).
const POSTES_COCHABLES = [
  "mise_a_longueur",
  "manutention",
  "presse_cintrage",
  "forage_numerique",
  "robot",
  "p3",
  "soudage_sous_flux",
  "controle_cnd",
]

// Un poste non coché est chiffré à 0 h (voir prevision::heures_poste) : la
// mise à longueur, utilisée sur 61 % des affaires, est cochée d'office.
const POSTES_COCHES_PAR_DEFAUT = ["mise_a_longueur"]

// Ajoute ou retire `cle` d'un ensemble de cases cochées.
function basculer(ensemble: Set<string>, cle: string, coche: boolean): Set<string> {
  const suivant = new Set(ensemble)
  if (coche) suivant.add(cle)
  else suivant.delete(cle)
  return suivant
}

const CHAMPS_VIDES: Record<Champ, string> = {
  nb_barres: "",
  poids_t: "",
  metres: "",
  nb_barres_cfl: "",
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
type ChampInfo = "profil" | "contre_fleche"

const INFOS_VIDES: Record<ChampInfo, string> = {
  profil: "",
  contre_fleche: "",
}

const formatHeures = (value: number) =>
  value.toLocaleString("fr-BE", { maximumFractionDigits: 1 })

export default function Chiffrage() {
  // Mêmes profils que le filtre de la page Search : distincts, non nuls,
  // triés, tirés des affaires déjà en base.
  const { affaires } = useAffairesDb()
  const profilOptions = useMemo(
    () =>
      Array.from(
        new Set(
          affaires.map((item) => item.variables?.profil).filter((p): p is string => !!p)
        )
      ).sort(),
    [affaires]
  )

  const [valeurs, setValeurs] = useState<Record<Champ, string>>(CHAMPS_VIDES)
  const [infos, setInfos] = useState<Record<ChampInfo, string>>(INFOS_VIDES)
  const [postes, setPostes] = useState<Set<string>>(new Set(POSTES_COCHES_PAR_DEFAUT))
  const [operationsRde, setOperationsRde] = useState<Set<string>>(new Set())
  // Champ -> postes qui en dépendent avec la calibration actuelle (voir
  // lister_grandeurs_utilisees) : chaque poste calibre sa propre grandeur
  // (poids, mètres, barres...), un champ utilisé laissé vide chiffre son
  // poste à 0 h -- sauf poids et mètres, estimés d'après le nombre de barres.
  const [grandeursUtilisees, setGrandeursUtilisees] = useState<Record<string, string[]>>({})

  useEffect(() => {
    const charger = () =>
      invoke<Record<string, string[]>>("lister_grandeurs_utilisees")
        .then(setGrandeursUtilisees)
        .catch(() => setGrandeursUtilisees({}))
    charger()
    window.addEventListener("coefficients-updated", charger)
    return () => window.removeEventListener("coefficients-updated", charger)
  }, [])
  const [resultat, setResultat] = useState<Record<string, number> | null>(null)
  const [calcul, setCalcul] = useState(false)
  const [dbs, setDbs] = useState(false)
  const [classeTolerance2, setClasseTolerance2] = useState(false)
  const [multiplicateur, setMultiplicateur] = useState("")

  function modifier(champ: Champ, valeur: string) {
    setValeurs((prev) => ({ ...prev, [champ]: valeur }))
  }

  function modifierInfo(champ: ChampInfo, valeur: string) {
    setInfos((prev) => ({ ...prev, [champ]: valeur }))
  }

  function reinitialiser() {
    setValeurs(CHAMPS_VIDES)
    setInfos(INFOS_VIDES)
    setPostes(new Set(POSTES_COCHES_PAR_DEFAUT))
    setOperationsRde(new Set())
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
    invoke<Record<string, number>>("chiffrer_manuellement", {
      variables,
      postes: Array.from(postes),
      operationsRde: Array.from(operationsRde),
    })
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

  // Sous-total = total après application des majorations DBS / Classe
  // Tolérance 2 sélectionnées (cumulatives si les deux sont cochées).
  const sousTotal = resultat
    ? (resultat.total ?? 0) * (dbs ? 1.2 : 1) * (classeTolerance2 ? 1.25 : 1)
    : 0

  const baseMultiplicateur = dbs || classeTolerance2 ? sousTotal : resultat?.total ?? 0

  const multiplicateurNombre = Number(multiplicateur.trim())
  const multiplicateurValide =
    multiplicateur.trim() !== "" && !Number.isNaN(multiplicateurNombre)

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
                  <Select
                    value={infos.profil === "" ? PROFIL_NON_RENSEIGNE : infos.profil}
                    onValueChange={(value) =>
                      modifierInfo("profil", value === PROFIL_NON_RENSEIGNE ? "" : (value ?? ""))
                    }
                  >
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={PROFIL_NON_RENSEIGNE}>Non renseigné</SelectItem>
                      {profilOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                    <div className="flex flex-col">
                      <span className="text-sm text-muted-foreground">{label}</span>
                      {grandeursUtilisees[key] && (
                        <span className="text-xs text-muted-foreground/70">
                          utilisé par : {grandeursUtilisees[key].map(libellePoste).join(", ")}
                        </span>
                      )}
                    </div>
                    <Input
                      className="h-8 max-w-36 text-right tabular-nums"
                      inputMode="decimal"
                      value={valeurs[key]}
                      onChange={(e) => modifier(key, e.target.value)}
                    />
                  </div>
                ))}
                <div className="my-1 border-t" />
                <span className="text-sm text-muted-foreground">Opérations cochées au RDE</span>
                <div className="grid grid-cols-2 gap-2">
                  {OPERATIONS_RDE.map(({ key, label }) => (
                    <div key={key} className="flex items-center gap-2">
                      <Checkbox
                        id={`rde-${key}`}
                        checked={operationsRde.has(key)}
                        onCheckedChange={(checked) =>
                          setOperationsRde((prev) => basculer(prev, key, checked === true))
                        }
                      />
                      <Label htmlFor={`rde-${key}`} className="text-sm font-normal">
                        {label}
                      </Label>
                    </div>
                  ))}
                </div>
                <div className="my-1 border-t" />
                <span className="text-sm text-muted-foreground">Autres postes prévus</span>
                <div className="grid grid-cols-2 gap-2">
                  {POSTES_COCHABLES.map((poste) => (
                    <div key={poste} className="flex items-center gap-2">
                      <Checkbox
                        id={`poste-${poste}`}
                        checked={postes.has(poste)}
                        onCheckedChange={(checked) =>
                          setPostes((prev) => basculer(prev, poste, checked === true))
                        }
                      />
                      <Label htmlFor={`poste-${poste}`} className="text-sm font-normal">
                        {libellePoste(poste)}
                      </Label>
                    </div>
                  ))}
                </div>
                <div className="my-1 border-t" />
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="dbs"
                    checked={dbs}
                    onCheckedChange={(checked) => setDbs(checked === true)}
                  />
                  <Label htmlFor="dbs" className="text-sm font-normal">
                    DBS (1,20)
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="classe-tolerance-2"
                    checked={classeTolerance2}
                    onCheckedChange={(checked) => setClasseTolerance2(checked === true)}
                  />
                  <Label htmlFor="classe-tolerance-2" className="text-sm font-normal">
                    Classe Tolérance 2 (1,25)
                  </Label>
                </div>
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
              <CardContent className="flex flex-1 flex-col gap-1.5 text-sm">
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
                {resultat && dbs && (
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>DBS (×1,20)</span>
                    <span className="tabular-nums">{formatHeures((resultat.total ?? 0) * 1.2)} h</span>
                  </div>
                )}
                {resultat && classeTolerance2 && (
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Classe Tolérance 2 (×1,25)</span>
                    <span className="tabular-nums">{formatHeures((resultat.total ?? 0) * 1.25)} h</span>
                  </div>
                )}
                {resultat && (dbs || classeTolerance2) && (
                  <div className="flex items-center justify-between border-t pt-1.5 font-medium">
                    <span>Sous-total</span>
                    <span className="tabular-nums">{formatHeures(sousTotal)} h</span>
                  </div>
                )}
                <div className="mt-auto flex items-center justify-between gap-2 border-t pt-1.5">
                  <Label htmlFor="multiplicateur" className="text-sm font-normal text-muted-foreground">
                    Multiplicateur
                  </Label>
                  <Input
                    id="multiplicateur"
                    className="h-8 max-w-24 text-right tabular-nums"
                    inputMode="decimal"
                    value={multiplicateur}
                    onChange={(e) => setMultiplicateur(e.target.value)}
                  />
                </div>
                {resultat && multiplicateurValide && (
                  <div className="flex items-center justify-between font-medium">
                    <span>Résultat</span>
                    <span className="tabular-nums">
                      {formatHeures(baseMultiplicateur * multiplicateurNombre)} €
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
