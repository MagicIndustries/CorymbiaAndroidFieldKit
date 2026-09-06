import type { Reading } from '../classify'
import type { LocationSource, PermissionState } from './port'

/**
 * A scripted GPS for tests. `readings` are delivered as soon as a watcher
 * subscribes; `emit` pushes further ones, which is how a test drives a hold and
 * watches the verdict change.
 *
 * Supports more than one concurrent watcher — the ambient cache and a capture
 * screen may both be watching the same fake source in a test, and each one's
 * returned `stop()` must remove only that watcher, not whichever one happened
 * to subscribe last.
 */
export function createFakeLocationSource(script: {
  permission?: PermissionState
  lastKnown?: Reading | null
  readings?: Reading[]
}): LocationSource & { emit(reading: Reading): void } {
  const listeners = new Set<(reading: Reading) => void>()

  return {
    async requestPermission() {
      return script.permission ?? 'granted'
    },
    async getLastKnown() {
      return script.lastKnown ?? null
    },
    async watch(onReading) {
      listeners.add(onReading)
      for (const reading of script.readings ?? []) {
        onReading(reading)
      }
      return () => {
        listeners.delete(onReading)
      }
    },
    emit(reading) {
      for (const listener of listeners) listener(reading)
    },
  }
}
