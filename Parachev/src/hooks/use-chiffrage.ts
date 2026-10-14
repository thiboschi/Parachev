import { useCallback, useMemo, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { useParametresSoudage } from "@/components/chiffrage/calculateur-soudage"
import { donneesOffre } from "@/components/chiffrage/donnees-offre"
import { useRechercheAffaires } from "@/hooks/use-recherche-affaires"
import {
  CLIENT_VIDE,
  COUPE_RDE,
  EXIGENCES_VIDES,
  EXIGENCE_MAJOREE,
  LIBELLES_CHAMPS,
  LIBELLE_CONTRE_FLECHE,
  LIBELLE_OBLONGS_ROBOT,
  MAJORATION_DBS,
  MAJORATION_TOLERANCE,
  NORMES_VIDES,
  POSTES_MASQUABLES,
  POSTE_CONTRE_FLECHE,
  POSTE_COUPES,
  POSTE_FORAGE_MANUEL,
  POSTE_ROBOT,
  TOLERANCE_MAJOREE,
  TYPES_COUPE,
  aSaisieRobot,
  barresGroupe,
  champsDes,
  coupesParBarre,
  demandeP3,
  groupeVide,
  heuresContreFlecheGroupe,
  heuresForageManuelGroupe,
  heuresRobotGroupe,
  heuresSciageGroupe,
  libelleCoupe,
  modulesDuType,
  nombre,
  passePar,
  postesDuGroupe,
  prefixeGroupe,
  retournementsParBarre,
  somme,
  totalProjet,
  type Champ,
  type ChampClient,
  type ChampExigence,
  type ChampNormeUnique,
  type GroupeBarres,
  type Mode,
} from "@/lib/chiffrage"
import { TYPES_PRODUCTION } from "@/lib/flux-production"
import { lireModeleOffre } from "@/lib/modele-offre"
import type { OffreEnCours } from "@/lib/offre-enregistree"
import { libellePoste } from "@/lib/postes"
import { PROFILS_CATALOGUE, familleProfil } from "@/lib/profils"
import { CHAMPS_NORMES, optionsFiltres, type ChampNorme, type OptionFiltre, type OptionsFiltres } from "@/lib/recherche"
import type { LigneSoudure } from "@/lib/soudage"

/** État de la page Chiffrage, lu par elle et par ses composants. */
export type Chiffrage = ReturnType<typeof useChiffrage>

// Saisie du projet, heures de ses postes et estimation qui en découle, avec
// les actions de la page (chiffrer, exporter l'offre, réinitialiser).
export function useChiffrage() {
  // En manuel, les heures de chaque poste viennent des barèmes atelier et du
  // calculateur de soudage, ou sont saisies à la main dans l'estimation. En
  // auto (prédiction), elles viennent de la calibration
  // (`chiffrer_manuellement`), que le calculateur et les barèmes de sciage, de
  // contre-flèche et du robot remplacent dès que leurs quantités sont saisies.
  const [mode, setMode] = useState<Mode>("manuel")
  const prediction = mode === "auto"
  // Valeurs proposées dans les listes : celles des affaires déjà en base,
  // comme les filtres de la page Recherche.
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
  // Le degré de préparation "P3" des normes ajoute le poste P3 à la gamme.
  const avecP3 = demandeP3(normes.prep)
  const modules = useMemo(() => (type ? modulesDuType(type, avecP3) : []), [type, avecP3])
  // Postes chiffrés : ceux d'au moins un groupe, les autres le sont à 0 h.
  const postes = new Set(groupes.flatMap((g) => postesDuGroupe(modules, g)))

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
  // Offre en relecture avant l'export, null quand la relecture est fermée.
  const [relecture, setRelecture] = useState<OffreEnCours | null>(null)
  const [ouvertureOffre, setOuvertureOffre] = useState(false)
  const soudageActif = postes.has("soudage")
  // Heures de mise à longueur au barème de sciage, d'après les coupes saisies
  // dans le volet du poste de chaque groupe : la somme des groupes au barème,
  // null si aucun ne l'est. Comme celles du soudage, elles remplacent celles
  // de la calibration dans l'estimation.
  const groupesAvecCoupes = groupes.filter((g) => passePar(modules, g, POSTE_COUPES) && coupesParBarre(g) > 0)
  const heuresSciageGroupes = groupesAvecCoupes.map(heuresSciageGroupe).filter((h) => h !== null)
  const sciageCalcule = heuresSciageGroupes.length > 0 ? somme(heuresSciageGroupes) : null
  const sciageActif = postes.has(POSTE_COUPES)
  // De même pour la presse, au barème de contre-flèche d'après la
  // contre-flèche saisie dans le volet du poste de chaque groupe.
  const groupesAvecContreFleche = groupes.filter(
    (g) => passePar(modules, g, POSTE_CONTRE_FLECHE) && nombre(g.contreFleche) > 0
  )
  const heuresContreFlecheGroupes = groupesAvecContreFleche
    .map(heuresContreFlecheGroupe)
    .filter((h) => h !== null)
  const contreFlecheCalculee =
    heuresContreFlecheGroupes.length > 0 ? somme(heuresContreFlecheGroupes) : null
  const presseActive = postes.has(POSTE_CONTRE_FLECHE)
  // De même pour le robot, au barème d'après l'opération aux bouts et les
  // oblongs saisis dans le volet du poste de chaque groupe.
  const heuresRobotGroupes = groupes
    .filter((g) => passePar(modules, g, POSTE_ROBOT) && aSaisieRobot(g))
    .map(heuresRobotGroupe)
    .filter((h) => h !== null)
  const robotCalcule = heuresRobotGroupes.length > 0 ? somme(heuresRobotGroupes) : null
  const robotActif = postes.has(POSTE_ROBOT)
  // Sans prédiction, le forage manuel est lui aussi chiffré au barème (FMAN),
  // d'après les trous saisis dans le volet du poste de chaque groupe.
  const heuresForageManuelGroupes = groupes
    .filter((g) => passePar(modules, g, POSTE_FORAGE_MANUEL))
    .map(heuresForageManuelGroupe)
    .filter((h) => h !== null)
  const forageManuelCalcule =
    heuresForageManuelGroupes.length > 0 ? somme(heuresForageManuelGroupes) : null
  const resultatPredit = useMemo(() => {
    if (!resultatBrut) return resultatBrut
    const calculees: [poste: string, heures: number | null][] = [
      ["soudage", soudageActif ? soudageCalcule : null],
      [POSTE_COUPES, sciageActif ? sciageCalcule : null],
      [POSTE_CONTRE_FLECHE, presseActive ? contreFlecheCalculee : null],
      [POSTE_ROBOT, robotActif ? robotCalcule : null],
    ]
    const suivant = { ...resultatBrut }
    for (const [poste, heures] of calculees) {
      if (heures === null) continue
      suivant.total = (suivant.total ?? 0) - (suivant[poste] ?? 0) + heures
      suivant[poste] = heures
    }
    return suivant
  }, [
    resultatBrut,
    soudageActif,
    soudageCalcule,
    sciageActif,
    sciageCalcule,
    presseActive,
    contreFlecheCalculee,
    robotActif,
    robotCalcule,
  ])
  // Heures au barème atelier des postes chiffrés ainsi.
  const heuresBareme: Record<string, number | null> = {
    [POSTE_COUPES]: sciageCalcule,
    [POSTE_CONTRE_FLECHE]: contreFlecheCalculee,
    [POSTE_ROBOT]: robotCalcule,
    ...(prediction ? {} : { [POSTE_FORAGE_MANUEL]: forageManuelCalcule }),
  }
  // Heures calculées sur la page pour un poste : calculateur ou barème.
  const heuresCalculeesPoste = (poste: string) =>
    poste === "soudage" ? soudageCalcule : (heuresBareme[poste] ?? null)
  // Sans prédiction : heures saisies à la main dans l'estimation, par poste.
  // Elles priment sur les heures calculées ; un poste sans les unes ni les
  // autres est compté 0 h.
  const [heuresSaisies, setHeuresSaisies] = useState<Record<string, string>>({})
  // Null si le champ est vide, NaN s'il est illisible ou négatif.
  const heuresSaisiesPoste = (poste: string) => {
    const brut = heuresSaisies[poste] ?? ""
    if (brut.trim() === "") return null
    const heures = nombre(brut)
    return heures >= 0 ? heures : NaN
  }
  const heuresRetenuesPoste = (poste: string) => {
    const saisies = heuresSaisiesPoste(poste)
    return saisies !== null && !Number.isNaN(saisies) ? saisies : (heuresCalculeesPoste(poste) ?? 0)
  }
  // Postes chiffrés, dans l'ordre de la gamme.
  const postesGamme = modules.filter(({ poste }) => postes.has(poste)).map(({ poste }) => poste)
  const postesSansHeures = postesGamme.filter(
    (poste) => heuresSaisiesPoste(poste) === null && heuresCalculeesPoste(poste) === null
  )
  const resultatSaisi: Record<string, number> | null = type
    ? {
        ...Object.fromEntries(postesGamme.map((poste) => [poste, heuresRetenuesPoste(poste)])),
        total: somme(postesGamme.map(heuresRetenuesPoste)),
      }
    : null
  const resultat = prediction ? resultatPredit : resultatSaisi
  const [calcul, setCalcul] = useState(false)
  const [tauxHoraire, setTauxHoraire] = useState("")
  const [reserve, setReserve] = useState("")
  // Postes décochés dans l'estimation : absents du détail des opérations de
  // l'offre, leurs heures y sont reportées sur un poste affiché.
  const [postesMasques, setPostesMasques] = useState<Set<string>>(new Set())
  const postesMasquables = postesGamme.filter((poste) => POSTES_MASQUABLES.includes(poste))
  // Poids indicatif des goujons : absent de l'offre tant que la case n'est
  // pas cochée dans le volet "Goujonnage". Un seul choix pour le projet, la
  // ligne de l'offre étant le total de ses groupes.
  const [poidsGoujonsAffiche, setPoidsGoujonsAffiche] = useState(false)

  function modifierGroupe(id: number, modification: (groupe: GroupeBarres) => Partial<GroupeBarres>) {
    setGroupes((prev) => prev.map((g) => (g.id === id ? { ...g, ...modification(g) } : g)))
  }

  function modifier(id: number, champ: Champ, valeur: string) {
    modifierGroupe(id, (g) => ({ valeurs: { ...g.valeurs, [champ]: valeur } }))
  }

  function ajouterGroupe() {
    setGroupes((prev) => [...prev, groupeVide(Math.max(...prev.map((g) => g.id)) + 1)])
  }

  function retirerGroupe(id: number) {
    setGroupes((prev) => prev.filter((g) => g.id !== id))
  }

  function choisirType(nom: string) {
    setTypeNom(nom)
    // Les postes cochés ou décochés sont ceux de la gamme du type : à refaire.
    setGroupes((prev) =>
      prev.map((g) => ({ ...g, postesOptionnels: new Set(), postesRetires: new Set() }))
    )
    setHeuresSaisies({})
    setPostesMasques(new Set())
    setResultat(null)
  }

  function reinitialiser() {
    setClient(CLIENT_VIDE)
    setNormes(NORMES_VIDES)
    setExigences(EXIGENCES_VIDES)
    setTypeNom("")
    setGroupes([groupeVide(0)])
    setHeuresSaisies({})
    setReserve("")
    setPostesMasques(new Set())
    setPoidsGoujonsAffiche(false)
    setResultat(null)
  }

  // Vérifie la saisie des groupes de barres et signale la première erreur.
  function saisieValide() {
    for (const [index, groupe] of groupes.entries()) {
      const champInvalide = champsDes(postesDuGroupe(modules, groupe)).find((key) =>
        Number.isNaN(nombre(groupe.valeurs[key]))
      )
      if (champInvalide) {
        toast.error(`${prefixeGroupe(groupes, index)}Valeur invalide pour "${LIBELLES_CHAMPS[champInvalide]}"`)
        return false
      }
      if (!(barresGroupe(groupe) > 0)) {
        toast.error(
          `${prefixeGroupe(groupes, index)}Renseignez le nombre de barres : les quantités sont saisies par barre`
        )
        return false
      }
      // Négatif ou illisible.
      const coupeInvalide =
        passePar(modules, groupe, POSTE_COUPES) && TYPES_COUPE.find((type) => !(nombre(groupe.coupes[type]) >= 0))
      if (coupeInvalide) {
        toast.error(`${prefixeGroupe(groupes, index)}Valeur invalide pour "${libelleCoupe(coupeInvalide)}"`)
        return false
      }
      if (passePar(modules, groupe, POSTE_CONTRE_FLECHE) && !(nombre(groupe.contreFleche) >= 0)) {
        toast.error(`${prefixeGroupe(groupes, index)}Valeur invalide pour "${LIBELLE_CONTRE_FLECHE}"`)
        return false
      }
      if (passePar(modules, groupe, POSTE_ROBOT) && !(nombre(groupe.robot.oblongs) >= 0)) {
        toast.error(`${prefixeGroupe(groupes, index)}Valeur invalide pour "${LIBELLE_OBLONGS_ROBOT}"`)
        return false
      }
    }
    return true
  }

  function chiffrer() {
    if (!saisieValide()) return
    const champs = champsDes([...postes])

    const variables = Object.fromEntries(
      (Object.keys(LIBELLES_CHAMPS) as Champ[]).map((key) => [
        key,
        champs.includes(key) ? totalProjet(groupes, modules, key) : 0,
      ])
    )
    if (postes.has("goujonnage")) {
      variables.nb_retournements_goujons = somme(
        groupes
          .filter((g) => passePar(modules, g, "goujonnage"))
          .map((g) => retournementsParBarre(g) * barresGroupe(g))
      )
    }
    const postesChiffres = Array.from(postes)
    // Cases "Coupe" du RDE que les coupes saisies reviennent à cocher.
    const coupesRde = TYPES_COUPE.filter((type) =>
      groupes.some((g) => passePar(modules, g, POSTE_COUPES) && nombre(g.coupes[type]) > 0)
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

  // Supplément d'heures de chaque majoration. La tolérance s'applique au
  // total déjà majoré DBS : total + suppléments = sous-total.
  const supplementDbs = dbs ? (resultat?.total ?? 0) * (MAJORATION_DBS - 1) : 0
  const supplementTolerance = classeTolerance2
    ? ((resultat?.total ?? 0) + supplementDbs) * (MAJORATION_TOLERANCE - 1)
    : 0

  // Réserve : pourcentage d'heures ajouté après les majorations.
  const reserveNombre = nombre(reserve)
  const reserveValide = reserveNombre >= 0
  const coefReserve = reserveValide ? 1 + reserveNombre / 100 : 1
  const heuresAvecReserve = sousTotal * coefReserve

  const tauxHoraireNombre = nombre(tauxHoraire)
  const tauxHoraireValide =
    tauxHoraire.trim() !== "" && !Number.isNaN(tauxHoraireNombre)
  // Montant de l'offre, puis le même rapporté au poids total des barres
  // (€/t) : null sans taux horaire, ou sans poids renseigné pour le second.
  const montant = tauxHoraireValide ? heuresAvecReserve * tauxHoraireNombre : null
  const tonnes = groupes.reduce((somme, groupe) => somme + barresGroupe(groupe) * nombre(groupe.valeurs.poids_t), 0)
  const prixTonne = montant !== null && tonnes > 0 ? montant / tonnes : null

  // Ouvre la relecture de l'offre (voir RelectureOffre), d'où elle s'exporte.
  async function ouvrirOffre() {
    if (!resultat) {
      toast.error(
        prediction
          ? "Cliquez sur « Chiffrer » avant d'exporter l'offre"
          : "Choisissez un type d'affaire avant d'exporter l'offre"
      )
      return
    }
    if (!reserveValide) {
      toast.error("Réserve invalide")
      return
    }
    // Avec la prédiction, la saisie est vérifiée par « Chiffrer ».
    if (!prediction) {
      if (!saisieValide()) return
      const posteInvalide = postesGamme.find((poste) => Number.isNaN(heuresSaisiesPoste(poste)))
      if (posteInvalide) {
        toast.error(`Heures invalides pour "${libellePoste(posteInvalide)}"`)
        return
      }
    }
    const offre = donneesOffre({
      client,
      normes,
      exigences,
      typeNom,
      groupes,
      modules,
      postesGamme,
      lignesSoudure,
      poidsGoujonsAffiche,
      postesMasques,
      resultat,
      coefReserve,
      dbs,
      supplementDbs,
      classeTolerance2,
      supplementTolerance,
      tauxHoraire: tauxHoraireValide ? tauxHoraireNombre : null,
      montant,
    })
    setOuvertureOffre(true)
    try {
      // Relu à chaque ouverture : une modification du modèle vaut dès l'offre suivante.
      const modele = lireModeleOffre(await invoke<string | null>("obtenir_modele_offre"))
      setRelecture({ id: null, offre, modele })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setOuvertureOffre(false)
    }
  }

  return {
    mode,
    setMode,
    prediction,
    client,
    setClient,
    normes,
    setNormes,
    exigences,
    setExigences,
    optionsNormes,
    typeNom,
    type,
    choisirType,
    modules,
    groupes,
    plusieursGroupes,
    optionsProfils,
    optionsFamilles,
    modifierGroupe,
    modifier,
    ajouterGroupe,
    retirerGroupe,
    parametresSoudage,
    setParametresSoudage,
    noterSoudage,
    noterLignesSoudure,
    poidsGoujonsAffiche,
    setPoidsGoujonsAffiche,
    soudageCalcule,
    sciageCalcule,
    contreFlecheCalculee,
    robotCalcule,
    heuresBareme,
    heuresCalculeesPoste,
    heuresSaisies,
    setHeuresSaisies,
    heuresSaisiesPoste,
    postesGamme,
    postesSansHeures,
    resultat,
    heuresParPoste,
    dbs,
    classeTolerance2,
    supplementDbs,
    supplementTolerance,
    sousTotal,
    reserve,
    setReserve,
    reserveNombre,
    reserveValide,
    heuresAvecReserve,
    tauxHoraire,
    setTauxHoraire,
    tauxHoraireNombre,
    tauxHoraireValide,
    prixTonne,
    postesMasquables,
    postesMasques,
    setPostesMasques,
    calcul,
    relecture,
    setRelecture,
    ouvertureOffre,
    chiffrer,
    reinitialiser,
    ouvrirOffre,
  }
}
