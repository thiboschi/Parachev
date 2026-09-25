// Graphiques du tableau de bord. Règles communes (voir la skill dataviz) :
// une seule couleur d'accent (orange de la marque, --chart-4, validée sur
// fond blanc), le gris sert de contexte (mise en avant) ; barres fines
// (<= 24 px) arrondies côté valeur ; grille en trait fin plein ; le texte
// reste dans les couleurs de texte, jamais dans la couleur des données ;
// chaque marque a une infobulle au survol.

import * as React from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

export const COULEUR_ACCENT = "var(--chart-4)"
/** Gris de contexte (#898781, 3,5:1 sur blanc) : séries secondaires, barres non sélectionnées. */
export const COULEUR_CONTEXTE = "#898781"
const GRILLE = "var(--border)"
const TEXTE_AXE = { fontSize: 11, fill: "var(--muted-foreground)" }

const nombre = new Intl.NumberFormat("fr-BE", { maximumFractionDigits: 0 })
const compact = new Intl.NumberFormat("fr-BE", { notation: "compact", maximumFractionDigits: 1 })
export const formatHeures = (h: number) => `${nombre.format(h)} h`
export const formatMois = (mois: string) =>
  new Date(`${mois}-01T00:00:00`).toLocaleDateString("fr-BE", { month: "short", year: "2-digit" })

// ---------------------------------------------------------------------------
// Tuile d'indicateur
// ---------------------------------------------------------------------------

export function StatTile({ label, valeur, detail }: { label: string; valeur: string; detail?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-card p-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-3xl font-semibold">{valeur}</span>
      {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Carte de graphique et infobulle
// ---------------------------------------------------------------------------

export function CarteGraphique({
  titre,
  sousTitre,
  actions,
  legende,
  children,
  className,
}: {
  titre: string
  sousTitre?: string
  actions?: React.ReactNode
  legende?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 ${className ?? ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col">
          <h2 className="text-sm font-medium">{titre}</h2>
          {sousTitre && <p className="text-xs text-muted-foreground">{sousTitre}</p>}
        </div>
        {actions}
      </div>
      {legende}
      {children}
    </section>
  )
}

/** Ligne d'infobulle : valeur en premier (forte), puis la série, clé en trait. */
function LigneInfobulle({ couleur, valeur, nom }: { couleur?: string; valeur: string; nom: string }) {
  return (
    <div className="flex items-center gap-2">
      {couleur && <span className="h-0.5 w-3 rounded-full" style={{ background: couleur }} />}
      <span className="font-semibold tabular-nums">{valeur}</span>
      <span className="text-muted-foreground">{nom}</span>
    </div>
  )
}

function Infobulle({ titre, lignes }: { titre: string; lignes: React.ComponentProps<typeof LigneInfobulle>[] }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <span className="text-muted-foreground">{titre}</span>
      {lignes.map((l) => (
        <LigneInfobulle key={l.nom} {...l} />
      ))}
    </div>
  )
}

export function Legende({ elements }: { elements: { nom: string; couleur: string }[] }) {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
      {elements.map((e) => (
        <span key={e.nom} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: e.couleur }} />
          {e.nom}
        </span>
      ))}
    </div>
  )
}

/** Boutons de tri d'un graphique (dans l'en-tête de la carte). */
export function BoutonsTri<T extends string>({
  valeur,
  options,
  onChange,
}: {
  valeur: T
  options: Record<T, string>
  onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-0.5 rounded-lg bg-muted p-0.5 text-xs" role="group" aria-label="Trier">
      {(Object.keys(options) as T[]).map((cle) => (
        <button
          key={cle}
          type="button"
          aria-pressed={valeur === cle}
          onClick={() => onChange(cle)}
          className={`rounded-md px-2 py-1 transition-colors ${
            valeur === cle ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {options[cle]}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Heures par mois (colonnes)
// ---------------------------------------------------------------------------

export function GraphiqueMois({ donnees }: { donnees: { mois: string; heures: number }[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={donnees} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={GRILLE} />
          <XAxis dataKey="mois" tickFormatter={formatMois} tick={TEXTE_AXE} tickLine={false} axisLine={{ stroke: GRILLE }} minTickGap={24} />
          <YAxis tickFormatter={(v: number) => compact.format(v)} tick={TEXTE_AXE} tickLine={false} axisLine={false} width={40} />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <Infobulle
                  titre={formatMois(String(label))}
                  lignes={[{ couleur: COULEUR_ACCENT, valeur: formatHeures(Number(payload[0].value)), nom: "pointées" }]}
                />
              ) : null
            }
          />
          <Bar dataKey="heures" fill={COULEUR_ACCENT} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Barres horizontales classées (postes, types de production)
// ---------------------------------------------------------------------------

const HAUTEUR_LIGNE = 30

/**
 * Barres horizontales d'une seule série, valeur en bout de barre. Cliquer
 * une barre la sélectionne (filtre du tableau de bord) : la sélection garde
 * l'accent, les autres barres passent en gris.
 */
export function BarresClassees<T extends { cle: string; libelle: string; valeur: number }>({
  donnees,
  selection,
  onSelection,
  formatValeur,
  nomValeur,
}: {
  donnees: T[]
  selection: string[]
  onSelection?: (cle: string) => void
  formatValeur: (v: number) => string
  nomValeur: string
}) {
  const largeurLibelles = Math.min(220, Math.max(90, ...donnees.map((d) => d.libelle.length * 8 + 16)))
  return (
    <div style={{ height: donnees.length * HAUTEUR_LIGNE + 16 }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={donnees} layout="vertical" margin={{ top: 0, right: 72, bottom: 0, left: 0 }}>
          <CartesianGrid horizontal={false} stroke={GRILLE} />
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="libelle"
            width={largeurLibelles}
            tick={{ ...TEXTE_AXE, fill: "var(--foreground)" }}
            tickLine={false}
            axisLine={{ stroke: GRILLE }}
            interval={0}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <Infobulle
                  titre={(payload[0].payload as T).libelle}
                  lignes={[{ couleur: COULEUR_ACCENT, valeur: formatValeur(Number(payload[0].value)), nom: nomValeur }]}
                />
              ) : null
            }
          />
          <Bar
            dataKey="valeur"
            radius={[0, 4, 4, 0]}
            maxBarSize={20}
            isAnimationActive={false}
            cursor={onSelection ? "pointer" : undefined}
            onClick={(entree: { payload?: T }) => entree.payload && onSelection?.(entree.payload.cle)}
          >
            {donnees.map((d) => (
              <Cell
                key={d.cle}
                fill={selection.length === 0 || selection.includes(d.cle) ? COULEUR_ACCENT : COULEUR_CONTEXTE}
              />
            ))}
            <LabelList
              dataKey="valeur"
              position="right"
              formatter={(v: unknown) => formatValeur(Number(v))}
              style={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Prévu (fiche) contre réel (ERP) par poste -- mise en avant
// ---------------------------------------------------------------------------

export function GraphiqueComparaison({
  donnees,
}: {
  donnees: { cle: string; libelle: string; reel: number; prevu: number }[]
}) {
  const largeurLibelles = Math.min(220, Math.max(90, ...donnees.map((d) => d.libelle.length * 8 + 16)))
  return (
    <div style={{ height: donnees.length * 36 + 16 }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={donnees} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barGap={2}>
          <CartesianGrid horizontal={false} stroke={GRILLE} />
          <XAxis type="number" tickFormatter={(v: number) => compact.format(v)} tick={TEXTE_AXE} tickLine={false} axisLine={false} />
          <YAxis
            type="category"
            dataKey="libelle"
            width={largeurLibelles}
            tick={{ ...TEXTE_AXE, fill: "var(--foreground)" }}
            tickLine={false}
            axisLine={{ stroke: GRILLE }}
            interval={0}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const d = payload[0].payload as (typeof donnees)[number]
              const ecart = d.prevu > 0 ? ` (×${(d.reel / d.prevu).toLocaleString("fr-BE", { maximumFractionDigits: 2 })})` : " (non prévu)"
              return (
                <Infobulle
                  titre={d.libelle}
                  lignes={[
                    { couleur: COULEUR_ACCENT, valeur: formatHeures(d.reel) + ecart, nom: "réel" },
                    { couleur: COULEUR_CONTEXTE, valeur: formatHeures(d.prevu), nom: "prévu" },
                  ]}
                />
              )
            }}
          />
          <Bar dataKey="reel" name="Réel (ERP)" fill={COULEUR_ACCENT} radius={[0, 4, 4, 0]} maxBarSize={12} isAnimationActive={false} />
          <Bar dataKey="prevu" name="Prévu (fiche)" fill={COULEUR_CONTEXTE} radius={[0, 4, 4, 0]} maxBarSize={12} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Nuage prévu / réel par affaire (échelles log)
// ---------------------------------------------------------------------------

export interface PointPrevuReel {
  affaire: string
  client: string | null
  prevu: number
  reel: number
}

/** Point : repère de 9 px cerclé de blanc, zone de survol de 24 px. */
function PointAffaire(props: { cx?: number; cy?: number }) {
  const { cx = 0, cy = 0 } = props
  return (
    <g style={{ cursor: "pointer" }}>
      <circle cx={cx} cy={cy} r={12} fill="transparent" />
      <circle cx={cx} cy={cy} r={4.5} fill={COULEUR_ACCENT} stroke="var(--card)" strokeWidth={2} />
    </g>
  )
}

export function NuagePrevuReel({ points, onOuvrir }: { points: PointPrevuReel[]; onOuvrir: (affaire: string) => void }) {
  if (points.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Aucune affaire avec fiche sur la période.</p>
  }
  const valeurs = points.flatMap((p) => [p.prevu, p.reel])
  const bas = 10 ** Math.floor(Math.log10(Math.min(...valeurs)))
  const haut = 10 ** Math.ceil(Math.log10(Math.max(...valeurs)))
  const graduations = Array.from({ length: Math.round(Math.log10(haut / bas)) + 1 }, (_, i) => bas * 10 ** i)
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
          <CartesianGrid stroke={GRILLE} />
          <XAxis
            type="number"
            dataKey="prevu"
            name="Prévu"
            scale="log"
            domain={[bas, haut]}
            ticks={graduations}
            tickFormatter={(v: number) => compact.format(v)}
            tick={TEXTE_AXE}
            tickLine={false}
            axisLine={{ stroke: GRILLE }}
            label={{ value: "Heures prévues (fiche)", position: "insideBottom", offset: -8, style: TEXTE_AXE }}
          />
          <YAxis
            type="number"
            dataKey="reel"
            name="Réel"
            scale="log"
            domain={[bas, haut]}
            ticks={graduations}
            tickFormatter={(v: number) => compact.format(v)}
            tick={TEXTE_AXE}
            tickLine={false}
            axisLine={false}
            width={48}
            label={{ value: "Heures réelles", angle: -90, position: "insideLeft", style: TEXTE_AXE }}
          />
          <ReferenceLine
            segment={[
              { x: bas, y: bas },
              { x: haut, y: haut },
            ]}
            stroke="var(--muted-foreground)"
            strokeWidth={1}
            label={{ value: "prévu = réel", position: "insideTopLeft", style: TEXTE_AXE }}
          />
          <Tooltip
            cursor={false}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload as PointPrevuReel
              return (
                <Infobulle
                  titre={`${p.affaire}${p.client ? ` · ${p.client}` : ""}`}
                  lignes={[
                    { couleur: COULEUR_ACCENT, valeur: formatHeures(p.reel), nom: "réel" },
                    { valeur: formatHeures(p.prevu), nom: "prévu" },
                    { valeur: `×${(p.reel / p.prevu).toLocaleString("fr-BE", { maximumFractionDigits: 2 })}`, nom: "réel / prévu" },
                  ]}
                />
              )
            }}
          />
          <Scatter
            data={points}
            shape={PointAffaire}
            isAnimationActive={false}
            onClick={(p: { payload?: PointPrevuReel }) => p.payload && onOuvrir(p.payload.affaire)}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}
