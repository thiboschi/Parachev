import { z } from "zod"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import { affaireSchema } from "./data-table-previ"

export function AffaireDescription({
  affaire,
}: {
  affaire: z.infer<typeof affaireSchema>
}) {
  const totalPoutres = affaire.poutres.reduce(
    (sum, poutre) => sum + poutre.nb_poutre,
    0
  )

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{affaire.client}</CardTitle>
        <Badge variant="outline">{affaire.status}</Badge>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 text-sm @xl/card:grid-cols-4">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground">Numéro</span>
          <span className="font-medium">{affaire.numero}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground">Semaine</span>
          <span className="font-medium">{affaire.semaine}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground">Reviewer</span>
          <span className="font-medium">{affaire.reviewer}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground">Poutres</span>
          <span className="font-medium">{totalPoutres}</span>
        </div>
      </CardContent>
    </Card>
  )
}