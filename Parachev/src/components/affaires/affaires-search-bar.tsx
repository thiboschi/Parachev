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
  status: string
  onStatusChange: (value: string) => void
  statusOptions: string[]
  reviewer: string
  onReviewerChange: (value: string) => void
  reviewerOptions: string[]
  semaine: string
  onSemaineChange: (value: string) => void
  semaineOptions: string[]
  onAddPoutreRow: () => void
}

export function AffaireSearchBar({
  searchText,
  onSearchTextChange,
  status,
  onStatusChange,
  statusOptions,
  reviewer,
  onReviewerChange,
  reviewerOptions,
  semaine,
  onSemaineChange,
  semaineOptions,
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
            placeholder="Client, numéro, reviewer..."
            className="pl-8"
            value={searchText}
            onChange={(e) => onSearchTextChange(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="status-filter">Status</Label>
        <Select value={status} onValueChange={(value) => onStatusChange(value ?? "all")}>
          <SelectTrigger id="status-filter" className="w-full md:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {statusOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="reviewer-filter">Reviewer</Label>
        <Select value={reviewer} onValueChange={(value) => onReviewerChange(value ?? "all")}>
          <SelectTrigger id="reviewer-filter" className="w-full md:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All reviewers</SelectItem>
            {reviewerOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="semaine-filter">Semaine</Label>
        <Select value={semaine} onValueChange={(value) => onSemaineChange(value ?? "all")}>
          <SelectTrigger id="semaine-filter" className="w-full md:w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All weeks</SelectItem>
            {semaineOptions.map((option) => (
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