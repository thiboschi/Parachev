import type { DonneesOffre, LigneInfo } from "@/components/chiffrage/offre-pdf"
import { LIBELLES_ZONE_GOUJONS } from "@/hooks/use-affaire-db"
import {
  CHAMPS_MODULE,
  LIBELLES_CHAMPS,
  LIBELLE_CONTRE_FLECHE,
  LIBELLE_OBLONGS_ROBOT,
  POSTE_CONTRE_FLECHE,
  POSTE_COUPES,
  POSTE_FORAGE_MANUEL,
  POSTE_ROBOT,
  POSTE_TOUJOURS_PROPOSE,
  TYPES_COUPE,
  ZONES_GOUJONS,
  aideCoupes,
  aideTotal,
  barresContreFleche,
  barresGroupe,
  boutsRobot,
  estExigence,
  formatHeures,
  libelleCoupe,
  nombre,
  oblongsDuPoste,
  oblongsRobot,
  passePar,
  poidsGoujonsParBarre,
  postesDuGroupe,
  prefixeGroupe,
  retournementsParBarre,
  somme,
  totalProjet,
  typeGoujon,
  type Champ,
  type ChampClient,
  type ChampExigence,
  type ChampNormeUnique,
  type GroupeBarres,
  type ModulePoste,
} from "@/lib/chiffrage"
import { libellePoste } from "@/lib/postes"
import { CHAMPS_NORMES, libelleOperationRde } from "@/lib/recherche"
import { OPERATIONS_ROBOT, type OperationRobot } from "@/lib/robot"
import { PREPARATIONS, nombrePasses, type LigneSoudure } from "@/lib/soudage"

/** Ce que la page Chiffrage fournit à l'offre : sa saisie et son estimation. */
export interface SaisieOffre {
  client: Record<ChampClient, string>
  normes: Record<ChampNormeUnique, string>
  exigences: Record<ChampExigence, string[]>
  typeNom: string
  groupes: GroupeBarres[]
  modules: ModulePoste[]
  // Postes chiffrés, dans l'ordre de la gamme.
  postesGamme: string[]
  lignesSoudure: Record<number, LigneSoudure[]>
  poidsGoujonsAffiche: boolean
  postesMasques: Set<string>
  // Heures par poste et leur total, avant majorations et réserve.
  resultat: Record<string, number>
  coefReserve: number
  dbs: boolean
  supplementDbs: number
  classeTolerance2: boolean
  supplementTolerance: number
  // Null sans taux horaire valide.
  tauxHoraire: number | null
  montant: number | null
  prixTonne: number | null
}

// Tout ce qui est saisi et chiffré sur la page, pour le PDF de l'offre.
export function donneesOffre({
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
  tauxHoraire,
  montant,
  prixTonne,
}: SaisieOffre): DonneesOffre {
  const renseignees = <T extends { valeur: string }>(lignes: T[]) => lignes.filter(({ valeur }) => valeur.trim() !== "")
  const avecTotal = (groupe: GroupeBarres, key: Champ) => {
    const aide = aideTotal(groupe, key)
    return aide ? `${groupe.valeurs[key]} (${aide})` : groupe.valeurs[key]
  }
  const detailsGroupe = (groupe: GroupeBarres, poste: string) => {
    const percage = poste === "forage_numerique" || poste === POSTE_FORAGE_MANUEL
    const details = (percage ? [] : (CHAMPS_MODULE[poste] ?? []))
      .filter((key) => groupe.valeurs[key].trim() !== "")
      .map((key) => `${LIBELLES_CHAMPS[key]} : ${avecTotal(groupe, key)}`)
    // Perçage : une seule ligne, le nombre de trous par barre puis leur diamètre.
    if (percage) {
      const [trous, diametre] = CHAMPS_MODULE[poste].map((key) => groupe.valeurs[key].trim())
      const mesures = [trous, diametre !== "" ? `Ø ${diametre} mm` : ""].filter((mesure) => mesure !== "")
      if (mesures.length > 0) details.push(`Perçage : ${mesures.join(" - ")}`)
    }
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
    if (poste === POSTE_ROBOT) {
      const { operation, oblongs } = groupe.robot
      if (operation !== "") {
        details.push(`${OPERATIONS_ROBOT[operation]} : ${groupe.robot.unBout ? "un bout" : "deux bouts"} par barre`)
      }
      if (nombre(oblongs) > 0) details.push(`${LIBELLE_OBLONGS_ROBOT} : ${oblongs}`)
    }
    if (poste === "goujonnage" && typeGoujon(groupe) !== "") details.push(`Goujons : ${typeGoujon(groupe)} mm`)
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
  // Quantités totales du projet pour un poste : celles de ses groupes,
  // multipliées par leur nombre de barres.
  const recapPoste = (poste: string): LigneInfo[] => {
    const concernes = groupes.filter((g) => passePar(modules, g, poste))
    const lignes: LigneInfo[] = []
    const ajouter = (label: string, total: number, precision = "") => {
      if (total > 0) lignes.push({ label, valeur: `${formatHeures(total)}${precision}` })
    }
    // Diamètres saisis dans les groupes, sans doublon, dans leur ordre.
    const diametre = (key: Champ) => {
      const diametres = Array.from(new Set(concernes.map((g) => g.valeurs[key].trim()).filter((d) => d !== "")))
      return diametres.length > 0 ? ` (Ø ${diametres.join(", ")} mm)` : ""
    }
    if (poste === POSTE_COUPES) {
      for (const type of TYPES_COUPE) {
        ajouter(libelleOperationRde(type), somme(concernes.map((g) => nombre(g.coupes[type]) * barresGroupe(g))))
      }
    }
    if (poste === POSTE_CONTRE_FLECHE) {
      const cintres = concernes.filter((g) => nombre(g.contreFleche) > 0 || nombre(g.valeurs.nb_barres_cfl) > 0)
      const fleches = Array.from(new Set(cintres.map((g) => g.contreFleche.trim()).filter((f) => f !== "")))
      ajouter(
        LIBELLES_CHAMPS.nb_barres_cfl,
        somme(cintres.map(barresContreFleche)),
        fleches.length > 0 ? ` (${fleches.join(" / ")} mm)` : ""
      )
    }
    if (poste === POSTE_ROBOT) {
      for (const operation of Object.keys(OPERATIONS_ROBOT) as OperationRobot[]) {
        const bouts = somme(
          concernes.filter((g) => g.robot.operation === operation).map((g) => boutsRobot(g) * barresGroupe(g))
        )
        ajouter(OPERATIONS_ROBOT[operation], bouts, bouts > 1 ? " bouts" : " bout")
      }
      ajouter(`Trous oblongs (${libellePoste(poste)})`, somme(concernes.map(oblongsRobot)))
    }
    if (poste === "forage_numerique") {
      ajouter("Trous perçage numérique", totalProjet(groupes, modules, "nb_trous_numerique"), diametre("diametre_moyen_numerique"))
    }
    if (poste === POSTE_FORAGE_MANUEL) {
      ajouter("Trous perçage manuel", totalProjet(groupes, modules, "nb_trous_manuel"), diametre("diametre_moyen_manuel"))
    }
    if (poste === "goujonnage") {
      const types = Array.from(new Set(concernes.map(typeGoujon).filter((type) => type !== "")))
      ajouter("Goujons", totalProjet(groupes, modules, "nb_goujons"), types.length > 0 ? ` (${types.join(", ")} mm)` : "")
      // Poids indicatif, hors tonnage, sur demande : seulement si chaque
      // groupe goujonné a le type de ses goujons, un total partiel tromperait.
      const goujonnes = concernes.filter((g) => nombre(g.valeurs.nb_goujons) > 0)
      const poids = goujonnes.map(poidsGoujonsParBarre)
      if (poidsGoujonsAffiche && !poids.includes(null)) {
        ajouter(
          "Poids des goujons",
          somme(goujonnes.map((g, i) => (poids[i] ?? 0) * barresGroupe(g))),
          " kg"
        )
      }
    }
    if (poste === "oxycoupage") ajouter("Longueur de coupe", totalProjet(groupes, modules, "longueur_coupe") / 1000, " m")
    if (poste === "soudage") {
      ajouter(
        "Pièces à souder",
        somme(concernes.map((g) => somme((lignesSoudure[g.id] ?? []).map((l) => nombre(l.nombre))) * barresGroupe(g)))
      )
    }
    ajouter(
      `Trous oblongs (${libellePoste(poste)})`,
      somme(
        concernes
          .filter((g) => g.oblongsActifs.has(poste))
          .map((g) => nombre(oblongsDuPoste(g, poste).nombre) * barresGroupe(g))
      )
    )
    return lignes
  }
  // Objet de l'offre : une coupe si la gamme ne compte que la mise à
  // longueur, un parachèvement sinon, puis les familles de profils et la
  // classe d'exécution.
  const coupeSeule =
    postesGamme.includes(POSTE_COUPES) &&
    postesGamme.every((poste) => poste === POSTE_COUPES || poste === POSTE_TOUJOURS_PROPOSE)
  const familles = Array.from(new Set(groupes.map((g) => g.famille).filter((famille) => famille !== "")))
  const objet = [
    [coupeSeule ? "Coupe" : "Parachèvement", "de poutrelles", ...(familles.length > 0 ? [familles.join(" / ")] : [])].join(" "),
    ...(normes.exc !== "" ? [normes.exc] : []),
  ].join(" – ")
  // Heures des postes décochés : reportées sur le poste affiché qui en compte
  // le plus, pour que les lignes de l'offre s'additionnent jusqu'au total.
  const heuresOffre = postesGamme.map((poste) => ({ poste, heures: (resultat[poste] ?? 0) * coefReserve }))
  const affiches = heuresOffre.filter(({ poste }) => !postesMasques.has(poste))
  const heuresMasquees = somme(heuresOffre.filter(({ poste }) => postesMasques.has(poste)).map(({ heures }) => heures))
  const receveur = affiches.reduce<(typeof affiches)[number] | undefined>(
    (retenu, ligne) => (retenu === undefined || ligne.heures > retenu.heures ? ligne : retenu),
    undefined
  )?.poste
  return {
    date: new Date(),
    client: client.client.trim(),
    commercial: client.commercial.trim(),
    numeroOffre: client.numero_offre.trim(),
    objet,
    typeAffaire: typeNom,
    barres: groupes.map((groupe) => ({
      nombre: barresGroupe(groupe),
      profil: groupe.profil.trim(),
      longueur: nombre(groupe.valeurs.metres) > 0 ? nombre(groupe.valeurs.metres) : null,
      poids: nombre(groupe.valeurs.poids_t) > 0 ? nombre(groupe.valeurs.poids_t) : null,
      operations: postesDuGroupe(modules, groupe).flatMap((poste) => detailsGroupe(groupe, poste)),
    })),
    normes: renseignees(
      CHAMPS_NORMES.map(({ key }) => ({
        key,
        valeur: estExigence(key) ? exigences[key].join(", ") : normes[key],
      }))
    ),
    operations: affiches.map(({ poste, heures }) => ({
      libelle: libellePoste(poste),
      heures: heures + (poste === receveur ? heuresMasquees : 0),
      quantites: recapPoste(poste),
    })),
    soudures: groupes.flatMap((groupe, index) =>
      (lignesSoudure[groupe.id] ?? []).map((ligne) => ({
        designation: `${prefixeGroupe(groupes, index)}${ligne.designation}`,
        nombre: ligne.nombre,
        longueur: ligne.longueur,
        preparation: PREPARATIONS.find((p) => p.key === ligne.preparation)?.label ?? ligne.preparation,
        passes: nombrePasses(ligne)?.toString() ?? "—",
      }))
    ),
    // La réserve n'a pas de ligne dans l'offre : elle est répartie sur
    // toutes ses heures (opérations, total, majorations).
    totalHeures: (resultat.total ?? 0) * coefReserve,
    // Sans les coefficients : l'offre est lue par le client.
    majorations: [
      ...(dbs ? [{ label: "Majoration DBS", heures: supplementDbs * coefReserve }] : []),
      ...(classeTolerance2
        ? [{ label: "Majoration tolérance classe 2", heures: supplementTolerance * coefReserve }]
        : []),
    ],
    tauxHoraire,
    montant,
    prixTonne,
  }
}
