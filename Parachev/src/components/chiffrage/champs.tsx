import { Combobox, ComboboxContent, ComboboxItem, ComboboxList, ComboboxSelectTrigger, ComboboxValue } from "@/components/ui/combobox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

// Sentinelle pour "rien de sélectionné" -- un Select ne peut pas prendre
// une valeur vide comme item.
const NON_RENSEIGNE = "none"

export function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs font-medium text-muted-foreground uppercase">{titre}</span>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </div>
  )
}

export function ChampSaisie({ id, label, aide, children }: { id?: string, label: string, aide?: string, children: React.ReactNode }) {
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
export function Liste({ label, valeur, options, vide = "Non renseigné", desactive = false, recherche, onChange }: {
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
