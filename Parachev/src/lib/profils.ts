// Liste statique des profils courants pour le formulaire d'ajout de ligne
// de profil. Auparavant dérivée de search.json (mock) ; aucune commande
// Tauri n'expose aujourd'hui la liste des profils depuis la DB, donc à
// défaut on fige une liste standard -- à remplacer par un appel `invoke`
// si un jour une commande dédiée existe côté Rust.
export const PROFIL_OPTIONS = [
  "IPE",
  "HEA",
  "HEB",
  "HEM",
  "UPN",
  "UAP",
  "CAE",
  "Plat",
  "Tube",
]