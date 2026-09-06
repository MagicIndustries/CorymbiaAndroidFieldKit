import { distanceMetres, type Coordinate } from './distance'

export type NamedPlace = {
  id: string
  name: string
  latitude: number
  longitude: number
}

/**
 * Spec §8.4: place names work offline, derived from proximity to the project's
 * own known locations rather than from a geocoding service. Nothing here touches
 * the network — reverse geocoding is an opportunistic bonus elsewhere, never a
 * dependency.
 *
 * The distance is rounded because the UI only ever shows whole metres, and a
 * chip reading "120 m from Nth Reach" should not disagree with itself between
 * renders.
 */
export function nearestPlace(
  position: Coordinate,
  places: NamedPlace[],
): { place: NamedPlace; distanceM: number } | null {
  let best: { place: NamedPlace; distanceM: number } | null = null
  for (const place of places) {
    const distanceM = distanceMetres(position, place)
    if (best === null || distanceM < best.distanceM) {
      best = { place, distanceM }
    }
  }
  return best ? { place: best.place, distanceM: Math.round(best.distanceM) } : null
}
