import { distanceMetres } from './distance'
import type { Reading } from './classify'

/**
 * Averages the readings taken while she held the SHARPEN control.
 *
 * Two things are reported that the record then keeps as provenance (spec §7.4):
 * the **spread**, being the greatest distance between any reading and the mean,
 * which is the honest measure of how much the readings disagreed; and the
 * **sample count**.
 *
 * The reported accuracy improves with the square root of the sample count, which
 * is how averaging reduces random error — but it is floored at a third of the
 * best single reading. Beyond that the limiting factor is systematic (multipath,
 * satellite geometry, atmosphere), which averaging cannot remove, and claiming
 * otherwise would put a number on the record that the hardware never earned.
 */
export function averageReadings(readings: Reading[]): {
  latitude: number
  longitude: number
  accuracyM: number
  altitudeM: number | null
  spreadM: number
  sampleCount: number
} {
  if (readings.length === 0) {
    throw new Error('Cannot average an empty set of readings.')
  }

  const sampleCount = readings.length
  const latitude = readings.reduce((sum, r) => sum + r.latitude, 0) / sampleCount
  const longitude = readings.reduce((sum, r) => sum + r.longitude, 0) / sampleCount

  const withAltitude = readings.filter(
    (r): r is Reading & { altitudeM: number } => r.altitudeM !== null,
  )
  const altitudeM =
    withAltitude.length === 0
      ? null
      : withAltitude.reduce((sum, r) => sum + r.altitudeM, 0) / withAltitude.length

  const centre = { latitude, longitude }
  const spreadM = readings.reduce((max, r) => Math.max(max, distanceMetres(centre, r)), 0)

  const best = readings.reduce((min, r) => Math.min(min, r.accuracyM), Number.POSITIVE_INFINITY)
  const improved = best / Math.sqrt(sampleCount)
  const accuracyM = Math.max(improved, best / 3)

  return { latitude, longitude, accuracyM, altitudeM, spreadM, sampleCount }
}
