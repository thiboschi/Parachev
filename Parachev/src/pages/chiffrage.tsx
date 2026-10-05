import { useCallback, useEffect, useMemo, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { IconChevronDown } from "@tabler/icons-react"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MultiSelect } from "@/components/affaires/multi-select"
import {
  CadencesSoudage,
  CalculateurSoudage,
  useParametresSoudage,
} from "@/components/chiffrage/calculateur-soudage"
import { LIBELLES_ZONE_GOUJONS, type ZoneGoujons } from "@/hooks/use-affaire-db"
import { useRechercheAffaires } from "@/hooks/use-recherche-affaires"
import { TYPES_PRODUCTION, type TypeProduction } from "@/lib/flux-production"
import { heuresForageManuel, heuresForageNumerique, heuresOblongs } from "@/lib/percage"
import { libellePoste } from "@/lib/postes"
import {
  CHAMPS_NORMES,
  familleProfil,
  optionsFiltres,
  type ChampNorme,
  type OptionFiltre,
  type OptionsFiltres,
} from "@/lib/recherche"
import { PREPARATIONS, nombrePasses, type LigneSoudure, type ParametresSoudure } from "@/lib/soudage"
import type { DonneesOffre, LigneInfo } from "@/components/chiffrage/offre-pdf"

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
// recherche (CHAMPS_NORMES), avec les valeurs de la liste déroulante du RDE
// et celles relevées dans les RDE déjà en base. Une seule valeur par champ,
// sauf les exigences particulières (voir `exigences`).
type ChampExigence = "exigencesFabrication" | "exigencesAcier"
type ChampNormeUnique = Exclude<ChampNorme, ChampExigence>

const estExigence = (key: ChampNorme): key is ChampExigence =>
  key === "exigencesFabrication" || key === "exigencesAcier"

const NORMES_VIDES: Record<ChampNormeUnique, string> = {
  en10163: "",
  tolerance: "",
  exc: "",
  prep: "",
  classeUs: "",
  en10204: "",
}

const EXIGENCES_VIDES: Record<ChampExigence, string[]> = {
  exigencesFabrication: [],
  exigencesAcier: [],
}

// Majorations du temps total déduites des normes choisies (cumulatives).
// DBS compte qu'il soit demandé en fabrication ou sur l'acier.
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
  | "nb_retournements_goujons"
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
  nb_retournements_goujons: "Retournements par barre",
  nb_trous_manuel: "Trous perçage manuel par barre",
  diametre_moyen_manuel: "Diamètre moyen manuel (mm)",
  nb_trous_numerique: "Trous perçage numérique par barre",
  diametre_moyen_numerique: "Diamètre moyen numérique (mm)",
  longueur_coupe: "Longueur de coupe par barre (mm)",
}

// Quantités saisies pour UNE barre : multipliées par le nombre de barres du
// groupe, puis sommées sur les groupes avant l'envoi à
// `chiffrer_manuellement`, qui attend les totaux du projet.
const CHAMPS_PAR_BARRE = new Set<Champ>([
  "poids_t",
  "metres",
  "nb_goujons",
  "nb_retournements_goujons",
  "nb_trous_manuel",
  "nb_trous_numerique",
  "longueur_coupe",
])

const CHAMPS_VIDES = Object.fromEntries(
  Object.keys(LIBELLES_CHAMPS).map((key) => [key, ""])
) as Record<Champ, string>

// Grandeurs de taille de la poutre, communes à tous les modules (GRANDEURS
// dans prevision.rs) : saisies une fois par groupe de barres dans la section
// "Poutre", pour une barre. Poids et longueur laissés vides sont estimés
// d'après le nombre de barres.
const CHAMPS_POUTRE: Champ[] = ["nb_barres", "poids_t", "metres"]

// Quantités propres à un poste, saisies dans son module de prédiction. Les
// postes absents n'ont que les grandeurs de la poutre (ou un forfait).
// Diamètre moyen -> nombre de trous qui le pondère dans la moyenne du projet.
const TROUS_DU_DIAMETRE: Partial<Record<Champ, Champ>> = {
  diametre_moyen_manuel: "nb_trous_manuel",
  diametre_moyen_numerique: "nb_trous_numerique",
}

const CHAMPS_MODULE: Record<string, Champ[]> = {
  presse_cintrage: ["nb_barres_cfl"],
  forage_numerique: ["nb_trous_numerique", "diametre_moyen_numerique"],
  forage_manuel: ["nb_trous_manuel", "diametre_moyen_manuel"],
  goujonnage: ["nb_goujons"],
  oxycoupage: ["longueur_coupe"],
}

// Zones d'une barre qui reçoivent des goujons, cochées dans le module
// "Goujonnage" (mêmes zones que FC-GOUJ) : chaque zone au-delà de la
// première impose un retournement de la barre (nb_retournements_goujons).
const ZONES_GOUJONS = Object.keys(LIBELLES_ZONE_GOUJONS) as ZoneGoujons[]

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

/** Barres identiques d'un projet : même profil, mêmes dimensions et mêmes
 *  opérations sur chaque barre. Un projet en compte un ou plusieurs. */
interface GroupeBarres {
  id: number
  // Le profil se choisit en deux temps : sa famille (HEB, HD, HL…), puis
  // le profil précis parmi ceux de cette famille.
  famille: string
  profil: string
  contreFleche: string
  valeurs: Record<Champ, string>
  zonesGoujons: Set<ZoneGoujons>
  // Option "Trous oblongs" de chaque module de POSTES_AVEC_OBLONGS : cochée
  // ou non, et ses dimensions (propres au poste).
  oblongsActifs: Set<string>
  oblongs: Record<string, Record<ChampOblong, string>>
}

const groupeVide = (id: number): GroupeBarres => ({
  id,
  famille: "",
  profil: "",
  contreFleche: "",
  valeurs: CHAMPS_VIDES,
  zonesGoujons: new Set(),
  oblongsActifs: new Set(),
  oblongs: {},
})

const barresGroupe = (groupe: GroupeBarres) => nombre(groupe.valeurs.nb_barres)

// Total d'un groupe pour un champ : la valeur par barre × son nombre de barres.
const totalGroupe = (groupe: GroupeBarres, key: Champ) =>
  nombre(groupe.valeurs[key]) * (CHAMPS_PAR_BARRE.has(key) ? barresGroupe(groupe) : 1)

const retournementsParBarre = (groupe: GroupeBarres) => Math.max(groupe.zonesGoujons.size - 1, 0)

const oblongsDuPoste = (groupe: GroupeBarres, poste: string) => groupe.oblongs[poste] ?? OBLONGS_VIDES

// Le module a-t-il une saisie propre à chaque groupe de barres ?
const aSaisieParGroupe = (poste: string) =>
  (CHAMPS_MODULE[poste] ?? []).length > 0 ||
  POSTES_AVEC_OBLONGS.includes(poste) ||
  poste === "goujonnage" ||
  poste === "soudage"

const somme = (valeurs: number[]) => valeurs.reduce((total, valeur) => total + valeur, 0)

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
function basculer<T extends string>(ensemble: Set<T>, cle: T, coche: boolean): Set<T> {
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

// Calculateur de soudage d'un groupe de barres : ses heures et ses pièces
// remontent à la page avec l'identifiant du groupe.
function SoudageGroupe({
  id,
  nbBarres,
  parametres,
  onHeures,
  onLignes,
}: {
  id: number
  nbBarres: number
  parametres: ParametresSoudure
  onHeures: (id: number, heures: number | null) => void
  onLignes: (id: number, lignes: LigneSoudure[]) => void
}) {
  const noterHeures = useCallback((heures: number | null) => onHeures(id, heures), [id, onHeures])
  const noterLignes = useCallback((lignes: LigneSoudure[]) => onLignes(id, lignes), [id, onLignes])
  return (
    <CalculateurSoudage
      nbBarres={nbBarres}
      parametres={parametres}
      onHeures={noterHeures}
      onLignes={noterLignes}
    />
  )
}

export default function Chiffrage() {
  // Valeurs proposées dans les listes : celles des affaires déjà en base,
  // comme les filtres de la page Search.
  const { affaires } = useRechercheAffaires()
  const options: OptionsFiltres = useMemo(() => optionsFiltres(affaires), [affaires])

  const [client, setClient] = useState<Record<ChampClient, string>>(CLIENT_VIDE)
  const [normes, setNormes] = useState<Record<ChampNormeUnique, string>>(NORMES_VIDES)
  const [exigences, setExigences] = useState<Record<ChampExigence, string[]>>(EXIGENCES_VIDES)

  // Les valeurs du RDE restent proposées même sans affaire en base qui les
  // porte, à la suite de celles relevées dans les affaires.
  const optionsNormes = useMemo(
    () =>
      Object.fromEntries(
        CHAMPS_NORMES.map(({ key, valeurs }) => [
          key,
          [
            ...options[key],
            ...valeurs
              .filter((valeur) => !options[key].some((o) => o.valeur === valeur))
              .map((valeur) => ({ valeur, libelle: valeur, nombre: 0 })),
          ],
        ])
      ) as Record<ChampNorme, OptionFiltre[]>,
    [options]
  )

  const [typeNom, setTypeNom] = useState("")
  // Un projet = un ou plusieurs groupes de barres, qui passent tous par les
  // modules du type choisi.
  const [groupes, setGroupes] = useState<GroupeBarres[]>([groupeVide(0)])
  const plusieursGroupes = groupes.length > 1
  const optionsFamilles = useMemo(
    () => [...options.familles].sort((a, b) => a.libelle.localeCompare(b.libelle)),
    [options.familles]
  )
  const optionsProfils = useMemo(
    () => [...options.profils].sort((a, b) => a.libelle.localeCompare(b.libelle, "fr", { numeric: true })),
    [options.profils]
  )
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
  // Heures de soudage des calculateurs du module "Soudage" (un par groupe de
  // barres) : la somme des groupes dont le calculateur est complet, null si
  // aucun ne l'est. Elles remplacent celles de la calibration dans l'estimation.
  const [parametresSoudage, setParametresSoudage] = useParametresSoudage()
  const [soudageParGroupe, setSoudageParGroupe] = useState<Record<number, number | null>>({})
  const noterSoudage = useCallback(
    (id: number, heures: number | null) => setSoudageParGroupe((prev) => ({ ...prev, [id]: heures })),
    []
  )
  const soudageCalcule = useMemo(() => {
    const heures = groupes.map((g) => soudageParGroupe[g.id]).filter((h): h is number => h != null)
    return heures.length > 0 ? somme(heures) : null
  }, [groupes, soudageParGroupe])
  // Pièces saisies dans les calculateurs, reprises dans le PDF de l'offre.
  const [lignesSoudure, setLignesSoudure] = useState<Record<number, LigneSoudure[]>>({})
  const noterLignesSoudure = useCallback(
    (id: number, lignes: LigneSoudure[]) => setLignesSoudure((prev) => ({ ...prev, [id]: lignes })),
    []
  )
  const [exportPdf, setExportPdf] = useState(false)
  const soudageActif = postes.has("soudage")
  const resultat = useMemo(() => {
    if (!resultatBrut || !soudageActif || soudageCalcule === null) return resultatBrut
    const total = (resultatBrut.total ?? 0) - (resultatBrut.soudage ?? 0) + soudageCalcule
    return { ...resultatBrut, soudage: soudageCalcule, total }
  }, [resultatBrut, soudageActif, soudageCalcule])
  const [calcul, setCalcul] = useState(false)
  const [multiplicateur, setMultiplicateur] = useState("")

  function modifierGroupe(id: number, modification: (groupe: GroupeBarres) => Partial<GroupeBarres>) {
    setGroupes((prev) => prev.map((g) => (g.id === id ? { ...g, ...modification(g) } : g)))
  }

  function modifier(id: number, champ: Champ, valeur: string) {
    modifierGroupe(id, (g) => ({ valeurs: { ...g.valeurs, [champ]: valeur } }))
  }

  function ajouterGroupe() {
    setGroupes((prev) => [...prev, groupeVide(Math.max(...prev.map((g) => g.id)) + 1)])
  }

  // Nom d'un groupe dans la page et dans l'offre ; vide s'il est seul.
  const prefixeGroupe = (index: number) => (plusieursGroupes ? `Groupe ${index + 1} — ` : "")

  function choisirType(nom: string) {
    setTypeNom(nom)
    const choisi = TYPES_PRODUCTION.find((t) => t.nom === nom)
    setPostes(choisi ? postesParDefaut(modulesDuType(choisi)) : new Set())
    setResultat(null)
  }

  function reinitialiser() {
    setClient(CLIENT_VIDE)
    setNormes(NORMES_VIDES)
    setExigences(EXIGENCES_VIDES)
    setTypeNom("")
    setGroupes([groupeVide(0)])
    setPostes(new Set())
    setResultat(null)
  }

  // Total du projet pour un champ : la somme de ses groupes, ou pour un
  // diamètre moyen la moyenne des groupes pondérée par leurs trous (moyenne
  // simple des diamètres saisis tant qu'aucun trou ne l'est).
  function totalProjet(key: Champ) {
    const trous = TROUS_DU_DIAMETRE[key]
    if (!trous) return somme(groupes.map((g) => totalGroupe(g, key)))
    const nbTrous = somme(groupes.map((g) => totalGroupe(g, trous)))
    if (nbTrous > 0) {
      return somme(groupes.map((g) => nombre(g.valeurs[key]) * totalGroupe(g, trous))) / nbTrous
    }
    const saisis = groupes.map((g) => nombre(g.valeurs[key])).filter((diametre) => diametre > 0)
    return saisis.length > 0 ? somme(saisis) / saisis.length : 0
  }
  // Rappel du total du groupe sous un champ saisi par barre.
  const aideTotal = (groupe: GroupeBarres, key: Champ) => {
    const total = totalGroupe(groupe, key)
    return CHAMPS_PAR_BARRE.has(key) && barresGroupe(groupe) > 0 && total > 0
      ? `total : ${formatHeures(total)}`
      : undefined
  }

  function chiffrer() {
    // Seules les quantités de la poutre et des modules cochés comptent.
    const champs = [...CHAMPS_POUTRE, ...[...postes].flatMap((poste) => CHAMPS_MODULE[poste] ?? [])]
    for (const [index, groupe] of groupes.entries()) {
      const champInvalide = champs.find((key) => Number.isNaN(nombre(groupe.valeurs[key])))
      if (champInvalide) {
        toast.error(`${prefixeGroupe(index)}Valeur invalide pour "${LIBELLES_CHAMPS[champInvalide]}"`)
        return
      }
      if (!(barresGroupe(groupe) > 0)) {
        toast.error(
          `${prefixeGroupe(index)}Renseignez le nombre de barres : les quantités sont saisies par barre`
        )
        return
      }
    }

    const variables = Object.fromEntries(
      (Object.keys(LIBELLES_CHAMPS) as Champ[]).map((key) => [
        key,
        champs.includes(key) ? totalProjet(key) : 0,
      ])
    )
    if (postes.has("goujonnage")) {
      variables.nb_retournements_goujons = somme(
        groupes.map((g) => retournementsParBarre(g) * barresGroupe(g))
      )
    }
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

  // Temps barème des modules de perçage (voir lib/percage.ts), sommé sur les
  // groupes qui ont des trous et affiché pour comparaison : l'estimation
  // reste celle de la calibration.
  const groupesAvec = (key: Champ) => groupes.filter((g) => totalGroupe(g, key) > 0)
  // Signale un barème qui ne couvre qu'une partie des groupes concernés.
  const couverture = (couverts: number, concernes: number) =>
    couverts < concernes ? ` (${couverts} groupe${couverts > 1 ? "s" : ""} sur ${concernes} au barème)` : ""
  const baremePercage: Record<string, string | undefined> = {
    forage_manuel: (() => {
      const concernes = groupesAvec("nb_trous_manuel")
      const heures = concernes
        .map((g) => heuresForageManuel(totalGroupe(g, "nb_trous_manuel"), nombre(g.valeurs.diametre_moyen_manuel)))
        .filter((h) => h !== null)
      return heures.length === 0
        ? undefined
        : `Barème atelier (FMAN) : ${formatHeures(somme(heures))} h${couverture(heures.length, concernes.length)}.`
    })(),
    forage_numerique: (() => {
      const concernes = groupesAvec("nb_trous_numerique")
      const heures = concernes
        .map((g) =>
          heuresForageNumerique(
            totalGroupe(g, "nb_trous_numerique"),
            nombre(g.valeurs.diametre_moyen_numerique),
            g.profil
          )
        )
        .filter((h) => h !== null)
      return heures.length === 0
        ? undefined
        : `Barème atelier (FWAG) : ${formatHeures(somme(heures.map((h) => h.ame)))} h dans l'âme, ${formatHeures(somme(heures.map((h) => h.aile)))} h dans les ailes${couverture(heures.length, concernes.length)}.`
    })(),
  }

  const heuresOblongsBareme = (groupe: GroupeBarres, poste: string) => {
    const saisie = oblongsDuPoste(groupe, poste)
    return heuresOblongs(
      nombre(saisie.nombre) * barresGroupe(groupe),
      nombre(saisie.longueur),
      nombre(saisie.largeur)
    )
  }

  // Dans l'ordre de la gamme.
  const heuresParPoste = resultat
    ? modules
        .filter(({ poste }) => postes.has(poste) && (resultat[poste] ?? 0) > 0)
        .map(({ poste }) => [poste, resultat[poste]] as const)
    : []

  const dbs = Object.values(exigences).some((valeurs) => valeurs.includes(EXIGENCE_MAJOREE))
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

  // Tout ce qui est saisi et chiffré sur la page, pour le PDF de l'offre.
  function donneesOffre(total: number): DonneesOffre {
    const renseignees = (lignes: LigneInfo[]) => lignes.filter(({ valeur }) => valeur.trim() !== "")
    const avecTotal = (groupe: GroupeBarres, key: Champ) => {
      const aide = aideTotal(groupe, key)
      return aide ? `${groupe.valeurs[key]} (${aide})` : groupe.valeurs[key]
    }
    const detailsGroupe = (groupe: GroupeBarres, poste: string) => {
      const details = (CHAMPS_MODULE[poste] ?? [])
        .filter((key) => groupe.valeurs[key].trim() !== "")
        .map((key) => `${LIBELLES_CHAMPS[key]} : ${avecTotal(groupe, key)}`)
      if (poste === "presse_cintrage" && groupe.contreFleche.trim() !== "") {
        details.push(`CFL : ${groupe.contreFleche}`)
      }
      if (poste === "goujonnage" && groupe.zonesGoujons.size > 0) {
        const zones = ZONES_GOUJONS.filter((zone) => groupe.zonesGoujons.has(zone)).map((zone) => LIBELLES_ZONE_GOUJONS[zone])
        const retournements = retournementsParBarre(groupe)
        details.push(`Zones goujonnées : ${zones.join(", ")} (${retournements} retournement${retournements > 1 ? "s" : ""} par barre)`)
      }
      if (groupe.oblongsActifs.has(poste)) {
        const { nombre: nb, longueur, largeur } = oblongsDuPoste(groupe, poste)
        details.push(`Trous oblongs : ${nb || "—"} par barre, ${longueur || "—"} × ${largeur || "—"} mm`)
      }
      return details
    }
    const detailsModule = (poste: string) =>
      groupes.flatMap((groupe, index) =>
        detailsGroupe(groupe, poste).map((detail) => `${prefixeGroupe(index)}${detail}`)
      )
    return {
      date: new Date(),
      client: client.client.trim(),
      numeroOffre: client.numero_offre.trim(),
      numeroCommande: client.numero_11.trim(),
      numeroLaminage: client.numero_19.trim(),
      poutre: renseignees([
        { label: "Type d'affaire", valeur: typeNom },
        ...groupes.flatMap((groupe, index) => [
          { label: `${prefixeGroupe(index)}Famille de profil`, valeur: groupe.famille },
          { label: `${prefixeGroupe(index)}Profil`, valeur: groupe.profil },
          ...CHAMPS_POUTRE.map((key) => ({
            label: `${prefixeGroupe(index)}${LIBELLES_CHAMPS[key]}`,
            valeur: avecTotal(groupe, key),
          })),
        ]),
      ]),
      normes: renseignees(
        CHAMPS_NORMES.map(({ key, label }) => ({
          label,
          valeur: estExigence(key) ? exigences[key].join(", ") : normes[key],
        }))
      ),
      operations: modules
        .filter(({ poste }) => postes.has(poste))
        .map(({ poste }) => ({
          libelle: libellePoste(poste),
          details: detailsModule(poste),
          heures: resultat?.[poste] ?? 0,
        })),
      soudures: groupes.flatMap((groupe, index) =>
        (lignesSoudure[groupe.id] ?? []).map((ligne) => ({
          designation: `${prefixeGroupe(index)}${ligne.designation}`,
          nombre: ligne.nombre,
          longueur: ligne.longueur,
          preparation: PREPARATIONS.find((p) => p.key === ligne.preparation)?.label ?? ligne.preparation,
          passes: nombrePasses(ligne)?.toString() ?? "—",
        }))
      ),
      totalHeures: total,
      majorations: [
        ...(dbs ? [{ label: "DBS (×1,20)", heures: total * MAJORATION_DBS }] : []),
        ...(classeTolerance2
          ? [{ label: "Tolérance classe 2 (×1,25)", heures: total * MAJORATION_TOLERANCE }]
          : []),
      ],
      sousTotalHeures: sousTotal,
      tauxHoraire: multiplicateurValide ? multiplicateurNombre : null,
      montant: multiplicateurValide ? sousTotal * multiplicateurNombre : null,
    }
  }

  async function exporterPdf() {
    if (!resultat) {
      toast.error("Cliquez sur « Chiffrer » avant d'exporter l'offre")
      return
    }
    const offre = donneesOffre(resultat.total ?? 0)
    const nom = `Offre ${offre.numeroOffre || offre.client || "chiffrage"}`.replace(/[\\/:*?"<>|]/g, "-")
    setExportPdf(true)
    try {
      // @react-pdf/renderer n'est chargé qu'au premier export.
      const { genererOffrePdf } = await import("@/components/chiffrage/offre-pdf")
      const contenu = await genererOffrePdf(offre)
      const chemin = await invoke<string | null>("enregistrer_pdf", {
        nom: `${nom}.pdf`,
        contenu: Array.from(contenu),
      })
      if (chemin) toast.success(`Offre enregistrée : ${chemin}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setExportPdf(false)
    }
  }

  // Saisie d'un groupe de barres pour un poste, affichée dans le volet du
  // poste dans la case du groupe (section "Poutre").
  function saisiePoste(groupe: GroupeBarres, poste: string) {
    const champs = CHAMPS_MODULE[poste] ?? []
    const avecOblongs = POSTES_AVEC_OBLONGS.includes(poste)
    const nbBarres = barresGroupe(groupe)
    const retournements = retournementsParBarre(groupe)
    const oblongsCoches = groupe.oblongsActifs.has(poste)
    const baremeOblongs = heuresOblongsBareme(groupe, poste)
    const id = `module-${poste}-${groupe.id}`
    return (
      <>
        {champs.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {champs.map((key) => (
              <ChampSaisie
                key={key}
                id={`${id}-${key}`}
                label={LIBELLES_CHAMPS[key]}
                aide={aideTotal(groupe, key)}
              >
                <Input
                  id={`${id}-${key}`}
                  className="text-right tabular-nums"
                  inputMode="decimal"
                  value={groupe.valeurs[key]}
                  onChange={(e) => modifier(groupe.id, key, e.target.value)}
                />
              </ChampSaisie>
            ))}
            {poste === "presse_cintrage" && (
              <ChampSaisie id={`${id}-cfl`} label="CFL">
                <Input
                  id={`${id}-cfl`}
                  className="text-right tabular-nums"
                  inputMode="decimal"
                  value={groupe.contreFleche}
                  onChange={(e) =>
                    modifierGroupe(groupe.id, () => ({ contreFleche: e.target.value }))
                  }
                />
              </ChampSaisie>
            )}
          </div>
        )}
        {poste === "goujonnage" && (
          <div className="flex flex-col gap-2">
            <span className="text-muted-foreground">Zones goujonnées</span>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {ZONES_GOUJONS.map((zone) => (
                <div key={zone} className="flex items-center gap-2">
                  <Checkbox
                    id={`${id}-zone-${zone}`}
                    checked={groupe.zonesGoujons.has(zone)}
                    onCheckedChange={(coche) =>
                      modifierGroupe(groupe.id, (g) => ({
                        zonesGoujons: basculer(g.zonesGoujons, zone, coche === true),
                      }))
                    }
                  />
                  <Label htmlFor={`${id}-zone-${zone}`} className="text-sm font-normal">
                    {LIBELLES_ZONE_GOUJONS[zone]}
                  </Label>
                </div>
              ))}
            </div>
            {groupe.zonesGoujons.size > 0 && (
              <span className="text-xs text-muted-foreground">
                {retournements} retournement{retournements > 1 ? "s" : ""} par barre
                {nbBarres > 0 && retournements > 0
                  ? ` (total : ${formatHeures(retournements * nbBarres)})`
                  : ""}
              </span>
            )}
          </div>
        )}
        {avecOblongs && (
          <div className="flex flex-col gap-3 border-t pt-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${id}-oblongs`}
                checked={oblongsCoches}
                onCheckedChange={(coche) =>
                  modifierGroupe(groupe.id, (g) => ({
                    oblongsActifs: basculer(g.oblongsActifs, poste, coche === true),
                  }))
                }
              />
              <Label htmlFor={`${id}-oblongs`} className="text-sm font-normal">
                Trous oblongs
              </Label>
            </div>
            {oblongsCoches && (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {CHAMPS_OBLONGS.map(({ key, label }) => (
                    <ChampSaisie key={key} id={`${id}-oblongs-${key}`} label={label}>
                      <Input
                        id={`${id}-oblongs-${key}`}
                        className="text-right tabular-nums"
                        inputMode="decimal"
                        value={oblongsDuPoste(groupe, poste)[key]}
                        onChange={(e) =>
                          modifierGroupe(groupe.id, (g) => ({
                            oblongs: {
                              ...g.oblongs,
                              [poste]: { ...oblongsDuPoste(g, poste), [key]: e.target.value },
                            },
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
        {poste === "soudage" && (
          <SoudageGroupe
            id={groupe.id}
            nbBarres={nbBarres > 0 ? nbBarres : 1}
            parametres={parametresSoudage}
            onHeures={noterSoudage}
            onLignes={noterLignesSoudure}
          />
        )}
      </>
    )
  }

  // Modules cochés qui ont une saisie propre à chaque groupe de barres, dans
  // l'ordre de la gamme.
  const postesParGroupe = modules
    .map(({ poste }) => poste)
    .filter((poste) => postes.has(poste) && aSaisieParGroupe(poste))

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
                    {CHAMPS_NORMES.map(({ key, label }) =>
                      estExigence(key) ? (
                        <MultiSelect
                          key={key}
                          label={label}
                          vide="Aucune"
                          options={optionsNormes[key]}
                          valeurs={exigences[key]}
                          onChange={(valeurs) => setExigences((prev) => ({ ...prev, [key]: valeurs }))}
                        />
                      ) : (
                        <Liste
                          key={key}
                          label={label}
                          valeur={normes[key]}
                          options={optionsNormes[key]}
                          onChange={(valeur) => setNormes((prev) => ({ ...prev, [key]: valeur }))}
                        />
                      )
                    )}
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
                  </Section>
                  {groupes.map((groupe, index) => (
                    <div key={groupe.id} className="flex flex-col gap-3 rounded-md border p-3">
                      <div className="flex min-h-7 items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                          {[`Groupe ${index + 1}`, groupe.profil].filter(Boolean).join(" · ")}
                        </span>
                        {plusieursGroupes && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setGroupes((prev) => prev.filter((g) => g.id !== groupe.id))}
                          >
                            Retirer
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Liste
                          label="Famille de profil"
                          valeur={groupe.famille}
                          options={optionsFamilles}
                          onChange={(famille) => modifierGroupe(groupe.id, () => ({ famille, profil: "" }))}
                        />
                        <Liste
                          label="Profil"
                          vide={groupe.famille ? "Non renseigné" : "Choisir une famille…"}
                          valeur={groupe.profil}
                          options={optionsProfils.filter((o) => familleProfil(o.valeur) === groupe.famille)}
                          desactive={!groupe.famille}
                          onChange={(profil) => modifierGroupe(groupe.id, () => ({ profil }))}
                        />
                        {type &&
                          CHAMPS_POUTRE.map((key) => (
                            <ChampSaisie
                              key={key}
                              id={`poutre-${groupe.id}-${key}`}
                              label={LIBELLES_CHAMPS[key]}
                              aide={aideTotal(groupe, key)}
                            >
                              <Input
                                id={`poutre-${groupe.id}-${key}`}
                                className="text-right tabular-nums"
                                inputMode="decimal"
                                value={groupe.valeurs[key]}
                                onChange={(e) => modifier(groupe.id, key, e.target.value)}
                              />
                            </ChampSaisie>
                          ))}
                      </div>
                      {postesParGroupe.map((poste) => (
                        // Volet déroulant du poste. Replié, son contenu reste monté : le
                        // calculateur de soudage garde ses pièces et ses heures.
                        <Collapsible key={poste} className="rounded-md border">
                          <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm [&[data-panel-open]>svg]:rotate-180">
                            <span className="font-medium">{libellePoste(poste)}</span>
                            <IconChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform" />
                          </CollapsibleTrigger>
                          <CollapsiblePanel keepMounted>
                            <div className="flex flex-col gap-3 px-3 pb-3 text-sm">
                              {saisiePoste(groupe, poste)}
                            </div>
                          </CollapsiblePanel>
                        </Collapsible>
                      ))}
                    </div>
                  ))}
                  <div>
                    <Button variant="outline" size="sm" onClick={ajouterGroupe}>
                      Ajouter un groupe de barres
                    </Button>
                  </div>
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
                return (
                  <Card key={poste}>
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
                        <span className="text-xs text-muted-foreground">
                          {poste === "soudage"
                            ? plusieursGroupes
                              ? "Chiffré par les calculateurs du volet « Soudage » de chaque groupe : seuls les groupes dont le calculateur est complet sont comptés ; si aucun ne l'est, par la calibration."
                              : "Chiffré par le calculateur du volet « Soudage » du groupe ; tant qu'il est incomplet, par la calibration."
                            : grandeurs.length > 0
                              ? `Calculé d'après : ${grandeurs
                                  .map((g) => LIBELLES_CHAMPS[g as Champ] ?? g)
                                  .join(", ")
                                  .toLowerCase()}.`
                              : champs.length > 0
                                ? "Calculé d'après les quantités saisies dans le volet du poste de chaque groupe."
                                : "Chiffré au forfait."}
                        </span>
                        {baremePercage[poste] && (
                          <span className="text-xs text-muted-foreground">{baremePercage[poste]}</span>
                        )}
                        {poste === "soudage" && (
                          <CadencesSoudage parametres={parametresSoudage} onChange={setParametresSoudage} />
                        )}
                      </CardContent>
                    )}
                  </Card>
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
                  <Button variant="outline" onClick={exporterPdf} disabled={calcul || exportPdf || !resultat}>
                    {exportPdf ? "PDF…" : "PDF"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
