import type { Reading } from './classify'

/**
 * What a set of readings jointly says about whether the position was spoofed.
 *
 * Deliberately three strings rather than `boolean | undefined`. `Reading.isMocked`
 * is three-state — `true`, `false`, or absent when the platform never said — and
 * `Fix.isMocked` is a required boolean, so something has to bridge them. The
 * obvious bridge is `?? false`, which writes down a claim of cleanliness nobody
 * made; that collapse has been written into this codebase twice and caught
 * twice, and a `boolean | undefined` return would invite it a third time.
 *
 * A string union cannot be `??`-defaulted into a boolean: `verdict ?? false` is
 * still a string, and `Fix.isMocked` will not accept it. A caller has to say
 * what it means to do about `'notReported'` before it can construct a fix at
 * all, which is the point.
 */
export type MockedVerdict = 'mocked' | 'notMocked' | 'notReported'

/**
 * The mocked verdict for the readings a fix was built from.
 *
 * Precedence, in order:
 *
 * 1. **`'mocked'` if any contributing reading was mocked.** One spoofed reading
 *    contaminates the fix it went into — the position was computed partly from
 *    it, so the fix cannot be described as unspoofed. This includes readings
 *    that earned no weight in `averageReadings` (a mock provider claiming 0 m
 *    accuracy gets none): weightlessness is about how much a reading moved the
 *    position, not about whether it was there. It was there, and it was a mock.
 * 2. **`'notReported'` if any contributing reading did not say.** The set as a
 *    whole cannot assert more than its least informative member. A hold that
 *    began before the platform started reporting the flag is exactly this case.
 * 3. **`'notMocked'` only when every contributing reading explicitly said so.**
 *
 * An empty set is `'notReported'`: nothing said anything. `averageReadings`
 * refuses an empty set before this is ever reached, but a caller passing one
 * directly gets the honest answer rather than a claim of cleanliness derived
 * from no readings at all.
 */
export function mockedVerdict(readings: Reading[]): MockedVerdict {
  if (readings.some((reading) => reading.isMocked === true)) return 'mocked'
  if (readings.some((reading) => reading.isMocked === undefined)) return 'notReported'
  return readings.length === 0 ? 'notReported' : 'notMocked'
}
