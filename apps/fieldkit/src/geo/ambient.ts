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
 * photo pipeline. `src/media` is one of its readers, not its home. The same
 * inversion existed a second time until now — `diagnostics.tsx`, a GPS
 * diagnostics screen, imported `buildAmbientFix` (`./ambientFix.ts`) from the
 * photo pipeline it has nothing to do with — so that mapping moved to sit
 * beside the cache instead.
 *
 * **There must never be a second one.** Task 10 shipped a cache nothing fed
 * while `diagnostics.tsx` fed a private one of its own, so every media event
 * would have been stamped `{ quality: 'none' }` — a feature that looks like it
 * works and records no position at all. Any screen that receives readings
 * feeds THIS object, through `feedingAmbientCache` below or by calling
 * `record` directly; nothing constructs a `createAmbientCache` of its own.
 * `app/__tests__/ambient-wiring.test.tsx` fails if that ever separates again.
 *
 * **How it is filled.** Spec §8.2: the cache "refreshes opportunistically —
 * whenever the capture screen is used, and at low frequency while an activity
 * is running." Only the first half is wired up here. `app/capture.tsx` calls
 * `ambientCache.refresh()` once, from a mount effect, so the first seconds
 * after a cold launch — before any `watch` subscription has delivered a
 * reading — stamp a photo from a real last-known position instead of
 * `{ quality: 'none' }`. It is fired and forgotten: nothing awaits it, and it
 * cannot delay or gate anything the screen does. The second half — refreshing
 * again at low frequency for as long as an activity runs — needs Plan 5's
 * activity machinery (there is no activity-lifetime hook to attach it to yet)
 * and is deliberately not built here.
 */
/**
 * The platform adapter, built on first use and not before.
 *
 * Importing a module must not reach for a native location provider. Beyond
 * being a side effect nobody asked for, it made this module impossible to
 * test alongside the screens: `createExpoLocationSource` is what every screen
 * test replaces, and a `jest.mock` factory is lazy — it runs when the mocked
 * package is first required, which is *during* the import of the screen and
 * therefore before the test file's own fixtures have been initialised.
 *
 * Narrowed to `getLastKnown` alone, because that is the only thing
 * `createAmbientCache`'s `refresh()` ever calls on it — `requestPermission`
 * and `watch` were never reachable through this object (nothing here
 * forwards them to anything), so they are not declared rather than kept as
 * dead code. A screen that wants permission or a live watch gets its own
 * `LocationSource` from `createExpoLocationSource()` directly, the way
 * `capture.tsx` and `diagnostics.tsx` both already do — this adapter exists
 * for `refresh()` and nothing else.
 */
let platformSource: Pick<LocationSource, 'getLastKnown'> | null = null

const deferredSource: Pick<LocationSource, 'getLastKnown'> = {
  getLastKnown: () => (platformSource ??= createExpoLocationSource()).getLastKnown(),
}

export const ambientCache = createAmbientCache(deferredSource)

/** The shape of the shared cache, for anything that passes it around. */
export type AmbientCache = typeof ambientCache

/**
 * The read-only half of `AmbientCache` — what a consumer that must never
 * write to the cache is typed against.
 *
 * `useAttachMedia.ts` only ever needs `read()`: an attach must never wait for
 * or feed a position, only stamp whatever is already there. It could reach
 * that discipline by convention alone — call `.read()` and nothing else — the
 * way this module did before `record` joined the exported surface, but a
 * convention is not a shape. Typing that call site against `AmbientReader`
 * instead of the wide `AmbientCache` makes calling `.record()` or
 * `.refresh()` from inside it a compile error rather than a habit to
 * remember. `diagnostics.tsx` keeps the wide `AmbientCache` — it legitimately
 * both reads the cache (the ambient save) and feeds it (its own location
 * callback calls `.record()` directly, since it does not route its readings
 * through `feedingAmbientCache`) — so the wide type stays exported for it.
 */
export type AmbientReader = Pick<AmbientCache, 'read'>

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
 * cannot cost the cache a position it had already been handed —
 * `src/geo/__tests__/ambient.test.ts` pins this ordering.
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
