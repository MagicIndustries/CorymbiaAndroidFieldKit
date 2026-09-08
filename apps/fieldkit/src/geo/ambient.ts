import { createAmbientCache, createExpoLocationSource, type LocationSource } from '@corymbia/geo'

/**
 * The last position the device knew about — **one cache for the whole app**
 * (spec §8.2).
 *
 * **Why this is a module singleton and not a provider.** The value of an
 * ambient fix is precisely that it outlives the screen that produced it: the
 * capture screen watches the GPS, she walks ten metres, opens the camera, and
 * the photo's `media_added` event is stamped with the position that screen
 * saw. A cache held in React state or context would be scoped to a mounted
 * tree and to a render — and `useAttachMedia` reads it synchronously, inside
 * an attach that spec §8.2 forbids from ever waiting, so there is nothing a
 * context would buy. `mediaStore` (`src/media/store.ts`) is shared the same
 * way, for the same reason.
 *
 * **Why it lives here and not under `src/media`.** It did, briefly, and that
 * was wrong: this is an app-wide GPS cache, and leaving it in the media module
 * meant the capture screen would have imported its location cache from the
 * photo pipeline. `src/media` is one of its readers, not its home.
 *
 * **There must never be a second one.** Task 10 shipped a cache nothing fed
 * while `diagnostics.tsx` fed a private one of its own, so every media event
 * would have been stamped `{ quality: 'none' }` — a feature that looks like it
 * works and records no position at all. Any screen that receives readings
 * feeds THIS object, through `feedingAmbientCache` below or by calling
 * `record` directly; nothing constructs a `createAmbientCache` of its own.
 * `app/__tests__/ambient-wiring.test.tsx` fails if that ever separates again.
 */
/**
 * The platform adapter, built on first use and not before.
 *
 * Importing a module must not reach for a native location provider. Beyond
 * being a side effect nobody asked for, it made this module impossible to
 * test alongside the screens: `createExpoLocationSource` is what every screen
 * test replaces, and a `jest.mock` factory is lazy — it runs when the mocked
 * package is first required, which is *during* the import of the screen and
 * therefore before the test file's own fixtures have been initialised. Only
 * `refresh()` needs a source at all, and nothing calls that yet.
 */
let platformSource: LocationSource | null = null

const deferredSource: LocationSource = {
  requestPermission: () => (platformSource ??= createExpoLocationSource()).requestPermission(),
  getLastKnown: () => (platformSource ??= createExpoLocationSource()).getLastKnown(),
  watch: (onReading) => (platformSource ??= createExpoLocationSource()).watch(onReading),
}

// `() => Date.now()` rather than the bare `Date.now` the default parameter
// would capture: this cache is constructed at import, long before any test can
// install a fake timer, and a captured reference goes on reading the real
// clock for the life of the process. Reading the global on each call means an
// age is measured against whatever clock is in force when it is asked for.
export const ambientCache = createAmbientCache(deferredSource, () => Date.now())

/** The shape of the shared cache, for anything that passes it around. */
export type AmbientCache = typeof ambientCache

/**
 * Wraps a `LocationSource` so every reading it delivers feeds the shared cache
 * on its way to the subscriber.
 *
 * This is how a screen that does not otherwise touch the cache — `capture.tsx`,
 * whose readings are consumed by `useCapture` rather than by the screen itself
 * — becomes a producer without `useCapture` having to know the cache exists.
 * The hook is deliberately dependency-injected and unit-tested against a
 * scripted source; reaching a module singleton from inside it would take that
 * away.
 *
 * `record` runs before the reading is forwarded, so a subscriber that throws
 * cannot cost the cache a position it had already been handed.
 */
export function feedingAmbientCache(source: LocationSource): LocationSource {
  return {
    requestPermission: () => source.requestPermission(),
    getLastKnown: () => source.getLastKnown(),
    watch: (onReading) =>
      source.watch((reading) => {
        ambientCache.record(reading)
        onReading(reading)
      }),
  }
}
