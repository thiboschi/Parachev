import { LIBELLES_ZONE_GOUJONS, type ZoneGoujons } from "@/hooks/use-affaire-db"
import type { TypeProduction } from "@/lib/flux-production"
import { poidsGoujon } from "@/lib/goujons"
import { heuresForageManuel, heuresOblongs } from "@/lib/percage"
import { heuresContreFleche } from "@/lib/presse"
import { libelleOperationRde, type ChampNorme } from "@/lib/recherche"
import { OPERATIONS_ROBOT, heuresBoutsRobot, heuresOblongsRobot, type OperationRobot } from "@/lib/robot"
import { heuresSciage } from "@/lib/sciage"

// Modèle de la page Chiffrage : ce qui s'y saisit (client, normes, groupes de
// barres) et les calculs qui n'en dépendent que par leurs arguments. L'état
// de la page est dans hooks/use-chiffrage.ts.

// Champs purement informatifs de la section "Infos Client" : ni envoyés à
// `chiffrer_manuellement`, ni utilisés dans le calcul.
export type ChampClient = "numero_offre" | "client" | "commercial"

export const CHAMPS_CLIENT: { key: ChampClient; label: string }[] = [
  { key: "numero_offre", label: "N° d'offre" },
  { key: "client", label: "Nom du client" },
  { key: "commercial", label: "Commercial" },
]

export const CLIENT_VIDE: Record<ChampClient, string> = {
  numero_offre: "",
  client: "",
  commercial: "",
}

// Mêmes champs que la section "Normes et exigences (RDE)" des filtres de la
// recherche (CHAMPS_NORMES), avec les valeurs de la liste déroulante du RDE
// et celles relevées dans les RDE déjà en base. Une seule valeur par champ,
// sauf les exigences particulières (voir `exigences`).
export type ChampExigence = "exigencesFabrication" | "exigencesAcier"
export type ChampNormeUnique = Exclude<ChampNorme, ChampExigence>

export const estExigence = (key: ChampNorme): key is ChampExigence =>
  key === "exigencesFabrication" || key === "exigencesAcier"

export const NORMES_VIDES: Record<ChampNormeUnique, string> = {
  en10163: "",
  tolerance: "",
  exc: "",
  prep: "",
  classeUs: "",
  en10204: "",
}

export const EXIGENCES_VIDES: Record<ChampExigence, string[]> = {
  exigencesFabrication: [],
  exigencesAcier: [],
}

// Majorations du temps total déduites des normes choisies (cumulatives).
// DBS compte qu'il soit demandé en fabrication ou sur l'acier.
export const TOLERANCE_MAJOREE = "Classe 2"
export const EXIGENCE_MAJOREE = "DBS"
export const MAJORATION_TOLERANCE = 1.25
export const MAJORATION_DBS = 1.2

// Variables explicatives acceptées par `chiffrer_manuellement` (voir
// poste_variables dans calibration.rs) -- les mêmes que variables_affaires,
// mais saisies à la main pour un projet qui n'a pas (encore) de fichier
// Excel dans le dossier surveillé.
export type Champ =
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

export const LIBELLES_CHAMPS: Record<Champ, string> = {
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
export const CHAMPS_POUTRE: Champ[] = ["nb_barres", "poids_t", "metres"]

// Quantités propres à un poste, saisies dans son volet de chaque groupe. Les
// postes absents n'ont que les grandeurs de la poutre (ou un forfait).
// Diamètre moyen -> nombre de trous qui le pondère dans la moyenne du projet.
const TROUS_DU_DIAMETRE: Partial<Record<Champ, Champ>> = {
  diametre_moyen_manuel: "nb_trous_manuel",
  diametre_moyen_numerique: "nb_trous_numerique",
}

export const CHAMPS_MODULE: Record<string, Champ[]> = {
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
export const ZONES_GOUJONS = Object.keys(LIBELLES_ZONE_GOUJONS) as ZoneGoujons[]

// Type des goujons d'une barre (diamètre × hauteur, comme la colonne "Diam."
// de FC-GOUJ) : aucun poste ne le chiffre, il ne sert qu'au poids indicatif
// des goujons (voir lib/goujons.ts).
export type ChampGoujon = "diametre" | "hauteur"

export const CHAMPS_GOUJON: { key: ChampGoujon; label: string }[] = [
  { key: "diametre", label: "Diamètre des goujons (mm)" },
  { key: "hauteur", label: "Hauteur des goujons (mm)" },
]

const GOUJON_VIDE: Record<ChampGoujon, string> = { diametre: "", hauteur: "" }

// Trous oblongs d'une barre, en option des postes qui peuvent les réaliser :
// aucun poste ne les chiffre d'après leur nombre, ils ne servent qu'au temps
// barème (voir heuresOblongs).
export const POSTES_AVEC_OBLONGS = ["forage_manuel", "oxycoupage"]

export type ChampOblong = "nombre" | "longueur" | "largeur"

export const CHAMPS_OBLONGS: { key: ChampOblong; label: string }[] = [
  { key: "nombre", label: "Oblongs par barre" },
  { key: "longueur", label: "Longueur (mm)" },
  { key: "largeur", label: "Largeur (mm)" },
]

const OBLONGS_VIDES: Record<ChampOblong, string> = { nombre: "", longueur: "", largeur: "" }

// Coupes d'une barre à la mise à longueur, par case du RDE (clés de
// OPERATIONS_RDE) : "Coupe" est cochée dès qu'une coupe droite ou biaise est
// saisie. Leur nombre chiffre le poste au barème de sciage (voir
// heuresSciage), à la place de la calibration.
export const POSTE_COUPES = "mise_a_longueur"
export const COUPE_RDE = "coupe"
export const TYPES_COUPE = ["coupe_droite", "coupe_biaise"] as const
export type TypeCoupe = (typeof TYPES_COUPE)[number]

const COUPES_VIDES: Record<TypeCoupe, string> = { coupe_droite: "", coupe_biaise: "" }

export const libelleCoupe = (type: TypeCoupe) => `${libelleOperationRde(type)} par barre`

// Poste dont la contre-flèche saisie (`contreFleche` du groupe) donne les
// heures au barème de la presse (voir heuresContreFleche), à la place de la
// calibration.
export const POSTE_CONTRE_FLECHE = "presse_cintrage"
export const LIBELLE_CONTRE_FLECHE = "CFL (mm)"

// Poste dont l'opération aux bouts et les oblongs saisis (`robot` du groupe)
// donnent les heures au barème du robot (voir lib/robot.ts), à la place de
// la calibration.
export const POSTE_ROBOT = "robot"
export const LIBELLE_OBLONGS_ROBOT = "Oblongs oxycoupés par barre"
export const OPTIONS_ROBOT = Object.entries(OPERATIONS_ROBOT).map(([valeur, libelle]) => ({ valeur, libelle }))

export interface SaisieRobot {
  // Opération faite aux bouts de chaque barre ; "" = aucune.
  operation: OperationRobot | ""
  // Un seul bout travaillé par barre, au lieu des deux.
  unBout: boolean
  oblongs: string
}

const ROBOT_VIDE: SaisieRobot = { operation: "", unBout: false, oblongs: "" }

/** Barres identiques d'un projet : même profil, mêmes dimensions et mêmes
 *  opérations sur chaque barre. Un projet en compte un ou plusieurs. */
export interface GroupeBarres {
  id: number
  // Le profil se choisit en deux temps : sa famille (HEB, HD, HL…), puis
  // le profil précis parmi ceux de cette famille.
  famille: string
  profil: string
  // Contre-flèche de chaque barre qui en a une, en mm.
  contreFleche: string
  valeurs: Record<Champ, string>
  zonesGoujons: Set<ZoneGoujons>
  goujon: Record<ChampGoujon, string>
  // Option "Trous oblongs" de chaque poste de POSTES_AVEC_OBLONGS : cochée
  // ou non, et ses dimensions (propres au poste).
  oblongsActifs: Set<string>
  oblongs: Record<string, Record<ChampOblong, string>>
  coupes: Record<TypeCoupe, string>
  robot: SaisieRobot
  // Postes optionnels de la gamme (voir ModulePoste) cochés pour ce groupe.
  postesOptionnels: Set<string>
  // Postes obligatoires de la gamme décochés pour ce groupe.
  postesRetires: Set<string>
}

export const groupeVide = (id: number): GroupeBarres => ({
  id,
  famille: "",
  profil: "",
  contreFleche: "",
  valeurs: CHAMPS_VIDES,
  zonesGoujons: new Set(),
  goujon: GOUJON_VIDE,
  oblongsActifs: new Set(),
  oblongs: {},
  coupes: COUPES_VIDES,
  robot: ROBOT_VIDE,
  postesOptionnels: new Set(),
  postesRetires: new Set(),
})

export const barresGroupe = (groupe: GroupeBarres) => nombre(groupe.valeurs.nb_barres)

// Longueur d'une barre en m : saisie en mm, mais `chiffrer_manuellement` et
// les barèmes atelier l'attendent en m.
export const longueurGroupe = (groupe: GroupeBarres) => nombre(groupe.valeurs.metres) / 1000

// Total d'un groupe pour un champ : la valeur par barre × son nombre de barres
// (en m pour la longueur).
export const totalGroupe = (groupe: GroupeBarres, key: Champ) =>
  (key === "metres" ? longueurGroupe(groupe) : nombre(groupe.valeurs[key])) *
  (CHAMPS_PAR_BARRE.has(key) ? barresGroupe(groupe) : 1)

export const retournementsParBarre = (groupe: GroupeBarres) => Math.max(groupe.zonesGoujons.size - 1, 0)

// Type de goujon saisi ("Ø 25 × 200") ; "" tant qu'une dimension manque.
export const typeGoujon = ({ goujon }: GroupeBarres) =>
  goujon.diametre.trim() !== "" && goujon.hauteur.trim() !== ""
    ? `Ø ${goujon.diametre.trim()} × ${goujon.hauteur.trim()}`
    : ""

// Poids d'un goujon du groupe, en kg ; null sans diamètre ou sans hauteur.
export const poidsGoujonGroupe = ({ goujon }: GroupeBarres) => poidsGoujon(nombre(goujon.diametre), nombre(goujon.hauteur))

// Poids indicatif des goujons d'une barre du groupe, en kg ; null sans
// goujons ou sans leur type.
export const poidsGoujonsParBarre = (groupe: GroupeBarres) => {
  const unitaire = poidsGoujonGroupe(groupe)
  const goujons = nombre(groupe.valeurs.nb_goujons)
  return unitaire !== null && goujons > 0 ? unitaire * goujons : null
}

export const oblongsDuPoste = (groupe: GroupeBarres, poste: string) => groupe.oblongs[poste] ?? OBLONGS_VIDES

export const coupesParBarre = (groupe: GroupeBarres) => somme(TYPES_COUPE.map((type) => nombre(groupe.coupes[type])))

// Heures barème de sciage du groupe d'après ses coupes ; null hors barème.
export const heuresSciageGroupe = (groupe: GroupeBarres) =>
  heuresSciage({
    profil: groupe.profil,
    nbBarres: barresGroupe(groupe),
    longueur: longueurGroupe(groupe),
    coupesDroites: nombre(groupe.coupes.coupe_droite),
    coupesBiaises: nombre(groupe.coupes.coupe_biaise),
  })

// Barres du groupe mises en contre-flèche : celles du champ "Barres avec
// contre-flèche", ou toutes s'il est laissé vide.
export const barresContreFleche = (groupe: GroupeBarres) => {
  const saisies = nombre(groupe.valeurs.nb_barres_cfl)
  return saisies > 0 ? saisies : barresGroupe(groupe)
}

// Heures barème de contre-flèche du groupe ; null hors barème.
export const heuresContreFlecheGroupe = (groupe: GroupeBarres) =>
  heuresContreFleche({
    profil: groupe.profil,
    nbBarres: barresContreFleche(groupe),
    longueur: longueurGroupe(groupe),
    contreFleche: nombre(groupe.contreFleche),
  })

export const boutsRobot = (groupe: GroupeBarres) => (groupe.robot.unBout ? 1 : 2)

export const oblongsRobot = (groupe: GroupeBarres) => nombre(groupe.robot.oblongs) * barresGroupe(groupe)

// Le groupe a-t-il du travail saisi pour le robot ?
export const aSaisieRobot = (groupe: GroupeBarres) =>
  groupe.robot.operation !== "" || nombre(groupe.robot.oblongs) > 0

// Heures barème du robot pour le groupe, opération aux bouts et oblongs ;
// null si l'un des deux est hors barème.
export const heuresRobotGroupe = (groupe: GroupeBarres) => {
  const { operation, oblongs } = groupe.robot
  const heuresBouts =
    operation === ""
      ? 0
      : heuresBoutsRobot({
          profil: groupe.profil,
          nbBarres: barresGroupe(groupe),
          longueur: longueurGroupe(groupe),
          operation,
          bouts: boutsRobot(groupe),
        })
  const heuresOblongs = nombre(oblongs) > 0 ? heuresOblongsRobot(groupe.profil, oblongsRobot(groupe)) : 0
  return heuresBouts === null || heuresOblongs === null ? null : heuresBouts + heuresOblongs
}

// Heures barème de forage manuel du groupe ; null hors barème.
export const POSTE_FORAGE_MANUEL = "forage_manuel"
export const heuresForageManuelGroupe = (groupe: GroupeBarres) =>
  heuresForageManuel(
    totalGroupe(groupe, "nb_trous_manuel"),
    nombre(groupe.valeurs.diametre_moyen_manuel)
  )

// Le poste a-t-il une saisie propre à chaque groupe de barres ?
export const aSaisieParGroupe = (poste: string) =>
  (CHAMPS_MODULE[poste] ?? []).length > 0 ||
  POSTES_AVEC_OBLONGS.includes(poste) ||
  poste === POSTE_COUPES ||
  poste === POSTE_ROBOT ||
  poste === "goujonnage" ||
  poste === "soudage"

export const somme = (valeurs: number[]) => valeurs.reduce((total, valeur) => total + valeur, 0)

// Présente sur presque toutes les affaires sans faire partie d'une gamme
// (voir POSTES_ANNEXES dans flux-production.ts) : proposée pour tous les types.
export const POSTE_TOUJOURS_PROPOSE = "manutention"

// Seuls postes que l'on peut retirer du détail des opérations de l'offre
// (voir postesMasques) : les autres y figurent toujours.
export const POSTES_MASQUABLES = ["manutention", "p3", "controle_cnd"]

/** Un module de prédiction = un poste de la gamme du type de poutre. */
export interface ModulePoste {
  poste: string
  /** Absent d'une variante de la gamme, ou alternative d'une étape (OU). */
  optionnel: boolean
}

// Modules d'un type du "Flux de production BFC" : tous les postes de ses
// itinéraires, dans l'ordre de la gamme. Un poste est obligatoire s'il est
// une étape à lui seul dans chaque itinéraire.
export function modulesDuType(type: TypeProduction): ModulePoste[] {
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
export function basculer<T extends string>(ensemble: Set<T>, cle: T, coche: boolean): Set<T> {
  const suivant = new Set(ensemble)
  if (coche) suivant.add(cle)
  else suivant.delete(cle)
  return suivant
}

// Nombre saisi (virgule ou point décimal) ; NaN si illisible, 0 si vide.
export const nombre = (brut: string) => (brut.trim() === "" ? 0 : Number(brut.trim().replace(",", ".")))

export const formatHeures = (value: number) =>
  value.toLocaleString("fr-BE", { maximumFractionDigits: 1 })

// Poids d'un goujon, à 10 g près.
export const formatPoidsGoujon = (kg: number) => kg.toLocaleString("fr-BE", { maximumFractionDigits: 2 })

// Les deux façons de chiffrer, au choix dans la carte "Estimation" : la
// saisie du projet est commune, seule l'origine des heures change.
export const MODES = { manuel: "Manuel", auto: "Auto" }
export type Mode = keyof typeof MODES

export const versOptions = (valeurs: string[]) => valeurs.map((v) => ({ valeur: v, libelle: v }))

// Le poste est-il coché pour le groupe ? Un poste optionnel ne l'est que si
// on le coche, un poste obligatoire l'est tant qu'on ne le décoche pas.
export const posteCoche = (groupe: GroupeBarres, { poste, optionnel }: ModulePoste) =>
  optionnel ? groupe.postesOptionnels.has(poste) : !groupe.postesRetires.has(poste)

// Coche ou décoche un poste de la gamme pour le groupe.
export const cocherPoste = (
  groupe: GroupeBarres,
  { poste, optionnel }: ModulePoste,
  coche: boolean
): Partial<GroupeBarres> =>
  optionnel
    ? { postesOptionnels: basculer(groupe.postesOptionnels, poste, coche) }
    : { postesRetires: basculer(groupe.postesRetires, poste, !coche) }

// Postes par lesquels passe un groupe, dans l'ordre de la gamme : ceux qui
// y sont cochés.
export const postesDuGroupe = (modules: ModulePoste[], groupe: GroupeBarres) =>
  modules.filter((m) => posteCoche(groupe, m)).map((m) => m.poste)

export const passePar = (modules: ModulePoste[], groupe: GroupeBarres, poste: string) =>
  postesDuGroupe(modules, groupe).includes(poste)

// Nom d'un groupe dans la page et dans l'offre ; vide s'il est seul.
export const prefixeGroupe = (groupes: GroupeBarres[], index: number) =>
  groupes.length > 1 ? `Groupe ${index + 1} — ` : ""

// Total du projet pour un champ : la somme de ses groupes, ou pour un
// diamètre moyen la moyenne des groupes pondérée par leurs trous (moyenne
// simple des diamètres saisis tant qu'aucun trou ne l'est). La quantité
// d'un poste ne compte que pour les groupes qui y passent.
export function totalProjet(groupes: GroupeBarres[], modules: ModulePoste[], key: Champ) {
  const poste = POSTE_DU_CHAMP[key]
  const concernes = poste ? groupes.filter((g) => passePar(modules, g, poste)) : groupes
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
export const aideCoupes = (groupe: GroupeBarres, type: TypeCoupe) => {
  const total = nombre(groupe.coupes[type]) * barresGroupe(groupe)
  return total > 0 ? `total : ${formatHeures(total)}` : undefined
}

// Rappel du total du groupe sous un champ saisi par barre.
export const aideTotal = (groupe: GroupeBarres, key: Champ) => {
  const total = totalGroupe(groupe, key)
  return CHAMPS_PAR_BARRE.has(key) && barresGroupe(groupe) > 0 && total > 0
    ? `total : ${formatHeures(total)}${key === "metres" ? " m" : ""}`
    : undefined
}

// Seules les quantités de la poutre et des postes du groupe comptent.
export const champsDes = (postesRetenus: string[]) => [
  ...CHAMPS_POUTRE,
  ...postesRetenus.flatMap((poste) => CHAMPS_MODULE[poste] ?? []),
]

export const heuresOblongsBareme = (groupe: GroupeBarres, poste: string) => {
  const saisie = oblongsDuPoste(groupe, poste)
  return heuresOblongs(
    nombre(saisie.nombre) * barresGroupe(groupe),
    nombre(saisie.longueur),
    nombre(saisie.largeur)
  )
}
