import { IconPlus, IconSearch } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface AffaireSearchBarProps {
  searchText: string
  onSearchTextChange: (value: string) => void
  client: string
  onClientChange: (value: string) => void
  clientOptions: string[]
  onAddPoutreRow: () => void
}

export function AffaireSearchBar({
  searchText,
  onSearchTextChange,
  client,
  onClientChange,
  clientOptions,
  onAddPoutreRow,
}: AffaireSearchBarProps) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 ring-1 ring-foreground/10 md:flex-row md:items-end">
      <div className="flex flex-1 flex-col gap-2">
        <Label htmlFor="search-query">Search</Label>
        <div className="relative">
          <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="search-query"
            placeholder="Client, numéro d'affaire..."
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
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="rounded-full"
        onClick={onAddPoutreRow}
      >
        <IconPlus />
        <span className="sr-only">Ajouter une ligne de profil</span>
      </Button>
    </div>
  )
}