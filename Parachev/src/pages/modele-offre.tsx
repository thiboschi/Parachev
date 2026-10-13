import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from "@tabler/icons-react"
import { toast } from "sonner"
import { AppSidebar } from "@/components/app-sidebar"
import { ChampSaisie } from "@/components/chiffrage/champs"
import { SiteHeader } from "@/components/dashboard/site-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Textarea } from "@/components/ui/textarea"
import {
  MODELE_PAR_DEFAUT,
  lireModeleOffre,
  nettoyerModeleOffre,
  type ConditionOffre,
  type ListeAnnexe,
  type ModeleOffre,
} from "@/lib/modele-offre"
import { CHAMPS_NORMES } from "@/lib/recherche"

// Textes fixes de l'offre PDF de la page "Chiffrage" : rien n'est enregistré
// avant le bouton "Enregistrer", et l'offre exportée ensuite les reprend.

function Bloc({ titre, aide, children }: { titre: string; aide?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium text-muted-foreground uppercase">{titre}</span>
          {aide && <span className="text-xs text-muted-foreground">{aide}</span>}
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

/** Liste dont on peut modifier, déplacer, retirer et ajouter les lignes. */
function Lignes<T>({ items, vide, ajout, onChange, children }: {
  items: T[]
  /** Ligne ajoutée par le bouton. */
  vide: T
  ajout: string
  onChange: (items: T[]) => void
  children: (item: T, modifier: (item: T) => void) => React.ReactNode
}) {
  const deplacer = (i: number, vers: number) => {
    const suite = [...items]
    ;[suite[i], suite[vers]] = [suite[vers], suite[i]]
    onChange(suite)
  }
  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-1">
          <div className="min-w-0 flex-1">
            {children(item, (suivant) => onChange(items.map((x, j) => (j === i ? suivant : x))))}
          </div>
          <Button variant="ghost" size="icon-sm" title="Monter" disabled={i === 0} onClick={() => deplacer(i, i - 1)}>
            <IconArrowUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Descendre"
            disabled={i === items.length - 1}
            onClick={() => deplacer(i, i + 1)}
          >
            <IconArrowDown />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Supprimer"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            <IconTrash />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="self-start" onClick={() => onChange([...items, vide])}>
        <IconPlus />
        {ajout}
      </Button>
    </div>
  )
}

/** Texte sur plusieurs lignes : la hauteur suit le contenu. */
function Texte({ valeur, onChange, ...props }: Omit<React.ComponentProps<"textarea">, "onChange"> & {
  valeur: string
  onChange: (valeur: string) => void
}) {
  return (
    <Textarea className="min-h-8" rows={2} value={valeur} onChange={(e) => onChange(e.target.value)} {...props} />
  )
}

const LISTE_VIDE: ListeAnnexe = { titre: "", lignes: [""] }
const CONDITION_VIDE: ConditionOffre = { label: "", valeur: "" }

const libelleNorme = (key: string) => CHAMPS_NORMES.find((champ) => champ.key === key)?.label ?? key

export default function ModeleOffre() {
  const [modele, setModele] = useState<ModeleOffre | null>(null)
  // Dernier modèle enregistré : dit s'il reste des modifications à enregistrer.
  const [enregistre, setEnregistre] = useState<ModeleOffre | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [enregistrement, setEnregistrement] = useState(false)

  useEffect(() => {
    invoke<string | null>("obtenir_modele_offre")
      .then((json) => {
        const lu = lireModeleOffre(json)
        setModele(lu)
        setEnregistre(lu)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const modifie = JSON.stringify(modele) !== JSON.stringify(enregistre)

  function modifier(champs: Partial<ModeleOffre>) {
    setModele((prev) => prev && { ...prev, ...champs })
  }

  async function enregistrer() {
    if (!modele) return
    const propre = nettoyerModeleOffre(modele)
    setEnregistrement(true)
    try {
      await invoke("enregistrer_modele_offre", { modele: JSON.stringify(propre) })
      setModele(propre)
      setEnregistre(propre)
      toast.success("Modèle d'offre enregistré")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setEnregistrement(false)
    }
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
        <div className="flex w-full max-w-4xl flex-1 flex-col gap-4 p-4 lg:p-6">
          {error && <p className="text-sm text-destructive">Impossible de lire le modèle d'offre ({error})</p>}

          {!modele && !error && <p className="text-sm text-muted-foreground">Chargement…</p>}

          {modele && (
            <>
              <div className="sticky top-0 z-10 flex items-center gap-2 bg-background py-2">
                <Button onClick={enregistrer} disabled={!modifie || enregistrement}>
                  {enregistrement ? "Enregistrement…" : "Enregistrer"}
                </Button>
                <Button variant="ghost" onClick={() => setModele(enregistre)} disabled={!modifie || enregistrement}>
                  Annuler
                </Button>
                <Button variant="outline" onClick={() => setModele(MODELE_PAR_DEFAUT)} disabled={enregistrement}>
                  Textes par défaut
                </Button>
                {modifie && <span className="text-xs text-muted-foreground">Modifications non enregistrées</span>}
              </div>

              <Bloc titre="En-tête">
                <ChampSaisie id="auteur" label="Signataire" aide="en-tête et signature">
                  <Input id="auteur" value={modele.auteur} onChange={(e) => modifier({ auteur: e.target.value })} />
                </ChampSaisie>
                <ChampSaisie id="accroche" label="Phrase d'introduction" aide="première page">
                  <Texte id="accroche" valeur={modele.accroche} onChange={(accroche) => modifier({ accroche })} />
                </ChampSaisie>
              </Bloc>

              <Bloc
                titre="Normes et exigences"
                aide="Début de chaque phrase, que termine la valeur choisie sur la page Chiffrage."
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {modele.phrasesNormes.map(({ key, phrase }) => (
                    <ChampSaisie key={key} id={`norme-${key}`} label={libelleNorme(key)}>
                      <Input
                        id={`norme-${key}`}
                        value={phrase}
                        onChange={(e) =>
                          modifier({
                            phrasesNormes: modele.phrasesNormes.map((p) =>
                              p.key === key ? { key, phrase: e.target.value } : p
                            ),
                          })
                        }
                      />
                    </ChampSaisie>
                  ))}
                </div>
                <ChampSaisie id="tracabilite" label="Mention sous les normes">
                  <Texte
                    id="tracabilite"
                    valeur={modele.tracabilite}
                    onChange={(tracabilite) => modifier({ tracabilite })}
                  />
                </ChampSaisie>
              </Bloc>

              <Bloc titre="Annexe — listes" aide="Sections numérotées de l'annexe, dans cet ordre.">
                <Lignes
                  items={modele.listesAnnexe}
                  vide={LISTE_VIDE}
                  ajout="Ajouter une liste"
                  onChange={(listesAnnexe) => modifier({ listesAnnexe })}
                >
                  {(liste, modifierListe) => (
                    <div className="flex flex-col gap-2 rounded-lg border p-3">
                      <Input
                        className="font-medium"
                        placeholder="Titre de la liste"
                        value={liste.titre}
                        onChange={(e) => modifierListe({ ...liste, titre: e.target.value })}
                      />
                      <Lignes
                        items={liste.lignes}
                        vide=""
                        ajout="Ajouter une ligne"
                        onChange={(lignes) => modifierListe({ ...liste, lignes })}
                      >
                        {(ligne, modifierLigne) => <Texte rows={1} valeur={ligne} onChange={modifierLigne} />}
                      </Lignes>
                    </div>
                  )}
                </Lignes>
              </Bloc>

              <Bloc titre="Annexe — informations" aide="Tableau des conditions, dernière section de l'annexe.">
                <Lignes
                  items={modele.conditions}
                  vide={CONDITION_VIDE}
                  ajout="Ajouter une information"
                  onChange={(conditions) => modifier({ conditions })}
                >
                  {(condition, modifierCondition) => (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                      <Input
                        className="sm:w-48 sm:shrink-0"
                        placeholder="Libellé"
                        value={condition.label}
                        onChange={(e) => modifierCondition({ ...condition, label: e.target.value })}
                      />
                      <Texte
                        placeholder="Texte"
                        valeur={condition.valeur}
                        onChange={(valeur) => modifierCondition({ ...condition, valeur })}
                      />
                    </div>
                  )}
                </Lignes>
              </Bloc>

              <Bloc titre="Clôture" aide="Paragraphes de fin de l'annexe, puis la formule de politesse.">
                <Lignes
                  items={modele.cloture}
                  vide=""
                  ajout="Ajouter un paragraphe"
                  onChange={(cloture) => modifier({ cloture })}
                >
                  {(paragraphe, modifierParagraphe) => <Texte valeur={paragraphe} onChange={modifierParagraphe} />}
                </Lignes>
                <ChampSaisie id="politesse" label="Formule de politesse">
                  <Texte id="politesse" valeur={modele.politesse} onChange={(politesse) => modifier({ politesse })} />
                </ChampSaisie>
              </Bloc>
            </>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
