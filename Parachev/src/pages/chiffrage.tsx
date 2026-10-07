import { useCallback, useMemo, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { IconChevronDown } from "@tabler/icons-react"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MultiSelect } from "@/components/affaires/multi-select"
import { Combobox, ComboboxContent, ComboboxItem, ComboboxList, ComboboxSelectTrigger, ComboboxValue } from "@/components/ui/combobox"
import { CadencesSoudage, CalculateurSoudage, useParametresSoudage } from "@/components/chiffrage/calculateur-soudage"
import { LIBELLES_ZONE_GOUJONS, type ZoneGoujons } from "@/hooks/use-affaire-db"
import { useRechercheAffaires } from "@/hooks/use-recherche-affaires"
import { TYPES_PRODUCTION, type TypeProduction } from "@/lib/flux-production"
import { heuresForageManuel, heuresForageNumerique, heuresOblongs } from "@/lib/percage"
import { libellePoste } from "@/lib/postes"
import { heuresContreFleche } from "@/lib/presse"
import { CHAMPS_NORMES, libelleOperationRde, optionsFiltres, type ChampNorme, type OptionFiltre, type OptionsFiltres } from "@/lib/recherche"
import { PROFILS_CATALOGUE, familleProfil, profilCorrespond } from "@/lib/profils"
import { heuresSciage } from "@/lib/sciage"
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
  metres: "Longueur par barre (mm)",
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

// Quantités propres à un poste, saisies dans son volet de chaque groupe. Les
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

// Champ -> poste dont il est une quantité.
const POSTE_DU_CHAMP = Object.fromEntries(
  Object.entries(CHAMPS_MODULE).flatMap(([poste, champs]) => champs.map((champ) => [champ, poste]))
) as Partial<Record<Champ, string>>

// Zones d'une barre qui reçoivent des goujons, cochées dans le volet
// "Goujonnage" (mêmes zones que FC-GOUJ) : chaque zone au-delà de la
// première impose un retournement de la barre (nb_retournements_goujons).
const ZONES_GOUJONS = Object.keys(LIBELLES_ZONE_GOUJONS) as ZoneGoujons[]

// Trous oblongs d'une barre, en option des postes qui peuvent les réaliser :
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

// Coupes d'une barre à la mise à longueur, par case du RDE (clés de
// OPERATIONS_RDE) : "Coupe" est cochée dès qu'une coupe droite ou biaise est
// saisie. Leur nombre chiffre le poste au barème de sciage (voir
// heuresSciage), à la place de la calibration.
const POSTE_COUPES = "mise_a_longueur"
const COUPE_RDE = "coupe"
const TYPES_COUPE = ["coupe_droite", "coupe_biaise"] as const
type TypeCoupe = (typeof TYPES_COUPE)[number]

const COUPES_VIDES: Record<TypeCoupe, string> = { coupe_droite: "", coupe_biaise: "" }

const libelleCoupe = (type: TypeCoupe) => `${libelleOperationRde(type)} par barre`

// Poste dont la contre-flèche saisie (`contreFleche` du groupe) donne les
// heures au barème de la presse (voir heuresContreFleche), à la place de la
// calibration.
const POSTE_CONTRE_FLECHE = "presse_cintrage"
const LIBELLE_CONTRE_FLECHE = "CFL (mm)"

/** Barres identiques d'un projet : même profil, mêmes dimensions et mêmes
 *  opérations sur chaque barre. Un projet en compte un ou plusieurs. */
interface GroupeBarres {
  id: number
  // Le profil se choisit en deux temps : sa famille (HEB, HD, HL…), puis
  // le profil précis parmi ceux de cette famille.
  famille: string
  profil: string
  // Contre-flèche de chaque barre qui en a une, en mm.
  contreFleche: string
  valeurs: Record<Champ, string>
  zonesGoujons: Set<ZoneGoujons>
  // Option "Trous oblongs" de chaque poste de POSTES_AVEC_OBLONGS : cochée
  // ou non, et ses dimensions (propres au poste).
  oblongsActifs: Set<string>
  oblongs: Record<string, Record<ChampOblong, string>>
  coupes: Record<TypeCoupe, string>
  // Postes optionnels de la gamme (voir ModulePoste) cochés pour ce groupe.
  postesOptionnels: Set<string>
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
  coupes: COUPES_VIDES,
  postesOptionnels: new Set(),
})

const barresGroupe = (groupe: GroupeBarres) => nombre(groupe.valeurs.nb_barres)

// Longueur d'une barre en m : saisie en mm, mais `chiffrer_manuellement` et
// les barèmes atelier l'attendent en m.
const longueurGroupe = (groupe: GroupeBarres) => nombre(groupe.valeurs.metres) / 1000

// Total d'un groupe pour un champ : la valeur par barre × son nombre de barres
// (en m pour la longueur).
const totalGroupe = (groupe: GroupeBarres, key: Champ) =>
  (key === "metres" ? longueurGroupe(groupe) : nombre(groupe.valeurs[key])) *
  (CHAMPS_PAR_BARRE.has(key) ? barresGroupe(groupe) : 1)

const retournementsParBarre = (groupe: GroupeBarres) => Math.max(groupe.zonesGoujons.size - 1, 0)

const oblongsDuPoste = (groupe: GroupeBarres, poste: string) => groupe.oblongs[poste] ?? OBLONGS_VIDES

const coupesParBarre = (groupe: GroupeBarres) => somme(TYPES_COUPE.map((type) => nombre(groupe.coupes[type])))

// Heures barème de sciage du groupe d'après ses coupes ; null hors barème.
const heuresSciageGroupe = (groupe: GroupeBarres) =>
  heuresSciage({
    profil: groupe.profil,
    nbBarres: barresGroupe(groupe),
    longueur: longueurGroupe(groupe),
    coupesDroites: nombre(groupe.coupes.coupe_droite),
    coupesBiaises: nombre(groupe.coupes.coupe_biaise),
  })

// Barres du groupe mises en contre-flèche : celles du champ "Barres avec
// contre-flèche", ou toutes s'il est laissé vide.
const barresContreFleche = (groupe: GroupeBarres) => {
  const saisies = nombre(groupe.valeurs.nb_barres_cfl)
  return saisies > 0 ? saisies : barresGroupe(groupe)
}

// Heures barème de contre-flèche du groupe ; null hors barème.
const heuresContreFlecheGroupe = (groupe: GroupeBarres) =>
  heuresContreFleche({
    profil: groupe.profil,
    nbBarres: barresContreFleche(groupe),
    longueur: longueurGroupe(groupe),
    contreFleche: nombre(groupe.contreFleche),
  })

// Le poste a-t-il une saisie propre à chaque groupe de barres ?
const aSaisieParGroupe = (poste: string) =>
  (CHAMPS_MODULE[poste] ?? []).length > 0 ||
  POSTES_AVEC_OBLONGS.includes(poste) ||
  poste === POSTE_COUPES ||
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

/**
 * Liste déroulante à choix unique ; "" = non renseigné. `recherche` ajoute
 * un champ de recherche en tête de la liste (listes longues) : dit si une
 * valeur correspond au texte saisi.
 */
function Liste({
  label,
  valeur,
  options,
  vide = "Non renseigné",
  desactive = false,
  recherche,
  onChange,
}: {
  label: string
  valeur: string
  options: { valeur: string; libelle: string }[]
  vide?: string
  desactive?: boolean
  recherche?: (valeur: string, requete: string) => boolean
  onChange: (valeur: string) => void
}) {
  const items: Record<string, string> = {
    [NON_RENSEIGNE]: vide,
    ...Object.fromEntries(options.map((o) => [o.valeur, o.libelle])),
  }
  if (recherche) {
    return (
      <ChampSaisie label={label}>
        <Combobox
          items={Object.keys(items)}
          disabled={desactive}
          value={valeur === "" ? NON_RENSEIGNE : valeur}
          onValueChange={(v) => onChange(!v || v === NON_RENSEIGNE ? "" : v)}
          // "Non renseigné" ne reste proposé que tant que rien n'est saisi.
          filter={(v: string, requete) =>
            v === NON_RENSEIGNE ? requete.trim() === "" : recherche(v, requete)
          }
        >
          <ComboboxSelectTrigger className="w-full">
            <ComboboxValue>{(v: string | null) => items[v ?? NON_RENSEIGNE] ?? v}</ComboboxValue>
          </ComboboxSelectTrigger>
          <ComboboxContent>
            <ComboboxList>
              {(v: string) => (
                <ComboboxItem key={v} value={v}>
                  {items[v]}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </ChampSaisie>
    )
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
  // Un projet = un ou plusieurs groupes de barres, qui passent par les postes
  // de la gamme du type choisi.
  const [groupes, setGroupes] = useState<GroupeBarres[]>([groupeVide(0)])
  const plusieursGroupes = groupes.length > 1
  // Profils du barème atelier, complétés par ceux des affaires en base qui
  // n'y figurent pas (UB, UC, HL lourds…).
  const optionsProfils = useMemo(
    () =>
      [...new Set([...PROFILS_CATALOGUE, ...options.profils.map((o) => o.valeur)])]
        .sort((a, b) => a.localeCompare(b, "fr", { numeric: true }))
        .map((valeur) => ({ valeur, libelle: valeur })),
    [options.profils]
  )
  const optionsFamilles = useMemo(
    () =>
      [...new Set(optionsProfils.map((o) => familleProfil(o.valeur)))]
        .filter((famille) => famille !== null)
        .sort()
        .map((valeur) => ({ valeur, libelle: valeur })),
    [optionsProfils]
  )
  const type = TYPES_PRODUCTION.find((t) => t.nom === typeNom)
  const modules = useMemo(() => (type ? modulesDuType(type) : []), [type])
  const postesOptionnels = modules.filter((m) => m.optionnel).map((m) => m.poste)
  // Postes par lesquels passe un groupe, dans l'ordre de la gamme : un poste
  // optionnel seulement s'il y est coché.
  const postesDuGroupe = (groupe: GroupeBarres) =>
    modules.filter((m) => !m.optionnel || groupe.postesOptionnels.has(m.poste)).map((m) => m.poste)
  const passePar = (groupe: GroupeBarres, poste: string) => postesDuGroupe(groupe).includes(poste)
  // Postes chiffrés : ceux d'au moins un groupe, les autres le sont à 0 h.
  const postes = new Set(groupes.flatMap(postesDuGroupe))

  const [resultatBrut, setResultat] = useState<Record<string, number> | null>(null)
  // Heures de soudage des calculateurs du volet "Soudage" (un par groupe de
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
  // Heures de mise à longueur au barème de sciage, d'après les coupes saisies
  // dans le volet du poste de chaque groupe : la somme des groupes au barème,
  // null si aucun ne l'est. Comme celles du soudage, elles remplacent celles
  // de la calibration dans l'estimation.
  const groupesAvecCoupes = groupes.filter((g) => passePar(g, POSTE_COUPES) && coupesParBarre(g) > 0)
  const heuresSciageGroupes = groupesAvecCoupes.map(heuresSciageGroupe).filter((h) => h !== null)
  const sciageCalcule = heuresSciageGroupes.length > 0 ? somme(heuresSciageGroupes) : null
  const sciageActif = postes.has(POSTE_COUPES)
  // De même pour la presse, au barème de contre-flèche d'après la
  // contre-flèche saisie dans le volet du poste de chaque groupe.
  const groupesAvecContreFleche = groupes.filter(
    (g) => passePar(g, POSTE_CONTRE_FLECHE) && nombre(g.contreFleche) > 0
  )
  const heuresContreFlecheGroupes = groupesAvecContreFleche
    .map(heuresContreFlecheGroupe)
    .filter((h) => h !== null)
  const contreFlecheCalculee =
    heuresContreFlecheGroupes.length > 0 ? somme(heuresContreFlecheGroupes) : null
  const presseActive = postes.has(POSTE_CONTRE_FLECHE)
  const resultat = useMemo(() => {
    if (!resultatBrut) return resultatBrut
    const calculees: [poste: string, heures: number | null][] = [
      ["soudage", soudageActif ? soudageCalcule : null],
      [POSTE_COUPES, sciageActif ? sciageCalcule : null],
      [POSTE_CONTRE_FLECHE, presseActive ? contreFlecheCalculee : null],
    ]
    const suivant = { ...resultatBrut }
    for (const [poste, heures] of calculees) {
      if (heures === null) continue
      suivant.total = (suivant.total ?? 0) - (suivant[poste] ?? 0) + heures
      suivant[poste] = heures
    }
    return suivant
  }, [resultatBrut, soudageActif, soudageCalcule, sciageActif, sciageCalcule, presseActive, contreFlecheCalculee])
  // Heures au barème atelier des postes chiffrés ainsi.
  const heuresBareme: Record<string, number | null> = {
    [POSTE_COUPES]: sciageCalcule,
    [POSTE_CONTRE_FLECHE]: contreFlecheCalculee,
  }
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
    // Les postes optionnels sont ceux de la gamme du type : à recocher.
    setGroupes((prev) => prev.map((g) => ({ ...g, postesOptionnels: new Set() })))
    setResultat(null)
  }

  function reinitialiser() {
    setClient(CLIENT_VIDE)
    setNormes(NORMES_VIDES)
    setExigences(EXIGENCES_VIDES)
    setTypeNom("")
    setGroupes([groupeVide(0)])
    setResultat(null)
  }

  // Total du projet pour un champ : la somme de ses groupes, ou pour un
  // diamètre moyen la moyenne des groupes pondérée par leurs trous (moyenne
  // simple des diamètres saisis tant qu'aucun trou ne l'est). La quantité
  // d'un poste ne compte que pour les groupes qui y passent.
  function totalProjet(key: Champ) {
    const poste = POSTE_DU_CHAMP[key]
    const concernes = poste ? groupes.filter((g) => passePar(g, poste)) : groupes
    const trous = TROUS_DU_DIAMETRE[key]
    if (!trous) return somme(concernes.map((g) => totalGroupe(g, key)))
    const nbTrous = somme(concernes.map((g) => totalGroupe(g, trous)))
    if (nbTrous > 0) {
      return somme(concernes.map((g) => nombre(g.valeurs[key]) * totalGroupe(g, trous))) / nbTrous
    }
    const saisis = concernes.map((g) => nombre(g.valeurs[key])).filter((diametre) => diametre > 0)
    return saisis.length > 0 ? somme(saisis) / saisis.length : 0
  }
  // Rappel du total du groupe sous un nombre de coupes par barre.
  const aideCoupes = (groupe: GroupeBarres, type: TypeCoupe) => {
    const total = nombre(groupe.coupes[type]) * barresGroupe(groupe)
    return total > 0 ? `total : ${formatHeures(total)}` : undefined
  }
  // Rappel du total du groupe sous un champ saisi par barre.
  const aideTotal = (groupe: GroupeBarres, key: Champ) => {
    const total = totalGroupe(groupe, key)
    return CHAMPS_PAR_BARRE.has(key) && barresGroupe(groupe) > 0 && total > 0
      ? `total : ${formatHeures(total)}${key === "metres" ? " m" : ""}`
      : undefined
  }

  function chiffrer() {
    // Seules les quantités de la poutre et des postes du groupe comptent.
    const champsDes = (postesRetenus: string[]) => [
      ...CHAMPS_POUTRE,
      ...postesRetenus.flatMap((poste) => CHAMPS_MODULE[poste] ?? []),
    ]
    const champs = champsDes([...postes])
    for (const [index, groupe] of groupes.entries()) {
      const champInvalide = champsDes(postesDuGroupe(groupe)).find((key) =>
        Number.isNaN(nombre(groupe.valeurs[key]))
      )
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
      // Négatif ou illisible.
      const coupeInvalide =
        passePar(groupe, POSTE_COUPES) && TYPES_COUPE.find((type) => !(nombre(groupe.coupes[type]) >= 0))
      if (coupeInvalide) {
        toast.error(`${prefixeGroupe(index)}Valeur invalide pour "${libelleCoupe(coupeInvalide)}"`)
        return
      }
      if (passePar(groupe, POSTE_CONTRE_FLECHE) && !(nombre(groupe.contreFleche) >= 0)) {
        toast.error(`${prefixeGroupe(index)}Valeur invalide pour "${LIBELLE_CONTRE_FLECHE}"`)
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
        groupes
          .filter((g) => passePar(g, "goujonnage"))
          .map((g) => retournementsParBarre(g) * barresGroupe(g))
      )
    }
    const postesChiffres = Array.from(postes)
    // Cases "Coupe" du RDE que les coupes saisies reviennent à cocher.
    const coupesRde = TYPES_COUPE.filter((type) =>
      groupes.some((g) => passePar(g, POSTE_COUPES) && nombre(g.coupes[type]) > 0)
    )

    setCalcul(true)
    invoke<Record<string, number>>("chiffrer_manuellement", {
      variables,
      postes: postesChiffres,
      operationsRde: coupesRde.length > 0 ? [COUPE_RDE, ...coupesRde] : [],
    })
      .then((heures) => {
        // Ne garde que les postes des groupes : sans présence calibrée, un poste
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
      if (poste === POSTE_CONTRE_FLECHE && groupe.contreFleche.trim() !== "") {
        details.push(`${LIBELLE_CONTRE_FLECHE} : ${groupe.contreFleche}`)
      }
      if (poste === POSTE_COUPES) {
        details.push(
          ...TYPES_COUPE.filter((type) => nombre(groupe.coupes[type]) > 0).map((type) => {
            const aide = aideCoupes(groupe, type)
            return `${libelleCoupe(type)} : ${groupe.coupes[type]}${aide ? ` (${aide})` : ""}`
          })
        )
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
        (passePar(groupe, poste) ? detailsGroupe(groupe, poste) : []).map(
          (detail) => `${prefixeGroupe(index)}${detail}`
        )
      )
    return {
      date: new Date(),
      client: client.client.trim(),
      numeroOffre: client.numero_offre.trim(),
      numeroCommande: client.numero_11.trim(),
      numeroLaminage: client.numero_19.trim(),
      typeAffaire: typeNom,
      barres: groupes.map((groupe) => ({
        nombre: groupe.valeurs.nb_barres.trim(),
        profil: groupe.profil.trim(),
        longueur: nombre(groupe.valeurs.metres) > 0 ? nombre(groupe.valeurs.metres) : null,
        poids: groupe.valeurs.poids_t.trim(),
        operations: postesDuGroupe(groupe).flatMap((poste) => detailsGroupe(groupe, poste)),
      })),
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
    const coupes = coupesParBarre(groupe)
    const baremeSciage = heuresSciageGroupe(groupe)
    const baremeContreFleche = heuresContreFlecheGroupe(groupe)
    // Temps barème de perçage (voir lib/percage.ts), affiché pour
    // comparaison : l'estimation reste celle de la calibration.
    const baremeManuel =
      poste === "forage_manuel"
        ? heuresForageManuel(totalGroupe(groupe, "nb_trous_manuel"), nombre(groupe.valeurs.diametre_moyen_manuel))
        : null
    const baremeNumerique =
      poste === "forage_numerique"
        ? heuresForageNumerique(
            totalGroupe(groupe, "nb_trous_numerique"),
            nombre(groupe.valeurs.diametre_moyen_numerique),
            groupe.profil
          )
        : null
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
            {poste === POSTE_CONTRE_FLECHE && (
              <ChampSaisie id={`${id}-cfl`} label={LIBELLE_CONTRE_FLECHE}>
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
        {baremeManuel !== null && (
          <span className="text-xs text-muted-foreground">
            Barème atelier (FMAN) : {formatHeures(baremeManuel)} h.
          </span>
        )}
        {baremeNumerique !== null && (
          <span className="text-xs text-muted-foreground">
            Barème atelier (FWAG) : {formatHeures(baremeNumerique.ame)} h dans l'âme,{" "}
            {formatHeures(baremeNumerique.aile)} h dans les ailes.
          </span>
        )}
        {poste === POSTE_CONTRE_FLECHE && (
          <span className="text-xs text-muted-foreground">
            {!(nombre(groupe.contreFleche) > 0)
              ? contreFlecheCalculee !== null
                ? "Sans contre-flèche saisie, ce groupe n'est pas compté à la presse."
                : "Sans contre-flèche saisie, le poste est chiffré par la calibration."
              : baremeContreFleche !== null
                ? `Barème atelier (PRESSE), contre-flèche : ${formatHeures(baremeContreFleche)} h pour ${formatHeures(barresContreFleche(groupe))} barre${barresContreFleche(groupe) > 1 ? "s" : ""}, redressage non compris.`
                : "Hors barème : renseignez le nombre de barres, la longueur par barre et le profil (jusqu'à 1100 mm de haut, contre-flèche de 900 mm au plus)."}
          </span>
        )}
        {poste === POSTE_COUPES && (
          <div className="flex flex-col gap-2">
            <span className="text-muted-foreground">{libelleOperationRde(COUPE_RDE)} (RDE)</span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {TYPES_COUPE.map((type) => (
                <ChampSaisie
                  key={type}
                  id={`${id}-${type}`}
                  label={libelleCoupe(type)}
                  aide={aideCoupes(groupe, type)}
                >
                  <Input
                    id={`${id}-${type}`}
                    className="text-right tabular-nums"
                    inputMode="decimal"
                    value={groupe.coupes[type]}
                    onChange={(e) =>
                      modifierGroupe(groupe.id, (g) => ({
                        coupes: { ...g.coupes, [type]: e.target.value },
                      }))
                    }
                  />
                </ChampSaisie>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">
              {!(coupes > 0)
                ? sciageCalcule !== null
                  ? "Sans coupe saisie, ce groupe n'est pas compté dans la scie."
                  : "Sans coupe saisie, le poste est chiffré par la calibration."
                : baremeSciage !== null
                  ? `Barème atelier (DATA-TEMPS), sciage : ${formatHeures(baremeSciage)} h pour ${formatHeures(coupes)} coupe${coupes > 1 ? "s" : ""} par barre.`
                  : "Hors barème : renseignez le nombre de barres et un profil du barème atelier (coupe biaise au robot sur les HL 1000, HL 1100 et HD 400 x 1086)."}
            </span>
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
          <>
            <SoudageGroupe
              id={groupe.id}
              nbBarres={nbBarres > 0 ? nbBarres : 1}
              parametres={parametresSoudage}
              onHeures={noterSoudage}
              onLignes={noterLignesSoudure}
            />
            <CadencesSoudage parametres={parametresSoudage} onChange={setParametresSoudage} />
          </>
        )}
      </>
    )
  }

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
                          recherche={profilCorrespond}
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
                      {postesOptionnels.length > 0 && (
                        <div className="flex flex-col gap-2 text-sm">
                          <span className="text-muted-foreground">Postes optionnels</span>
                          <div className="flex flex-wrap gap-x-4 gap-y-2">
                            {postesOptionnels.map((poste) => (
                              <div key={poste} className="flex items-center gap-2">
                                <Checkbox
                                  id={`optionnel-${groupe.id}-${poste}`}
                                  checked={groupe.postesOptionnels.has(poste)}
                                  onCheckedChange={(coche) =>
                                    modifierGroupe(groupe.id, (g) => ({
                                      postesOptionnels: basculer(g.postesOptionnels, poste, coche === true),
                                    }))
                                  }
                                />
                                <Label htmlFor={`optionnel-${groupe.id}-${poste}`} className="text-sm font-normal">
                                  {libellePoste(poste)}
                                </Label>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {postesDuGroupe(groupe).filter(aSaisieParGroupe).map((poste) => (
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
                      Choisissez un type d'affaire pour ouvrir les postes de sa gamme.
                    </span>
                  )}
                </CardContent>
              </Card>
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
                      ? "Renseignez les groupes de barres puis cliquez sur « Chiffrer »."
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
                      {heuresBareme[poste] != null && " (barème)"}
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
