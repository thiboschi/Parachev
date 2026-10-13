import { useCallback } from "react"
import { CadencesSoudage, CalculateurSoudage } from "@/components/chiffrage/calculateur-soudage"
import { ChampSaisie, Liste } from "@/components/chiffrage/champs"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LIBELLES_ZONE_GOUJONS } from "@/hooks/use-affaire-db"
import type { Chiffrage } from "@/hooks/use-chiffrage"
import {
  CHAMPS_GOUJON,
  CHAMPS_MODULE,
  CHAMPS_OBLONGS,
  COUPE_RDE,
  LIBELLES_CHAMPS,
  LIBELLE_CONTRE_FLECHE,
  LIBELLE_OBLONGS_ROBOT,
  OPTIONS_ROBOT,
  POSTES_AVEC_OBLONGS,
  POSTE_CONTRE_FLECHE,
  POSTE_COUPES,
  POSTE_FORAGE_MANUEL,
  POSTE_ROBOT,
  TYPES_COUPE,
  ZONES_GOUJONS,
  aSaisieRobot,
  aideCoupes,
  aideTotal,
  barresContreFleche,
  barresGroupe,
  basculer,
  coupesParBarre,
  formatHeures,
  formatPoidsGoujon,
  heuresContreFlecheGroupe,
  heuresForageManuelGroupe,
  heuresOblongsBareme,
  heuresRobotGroupe,
  heuresSciageGroupe,
  libelleCoupe,
  longueurGroupe,
  nombre,
  oblongsDuPoste,
  oblongsRobot,
  poidsGoujonGroupe,
  poidsGoujonsParBarre,
  retournementsParBarre,
  totalGroupe,
  type GroupeBarres,
} from "@/lib/chiffrage"
import { heuresForageNumerique } from "@/lib/percage"
import { libelleOperationRde } from "@/lib/recherche"
import type { OperationRobot } from "@/lib/robot"
import type { LigneSoudure, ParametresSoudure } from "@/lib/soudage"

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

// Saisie d'un groupe de barres pour un poste, affichée dans le volet du
// poste dans la case du groupe (section "Poutre").
export function SaisiePoste({ chiffrage, groupe, poste }: {
  chiffrage: Chiffrage
  groupe: GroupeBarres
  poste: string
}) {
  const {
    prediction,
    modifier,
    modifierGroupe,
    poidsGoujonsAffiche,
    setPoidsGoujonsAffiche,
    sciageCalcule,
    contreFlecheCalculee,
    robotCalcule,
    parametresSoudage,
    setParametresSoudage,
    noterSoudage,
    noterLignesSoudure,
  } = chiffrage
  const champs = CHAMPS_MODULE[poste] ?? []
  const avecOblongs = POSTES_AVEC_OBLONGS.includes(poste)
  const nbBarres = barresGroupe(groupe)
  const retournements = retournementsParBarre(groupe)
  const poidsGoujonUnitaire = poidsGoujonGroupe(groupe)
  const poidsGoujons = poidsGoujonsParBarre(groupe)
  const oblongsCoches = groupe.oblongsActifs.has(poste)
  const baremeOblongs = heuresOblongsBareme(groupe, poste)
  const coupes = coupesParBarre(groupe)
  const baremeSciage = heuresSciageGroupe(groupe)
  const baremeContreFleche = heuresContreFlecheGroupe(groupe)
  const baremeRobot = heuresRobotGroupe(groupe)
  // Temps barème de perçage (voir lib/percage.ts). Avec la prédiction, ils
  // sont affichés pour comparaison : l'estimation reste celle de la
  // calibration. Sans, celui du forage manuel chiffre le poste.
  const baremeManuel = poste === POSTE_FORAGE_MANUEL ? heuresForageManuelGroupe(groupe) : null
  const baremeNumerique =
    poste === "forage_numerique"
      ? heuresForageNumerique(
          totalGroupe(groupe, "nb_trous_numerique"),
          nombre(groupe.valeurs.diametre_moyen_numerique),
          groupe.profil
        )
      : null
  // Ce que devient un poste au barème tant que ses quantités manquent.
  const sansBareme = prediction
    ? "le poste est chiffré par la calibration."
    : "les heures du poste sont à saisir dans l'estimation."
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
          {poste === "goujonnage" &&
            CHAMPS_GOUJON.map(({ key, label }) => (
              <ChampSaisie key={key} id={`${id}-goujon-${key}`} label={label}>
                <Input
                  id={`${id}-goujon-${key}`}
                  className="text-right tabular-nums"
                  inputMode="decimal"
                  value={groupe.goujon[key]}
                  onChange={(e) =>
                    modifierGroupe(groupe.id, (g) => ({ goujon: { ...g.goujon, [key]: e.target.value } }))
                  }
                />
              </ChampSaisie>
            ))}
        </div>
      )}
      {poste === "goujonnage" && (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">
            {poidsGoujonUnitaire === null
              ? "Renseignez le diamètre et la hauteur des goujons pour estimer leur poids."
              : `Poids des goujons : ${formatPoidsGoujon(poidsGoujonUnitaire)} kg pièce${
                  poidsGoujons !== null
                    ? `, ${formatHeures(poidsGoujons)} kg par barre${nbBarres > 0 ? ` (total : ${formatHeures(poidsGoujons * nbBarres)} kg)` : ""}`
                    : ""
                }.`}{" "}
            Poids indicatif, non ajouté au tonnage.
          </span>
          <div className="flex items-center gap-2">
            <Checkbox
              id={`${id}-poids-goujons`}
              checked={poidsGoujonsAffiche}
              onCheckedChange={(coche) => setPoidsGoujonsAffiche(coche === true)}
            />
            <Label htmlFor={`${id}-poids-goujons`} className="text-sm font-normal">
              Afficher le poids des goujons sur l'offre PDF
            </Label>
          </div>
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
          {!prediction && " Temps indicatif : les heures du poste sont à saisir dans l'estimation."}
        </span>
      )}
      {poste === POSTE_CONTRE_FLECHE && (
        <span className="text-xs text-muted-foreground">
          {!(nombre(groupe.contreFleche) > 0)
            ? contreFlecheCalculee !== null
              ? "Sans contre-flèche saisie, ce groupe n'est pas compté à la presse."
              : `Sans contre-flèche saisie, ${sansBareme}`
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
                : `Sans coupe saisie, ${sansBareme}`
              : baremeSciage !== null
                ? `Barème atelier (DATA-TEMPS), sciage : ${formatHeures(baremeSciage)} h pour ${formatHeures(coupes)} coupe${coupes > 1 ? "s" : ""} par barre.`
                : "Hors barème : renseignez le nombre de barres et un profil du barème atelier (coupe biaise au robot sur les HL 1000, HL 1100 et HD 400 x 1086)."}
          </span>
        </div>
      )}
      {poste === POSTE_ROBOT && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Liste
              label="Opération aux bouts"
              vide="Aucune"
              valeur={groupe.robot.operation}
              options={OPTIONS_ROBOT}
              onChange={(operation) =>
                modifierGroupe(groupe.id, (g) => ({
                  robot: { ...g.robot, operation: operation as OperationRobot | "" },
                }))
              }
            />
            <ChampSaisie
              id={`${id}-oblongs-robot`}
              label={LIBELLE_OBLONGS_ROBOT}
              aide={oblongsRobot(groupe) > 0 ? `total : ${formatHeures(oblongsRobot(groupe))}` : undefined}
            >
              <Input
                id={`${id}-oblongs-robot`}
                className="text-right tabular-nums"
                inputMode="decimal"
                value={groupe.robot.oblongs}
                onChange={(e) =>
                  modifierGroupe(groupe.id, (g) => ({ robot: { ...g.robot, oblongs: e.target.value } }))
                }
              />
            </ChampSaisie>
          </div>
          {groupe.robot.operation !== "" && (
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${id}-un-bout`}
                checked={groupe.robot.unBout}
                onCheckedChange={(coche) =>
                  modifierGroupe(groupe.id, (g) => ({ robot: { ...g.robot, unBout: coche === true } }))
                }
              />
              <Label htmlFor={`${id}-un-bout`} className="text-sm font-normal">
                Un seul bout par barre
              </Label>
            </div>
          )}
          <span className="text-xs text-muted-foreground">
            {!aSaisieRobot(groupe)
              ? robotCalcule !== null
                ? "Sans opération ni oblong saisi, ce groupe n'est pas compté au robot."
                : `Sans opération ni oblong saisi, ${sansBareme}`
              : baremeRobot !== null
                ? `Barème atelier (ROBOT) : ${formatHeures(baremeRobot)} h pour ${formatHeures(nbBarres)} barre${nbBarres > 1 ? "s" : ""}${groupe.robot.operation !== "" && longueurGroupe(groupe) > 30 ? ", transport à deux ponts compris" : ""}.`
                : "Hors barème : renseignez le nombre de barres et le profil. Opérations aux bouts jusqu'à 1100 mm de haut (HD 400 : préparation de chanfrein seulement, aux deux bouts, au-delà de 314 kg/m ; Skanska ou WIP : deux bouts, à partir de 320 mm de haut) ; oblongs sur HEA, HEB et HEM."}
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
