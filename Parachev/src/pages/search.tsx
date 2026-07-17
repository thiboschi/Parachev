import * as React from "react"
import { IconSearch } from "@tabler/icons-react"
import { z } from "zod"

import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

import searchData from "@/data/search.json"

// machines[] entries aren't all shaped the same across search.json (some
// carry stray "profil"/"nb_poutre" keys), so keep values loosely typed and
// sum defensively rather than assuming every key is a machine value.
const affaireSchema = z.object({
  id: z.number(),
  client: z.string(),
  numero: z.string(),
  status: z.string(),
  semaine: z.string(),
  reviewer: z.string(),
  machines: z.array(z.record(z.string(), z.unknown())),
})

type Affaire = z.infer<typeof affaireSchema>

const items: Affaire[] = searchData

const NON_MACHINE_KEYS = new Set(["nb_poutre", "profil"])

function totalFor(item: Affaire) {
  return item.machines.reduce(
    (sum, entry) =>
      sum +
      Object.entries(entry).reduce<number>(
        (s, [key, value]) =>
          NON_MACHINE_KEYS.has(key) || typeof value !== "number"
            ? s
            : s + value,
        0
      ),
    0
  )
}

export default function Search() {
  const [searchText, setSearchText] = React.useState("")
  const [status, setStatus] = React.useState("all")
  const [reviewer, setReviewer] = React.useState("all")
  const [semaine, setSemaine] = React.useState("all")

  const statusOptions = React.useMemo(
    () => Array.from(new Set(items.map((item) => item.status))).sort(),
    []
  )
  const reviewerOptions = React.useMemo(
    () => Array.from(new Set(items.map((item) => item.reviewer))).sort(),
    []
  )
  const semaineOptions = React.useMemo(
    () => Array.from(new Set(items.map((item) => item.semaine))).sort(),
    []
  )

  const results = React.useMemo(() => {
    const query = searchText.trim().toLowerCase()
    return items.filter((item) => {
      const matchesQuery =
        !query ||
        [item.client, item.numero, item.status, item.semaine, item.reviewer]
          .join(" ")
          .toLowerCase()
          .includes(query)
      const matchesStatus = status === "all" || item.status === status
      const matchesReviewer = reviewer === "all" || item.reviewer === reviewer
      const matchesSemaine = semaine === "all" || item.semaine === semaine
      return matchesQuery && matchesStatus && matchesReviewer && matchesSemaine
    })
  }, [searchText, status, reviewer, semaine])

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
        <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
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
                  onChange={(e) => setSearchText(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="status-filter">Status</Label>
              <Select
                value={status}
                onValueChange={(value) => setStatus(value ?? "all")}
              >
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
              <Select
                value={reviewer}
                onValueChange={(value) => setReviewer(value ?? "all")}
              >
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
              <Select
                value={semaine}
                onValueChange={(value) => setSemaine(value ?? "all")}
              >
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
          </div>

          <div className="text-sm text-muted-foreground">
            {results.length} result{results.length !== 1 ? "s" : ""}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {results.map((item) => (
              <Card key={item.id}>
                <CardHeader>
                  <CardTitle>{item.client}</CardTitle>
                  <CardDescription>
                    <Badge
                      variant="outline"
                      className="px-1.5 text-muted-foreground"
                    >
                      {item.numero}
                    </Badge>
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <Badge variant="outline">{item.status}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Semaine</span>
                    <span>{item.semaine}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Reviewer</span>
                    <span>{item.reviewer}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Total</span>
                    <span className="font-medium tabular-nums">
                      {totalFor(item)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
            {results.length === 0 && (
              <div className="col-span-full py-12 text-center text-sm text-muted-foreground">
                No results.
              </div>
            )}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
