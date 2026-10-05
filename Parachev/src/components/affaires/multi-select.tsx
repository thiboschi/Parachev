import { IconChevronDown } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Combobox, ComboboxContent, ComboboxItem, ComboboxList, ComboboxTrigger } from "@/components/ui/combobox"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import type { OptionFiltre } from "@/lib/recherche"

interface MultiSelectProps {
  label: string
  options: OptionFiltre[]
  valeurs: string[]
  onChange: (valeurs: string[]) => void
  /** Texte affiché sous le libellé (ex. "toutes les cases cochées"). */
  aide?: string
  /** Texte du bouton quand rien n'est coché ("Tous" pour un filtre). */
  vide?: string
  /**
   * Ajoute un champ de recherche en tête de la liste (listes longues) :
   * dit si une valeur correspond au texte saisi.
   */
  recherche?: (valeur: string, requete: string) => boolean
}

/** Liste déroulante à cases à cocher ; le menu reste ouvert entre deux clics. */
export function MultiSelect({ label, options, valeurs, onChange, aide, vide = "Tous", recherche }: MultiSelectProps) {
  const basculer = (valeur: string, coche: boolean) =>
    onChange(coche ? [...valeurs, valeur] : valeurs.filter((v) => v !== valeur))

  const resume =
    valeurs.length === 0
      ? vide
      : valeurs.length === 1
        ? (options.find((o) => o.valeur === valeurs[0])?.libelle ?? valeurs[0])
        : `${valeurs.length} sélectionnés`

  const bouton = (
    <Button variant="outline" className="w-full justify-between font-normal" disabled={options.length === 0} />
  )
  const contenuBouton = (
    <>
      <span className="truncate">{options.length === 0 ? "Aucune donnée" : resume}</span>
      <IconChevronDown className="opacity-50" />
    </>
  )
  const ligne = (o: OptionFiltre) => (
    <>
      <span className="flex-1 truncate">{o.libelle}</span>
      <span className="text-xs text-muted-foreground tabular-nums">{o.nombre}</span>
    </>
  )
  const libelle = (
    <Label className="text-xs text-muted-foreground">
      {label}
      {aide && <span className="font-normal opacity-70"> · {aide}</span>}
    </Label>
  )

  if (recherche) {
    const parValeur = new Map(options.map((o) => [o.valeur, o]))
    return (
      <div className="flex min-w-0 flex-col gap-1">
        {libelle}
        <Combobox
          multiple
          items={options.map((o) => o.valeur)}
          value={valeurs}
          onValueChange={onChange}
          filter={(valeur: string, requete) => recherche(valeur, requete)}
          disabled={options.length === 0}
        >
          <ComboboxTrigger render={bouton}>{contenuBouton}</ComboboxTrigger>
          <ComboboxContent className="min-w-56">
            {valeurs.length > 0 && (
              <button
                type="button"
                className="shrink-0 cursor-default border-b px-2.5 py-1.5 text-left text-sm outline-hidden hover:bg-accent hover:text-accent-foreground"
                onClick={() => onChange([])}
              >
                Tout désélectionner
              </button>
            )}
            <ComboboxList>
              {(valeur: string) => (
                <ComboboxItem key={valeur} value={valeur}>
                  {ligne(parValeur.get(valeur) ?? { valeur, libelle: valeur, nombre: 0 })}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {libelle}
      <DropdownMenu>
        <DropdownMenuTrigger render={bouton}>{contenuBouton}</DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-80 min-w-56">
          {valeurs.length > 0 && (
            <>
              <DropdownMenuItem onClick={() => onChange([])}>Tout désélectionner</DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {options.map((o) => (
            <DropdownMenuCheckboxItem
              key={o.valeur}
              checked={valeurs.includes(o.valeur)}
              onCheckedChange={(coche) => basculer(o.valeur, coche)}
              closeOnClick={false}
            >
              {ligne(o)}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
