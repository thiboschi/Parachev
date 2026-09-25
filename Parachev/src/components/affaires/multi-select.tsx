import { IconChevronDown } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
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
}

/** Liste déroulante à cases à cocher ; le menu reste ouvert entre deux clics. */
export function MultiSelect({ label, options, valeurs, onChange, aide }: MultiSelectProps) {
  const basculer = (valeur: string, coche: boolean) =>
    onChange(coche ? [...valeurs, valeur] : valeurs.filter((v) => v !== valeur))

  const resume =
    valeurs.length === 0
      ? "Tous"
      : valeurs.length === 1
        ? (options.find((o) => o.valeur === valeurs[0])?.libelle ?? valeurs[0])
        : `${valeurs.length} sélectionnés`

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label className="text-xs text-muted-foreground">
        {label}
        {aide && <span className="font-normal opacity-70"> · {aide}</span>}
      </Label>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              className="w-full justify-between font-normal"
              disabled={options.length === 0}
            />
          }
        >
          <span className="truncate">{options.length === 0 ? "Aucune donnée" : resume}</span>
          <IconChevronDown className="opacity-50" />
        </DropdownMenuTrigger>
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
              <span className="flex-1 truncate">{o.libelle}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{o.nombre}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
