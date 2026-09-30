import * as React from "react"

/**
 * `useState` enregistré dans le sessionStorage. Si `restaurer` est vrai, la
 * valeur enregistrée est reprise au montage (retour sur une page) ; sinon on
 * repart de `initial`, qui remplace la valeur enregistrée. `fusion` permet de
 * compléter une valeur enregistrée par une version antérieure (champs ajoutés
 * depuis).
 */
export function useEtatSession<T>(
  cle: string,
  initial: T,
  { restaurer = true, fusion = (v: T) => v }: { restaurer?: boolean; fusion?: (enregistre: T) => T } = {}
) {
  const [valeur, setValeur] = React.useState<T>(() => {
    if (!restaurer) return initial
    try {
      const brut = sessionStorage.getItem(cle)
      return brut === null ? initial : fusion(JSON.parse(brut) as T)
    } catch {
      return initial
    }
  })

  React.useEffect(() => {
    try {
      sessionStorage.setItem(cle, JSON.stringify(valeur))
    } catch {
      // stockage indisponible : l'état reste simplement en mémoire
    }
  }, [cle, valeur])

  return [valeur, setValeur] as const
}
