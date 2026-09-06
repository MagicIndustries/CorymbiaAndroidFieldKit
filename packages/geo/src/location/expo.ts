import * as Location from 'expo-location'
import type { Reading } from '../classify'
import type { LocationSource, PermissionState } from './port'

function toReading(position: Location.LocationObject): Reading {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    // Android always supplies an accuracy in practice, but the type says it can
    // be null. `averageReadings` (see average.ts) rejects any non-finite or
    // non-positive accuracy before weighting and excludes that reading from the
    // sample entirely — a hold made up only of such readings throws rather than
    // record a position with invented provenance. Infinity is deliberately
    // unusable for that purpose while still being a coherent value everywhere
    // else: `gradeAccuracy(Infinity)` correctly grades it 'poor', so a caller
    // showing a live traffic-light frame does not need a special case for a
    // reading the platform declined to rate.
    accuracyM: position.coords.accuracy ?? Number.POSITIVE_INFINITY,
    altitudeM: position.coords.altitude,
    verticalAccuracyM: position.coords.altitudeAccuracy ?? null,
    // A fix that cannot show it was not spoofed is not evidence (spec §7.5) —
    // which is an argument for preserving the platform's silence, not for
    // manufacturing a "not mocked" answer it never gave. `isMocked` is optional
    // on `Reading` precisely so this can stay `undefined` when the platform did
    // not report `mocked` at all, rather than defaulting to `false` and writing
    // down a claim of cleanliness nobody made. This project has already shipped
    // that exact mistake once, with a `0` written where `NULL` was meant.
    isMocked: position.mocked,
    timestampMs: position.timestamp,
  }
}

/**
 * The device adapter.
 *
 * `BestForNavigation` accuracy with a one-second interval is what makes a hold
 * meaningful: averaging needs a stream of readings, and a slower interval would
 * make her wait for samples that never arrive. Acquisition is on demand — spec
 * §8.2 is explicit that holding a continuous GPS lock would exhaust the battery
 * over a field day, so nothing here starts watching until something asks.
 */
export function createExpoLocationSource(): LocationSource {
  return {
    async requestPermission(): Promise<PermissionState> {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status === Location.PermissionStatus.GRANTED) return 'granted'
      if (status === Location.PermissionStatus.DENIED) return 'denied'
      return 'undetermined'
    },

    async getLastKnown() {
      const position = await Location.getLastKnownPositionAsync()
      return position ? toReading(position) : null
    },

    async watch(onReading) {
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 1000,
          distanceInterval: 0,
        },
        (position) => onReading(toReading(position)),
      )
      return () => subscription.remove()
    },
  }
}
