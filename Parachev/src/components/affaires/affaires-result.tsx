import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { totalFor, type Affaire } from "../../lib/affaires"

interface AffaireResultsProps {
  results: Affaire[]
}

export function AffaireResults({ results }: AffaireResultsProps) {
  return (
    <>
      <div className="text-sm text-muted-foreground">
        {results.length} result{results.length !== 1 ? "s" : ""}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {results.map((item) => (
          <Card key={item.id}>
            <CardHeader>
              <CardTitle>{item.client}</CardTitle>
              <CardDescription>
                <Badge variant="outline" className="px-1.5 text-muted-foreground">
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
                <span className="font-medium tabular-nums">{totalFor(item)}</span>
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
    </>
  )
}