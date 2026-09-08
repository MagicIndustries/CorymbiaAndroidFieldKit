import { createAmbientCache, createExpoLocationSource, type AmbientFix } from '@corymbia/geo'

/**
 * The last position the device knew about, shared the way `mediaStore` is
 * (`./store.ts`) — one cache, so a reading recorded by whichever screen is
 * watching the GPS is the reading `useAttachMedia` reads back when a photo or
 * a voice note is attached a moment later.
 *
 * Nothing in `src/media` ever feeds this cache — `record()` is for the
 * screen that is actively watching a position, which a camera or a
 * recorder is not. It is read-only from here, deliberately: spec §8.2's
 * ambient class "never waits, never blocks, never gates", and asking the
 * cache to `refresh()` reaches for a live position, which is exactly the
 * wait attaching a photo must never take.
 */
const ambientCache = createAmbientCache(createExpoLocationSource())

/** Whatever the cache already holds, or `null` if it has never been fed. */
export function readAmbient(): AmbientFix | null {
  return ambientCache.read()
}

/**
 * Asks the platform for its own last-known position and folds it into the
 * cache if it is newer than what is already held. Exported for the screens
 * that are meant to call it — the ones actively watching a GPS, per spec
 * §8.2 — not for `useAttachMedia`, which must never wait on this.
 */
export function refreshAmbient(): Promise<AmbientFix | null> {
  return ambientCache.refresh()
}
