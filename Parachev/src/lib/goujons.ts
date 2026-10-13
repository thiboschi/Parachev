// Poids d'un goujon à tête d'après son diamètre et sa hauteur, tels que les
// donne la colonne "Diam." de FC-GOUJ ("Ø25x200") : aucune fiche ne le
// porte. Dans le chiffrage, il n'est qu'indicatif : il n'entre ni dans le
// tonnage ni dans les heures.

// Tête d'un goujon selon le diamètre de sa tige, en mm (EN ISO 13918, type
// SD1). Un diamètre hors norme est compté sans tête, comme une simple tige.
const TETES: Record<number, [diametre: number, epaisseur: number]> = {
  10: [19, 7],
  13: [25, 8],
  16: [32, 8],
  19: [32, 10],
  22: [35, 10],
  25: [40, 12],
}

// Masse volumique de l'acier, en kg par mm³.
const MASSE_VOLUMIQUE = 7850 / 1e9

/**
 * Poids d'un goujon en kg, tige et tête : la hauteur est celle du goujon
 * entier, tête comprise. null sans diamètre ou sans hauteur.
 */
export function poidsGoujon(diametre: number, hauteur: number): number | null {
  if (!(diametre > 0) || !(hauteur > 0)) return null
  const [diametreTete, epaisseurTete] = TETES[diametre] ?? [diametre, 0]
  const tete = Math.min(epaisseurTete, hauteur)
  const volume = (Math.PI / 4) * (diametre ** 2 * (hauteur - tete) + diametreTete ** 2 * tete)
  return volume * MASSE_VOLUMIQUE
}
