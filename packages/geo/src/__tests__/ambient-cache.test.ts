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
      ageSeconds: 240,
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
