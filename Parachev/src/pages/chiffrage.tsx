import { useEffect, useMemo, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MultiSelect } from "@/components/affaires/multi-select"
import { CalculateurSoudage } from "@/components/chiffrage/calculateur-soudage"
import { useRechercheAffaires } from "@/hooks/use-recherche-affaires"
import { TYPES_PRODUCTION, type TypeProduction } from "@/lib/flux-production"
import { heuresForageManuel, heuresForageNumerique, heuresOblongs } from "@/lib/percage"
import { libellePoste } from "@/lib/postes"
import { familleProfil, optionsFiltres, type OptionFiltre, type OptionsFiltres } from "@/lib/recherche"

// Sentinelle pour "rien de sélectionné" -- un Select ne peut pas prendre
// une valeur vide comme item.
const NON_RENSEIGNE = "none"

// Champs purement informatifs de la section "Infos Client" : ni envoyés à
// `chiffrer_manuellement`, ni utilisés dans le calcul. Le n° 11 est le
// numéro de commande (1100...), le n° 19 la commande de laminage (1900...).
type ChampClient = "numero_11" | "numero_19" | "numero_offre" | "client"

const CHAMPS_CLIENT: { key: ChampClient; label: string; placeholder?: string }[] = [
  { key: "numero_11", label: "N° 11", placeholder: "1100…" },
  { key: "numero_19", label: "N° 19", placeholder: "1900…" },
  { key: "numero_offre", label: "N° d'offre" },
  { key: "client", label: "Nom du client" },
]

const CLIENT_VIDE: Record<ChampClient, string> = {
  numero_11: "",
  numero_19: "",
  numero_offre: "",
  client: "",
}

// Mêmes champs que la section "Normes et exigences (RDE)" des filtres de la
// recherche (voir affaires-search-bar.tsx), avec les valeurs relevées dans
// les RDE déjà en base. Une seule valeur par champ, sauf les exigences
// particulières (voir `exigences`).
type ChampNorme = "exc" | "en10163" | "tolerance" | "en10204" | "prep" | "classeUs"

const CHAMPS_NORMES: { key: ChampNorme; label: string }[] = [
  { key: "exc", label: "Classe d'exécution (EN 1090)" },
  { key: "en10163", label: "Réparation (EN 10163-3)" },
  { key: "tolerance", label: "Tolérance géométrique" },
  { key: "en10204", label: "Document de contrôle (EN 10204)" },
  { key: "prep", label: "Préparation (EN 8501-3)" },
  { key: "classeUs", label: "Contrôle US" },
]

const NORMES_VIDES: Record<ChampNorme, string> = {
  exc: "",
  en10163: "",
  tolerance: "",
  en10204: "",
  prep: "",
  classeUs: "",
}

// Majorations du temps total déduites des normes choisies (cumulatives).
const TOLERANCE_MAJOREE = "Classe 2"
const EXIGENCE_MAJOREE = "DBS"
const MAJORATION_TOLERANCE = 1.25
const MAJORATION_DBS = 1.2

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
  | "diametre_moyen_manuel"
  | "nb_trous_numerique"
  | "diametre_moyen_numerique"
  | "longueur_coupe"

const LIBELLES_CHAMPS: Record<Champ, string> = {
  nb_barres: "Nombre de barres",
  poids_t: "Poids par barre (t)",
  metres: "Longueur par barre (m)",
  nb_barres_cfl: "Barres avec contre-flèche",
  nb_goujons: "Goujons par barre",
  nb_trous_manuel: "Trous perçage manuel par barre",
  diametre_moyen_manuel: "Diamètre moyen manuel (mm)",
  nb_trous_numerique: "Trous perçage numérique par barre",
  diametre_moyen_numerique: "Diamètre moyen numérique (mm)",
  longueur_coupe: "Longueur de coupe par barre (mm)",
}

// Quantités saisies pour UNE barre : multipliées par le nombre de barres
// avant l'envoi à `chiffrer_manuellement`, qui attend les totaux du projet.
const CHAMPS_PAR_BARRE = new Set<Champ>([
  "poids_t",
  "metres",
  "nb_goujons",
  "nb_trous_manuel",
  "nb_trous_numerique",
  "longueur_coupe",
])

const CHAMPS_VIDES = Object.fromEntries(
  Object.keys(LIBELLES_CHAMPS).map((key) => [key, ""])
) as Record<Champ, string>

// Grandeurs de taille de la poutre, communes à tous les modules (GRANDEURS
// dans prevision.rs) : saisies une fois dans la section "Poutre", pour une
// barre. Poids et longueur laissés vides sont estimés d'après le nombre de
// barres.
const CHAMPS_POUTRE: Champ[] = ["nb_barres", "poids_t", "metres"]

// Quantités propres à un poste, saisies dans son module de prédiction. Les
// postes absents n'ont que les grandeurs de la poutre (ou un forfait).
const CHAMPS_MODULE: Record<string, Champ[]> = {
  presse_cintrage: ["nb_barres_cfl"],
  forage_numerique: ["nb_trous_numerique", "diametre_moyen_numerique"],
  forage_manuel: ["nb_trous_manuel", "diametre_moyen_manuel"],
  goujonnage: ["nb_goujons"],
  oxycoupage: ["longueur_coupe"],
}

// Trous oblongs d'une barre, en option des modules qui peuvent les réaliser :
// aucun poste ne les chiffre d'après leur nombre, ils ne servent qu'au temps
// barème (voir heuresOblongs).
const POSTES_AVEC_OBLONGS = ["forage_manuel", "oxycoupage"]

type ChampOblong = "nombre" | "longueur" | "largeur"

const CHAMPS_OBLONGS: { key: ChampOblong; label: string }[] = [
  { key: "nombre", label: "Oblongs par barre" },
  { key: "longueur", label: "Longueur (mm)" },
  { key: "largeur", label: "Largeur (mm)" },
]

const OBLONGS_VIDES: Record<ChampOblong, string> = { nombre: "", longueur: "", largeur: "" }

// Présente sur presque toutes les affaires sans faire partie d'une gamme
// (voir POSTES_ANNEXES dans flux-production.ts) : proposée pour tous les types.
const POSTE_TOUJOURS_PROPOSE = "manutention"

/** Un module de prédiction = un poste de la gamme du type de poutre. */
interface ModulePoste {
  poste: string
  /** Absent d'une variante de la gamme, ou alternative d'une étape (OU). */
  optionnel: boolean
}

// Modules d'un type du "Flux de production BFC" : tous les postes de ses
// itinéraires, dans l'ordre de la gamme. Un poste est obligatoire s'il est
// une étape à lui seul dans chaque itinéraire.
function modulesDuType(type: TypeProduction): ModulePoste[] {
  const postes = Array.from(new Set(type.itineraires.flat(2)))
  const modules = postes.map((poste) => ({
    poste,
    optionnel: !type.itineraires.every((itineraire) =>
      itineraire.some((etape) => etape.length === 1 && etape[0] === poste)
    ),
  }))
  if (!postes.includes(POSTE_TOUJOURS_PROPOSE)) {
    modules.push({ poste: POSTE_TOUJOURS_PROPOSE, optionnel: false })
  }
  return modules
}

const postesParDefaut = (modules: ModulePoste[]) =>
  new Set(modules.filter((m) => !m.optionnel).map((m) => m.poste))

// Ajoute ou retire `cle` d'un ensemble de cases cochées.
function basculer(ensemble: Set<string>, cle: string, coche: boolean): Set<string> {
  const suivant = new Set(ensemble)
  if (coche) suivant.add(cle)
  else suivant.delete(cle)
  return suivant
}

// Nombre saisi (virgule ou point décimal) ; NaN si illisible, 0 si vide.
const nombre = (brut: string) => (brut.trim() === "" ? 0 : Number(brut.trim().replace(",", ".")))

const formatHeures = (value: number) =>
  value.toLocaleString("fr-BE", { maximumFractionDigits: 1 })

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs font-medium text-muted-foreground uppercase">{titre}</span>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </div>
  )
}

function ChampSaisie({
  id,
  label,
  aide,
  children,
}: {
  id?: string
  label: string
  aide?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
        {aide && <span className="font-normal opacity-70"> · {aide}</span>}
      </Label>
      {children}
    </div>
  )
}

/** Liste déroulante à choix unique ; "" = non renseigné. */
function Liste({
  label,
  valeur,
  options,
  vide = "Non renseigné",
  desactive = false,
  onChange,
}: {
  label: string
  valeur: string
  options: { valeur: string; libelle: string }[]
  vide?: string
  desactive?: boolean
  onChange: (valeur: string) => void
}) {
  const items = {
    [NON_RENSEIGNE]: vide,
    ...Object.fromEntries(options.map((o) => [o.valeur, o.libelle])),
  }
  return (
    <ChampSaisie label={label}>
      <Select
        items={items}
        disabled={desactive}
        value={valeur === "" ? NON_RENSEIGNE : valeur}
        onValueChange={(v) => onChange(!v || v === NON_RENSEIGNE ? "" : v)}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NON_RENSEIGNE}>{vide}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.valeur} value={o.valeur}>
              {o.libelle}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </ChampSaisie>
  )
}

const versOptions = (valeurs: string[]) => valeurs.map((v) => ({ valeur: v, libelle: v }))

export default function Chiffrage() {
  // Valeurs proposées dans les listes : celles des affaires déjà en base,
  // comme les filtres de la page Search.
  const { affaires } = useRechercheAffaires()
  const options: OptionsFiltres = useMemo(() => optionsFiltres(affaires), [affaires])

  const [client, setClient] = useState<Record<ChampClient, string>>(CLIENT_VIDE)
  const [normes, setNormes] = useState<Record<ChampNorme, string>>(NORMES_VIDES)
  const [exigences, setExigences] = useState<string[]>([])

  // La valeur majorée reste proposée même sans affaire en base qui la porte.
  const avecValeur = (liste: OptionFiltre[], valeur: string): OptionFiltre[] =>
    liste.some((o) => o.valeur === valeur) ? liste : [...liste, { valeur, libelle: valeur, nombre: 0 }]
  const optionsTolerance = avecValeur(options.tolerance, TOLERANCE_MAJOREE)
  const optionsExigences = avecValeur(options.exigences, EXIGENCE_MAJOREE)

  const [typeNom, setTypeNom] = useState("")
  // Le profil se choisit en deux temps : sa famille (HEB, HD, HL…), puis
  // le profil précis parmi ceux de cette famille.
  const [famille, setFamille] = useState("")
  const [profil, setProfil] = useState("")
  const optionsFamilles = useMemo(
    () => [...options.familles].sort((a, b) => a.libelle.localeCompare(b.libelle)),
    [options.familles]
  )
  const optionsProfils = useMemo(
    () =>
      options.profils
        .filter((o) => familleProfil(o.valeur) === famille)
        .sort((a, b) => a.libelle.localeCompare(b.libelle, "fr", { numeric: true })),
    [options.profils, famille]
  )
  const [contreFleche, setContreFleche] = useState("")
  const [valeurs, setValeurs] = useState<Record<Champ, string>>(CHAMPS_VIDES)
  // Option "Trous oblongs" de chaque module de POSTES_AVEC_OBLONGS : cochée
  // ou non, et ses dimensions (propres au poste).
  const [oblongsActifs, setOblongsActifs] = useState<Set<string>>(new Set())
  const [oblongs, setOblongs] = useState<Record<string, Record<ChampOblong, string>>>({})
  const type = TYPES_PRODUCTION.find((t) => t.nom === typeNom)
  const modules = useMemo(() => (type ? modulesDuType(type) : []), [type])
  // Modules cochés : un poste non coché est chiffré à 0 h.
  const [postes, setPostes] = useState<Set<string>>(new Set())

  // Poste -> grandeurs dont il dépend avec la calibration actuelle (voir
  // lister_grandeurs_utilisees) : chaque poste calibre sa propre grandeur
  // (poids, mètres, barres...), une grandeur utilisée laissée vide chiffre
  // son poste à 0 h -- sauf poids et mètres, estimés d'après le nombre de barres.
  const [grandeursParPoste, setGrandeursParPoste] = useState<Record<string, string[]>>({})

  useEffect(() => {
    const charger = () =>
      invoke<Record<string, string[]>>("lister_grandeurs_utilisees")
        .then((parGrandeur) => {
          const parPoste: Record<string, string[]> = {}
          for (const [grandeur, postesGrandeur] of Object.entries(parGrandeur)) {
            for (const poste of postesGrandeur) (parPoste[poste] ??= []).push(grandeur)
          }
          setGrandeursParPoste(parPoste)
        })
        .catch(() => setGrandeursParPoste({}))
    charger()
    window.addEventListener("coefficients-updated", charger)
    return () => window.removeEventListener("coefficients-updated", charger)
  }, [])

  const [resultatBrut, setResultat] = useState<Record<string, number> | null>(null)
  // Heures de soudage du calculateur (affiché avec le module "Soudage"),
  // null tant qu'il est incomplet : elles remplacent celles de la
  // calibration dans l'estimation.
  const [soudageCalcule, setSoudageCalcule] = useState<number | null>(null)
  const soudageActif = postes.has("soudage")
  const resultat = useMemo(() => {
    if (!resultatBrut || !soudageActif || soudageCalcule === null) return resultatBrut
    const total = (resultatBrut.total ?? 0) - (resultatBrut.soudage ?? 0) + soudageCalcule
    return { ...resultatBrut, soudage: soudageCalcule, total }
  }, [resultatBrut, soudageActif, soudageCalcule])
  const [calcul, setCalcul] = useState(false)
  const [multiplicateur, setMultiplicateur] = useState("")

  function modifier(champ: Champ, valeur: string) {
    setValeurs((prev) => ({ ...prev, [champ]: valeur }))
  }

  function choisirFamille(valeur: string) {
    setFamille(valeur)
    setProfil("")
  }

  function choisirType(nom: string) {
    setTypeNom(nom)
    const choisi = TYPES_PRODUCTION.find((t) => t.nom === nom)
    setPostes(choisi ? postesParDefaut(modulesDuType(choisi)) : new Set())
    setResultat(null)
  }

  function reinitialiser() {
    setClient(CLIENT_VIDE)
    setNormes(NORMES_VIDES)
    setExigences([])
    setTypeNom("")
    setFamille("")
    setProfil("")
    setContreFleche("")
    setValeurs(CHAMPS_VIDES)
    setOblongsActifs(new Set())
    setOblongs({})
    setPostes(new Set())
    setResultat(null)
  }

  const nbBarres = nombre(valeurs.nb_barres)
  // Total du projet pour un champ : la valeur par barre × le nombre de barres.
  const totalProjet = (key: Champ) =>
    nombre(valeurs[key]) * (CHAMPS_PAR_BARRE.has(key) ? nbBarres : 1)
  // Rappel du total sous un champ saisi par barre.
  const aideTotal = (key: Champ) => {
    const total = totalProjet(key)
    return CHAMPS_PAR_BARRE.has(key) && nbBarres > 0 && total > 0
      ? `total : ${formatHeures(total)}`
      : undefined
  }

  function chiffrer() {
    // Seules les quantités de la poutre et des modules cochés comptent.
    const champs = [...CHAMPS_POUTRE, ...[...postes].flatMap((poste) => CHAMPS_MODULE[poste] ?? [])]
    const champInvalide = champs.find((key) => Number.isNaN(nombre(valeurs[key])))
    if (champInvalide) {
      toast.error(`Valeur invalide pour "${LIBELLES_CHAMPS[champInvalide]}"`)
      return
    }
    if (!(nbBarres > 0)) {
      toast.error("Renseignez le nombre de barres : les quantités sont saisies par barre")
      return
    }

    const variables = Object.fromEntries(
      (Object.keys(LIBELLES_CHAMPS) as Champ[]).map((key) => [
        key,
        champs.includes(key) ? totalProjet(key) : 0,
      ])
    )
    const postesChiffres = Array.from(postes)

    setCalcul(true)
    invoke<Record<string, number>>("chiffrer_manuellement", {
      variables,
      postes: postesChiffres,
      operationsRde: [],
    })
      .then((heures) => {
        // Ne garde que les modules cochés : sans présence calibrée, un poste
        // hors gamme peut recevoir des heures d'après la seule taille de la poutre.
        const retenues = Object.fromEntries(
          postesChiffres.filter((poste) => (heures[poste] ?? 0) > 0).map((poste) => [poste, heures[poste]])
        )
        const total = Object.values(retenues).reduce((somme, h) => somme + h, 0)
        setResultat({ ...retenues, total })
      })
      .catch((e) => {
        setResultat(null)
        toast.error(e instanceof Error ? e.message : String(e))
      })
      .finally(() => setCalcul(false))
  }

  // Temps barème des modules de perçage (voir lib/percage.ts), affiché pour
  // comparaison : l'estimation reste celle de la calibration.
  const baremePercage: Record<string, string | undefined> = {
    forage_manuel: (() => {
      const heures = heuresForageManuel(totalProjet("nb_trous_manuel"), nombre(valeurs.diametre_moyen_manuel))
      return heures === null ? undefined : `Barème atelier (FMAN) : ${formatHeures(heures)} h.`
    })(),
    forage_numerique: (() => {
      const heures = heuresForageNumerique(
        totalProjet("nb_trous_numerique"),
        nombre(valeurs.diametre_moyen_numerique),
        profil
      )
      return heures === null
        ? undefined
        : `Barème atelier (FWAG) : ${formatHeures(heures.ame)} h dans l'âme, ${formatHeures(heures.aile)} h dans les ailes.`
    })(),
  }

  const oblongsDuPoste = (poste: string) => oblongs[poste] ?? OBLONGS_VIDES
  const heuresOblongsBareme = (poste: string) => {
    const saisie = oblongsDuPoste(poste)
    return heuresOblongs(nombre(saisie.nombre) * nbBarres, nombre(saisie.longueur), nombre(saisie.largeur))
  }

  // Dans l'ordre de la gamme.
  const heuresParPoste = resultat
    ? modules
        .filter(({ poste }) => postes.has(poste) && (resultat[poste] ?? 0) > 0)
        .map(({ poste }) => [poste, resultat[poste]] as const)
    : []

  const dbs = exigences.includes(EXIGENCE_MAJOREE)
  const classeTolerance2 = normes.tolerance === TOLERANCE_MAJOREE

  // Sous-total = total après application des majorations DBS / tolérance
  // classe 2 (cumulatives si les deux s'appliquent).
  const sousTotal = resultat
    ? (resultat.total ?? 0) *
      (dbs ? MAJORATION_DBS : 1) *
      (classeTolerance2 ? MAJORATION_TOLERANCE : 1)
    : 0

  const multiplicateurNombre = nombre(multiplicateur)
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

          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="flex min-w-0 flex-col gap-4">
              <Card>
                <CardContent className="flex flex-col gap-5">
                  <Section titre="Infos Client">
                    {CHAMPS_CLIENT.map(({ key, label, placeholder }) => (
                      <ChampSaisie key={key} id={`client-${key}`} label={label}>
                        <Input
                          id={`client-${key}`}
                          placeholder={placeholder}
                          value={client[key]}
                          onChange={(e) => setClient((prev) => ({ ...prev, [key]: e.target.value }))}
                        />
                      </ChampSaisie>
                    ))}
                  </Section>

                  <div className="border-t" />
                  <Section titre="Normes et Exigences">
                    {CHAMPS_NORMES.map(({ key, label }) => (
                      <Liste
                        key={key}
                        label={label}
                        valeur={normes[key]}
                        options={key === "tolerance" ? optionsTolerance : options[key]}
                        onChange={(valeur) => setNormes((prev) => ({ ...prev, [key]: valeur }))}
                      />
                    ))}
                    <MultiSelect
                      label="Exigences particulières"
                      vide="Aucune"
                      options={optionsExigences}
                      valeurs={exigences}
                      onChange={setExigences}
                    />
                  </Section>

                  <div className="border-t" />
                  <Section titre="Poutre">
                    <Liste
                      label="Type d'affaire"
                      vide="Choisir un type…"
                      valeur={typeNom}
                      options={versOptions(TYPES_PRODUCTION.map((t) => t.nom))}
                      onChange={choisirType}
                    />
                    <Liste
                      label="Famille de profil"
                      valeur={famille}
                      options={optionsFamilles}
                      onChange={choisirFamille}
                    />
                    <Liste
                      label="Profil"
                      vide={famille ? "Non renseigné" : "Choisir une famille…"}
                      valeur={profil}
                      options={optionsProfils}
                      desactive={!famille}
                      onChange={setProfil}
                    />
                    {type &&
                      CHAMPS_POUTRE.map((key) => (
                        <ChampSaisie key={key} id={`poutre-${key}`} label={LIBELLES_CHAMPS[key]} aide={aideTotal(key)}>
                          <Input
                            id={`poutre-${key}`}
                            className="text-right tabular-nums"
                            inputMode="decimal"
                            value={valeurs[key]}
                            onChange={(e) => modifier(key, e.target.value)}
                          />
                        </ChampSaisie>
                      ))}
                  </Section>
                  {!type && (
                    <span className="text-sm text-muted-foreground">
                      Choisissez un type d'affaire pour ouvrir ses modules de prédiction.
                    </span>
                  )}
                </CardContent>
              </Card>

              {modules.map(({ poste, optionnel }) => {
                const actif = postes.has(poste)
                const champs = CHAMPS_MODULE[poste] ?? []
                const grandeurs = (grandeursParPoste[poste] ?? []).filter(
                  (g) => !champs.includes(g as Champ)
                )
                const heures = resultat?.[poste]
                const avecOblongs = POSTES_AVEC_OBLONGS.includes(poste)
                const oblongsCoches = oblongsActifs.has(poste)
                const baremeOblongs = heuresOblongsBareme(poste)
                return (
                  <div key={poste} className="flex flex-col gap-4">
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <Checkbox
                            id={`module-${poste}`}
                            checked={actif}
                            onCheckedChange={(coche) =>
                              setPostes((prev) => basculer(prev, poste, coche === true))
                            }
                          />
                          <Label htmlFor={`module-${poste}`} className="text-sm font-medium">
                            {libellePoste(poste)}
                          </Label>
                          {optionnel && <Badge variant="outline">Optionnel</Badge>}
                          {actif && heures !== undefined && (
                            <span className="ml-auto tabular-nums">{formatHeures(heures)} h</span>
                          )}
                        </CardTitle>
                      </CardHeader>
                      {actif && (
                        <CardContent className="flex flex-col gap-3 text-sm">
                          {champs.length > 0 && (
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              {champs.map((key) => (
                                <ChampSaisie
                                  key={key}
                                  id={`module-${poste}-${key}`}
                                  label={LIBELLES_CHAMPS[key]}
                                  aide={aideTotal(key)}
                                >
                                  <Input
                                    id={`module-${poste}-${key}`}
                                    className="text-right tabular-nums"
                                    inputMode="decimal"
                                    value={valeurs[key]}
                                    onChange={(e) => modifier(key, e.target.value)}
                                  />
                                </ChampSaisie>
                              ))}
                              {poste === "presse_cintrage" && (
                                <ChampSaisie id="module-cfl" label="CFL" aide="pour information">
                                  <Input
                                    id="module-cfl"
                                    className="text-right tabular-nums"
                                    inputMode="decimal"
                                    value={contreFleche}
                                    onChange={(e) => setContreFleche(e.target.value)}
                                  />
                                </ChampSaisie>
                              )}
                            </div>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {poste === "soudage"
                              ? "Chiffré par le calculateur ci-dessous ; tant qu'il est incomplet, par la calibration."
                              : grandeurs.length > 0
                                ? `Calculé d'après : ${grandeurs
                                    .map((g) => LIBELLES_CHAMPS[g as Champ] ?? g)
                                    .join(", ")
                                    .toLowerCase()}.`
                                : champs.length > 0
                                  ? "Calculé d'après les quantités ci-dessus."
                                  : "Chiffré au forfait."}
                          </span>
                          {baremePercage[poste] && (
                            <span className="text-xs text-muted-foreground">{baremePercage[poste]}</span>
                          )}
                          {avecOblongs && (
                            <div className="flex flex-col gap-3 border-t pt-3">
                              <div className="flex items-center gap-2">
                                <Checkbox
                                  id={`oblongs-${poste}`}
                                  checked={oblongsCoches}
                                  onCheckedChange={(coche) =>
                                    setOblongsActifs((prev) => basculer(prev, poste, coche === true))
                                  }
                                />
                                <Label htmlFor={`oblongs-${poste}`} className="text-sm font-normal">
                                  Trous oblongs
                                </Label>
                              </div>
                              {oblongsCoches && (
                                <>
                                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                    {CHAMPS_OBLONGS.map(({ key, label }) => (
                                      <ChampSaisie key={key} id={`oblongs-${poste}-${key}`} label={label}>
                                        <Input
                                          id={`oblongs-${poste}-${key}`}
                                          className="text-right tabular-nums"
                                          inputMode="decimal"
                                          value={oblongsDuPoste(poste)[key]}
                                          onChange={(e) =>
                                            setOblongs((prev) => ({
                                              ...prev,
                                              [poste]: { ...(prev[poste] ?? OBLONGS_VIDES), [key]: e.target.value },
                                            }))
                                          }
                                        />
                                      </ChampSaisie>
                                    ))}
                                  </div>
                                  <span className="text-xs text-muted-foreground">
                                    {baremeOblongs
                                      ? `Barème atelier (DATA-TEMPS), oxycoupage : ${formatHeures(baremeOblongs.avecPreforage)} h avec préforage au programme, ${formatHeures(baremeOblongs.sansPreforage)} h sans.`
                                      : "Renseignez le nombre de barres, puis le nombre et les dimensions des oblongs."}{" "}
                                    Temps indicatif, non ajouté à l'estimation.
                                  </span>
                                </>
                              )}
                            </div>
                          )}
                        </CardContent>
                      )}
                    </Card>
                    {poste === "soudage" && actif && (
                      <CalculateurSoudage
                        nbBarres={nbBarres > 0 ? nbBarres : 1}
                        onHeures={setSoudageCalcule}
                      />
                    )}
                  </div>
                )
              })}
            </div>

            <Card className="lg:sticky lg:top-4">
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">Estimation</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-1.5 text-sm">
                {(client.client || client.numero_11 || client.numero_offre) && (
                  <span className="pb-1 font-medium">
                    {[client.client, client.numero_11, client.numero_offre].filter(Boolean).join(" · ")}
                  </span>
                )}
                {!resultat && (
                  <span className="text-muted-foreground">
                    {type
                      ? "Renseignez la poutre et les modules puis cliquez sur « Chiffrer »."
                      : "Choisissez un type d'affaire dans la section « Poutre »."}
                  </span>
                )}
                {resultat && heuresParPoste.length === 0 && (
                  <span className="text-muted-foreground">
                    Aucune heure estimée avec ces variables.
                  </span>
                )}
                {heuresParPoste.map(([poste, heures]) => (
                  <div key={poste} className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      {libellePoste(poste)}
                      {poste === "soudage" && soudageCalcule !== null && " (calculateur)"}
                    </span>
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
                    <span className="tabular-nums">
                      {formatHeures((resultat.total ?? 0) * MAJORATION_DBS)} h
                    </span>
                  </div>
                )}
                {resultat && classeTolerance2 && (
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Tolérance classe 2 (×1,25)</span>
                    <span className="tabular-nums">
                      {formatHeures((resultat.total ?? 0) * MAJORATION_TOLERANCE)} h
                    </span>
                  </div>
                )}
                {resultat && (dbs || classeTolerance2) && (
                  <div className="flex items-center justify-between border-t pt-1.5 font-medium">
                    <span>Sous-total</span>
                    <span className="tabular-nums">{formatHeures(sousTotal)} h</span>
                  </div>
                )}
                <div className="mt-2 flex items-center justify-between gap-2 border-t pt-1.5">
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
                      {formatHeures(sousTotal * multiplicateurNombre)} €
                    </span>
                  </div>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <Button onClick={chiffrer} disabled={calcul || !type}>
                    {calcul ? "Calcul…" : "Chiffrer"}
                  </Button>
                  <Button variant="ghost" onClick={reinitialiser} disabled={calcul}>
                    Réinitialiser
                  </Button>
                  {/* Export PDF du chiffrage : à brancher. */}
                  <Button variant="outline">PDF</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
