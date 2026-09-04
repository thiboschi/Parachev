import { z } from "zod"

import searchData from "@/data/search.json"

// machines[] entries aren't all shaped the same across search.json (some
// carry stray "profil"/"nb_poutre" keys), so keep values loosely typed and
// sum defensively rather than assuming every key is a machine value.
export const affaireSchema = z.object({
  id: z.number(),
  client: z.string(),
  numero: z.string(),
  status: z.string(),
  semaine: z.string(),
  reviewer: z.string(),
  machines: z.array(z.record(z.string(), z.unknown())),
})

export type Affaire = z.infer<typeof affaireSchema>

export const items: Affaire[] = searchData

const NON_MACHINE_KEYS = new Set(["nb_poutre", "profil"])

export const profilOptions = Array.from(
  new Set(
    items.flatMap((item) =>
      item.machines
        .map((entry) => entry.profil)
        .filter((value): value is string => typeof value === "string")
    )
  )
).sort()

export function totalFor(item: Affaire) {
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