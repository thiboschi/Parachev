import type { VariablesAffaireRow } from "@/hooks/use-affaires-db"

const formatNombre = (value: number) =>
  value.toLocaleString("fr-BE", { maximumFractionDigits: 1 })

// Les champs numériques de variables_affaires, dans l'ordre d'affichage,
// avec leur libellé et un formatteur optionnel. Partagé entre l'affichage
// des résultats (affaires-result.tsx) et les options de recherche
// (affaires-search-bar.tsx) pour ne pas dupliquer les libellés.
export const CHAMPS_VARIABLES_NUMERIQUES: {
  key: keyof Omit<VariablesAffaireRow, "affaire" | "client" | "profil" | "numero_plan" | "numero_offre">
  label: string
  format?: (value: number) => string
}[] = [
  { key: "nb_barres", label: "Nb barres" },
  { key: "nb_goujons", label: "Nb goujons" },
  { key: "nb_trous_manuel", label: "Trous (manuel)" },
  { key: "nb_trous_numerique", label: "Trous (numérique)" },
  {
    key: "diametre_moyen_numerique",
    label: "Ø moyen numérique",
    format: (v) => `${formatNombre(v)} mm`,
  },
  {
    key: "longueur_coupe",
    label: "Longueur coupe",
    format: (v) => `${formatNombre(v)} mm`,
  },
  { key: "contre_fleche", label: "Contre-flèche" },
]

// Champs texte (hors client, déjà filtré séparément).
// numero_plan est affiché à part, sous forme de tag (voir affaires-result.tsx).
export const CHAMPS_VARIABLES_TEXTE: {
  key: keyof Pick<VariablesAffaireRow, "profil">
  label: string
}[] = [{ key: "profil", label: "Profil" }]
