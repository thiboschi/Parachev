import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { IconTrash } from "@tabler/icons-react"
import { toast } from "sonner"
import { ChampSaisie, Liste } from "@/components/chiffrage/champs"
import { Bloc, EditeurModele, Lignes, libelleNorme } from "@/components/chiffrage/editeur-modele"
import type { BarresOffre, DonneesOffre, OperationOffre, SoudureOffre } from "@/components/chiffrage/offre-pdf"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { nettoyerModeleOffre } from "@/lib/modele-offre"
import { nomFichierOffre, versJson, type OffreEnCours } from "@/lib/offre-enregistree"
import { CHAMPS_NORMES, type ChampNorme } from "@/lib/recherche"

// Relecture d'une offre avant son export : tout ce que le PDF affiche se
// retouche ici, pour cette offre seulement (données, montants et textes
// copiés du modèle). L'offre est enregistrée en base à chaque export, pour
// être rouverte depuis la page "Offres".

// Nombre saisi : null si vide, undefined si ce n'est pas un nombre.
const lireNombre = (texte: string): number | null | undefined => {
  const brut = texte.replace(/\s/g, "").replace(",", ".")
  if (brut === "") return null
  const valeur = Number(brut)
  return Number.isNaN(valeur) ? undefined : valeur
}

const afficherNombre = (valeur: number | null, decimales: number) =>
  valeur === null ? "" : String(Number(valeur.toFixed(decimales))).replace(".", ",")

/** Champ numérique : la saisie reste libre, la valeur suit dès qu'elle est un nombre (vide : null). */
function ChampNombre({ valeur, decimales = 3, onChange, ...props }: Omit<React.ComponentProps<"input">, "value" | "onChange"> & {
  valeur: number | null
  decimales?: number
  onChange: (valeur: number | null) => void
}) {
  const [texte, setTexte] = useState(afficherNombre(valeur, decimales))
  // Valeur changée d'ailleurs (ligne déplacée, montant recalculé) : le champ la reprend.
  useEffect(() => {
    if (lireNombre(texte) !== valeur) setTexte(afficherNombre(valeur, decimales))
  }, [valeur])
  return (
    <Input
      inputMode="decimal"
      className="text-right tabular-nums"
      value={texte}
      onChange={(e) => {
        setTexte(e.target.value)
        const lu = lireNombre(e.target.value)
        if (lu !== undefined) onChange(lu)
      }}
      onBlur={() => setTexte(afficherNombre(valeur, decimales))}
      {...props}
    />
  )
}

/** En-têtes de colonnes au-dessus de Lignes (la marge droite laisse la place à ses boutons). */
function EnteteColonnes({ colonnes, className }: { colonnes: string[]; className: string }) {
  return (
    <div className={`hidden gap-2 pr-24 text-xs text-muted-foreground sm:grid ${className}`}>
      {colonnes.map((colonne) => (
        <span key={colonne}>{colonne}</span>
      ))}
    </div>
  )
}

// Montant HT : le sous-total plus les majorations, null sans aucun montant.
const sommeMontants = (sousTotal: number | null, majorations: DonneesOffre["majorations"]) => {
  const montants = [sousTotal, ...majorations.map(({ montant }) => montant)]
  return montants.every((m) => m === null) ? null : montants.reduce<number>((total, m) => total + (m ?? 0), 0)
}

const euros = (valeur: number) =>
  `${valeur.toLocaleString("fr-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

// Date au format d'un <input type="date">, en heure locale.
const dateIso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`

// Classes écrites en entier : Tailwind ne voit pas les classes composées.
const COLONNES_BARRES = "sm:grid-cols-[2fr_1fr_1fr_1fr]"
const COLONNES_SOUDURES = "sm:grid-cols-[2fr_1fr_1fr_1.5fr_1fr]"
const BARRES_VIDE: BarresOffre = { nombre: 0, profil: "", longueur: null, poids: null, operations: [] }
const OPERATION_VIDE: OperationOffre = { libelle: "", heures: 0, quantites: [] }
const SOUDURE_VIDE: SoudureOffre = { designation: "", nombre: "", longueur: "", preparation: "", passes: "" }

export function RelectureOffre({ initiale, onFermer, onEnregistree }: {
  initiale: OffreEnCours
  onFermer: () => void
  /** Après chaque enregistrement (ex. rafraîchir la liste des offres). */
  onEnregistree?: () => void
}) {
  const [enCours, setEnCours] = useState(initiale)
  // JSON du dernier état enregistré, null tant que l'offre ne l'a jamais été.
  const [enregistre, setEnregistre] = useState(initiale.id !== null ? versJson(initiale) : null)
  const [occupe, setOccupe] = useState<"enregistrement" | "export" | null>(null)
  const { offre, modele } = enCours
  const modifie = versJson(enCours) !== enregistre

  const modifierOffre = (champs: Partial<DonneesOffre>) =>
    setEnCours((prev) => ({ ...prev, offre: { ...prev.offre, ...champs } }))
  // Le montant suit le sous-total et les majorations ; saisi à part, il est forcé.
  const modifierMontants = (champs: Pick<Partial<DonneesOffre>, "sousTotal" | "majorations">) => {
    const suivant = { ...offre, ...champs }
    modifierOffre({ ...champs, montant: sommeMontants(suivant.sousTotal, suivant.majorations) })
  }

  const normesManquantes = CHAMPS_NORMES.filter(({ key }) => !offre.normes.some((n) => n.key === key))
  const tonnage = offre.barres.reduce(
    (total, { nombre, poids }) => total + (poids !== null && nombre > 0 ? nombre * poids : 0),
    0
  )

  async function enregistrer(): Promise<OffreEnCours> {
    const propre = { ...enCours, modele: nettoyerModeleOffre(enCours.modele) }
    const id = await invoke<number>("enregistrer_offre", {
      id: propre.id,
      numero: propre.offre.numeroOffre.trim(),
      client: propre.offre.client.trim(),
      montant: propre.offre.montant,
      contenu: versJson(propre),
    })
    const suivant = { ...propre, id }
    setEnCours(suivant)
    setEnregistre(versJson(suivant))
    onEnregistree?.()
    return suivant
  }

  async function enregistrerSeul() {
    setOccupe("enregistrement")
    try {
      await enregistrer()
      toast.success("Offre enregistrée")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setOccupe(null)
    }
  }

  async function exporter() {
    setOccupe("export")
    try {
      const aExporter = modifie ? await enregistrer() : enCours
      // @react-pdf/renderer n'est chargé qu'au premier export.
      const { genererOffrePdf } = await import("@/components/chiffrage/offre-pdf")
      const contenu = await genererOffrePdf(aExporter.offre, aExporter.modele)
      const chemin = await invoke<string | null>("enregistrer_pdf", {
        nom: nomFichierOffre(aExporter.offre),
        contenu: Array.from(contenu),
      })
      if (chemin) toast.success(`Offre enregistrée : ${chemin}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setOccupe(null)
    }
  }

  return (
    <Dialog open onOpenChange={(ouverte) => !ouverte && onFermer()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Relecture de l'offre{offre.numeroOffre !== "" && ` ${offre.numeroOffre}`}</DialogTitle>
          <DialogDescription>
            Ce qui est modifié ici ne vaut que pour cette offre : ni la saisie du chiffrage ni le modèle d'offre ne
            changent.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="offre" className="min-h-0 flex-1">
          <TabsList>
            <TabsTrigger value="offre" className="px-3">
              Offre
            </TabsTrigger>
            <TabsTrigger value="textes" className="px-3">
              Textes
            </TabsTrigger>
          </TabsList>

          <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-1">
            <TabsContent value="offre" className="flex flex-col gap-4">
              <Bloc titre="Informations">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <ChampSaisie id="offre-numero" label="N° d'offre">
                    <Input
                      id="offre-numero"
                      value={offre.numeroOffre}
                      onChange={(e) => modifierOffre({ numeroOffre: e.target.value })}
                    />
                  </ChampSaisie>
                  <ChampSaisie id="offre-date" label="Date">
                    <Input
                      id="offre-date"
                      type="date"
                      value={dateIso(offre.date)}
                      onChange={(e) => {
                        // Midi : la date reste la même quel que soit le fuseau.
                        const date = new Date(`${e.target.value}T12:00:00`)
                        if (!Number.isNaN(date.getTime())) modifierOffre({ date })
                      }}
                    />
                  </ChampSaisie>
                  <ChampSaisie id="offre-client" label="Client">
                    <Input id="offre-client" value={offre.client} onChange={(e) => modifierOffre({ client: e.target.value })} />
                  </ChampSaisie>
                  <ChampSaisie id="offre-commercial" label="Commercial">
                    <Input
                      id="offre-commercial"
                      value={offre.commercial}
                      onChange={(e) => modifierOffre({ commercial: e.target.value })}
                    />
                  </ChampSaisie>
                  <ChampSaisie id="offre-objet" label="Objet">
                    <Input id="offre-objet" value={offre.objet} onChange={(e) => modifierOffre({ objet: e.target.value })} />
                  </ChampSaisie>
                  <ChampSaisie id="offre-type" label="Type d'affaire">
                    <Input
                      id="offre-type"
                      value={offre.typeAffaire}
                      onChange={(e) => modifierOffre({ typeAffaire: e.target.value })}
                    />
                  </ChampSaisie>
                </div>
              </Bloc>

              <Bloc titre="Normes et exigences" aide="Valeur qui termine chaque phrase ; une valeur vide n'est pas imprimée.">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {offre.normes.map(({ key, valeur }) => (
                    <div key={key} className="flex items-end gap-1">
                      <div className="min-w-0 flex-1">
                        <ChampSaisie id={`offre-norme-${key}`} label={libelleNorme(key)}>
                          <Input
                            id={`offre-norme-${key}`}
                            value={valeur}
                            onChange={(e) =>
                              modifierOffre({
                                normes: offre.normes.map((n) => (n.key === key ? { key, valeur: e.target.value } : n)),
                              })
                            }
                          />
                        </ChampSaisie>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Retirer"
                        className="mb-0.5"
                        onClick={() => modifierOffre({ normes: offre.normes.filter((n) => n.key !== key) })}
                      >
                        <IconTrash />
                      </Button>
                    </div>
                  ))}
                </div>
                {normesManquantes.length > 0 && (
                  <div className="sm:w-80">
                    <Liste
                      label="Ajouter une norme"
                      valeur=""
                      vide="Choisir…"
                      options={normesManquantes.map(({ key, label }) => ({ valeur: key, libelle: label }))}
                      onChange={(key) =>
                        key !== "" && modifierOffre({ normes: [...offre.normes, { key: key as ChampNorme, valeur: "" }] })
                      }
                    />
                  </div>
                )}
              </Bloc>

              <Bloc titre="Objet de l'offre" aide="Barres du tableau ; le tonnage et le prix à la tonne s'en déduisent.">
                <EnteteColonnes
                  className={COLONNES_BARRES}
                  colonnes={["Profil", "Quantité", "Longueur (mm)", "Poids unit. (t)"]}
                />
                <Lignes
                  items={offre.barres}
                  vide={BARRES_VIDE}
                  ajout="Ajouter une ligne"
                  onChange={(barres) => modifierOffre({ barres })}
                >
                  {(barres, modifierBarres) => (
                    <div className={`grid grid-cols-2 gap-2 ${COLONNES_BARRES}`}>
                      <Input
                        placeholder="Profil"
                        value={barres.profil}
                        onChange={(e) => modifierBarres({ ...barres, profil: e.target.value })}
                      />
                      <ChampNombre
                        placeholder="Quantité"
                        decimales={0}
                        valeur={barres.nombre > 0 ? barres.nombre : null}
                        onChange={(nombre) => modifierBarres({ ...barres, nombre: nombre ?? 0 })}
                      />
                      <ChampNombre
                        placeholder="Longueur (mm)"
                        decimales={1}
                        valeur={barres.longueur}
                        onChange={(longueur) => modifierBarres({ ...barres, longueur })}
                      />
                      <ChampNombre
                        placeholder="Poids unit. (t)"
                        valeur={barres.poids}
                        onChange={(poids) => modifierBarres({ ...barres, poids })}
                      />
                    </div>
                  )}
                </Lignes>
              </Bloc>

              <Bloc titre="Détail des opérations">
                <Lignes
                  items={offre.operations}
                  vide={OPERATION_VIDE}
                  ajout="Ajouter une opération"
                  onChange={(operations) => modifierOffre({ operations })}
                >
                  {(operation, modifierOperation) => (
                    <div className="flex flex-col gap-2 rounded-lg border p-3">
                      <Input
                        className="font-medium"
                        placeholder="Opération"
                        value={operation.libelle}
                        onChange={(e) => modifierOperation({ ...operation, libelle: e.target.value })}
                      />
                      <Lignes
                        items={operation.quantites}
                        vide={{ label: "", valeur: "" }}
                        ajout="Ajouter une quantité"
                        onChange={(quantites) => modifierOperation({ ...operation, quantites })}
                      >
                        {(quantite, modifierQuantite) => (
                          <div className="grid grid-cols-2 gap-2">
                            <Input
                              placeholder="Libellé"
                              value={quantite.label}
                              onChange={(e) => modifierQuantite({ ...quantite, label: e.target.value })}
                            />
                            <Input
                              placeholder="Valeur"
                              value={quantite.valeur}
                              onChange={(e) => modifierQuantite({ ...quantite, valeur: e.target.value })}
                            />
                          </div>
                        )}
                      </Lignes>
                    </div>
                  )}
                </Lignes>
              </Bloc>

              <Bloc
                titre="Montant"
                aide="En € HT. Le montant est recalculé quand le sous-total ou une majoration change ; il peut ensuite être forcé."
              >
                <div className="sm:w-56">
                  <ChampSaisie label="Sous-total" aide="imprimé s'il y a des majorations">
                    <ChampNombre
                      decimales={2}
                      valeur={offre.sousTotal}
                      onChange={(sousTotal) => modifierMontants({ sousTotal })}
                    />
                  </ChampSaisie>
                </div>
                <Lignes
                  items={offre.majorations}
                  vide={{ label: "", montant: null }}
                  ajout="Ajouter une majoration"
                  onChange={(majorations) => modifierMontants({ majorations })}
                >
                  {(majoration, modifierMajoration) => (
                    <div className="grid grid-cols-[1fr_10rem] gap-2">
                      <Input
                        placeholder="Majoration"
                        value={majoration.label}
                        onChange={(e) => modifierMajoration({ ...majoration, label: e.target.value })}
                      />
                      <ChampNombre
                        placeholder="Montant"
                        decimales={2}
                        valeur={majoration.montant}
                        onChange={(montant) => modifierMajoration({ ...majoration, montant })}
                      />
                    </div>
                  )}
                </Lignes>
                <div className="flex flex-wrap items-end gap-4">
                  <div className="sm:w-56">
                    <ChampSaisie label="Montant HT">
                      <ChampNombre decimales={2} valeur={offre.montant} onChange={(montant) => modifierOffre({ montant })} />
                    </ChampSaisie>
                  </div>
                  <span className="pb-1.5 text-sm text-muted-foreground">
                    Prix à la tonne :{" "}
                    {offre.montant !== null && tonnage > 0 ? `${euros(offre.montant / tonnage)} / t` : "—"}
                  </span>
                </div>
              </Bloc>

              <Bloc titre="Soudage — pièces à souder par barre" aide="Section imprimée seulement si elle a des lignes.">
                <EnteteColonnes
                  className={COLONNES_SOUDURES}
                  colonnes={["Désignation", "Nombre", "Longueur (mm)", "Préparation", "Passes"]}
                />
                <Lignes
                  items={offre.soudures}
                  vide={SOUDURE_VIDE}
                  ajout="Ajouter une pièce"
                  onChange={(soudures) => modifierOffre({ soudures })}
                >
                  {(soudure, modifierSoudure) => (
                    <div className={`grid grid-cols-2 gap-2 ${COLONNES_SOUDURES}`}>
                      {(["designation", "nombre", "longueur", "preparation", "passes"] as const).map((champ) => (
                        <Input
                          key={champ}
                          value={soudure[champ]}
                          onChange={(e) => modifierSoudure({ ...soudure, [champ]: e.target.value })}
                        />
                      ))}
                    </div>
                  )}
                </Lignes>
              </Bloc>
            </TabsContent>

            <TabsContent value="textes" className="flex flex-col gap-4">
              <p className="text-xs text-muted-foreground">
                Textes copiés du modèle d'offre à l'ouverture : les modifier ici ne change pas le modèle.
              </p>
              <EditeurModele modele={modele} onChange={(suivant) => setEnCours((prev) => ({ ...prev, modele: suivant }))} />
            </TabsContent>
          </div>
        </Tabs>

        <DialogFooter className="sm:items-center">
          <span className="text-xs text-muted-foreground sm:mr-auto">
            {enCours.id === null
              ? "Pas encore enregistrée : elle le sera à l'export."
              : modifie
                ? "Modifications non enregistrées"
                : "Offre enregistrée"}
          </span>
          <Button variant="outline" onClick={onFermer} disabled={occupe !== null}>
            Fermer
          </Button>
          <Button variant="outline" onClick={enregistrerSeul} disabled={occupe !== null || !modifie}>
            {occupe === "enregistrement" ? "Enregistrement…" : "Enregistrer"}
          </Button>
          <Button onClick={exporter} disabled={occupe !== null}>
            {occupe === "export" ? "Export…" : "Exporter le PDF"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
