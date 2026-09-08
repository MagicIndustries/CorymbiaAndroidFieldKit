import { createAmbientCache } from '../ambient-cache'
import { createFakeLocationSource } from '../location/fake'
import type { Reading } from '../classify'
import type { LocationSource } from '../location/port'

const reading = (over: Partial<Reading> = {}): Reading => ({
  latitude: -37.82141,
  longitude: 145.03318,
  accuracyM: 38,
  altitudeM: 62,
  timestampMs: 1_000_000,
  ...over,
})

describe('the ambient position cache', () => {
  it('is empty before anything has been recorded', () => {
    expect(createAmbientCache(createFakeLocationSource({})).read()).toBeNull()
  })

  it('returns the last recorded position with its age', () => {
    let now = 1_000_000
    const cache = createAmbientCache(createFakeLocationSource({}), () => now)
    cache.record(reading({ timestampMs: 1_000_000 }))
    now = 1_240_000
    expect(cache.read()).toEqual({
      latitude: -37.82141,
      longitude: 145.03318,
      accuracyM: 38,
      altitudeM: 62,
      verticalAccuracyM: null,
      isMocked: 'notReported',
      ageSeconds: 240,
    })
  })

  describe('the cached reading answers for itself, not for the live one', () => {
    it('carries the cached reading’s vertical accuracy, where it reported one', () => {
      const now = 1_000_000
      const cache = createAmbientCache(createFakeLocationSource({}), () => now)
      cache.record(reading({ altitudeM: 62, verticalAccuracyM: 3 }))
      expect(cache.read()?.verticalAccuracyM).toBe(3)
    })

    it('reports no vertical accuracy for a reading with no height to describe', () => {
      // The same pairing rule averageReadings applies: a vertical uncertainty
      // belonging to no altitude is provenance about nothing.
      const now = 1_000_000
      const cache = createAmbientCache(createFakeLocationSource({}), () => now)
      cache.record(reading({ altitudeM: null, verticalAccuracyM: 3 }))
      expect(cache.read()?.verticalAccuracyM).toBeNull()
    })

    it.each([
      [true, 'mocked'],
      [false, 'notMocked'],
      [undefined, 'notReported'],
    ] as const)('reports isMocked %s as %s', (isMocked, expected) => {
      const now = 1_000_000
      const cache = createAmbientCache(createFakeLocationSource({}), () => now)
      cache.record(reading({ isMocked }))
      expect(cache.read()?.isMocked).toBe(expected)
    })
  })

  it('reports an age of zero for a position just recorded', () => {
    const now = 1_000_000
    const cache = createAmbientCache(createFakeLocationSource({}), () => now)
    cache.record(reading({ timestampMs: now }))
    expect(cache.read()?.ageSeconds).toBe(0)
  })

  it('keeps the most recent reading', () => {
    const now = 2_000_000
    const cache = createAmbientCache(createFakeLocationSource({}), () => now)
    cache.record(reading({ accuracyM: 38 }))
    cache.record(reading({ accuracyM: 6, timestampMs: now }))
    expect(cache.read()?.accuracyM).toBe(6)
  })

  it('refreshes from the last-known position without waiting for a new fix', async () => {
    const now = 1_060_000
    const source = createFakeLocationSource({ lastKnown: reading({ timestampMs: 1_000_000 }) })
    const cache = createAmbientCache(source, () => now)
    const fix = await cache.refresh()
    expect(fix?.ageSeconds).toBe(60)
    expect(cache.read()?.ageSeconds).toBe(60)
  })

  it('returns null from a refresh when the device has no position at all', async () => {
    const cache = createAmbientCache(createFakeLocationSource({ lastKnown: null }))
    expect(await cache.refresh()).toBeNull()
  })

  it('does not overwrite a fresher cached position with a staler last-known one', async () => {
    const now = 2_000_000
    const source = createFakeLocationSource({ lastKnown: reading({ timestampMs: 1_000_000 }) })
    const cache = createAmbientCache(source, () => now)
    cache.record(reading({ accuracyM: 6, timestampMs: 1_999_000 }))
    await cache.refresh()
    expect(cache.read()?.accuracyM).toBe(6)
  })

  it('rounds the age down to whole seconds, which is all the UI shows', () => {
    let now = 1_000_000
    const cache = createAmbientCache(createFakeLocationSource({}), () => now)
    cache.record(reading({ timestampMs: 1_000_000 }))
    now = 1_001_900
    expect(cache.read()?.ageSeconds).toBe(1)
  })

  it('ignores a reading recorded out of order, older than the one already cached', () => {
    const cache = createAmbientCache(createFakeLocationSource({}))
    cache.record(reading({ accuracyM: 6, timestampMs: 2_000_000 }))
    cache.record(reading({ accuracyM: 38, timestampMs: 1_000_000 }))
    expect(cache.read()?.accuracyM).toBe(6)
  })

  it('record() uses >= for timestamp comparison so equal timestamps favour the newer arrival', () => {
    const cache = createAmbientCache(createFakeLocationSource({}))
    const timestamp = 1_500_000
    cache.record(reading({ accuracyM: 38, timestampMs: timestamp }))
    cache.record(reading({ accuracyM: 6, timestampMs: timestamp }))
    // The second reading (with better accuracy) should replace the first despite having the same timestamp
    expect(cache.read()?.accuracyM).toBe(6)
  })

  it('refresh() uses >= for timestamp comparison so equal timestamps favour the last-known arrival', async () => {
    const timestamp = 1_500_000
    const source = createFakeLocationSource({ lastKnown: reading({ accuracyM: 6, timestampMs: timestamp }) })
    const cache = createAmbientCache(source)
    cache.record(reading({ accuracyM: 38, timestampMs: timestamp }))
    await cache.refresh()
    // The last-known reading (with better accuracy) should replace the cached one despite having the same timestamp
    expect(cache.read()?.accuracyM).toBe(6)
  })
})

describe("refresh() never throws, because it must never fail the save it's decorating", () => {
  // A minimal LocationSource whose getLastKnown rejects, the way expo-location
  // does when permission has not been granted or location services are off —
  // both entirely ordinary in the field (spec §8.2).
  const rejectingSource: LocationSource = {
    async requestPermission() {
      return 'granted'
    },
    getLastKnown(): Promise<Reading | null> {
      return Promise.reject(new Error('location services are off'))
    },
    async watch() {
      return () => {}
    },
  }

  it('resolves to null, not a rejection, when the cache is empty', async () => {
    const cache = createAmbientCache(rejectingSource)
    await expect(cache.refresh()).resolves.toBeNull()
  })

  it('resolves to the existing cached fix, untouched, rather than rejecting', async () => {
    const cache = createAmbientCache(rejectingSource)
    cache.record(reading({ accuracyM: 6, timestampMs: 1_000_000 }))
    await expect(cache.refresh()).resolves.toEqual(
      expect.objectContaining({ accuracyM: 6 }),
    )
    expect(cache.read()?.accuracyM).toBe(6)
  })
})

describe('rejects an unusable accuracy — not a poor measurement, but the absence of one', () => {
  const unusable = [0, -5, Number.POSITIVE_INFINITY, Number.NaN]

  describe('record()', () => {
    it.each(unusable)('does not cache a reading with accuracyM %p', (accuracyM) => {
      const cache = createAmbientCache(createFakeLocationSource({}))
      cache.record(reading({ accuracyM }))
      expect(cache.read()).toBeNull()
    })

    it.each(unusable)('leaves an existing cached fix untouched when given accuracyM %p', (accuracyM) => {
      const cache = createAmbientCache(createFakeLocationSource({}))
      cache.record(reading({ accuracyM: 10, timestampMs: 1_000_000 }))
      cache.record(reading({ accuracyM, timestampMs: 2_000_000 }))
      expect(cache.read()?.accuracyM).toBe(10)
    })
  })

  describe('refresh()', () => {
    it.each(unusable)('does not cache a last-known reading with accuracyM %p', async (accuracyM) => {
      const source = createFakeLocationSource({ lastKnown: reading({ accuracyM }) })
      const cache = createAmbientCache(source)
      expect(await cache.refresh()).toBeNull()
    })

    it.each(unusable)('leaves an existing cached fix untouched when it finds accuracyM %p', async (accuracyM) => {
      const source = createFakeLocationSource({
        lastKnown: reading({ accuracyM, timestampMs: 3_000_000 }),
      })
      const cache = createAmbientCache(source)
      cache.record(reading({ accuracyM: 10, timestampMs: 1_000_000 }))
      const fix = await cache.refresh()
      expect(fix?.accuracyM).toBe(10)
      expect(cache.read()?.accuracyM).toBe(10)
    })
  })
})

describe('the default clock', () => {
  // `now: () => number = Date.now` — the bare function reference — is
  // resolved to whatever `Date.now` names at the moment `createAmbientCache`
  // is CALLED, and captured into the closure from then on. For a caller that
  // constructs its cache once, at import (as
  // `apps/fieldkit/src/geo/ambient.ts`'s module-level singleton does), that
  // moment is long before any test gets to install a fake timer — so every
  // age computed afterwards silently reads the real wall clock no matter what
  // the test's fake clock says. `now: () => () => Date.now()` does not
  // capture a function reference at all; each call to `now()` looks up
  // whatever `Date.now` currently is, which is exactly what
  // `jest.useFakeTimers` replaces. The distinction only shows up when
  // construction happens before the fake timer is installed — that ordering
  // is the whole test.
  it('reads whatever clock is in force when an age is computed, even when the cache was built before that clock existed', () => {
    // No `now` argument — this is the default the fix in `ambient-cache.ts`
    // has to protect, not a scripted clock this test supplies itself. Built
    // with the real `Date.now`, exactly as the module-level singleton is.
    const cache = createAmbientCache(createFakeLocationSource({}))
    cache.record(reading({ timestampMs: Date.now() }))

    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] })
    try {
      // Jump the fake clock forward ninety seconds from whenever the reading
      // above was actually stamped.
      jest.setSystemTime(Date.now() + 90_000)

      expect(cache.read()?.ageSeconds).toBe(90)
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('reset()', () => {
  it('forgets the cached position', () => {
    const cache = createAmbientCache(createFakeLocationSource({}))
    cache.record(reading())
    expect(cache.read()).not.toBeNull()

    cache.reset()

    expect(cache.read()).toBeNull()
  })
})
