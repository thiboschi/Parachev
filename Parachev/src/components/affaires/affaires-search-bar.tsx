import * as React from "react"
import { IconAdjustmentsHorizontal, IconSearch } from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsiblePanel } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MultiSelect } from "@/components/affaires/multi-select"
import { useEtatSession } from "@/hooks/use-etat-session"
import {
  CHAMPS_DATE,
  CHAMPS_NORMES,
  INTERVALLE_VIDE,
  QUANTITES,
  TRIS,
  etenduesQuantites,
  intervalleInverse,
  type ChampDate,
  type EtendueQuantite,
  type Filtres,
  type IntervalleFiltre,
  type OptionsFiltres,
  type SourceMachines,
  type Tri,
} from "@/lib/recherche"

interface AffaireSearchBarProps {
  filtres: Filtres
  onChange: (modif: Partial<Filtres>) => void
  onReset: () => void
  options: OptionsFiltres
  /** Étendue de chaque quantité dans les données (repère de saisie). */
  etendues: ReturnType<typeof etenduesQuantites>
  nbFiltresAvances: number
  tri: Tri
  onTriChange: (tri: Tri) => void
  /** Reprendre l'état enregistré (retour depuis une affaire). */
  restaurer: boolean
}

const STATUTS = { toutes: "Toutes", actives: "Non annulées", annulees: "Annulées" } as const
const SOURCES_MACHINES: Record<SourceMachines, string> = {
  toutes: "Prévue ou réalisée",
  realise: "Réalisée (SUIVI, ERP)",
  prevu: "Prévue (fiche)",
}

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground uppercase">{titre}</span>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </div>
  )
}

const formatBorne = (n: number) => n.toLocaleString("fr-BE", { maximumFractionDigits: 1 })

/**
 * Deux champs numériques min / max côte à côte. L'étendue observée dans les
 * données sert de repère (placeholders) et le libellé rappelle combien
 * d'affaires ont la quantité renseignée.
 */
function Intervalle({
  label,
  valeur,
  etendue,
  onChange,
}: {
  label: string
  valeur: IntervalleFiltre
  etendue?: EtendueQuantite
  onChange: (valeur: IntervalleFiltre) => void
}) {
  const inverse = intervalleInverse(valeur)
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">
        {label}
        <span className="font-normal opacity-70">· {etendue?.nombre ?? 0} aff.</span>
      </Label>
      <div className="flex gap-2">
        <Input
          type="number"
          min={0}
          step="any"
          aria-label={`${label} : minimum`}
          aria-invalid={inverse}
          placeholder={etendue ? `min ${formatBorne(etendue.min)}` : "min"}
          value={valeur.min}
          onChange={(e) => onChange({ ...valeur, min: e.target.value })}
        />
        <Input
          type="number"
          min={0}
          step="any"
          aria-label={`${label} : maximum`}
          aria-invalid={inverse}
          placeholder={etendue ? `max ${formatBorne(etendue.max)}` : "max"}
          value={valeur.max}
          onChange={(e) => onChange({ ...valeur, max: e.target.value })}
        />
      </div>
    </div>
  )
}

export function AffaireSearchBar({
  filtres,
  onChange,
  onReset,
  options,
  etendues,
  nbFiltresAvances,
  tri,
  onTriChange,
  restaurer,
}: AffaireSearchBarProps) {
  const [ouvert, setOuvert] = useEtatSession("recherche.filtresAvancesOuverts", false, { restaurer })
  const multi = (
    cle: keyof Filtres & keyof OptionsFiltres,
    label: string,
    aide?: string
  ) => (
    <MultiSelect
      label={label}
      aide={aide}
      options={options[cle] as OptionsFiltres["exc"]}
      valeurs={filtres[cle] as string[]}
      onChange={(valeurs) => onChange({ [cle]: valeurs } as Partial<Filtres>)}
    />
  )
  const clientItems = { all: "Tous les clients", ...Object.fromEntries(options.clients.map((c) => [c, c])) }

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex flex-col gap-4 md:flex-row md:items-end">
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="search-query">Recherche</Label>
          <div className="relative">
            <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="search-query"
              placeholder="N° d'affaire, client, projet, profil, contenu des mails et documents…"
              className="pl-8"
              value={filtres.texte}
              onChange={(e) => onChange({ texte: e.target.value })}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="client-filter">Client</Label>
          <Select items={clientItems} value={filtres.client} onValueChange={(v) => onChange({ client: v ?? "all" })}>
            <SelectTrigger id="client-filter" className="w-full md:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les clients</SelectItem>
              {options.clients.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="statut-filter">Statut</Label>
          <Select
            items={STATUTS}
            value={filtres.statut}
            onValueChange={(v) => onChange({ statut: (v ?? "toutes") as Filtres["statut"] })}
          >
            <SelectTrigger id="statut-filter" className="w-full md:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STATUTS).map(([valeur, libelle]) => (
                <SelectItem key={valeur} value={valeur}>
                  {libelle}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="tri">Trier par</Label>
          <Select items={TRIS} value={tri} onValueChange={(v) => onTriChange((v ?? "affaire") as Tri)}>
            <SelectTrigger id="tri" className="w-full md:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(TRIS).map(([valeur, libelle]) => (
                <SelectItem key={valeur} value={valeur}>
                  {libelle}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={() => setOuvert((o) => !o)} aria-expanded={ouvert}>
          <IconAdjustmentsHorizontal />
          Filtres avancés
          {nbFiltresAvances > 0 && <Badge className="ml-1 px-1.5">{nbFiltresAvances}</Badge>}
        </Button>
      </div>

      <Collapsible open={ouvert} onOpenChange={setOuvert}>
        <CollapsiblePanel>
          <div className="flex flex-col gap-5 border-t pt-4">
            <Section titre="Dates">
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Date de</Label>
                <Select
                  items={CHAMPS_DATE}
                  value={filtres.champDate}
                  onValueChange={(v) => onChange({ champDate: (v ?? "date_commande") as ChampDate })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CHAMPS_DATE).map(([valeur, libelle]) => (
                      <SelectItem key={valeur} value={valeur}>
                        {libelle}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Du</Label>
                <Input type="date" value={filtres.dateDu} onChange={(e) => onChange({ dateDu: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Au</Label>
                <Input type="date" value={filtres.dateAu} onChange={(e) => onChange({ dateAu: e.target.value })} />
              </div>
            </Section>

            <Section titre="Production (Flux de production BFC)">
              <div className="flex flex-col gap-1.5">
                {multi("typesProduction", "Type de production")}
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    checked={filtres.fluxStrict}
                    onCheckedChange={(c) => onChange({ fluxStrict: c })}
                  />
                  Strict : aucune autre machine que l'itinéraire
                </label>
              </div>
              {multi("machines", "Machines / postes", "toutes requises")}
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Machine</Label>
                <Select
                  items={SOURCES_MACHINES}
                  value={filtres.sourceMachines}
                  onValueChange={(v) => onChange({ sourceMachines: (v ?? "toutes") as SourceMachines })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(SOURCES_MACHINES).map(([valeur, libelle]) => (
                      <SelectItem key={valeur} value={valeur}>
                        {libelle}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {multi("operationsRde", "Opérations demandées (RDE)", "toutes requises")}
              {multi("typesAffaire", "Type d'affaire (RDE)")}
              {multi("traitements", "Traitement de surface")}
            </Section>

            <Section titre="Normes et exigences (RDE)">
              {CHAMPS_NORMES.map(({ key, label }) => (
                <React.Fragment key={key}>{multi(key, label)}</React.Fragment>
              ))}
            </Section>

            <Section titre="Matière">
              {multi("familles", "Famille de profil")}
              {multi("profils", "Profil")}
              {multi("nuances", "Nuance")}
              {multi("usines", "Usine de laminage")}
            </Section>

            <Section titre="Quantités">
              {QUANTITES.map(({ cle, label }) => (
                <Intervalle
                  key={cle}
                  label={label}
                  valeur={filtres.quantites[cle] ?? INTERVALLE_VIDE}
                  etendue={etendues[cle]}
                  onChange={(valeur) => onChange({ quantites: { ...filtres.quantites, [cle]: valeur } })}
                />
              ))}
            </Section>

            <Section titre="Dossier">
              {(
                [
                  ["avecNonConformite", "Avec non-conformité"],
                  ["avecRde", "Avec RDE"],
                  ["avecFiche", "Avec fiche de prévision"],
                ] as const
              ).map(([cle, libelle]) => (
                <label key={cle} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={filtres[cle]} onCheckedChange={(c) => onChange({ [cle]: c })} />
                  {libelle}
                </label>
              ))}
            </Section>

            {nbFiltresAvances > 0 && (
              <Button variant="ghost" size="sm" className="w-fit" onClick={onReset}>
                Réinitialiser les filtres
              </Button>
            )}
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  )
}
