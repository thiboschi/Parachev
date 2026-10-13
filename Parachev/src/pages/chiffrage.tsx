import { IconChevronDown } from "@tabler/icons-react"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Label } from "@/components/ui/label"
import { MultiSelect } from "@/components/affaires/multi-select"
import { ChampSaisie, Liste, Section } from "@/components/chiffrage/champs"
import { Estimation } from "@/components/chiffrage/estimation"
import { SaisiePoste } from "@/components/chiffrage/saisie-poste"
import { useChiffrage } from "@/hooks/use-chiffrage"
import {
  CHAMPS_CLIENT,
  CHAMPS_POUTRE,
  LIBELLES_CHAMPS,
  aSaisieParGroupe,
  aideTotal,
  cocherPoste,
  estExigence,
  posteCoche,
  versOptions,
} from "@/lib/chiffrage"
import { TYPES_PRODUCTION } from "@/lib/flux-production"
import { libellePoste } from "@/lib/postes"
import { cn } from "@/lib/utils"
import { CHAMPS_NORMES } from "@/lib/recherche"
import { familleProfil, profilCorrespond } from "@/lib/profils"

export default function Chiffrage() {
  const chiffrage = useChiffrage()
  const {
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
  } = chiffrage

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
              Chiffre le temps de fabrication d'un projet qui n'est pas (encore)
              dans le dossier surveillé, rien n'est
              enregistré en base, c'est une simulation.
            </p>
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="flex min-w-0 flex-col gap-4">
              <Card>
                <CardContent className="flex flex-col gap-5">
                  <Section titre="Infos Client">
                    {CHAMPS_CLIENT.map(({ key, label }) => (
                      <ChampSaisie key={key} id={`client-${key}`} label={label}>
                        <Input
                          id={`client-${key}`}
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
                            onClick={() => retirerGroupe(groupe.id)}
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
                      {modules.map((m) => {
                        const { poste } = m
                        const coche = posteCoche(groupe, m)
                        const ouvrable = coche && aSaisieParGroupe(poste)
                        const id = `poste-${groupe.id}-${poste}`
                        return (
                          // Poste de la gamme : grisé tant qu'il est décoché, le groupe n'y
                          // passe alors pas. Coché, il ouvre un volet déroulant s'il a une
                          // saisie ; replié, son contenu reste monté : le calculateur de
                          // soudage garde ses pièces et ses heures.
                          <Collapsible key={poste} className={cn("rounded-md border", !coche && "bg-muted/50")}>
                            <div className="flex items-center gap-2 px-3 text-sm">
                              <Checkbox
                                id={id}
                                aria-label={libellePoste(poste)}
                                checked={coche}
                                onCheckedChange={(valeur) =>
                                  modifierGroupe(groupe.id, (g) => cocherPoste(g, m, valeur === true))
                                }
                              />
                              {ouvrable ? (
                                <CollapsibleTrigger className="flex flex-1 items-center justify-between gap-2 py-2 text-left [&[data-panel-open]>svg]:rotate-180">
                                  <span className="font-medium">{libellePoste(poste)}</span>
                                  <IconChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform" />
                                </CollapsibleTrigger>
                              ) : (
                                <Label
                                  htmlFor={id}
                                  className={cn("flex-1 py-2", !coche && "font-normal text-muted-foreground")}
                                >
                                  {libellePoste(poste)}
                                </Label>
                              )}
                            </div>
                            {ouvrable && (
                              <CollapsiblePanel keepMounted>
                                <div className="flex flex-col gap-3 px-3 pb-3 text-sm">
                                  <SaisiePoste chiffrage={chiffrage} groupe={groupe} poste={poste} />
                                </div>
                              </CollapsiblePanel>
                            )}
                          </Collapsible>
                        )
                      })}
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

            <Estimation chiffrage={chiffrage} />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
