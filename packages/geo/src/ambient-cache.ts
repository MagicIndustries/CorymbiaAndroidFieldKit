import { isUsableAccuracy } from './accuracy'
import type { Reading } from './classify'
import type { LocationSource } from './location/port'

export type AmbientFix = {
  latitude: number
  longitude: number
  accuracyM: number
  altitudeM: number | null
  ageSeconds: number
}

/**
 * The last position the device knew about, and how old it is (spec §8.2).
 *
 * An ambient fix never waits and never blocks: it is whatever is already
 * available, which is why every record and every event can carry one without
 * slowing anything down. Firing the GPS on each write would exhaust the battery
 * over a field day, so the cache is fed opportunistically — by the capture
 * screen while it is watching anyway, and at low frequency while an activity is
 * running.
 *
 * The age is the whole point. A fix from four minutes ago is a different claim
 * from one taken now, and the UI shows the difference so a stale position can
 * never be mistaken for a current one.
 */
export function createAmbientCache(
  source: LocationSource,
  now: () => number = Date.now,
): {
  record(reading: Reading): void
  read(): AmbientFix | null
  refresh(): Promise<AmbientFix | null>
} {
  let cached: Reading | null = null

  const toFix = (reading: Reading): AmbientFix => ({
    latitude: reading.latitude,
    longitude: reading.longitude,
    accuracyM: reading.accuracyM,
    altitudeM: reading.altitudeM,
    // Clamped to zero deliberately, not merely for tidiness: a negative age
    // means the reading's timestamp is in the future relative to `now()` — a
    // device clock change, an NTP correction, or a bad platform timestamp —
    // and the clamp quietly conceals that anomaly rather than surfacing it.
    // A negative number would be meaningless to show the user, so hiding it
    // is the right behaviour; it is just worth knowing what it is hiding.
    ageSeconds: Math.max(0, Math.floor((now() - reading.timestampMs) / 1000)),
  })

  return {
    record(reading) {
      // An unusable accuracy (zero, negative, NaN, or the Infinity the device
      // adapter substitutes for a missing platform figure) is not a poor
      // measurement, it is the absence of one. A poor fix is welcome here; an
      // absent one must not overwrite whatever is already cached.
      if (!isUsableAccuracy(reading.accuracyM)) return
      // Guards against an out-of-order write: a reading recorded after a
      // fresher one has already landed (e.g. two callers racing) must not
      // regress the cache to something staler.
      if (cached === null || reading.timestampMs >= cached.timestampMs) {
        cached = reading
      }
    },

    read() {
      return cached ? toFix(cached) : null
    },

    async refresh() {
      let lastKnown: Reading | null
      try {
        lastKnown = await source.getLastKnown()
      } catch {
        // An ambient fix never blocks or fails the caller it is decorating
        // (spec §8.2). getLastKnown rejects in entirely ordinary field
        // conditions — permission not granted, location services off — and
        // none of that should fail the save this fix was only riding along
        // with. Fall back to whatever is already cached.
        lastKnown = null
      }
      // Never replace a fresher position with a staler one: the capture screen
      // feeds this cache far better readings than getLastKnown returns. An
      // unusable accuracy is rejected for the same reason as in record().
      if (
        lastKnown &&
        isUsableAccuracy(lastKnown.accuracyM) &&
        (cached === null || lastKnown.timestampMs >= cached.timestampMs)
      ) {
        cached = lastKnown
      }
      return cached ? toFix(cached) : null
    },
  }
}
