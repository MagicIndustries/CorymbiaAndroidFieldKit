import type { Reading } from '../classify'

export type PermissionState = 'granted' | 'denied' | 'undetermined'

/**
 * The narrow surface `expo-location` is used through.
 *
 * Everything that decides what a fix *means* is pure and tested elsewhere. This
 * exists so the parts that consume a live GPS — the ambient cache, and the
 * capture screen in the next plan — can be tested against a scripted source,
 * including the situations that are tedious or impossible to produce on demand
 * outdoors: permission refused, no fix at all, accuracy that gets worse rather
 * than better.
 */
export interface LocationSource {
  requestPermission(): Promise<PermissionState>
  getLastKnown(): Promise<Reading | null>
  /** Resolves to an unsubscribe function. */
  watch(onReading: (reading: Reading) => void): Promise<() => void>
}
