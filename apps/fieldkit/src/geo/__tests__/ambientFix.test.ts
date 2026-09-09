import type { AmbientFix } from '@corymbia/geo'
import type { AmbientReader } from '../ambient'
import { ambientFixOrNone, buildAmbientFix } from '../ambientFix'

/**
 * Tests for `ambientFixOrNone` (Plan 4, Task 12 review, finding 4): the
 * downgrade-to-`{ quality: 'none' }` policy shared by `useAttachMedia.ts`
 * and `capture.tsx`.
 *
 * Until this extraction the policy existed as a fourth verbatim copy — first
 * `useAttachMedia.ts`'s own (unexported) `ambientFix()`, and then
 * `capture.tsx`'s own (unexported) `ambientEventFix()`, each re-implementing
 * the same two-line guard around `buildAmbientFix` — and neither copy had a
 * test of its own; each was proved only indirectly, through the screen or
 * hook that happened to call it. This file is that missing direct test,
 * against the one function both callers now share.
 *
 * Not mocked: `buildAmbientFix`, the real field-by-field mapping this
 * delegates to for a positioned reading — its own shape is not what this
 * file is about.
 */

function fakeAmbientFix(overrides: Partial<AmbientFix> = {}): AmbientFix {
  return {
    latitude: -37.8214,
    longitude: 144.9631,
    accuracyM: 12,
    altitudeM: null,
    verticalAccuracyM: null,
    isMocked: 'notMocked',
    ageSeconds: 30,
    ...overrides,
  }
}

/** A reader whose `.read()` always answers with a fixed, scripted value. */
function readerOf(value: ReturnType<AmbientReader['read']>): AmbientReader {
  return { read: () => value }
}

describe('ambientFixOrNone', () => {
  it('returns { quality: "none" } when the cache holds nothing', () => {
    expect(ambientFixOrNone(readerOf(null))).toEqual({ quality: 'none' })
  })

  it('downgrades to { quality: "none" } when the cached reading never reported whether it was mocked', () => {
    // Never a refusal (spec §8.2): this is the "proceed anyway" half of the
    // policy `diagnostics.tsx` deliberately answers the other way, by
    // refusing the save outright — see `buildAmbientFix`'s own doc comment.
    const cached = fakeAmbientFix({ isMocked: 'notReported' })
    expect(ambientFixOrNone(readerOf(cached))).toEqual({ quality: 'none' })
  })

  it('builds an ambient fix with isMocked: true for a cached reading flagged as mocked', () => {
    const cached = fakeAmbientFix({ isMocked: 'mocked', latitude: -38.1, longitude: 145.2 })
    expect(ambientFixOrNone(readerOf(cached))).toEqual(buildAmbientFix(cached, true))
  })

  it('builds an ambient fix with isMocked: false for a cached reading flagged as genuinely not mocked', () => {
    const cached = fakeAmbientFix({ isMocked: 'notMocked', latitude: -38.1, longitude: 145.2 })
    expect(ambientFixOrNone(readerOf(cached))).toEqual(buildAmbientFix(cached, false))
  })

  it('reads the reader exactly once, never waiting on or feeding a live position', () => {
    // `AmbientReader` is typed down to `Pick<AmbientCache, 'read'>` precisely
    // so a caller cannot reach `.record()` or `.refresh()` — this pins the
    // runtime half of that: the one call this makes is `.read()`, and only
    // once per invocation.
    let readCount = 0
    const reader: AmbientReader = {
      read: () => {
        readCount += 1
        return fakeAmbientFix()
      },
    }
    ambientFixOrNone(reader)
    expect(readCount).toBe(1)
  })
})
