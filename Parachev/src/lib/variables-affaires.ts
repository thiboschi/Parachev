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
  // Seuils proposés pour le filtre par tranche (">X") dans la barre de
  // recherche (affaires-search-bar.tsx).
  seuils: number[]
}[] = [
  { key: "nb_barres", label: "Nb barres", seuils: [10, 25, 50, 100, 200] },
  { key: "nb_goujons", label: "Nb goujons", seuils: [50, 100, 200, 500, 1000] },
  { key: "nb_trous_manuel", label: "Trous (manuel)", seuils: [10, 25, 50, 100, 200] },
  { key: "nb_trous_numerique", label: "Trous (numérique)", seuils: [10, 25, 50, 100, 200] },
  {
    key: "diametre_moyen_numerique",
    label: "Ø moyen numérique",
    format: (v) => `${formatNombre(v)} mm`,
    seuils: [10, 20, 30, 40, 50],
  },
  {
    key: "longueur_coupe",
    label: "Longueur coupe",
    format: (v) => `${formatNombre(v)} mm`,
    seuils: [500, 1000, 2000, 5000, 10000],
  },
  { key: "contre_fleche", label: "Contre-flèche", seuils: [5, 10, 20, 50, 100] },
]

// Champs texte (hors client, déjà filtré séparément).
// numero_plan est affiché à part, sous forme de tag (voir affaires-result.tsx).
export const CHAMPS_VARIABLES_TEXTE: {
  key: keyof Pick<VariablesAffaireRow, "profil">
  label: string
}[] = [{ key: "profil", label: "Profil" }]
