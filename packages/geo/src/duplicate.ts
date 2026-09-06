import { distanceMetres, type Coordinate } from './distance'

/** Spec §9.5. Configurable; this is the default. */
export const DUPLICATE_THRESHOLD_M = 5

/**
 * Whether a new pin has landed close enough to the previous one to be worth
 * querying.
 *
 * This only ever produces a warning. Spec §9.5 and doctrine rule 4 are explicit
 * that it must not block: accidental double-capture is a real field failure, but
 * so is refusing a legitimate close-spaced pin, and only the ecologist knows
 * which she meant.
 */
export function isProbableDuplicate(
  next: Coordinate,
  previous: Coordinate | null,
  thresholdM: number = DUPLICATE_THRESHOLD_M,
): boolean {
  if (previous === null) return false
  return distanceMetres(next, previous) <= thresholdM
}
