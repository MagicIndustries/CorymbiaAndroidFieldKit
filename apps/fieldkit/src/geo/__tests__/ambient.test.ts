import { createFakeLocationSource, type Reading } from '@corymbia/geo'
import { ambientCache, feedingAmbientCache } from '../ambient'

/**
 * `feedingAmbientCache` (Plan 4, Task 10b review, finding 3): the ordering
 * between recording a reading into the shared cache and forwarding it to the
 * subscriber was an untested decision — swapping the two lines failed
 * nothing in the rest of the suite. This file exists to make that revert
 * fail.
 *
 * Not mocked: `createExpoLocationSource` / `@corymbia/geo`. This file never
 * calls `ambientCache.refresh()`, the only path that reaches it, so nothing
 * here touches a native module.
 */

const reading = (): Reading => ({
  latitude: -37.8136,
  longitude: 144.9631,
  accuracyM: 6,
  altitudeM: null,
  timestampMs: Date.now(),
})

describe('feedingAmbientCache', () => {
  it('records a reading into the shared cache before forwarding it, so a subscriber that throws does not cost the cache a position', async () => {
    const fake = createFakeLocationSource({ permission: 'granted', readings: [reading()] })
    const wrapped = feedingAmbientCache(fake)

    const subscriberBlewUp = new Error('subscriber blew up')
    const throwingSubscriber = (): void => {
      throw subscriberBlewUp
    }

    // The fake source delivers its one scripted reading synchronously,
    // inside `watch`, so the throw above surfaces as this promise rejecting
    // rather than as an unhandled exception.
    await expect(wrapped.watch(throwingSubscriber)).rejects.toBe(subscriberBlewUp)

    // If forwarding ran before recording, the throw above would have
    // unwound past `ambientCache.record(reading)` and this would read null.
    expect(ambientCache.read()).not.toBeNull()
    expect(ambientCache.read()).toMatchObject({ latitude: -37.8136, longitude: 144.9631 })
  })
})
