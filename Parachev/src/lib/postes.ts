// Mirrors the poste keys produced by `normaliser_poste` in erp.rs.
// Kept as a plain lookup so new postes just fall back to a readable
// default (underscores -> spaces, capitalized) instead of breaking.
const POSTE_LABELS: Record<string, string> = {
  assemblage_tracage: "Assemblage / Traçage",
  manutention: "Manutention",
  forage_manuel: "Forage manuel",
  forage_numerique: "Forage numérique",
  goujonnage: "Goujonnage",
  oxycoupage: "Oxycoupage",
  mise_a_longueur: "Mise à longueur",
  p3: "P3",
  robot: "Robot",
  presse_cintrage: "Presse / Cintrage",
  soudage: "Soudage",
  soudage_sous_flux: "Soudage sous flux",
  controle_cnd: "Contrôle CND",
  reparation: "Réparation",
  casse_machine: "Casse machine",
}

// Tous les postes connus (voir erp::normaliser_poste côté Rust) -- utile
// pour afficher l'ensemble des postes possibles même quand certains n'ont
// pas (encore) de lignes dans une table donnée (ex. coefficients calibrés).
export const POSTE_KEYS = Object.keys(POSTE_LABELS)

export function libellePoste(poste: string): string {
  return (
    POSTE_LABELS[poste] ??
    poste
      .split("_")
      .map((mot) => mot.charAt(0).toUpperCase() + mot.slice(1))
      .join(" ")
  )
}