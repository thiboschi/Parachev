import { IconSearch } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select"
import { CHAMPS_VARIABLES_NUMERIQUES } from "@/lib/variables-affaires"
import { TYPES_PRODUCTION } from "@/lib/flux-production"

type ChampVariableKey = (typeof CHAMPS_VARIABLES_NUMERIQUES)[number]["key"]

interface AffaireSearchBarProps {
  searchText: string
  onSearchTextChange: (value: string) => void
  client: string
  onClientChange: (value: string) => void
  clientOptions: string[]
  profil: string
  onProfilChange: (value: string) => void
  profilOptions: string[]
  type: string
  onTypeChange: (value: string) => void
  variableFiltres: Partial<Record<ChampVariableKey, string>>
  onVariableFiltreChange: (key: ChampVariableKey, value: string) => void
  onResetVariables: () => void
}

export function AffaireSearchBar({
  searchText,
  onSearchTextChange,
  client,
  onClientChange,
  clientOptions,
  profil,
  onProfilChange,
  profilOptions,
  type,
  onTypeChange,
  variableFiltres,
  onVariableFiltreChange,
  onResetVariables,
}: AffaireSearchBarProps) {
  const aUnFiltre = Object.values(variableFiltres).some((v) => v && v.trim())
  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex flex-col gap-4 md:flex-row md:items-end">
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="search-query">Search</Label>
          <div className="relative">
            <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="search-query"
              placeholder="Client, numéro d'affaire, profil, n° de plan..."
              className="pl-8"
              value={searchText}
              onChange={(e) => onSearchTextChange(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="client-filter">Client</Label>
          <Select value={client} onValueChange={(value) => onClientChange(value ?? "all")}>
            <SelectTrigger id="client-filter" className="w-full md:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les clients</SelectItem>
              {clientOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="profil-filter">Profil</Label>
          <Select value={profil} onValueChange={(value) => onProfilChange(value ?? "all")}>
            <SelectTrigger id="profil-filter" className="w-full md:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les profils</SelectItem>
              {profilOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="type-filter">Type</Label>
          <Select value={type} onValueChange={(value) => onTypeChange(value ?? "all")}>
            <SelectTrigger id="type-filter" className="w-full md:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les types</SelectItem>
              {TYPES_PRODUCTION.map(({ nom }) => (
                <SelectItem key={nom} value={nom}>
                  {nom}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>Rechercher par valeur de variable</Label>
          {aUnFiltre && (
            <Button type="button" variant="ghost" size="xs" onClick={onResetVariables}>
              Réinitialiser
            </Button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
          {CHAMPS_VARIABLES_NUMERIQUES.map(({ key, label, seuils }) => (
            <div key={key} className="flex flex-col gap-1">
              <Label htmlFor={`variable-filtre-${key}`} className="text-xs text-muted-foreground">
                {label}
              </Label>
              <Select
                value={variableFiltres[key] ?? "all"}
                onValueChange={(value) => onVariableFiltreChange(key, !value || value === "all" ? "" : value)}
              >
                <SelectTrigger id={`variable-filtre-${key}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous</SelectItem>
                  {seuils.map((seuil) => (
                    <SelectItem key={seuil} value={`>${seuil}`}>
                      {`> ${seuil}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export type { ChampVariableKey }