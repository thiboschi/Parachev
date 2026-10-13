import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { Chiffrage } from "@/hooks/use-chiffrage"
import { MODES, basculer, formatHeures, type Mode } from "@/lib/chiffrage"
import { libellePoste } from "@/lib/postes"

// Carte "Estimation" : heures par poste (saisies ou prédites), majorations,
// réserve, taux horaire, et les actions de la page.

export function Estimation({ chiffrage }: { chiffrage: Chiffrage }) {
  const {
    mode,
    setMode,
    prediction,
    client,
    type,
    resultat,
    postesGamme,
    postesSansHeures,
    heuresParPoste,
    heuresCalculeesPoste,
    heuresSaisies,
    setHeuresSaisies,
    heuresSaisiesPoste,
    soudageCalcule,
    heuresBareme,
    dbs,
    classeTolerance2,
    supplementDbs,
    supplementTolerance,
    sousTotal,
    reserve,
    setReserve,
    reserveNombre,
    reserveValide,
    heuresAvecReserve,
    tauxHoraire,
    setTauxHoraire,
    tauxHoraireNombre,
    tauxHoraireValide,
    prixTonne,
    postesMasquables,
    postesMasques,
    setPostesMasques,
    calcul,
    exportPdf,
    chiffrer,
    reinitialiser,
    exporterPdf,
  } = chiffrage
  return (
    <Card className="lg:sticky lg:top-4">
      <CardHeader>
        <CardTitle className="text-sm text-muted-foreground">Estimation</CardTitle>
        <CardAction>
          <Tabs value={mode} onValueChange={(valeur) => setMode(valeur as Mode)}>
            <TabsList>
              {Object.entries(MODES).map(([valeur, libelle]) => (
                <TabsTrigger key={valeur} value={valeur} className="px-3">
                  {libelle}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-1.5 text-sm">
        {(client.client || client.numero_offre) && (
          <span className="pb-1 font-medium">
            {[client.client, client.numero_offre].filter(Boolean).join(" · ")}
          </span>
        )}
        {!resultat && (
          <span className="text-muted-foreground">
            {type
              ? "Renseignez les groupes de barres puis cliquez sur « Chiffrer »."
              : "Choisissez un type d'affaire dans la section « Poutre »."}
          </span>
        )}
        {!prediction &&
          postesGamme.map((poste) => {
            const calculees = heuresCalculeesPoste(poste)
            const saisies = heuresSaisiesPoste(poste)
            const source = poste === "soudage" ? "calculateur" : "barème"
            return (
              <div key={poste} className="flex items-center justify-between gap-2">
                <Label htmlFor={`heures-${poste}`} className="text-sm font-normal text-muted-foreground">
                  {libellePoste(poste)}
                  {calculees !== null &&
                    (saisies === null
                      ? ` (${source})`
                      : ` (${source} : ${formatHeures(calculees)} h)`)}
                </Label>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Input
                    id={`heures-${poste}`}
                    className="h-8 w-24 text-right tabular-nums"
                    inputMode="decimal"
                    placeholder={calculees !== null ? formatHeures(calculees) : undefined}
                    aria-invalid={Number.isNaN(saisies)}
                    value={heuresSaisies[poste] ?? ""}
                    onChange={(e) =>
                      setHeuresSaisies((prev) => ({ ...prev, [poste]: e.target.value }))
                    }
                  />
                  <span>h</span>
                </div>
              </div>
            )
          })}
        {!prediction && postesSansHeures.length > 0 && (
          <span className="text-xs text-muted-foreground">
            Sans barème ni heures saisies, comptés 0 h :{" "}
            {postesSansHeures.map(libellePoste).join(", ")}.
          </span>
        )}
        {prediction && resultat && heuresParPoste.length === 0 && (
          <span className="text-muted-foreground">
            Aucune heure estimée avec ces variables.
          </span>
        )}
        {prediction && heuresParPoste.map(([poste, heures]) => (
          <div key={poste} className="flex items-center justify-between">
            <span className="text-muted-foreground">
              {libellePoste(poste)}
              {poste === "soudage" && soudageCalcule !== null && " (calculateur)"}
              {heuresBareme[poste] != null && " (barème)"}
            </span>
            <span className="tabular-nums">{formatHeures(heures)} h</span>
          </div>
        ))}
        {resultat && (
          <div className="mt-1 flex items-center justify-between border-t pt-1.5 font-medium">
            <span>Total</span>
            <span className="tabular-nums">{formatHeures(resultat.total ?? 0)} h</span>
          </div>
        )}
        {resultat && dbs && (
          <div className="flex items-center justify-between text-muted-foreground">
            <span>DBS (×1,20)</span>
            <span className="tabular-nums">+ {formatHeures(supplementDbs)} h</span>
          </div>
        )}
        {resultat && classeTolerance2 && (
          <div className="flex items-center justify-between text-muted-foreground">
            <span>Tolérance classe 2 (×1,25)</span>
            <span className="tabular-nums">+ {formatHeures(supplementTolerance)} h</span>
          </div>
        )}
        {resultat && (dbs || classeTolerance2) && (
          <div className="flex items-center justify-between border-t pt-1.5 font-medium">
            <span>Sous-total</span>
            <span className="tabular-nums">{formatHeures(sousTotal)} h</span>
          </div>
        )}
        <div className="mt-2 flex items-center justify-between gap-2 border-t pt-1.5">
          <Label htmlFor="reserve" className="text-sm font-normal text-muted-foreground">
            Réserve (%)
          </Label>
          <Input
            id="reserve"
            className="h-8 max-w-24 text-right tabular-nums"
            inputMode="decimal"
            aria-invalid={!reserveValide}
            value={reserve}
            onChange={(e) => setReserve(e.target.value)}
          />
        </div>
        {resultat && reserveValide && reserveNombre > 0 && (
          <div className="flex items-center justify-between font-medium">
            <span>Total avec réserve</span>
            <span className="tabular-nums">{formatHeures(heuresAvecReserve)} h</span>
          </div>
        )}
        <div className="mt-2 flex items-center justify-between gap-2 border-t pt-1.5">
          <Label htmlFor="taux-horaire" className="text-sm font-normal text-muted-foreground">
            Taux horaire
          </Label>
          <Input
            id="taux-horaire"
            className="h-8 max-w-24 text-right tabular-nums"
            inputMode="decimal"
            value={tauxHoraire}
            onChange={(e) => setTauxHoraire(e.target.value)}
          />
        </div>
        {resultat && prixTonne !== null && (
          <div className="flex items-center justify-between text-muted-foreground">
            <span>Prix à la tonne</span>
            <span className="tabular-nums">
              {prixTonne.toLocaleString("fr-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € / t
            </span>
          </div>
        )}
        {resultat && tauxHoraireValide && (
          <div className="flex items-center justify-between font-medium">
            <span>Résultat</span>
            <span className="tabular-nums">
              {formatHeures(heuresAvecReserve * tauxHoraireNombre)} €
            </span>
          </div>
        )}
        {postesMasquables.length > 0 && (
          <div className="mt-2 flex flex-col gap-2 border-t pt-1.5">
            <span className="text-muted-foreground">Opérations affichées sur l'offre PDF</span>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {postesMasquables.map((poste) => (
                <div key={poste} className="flex items-center gap-2">
                  <Checkbox
                    id={`offre-${poste}`}
                    checked={!postesMasques.has(poste)}
                    onCheckedChange={(coche) =>
                      setPostesMasques((prev) => basculer(prev, poste, coche !== true))
                    }
                  />
                  <Label htmlFor={`offre-${poste}`} className="text-sm font-normal">
                    {libellePoste(poste)}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="mt-2 flex items-center gap-2">
          {prediction && (
            <Button onClick={chiffrer} disabled={calcul || !type}>
              {calcul ? "Calcul…" : "Chiffrer"}
            </Button>
          )}
          <Button variant="ghost" onClick={reinitialiser} disabled={calcul}>
            Réinitialiser
          </Button>
          <Button
            variant={prediction ? "outline" : "default"}
            onClick={exporterPdf}
            disabled={calcul || exportPdf || !resultat}
          >
            {exportPdf ? "PDF…" : "PDF"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
