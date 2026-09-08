import type { AmbientFix } from '@corymbia/geo'
import type { Fix } from '@corymbia/data'

/**
 * Maps a cached `AmbientFix` onto an `ambient`-quality `Fix` (spec §7.5,
 * §8.1).
 *
 * Extracted because, until this extraction, this was a verbatim third copy:
 * `src/media/useAttachMedia.ts`'s rollback pipeline and `diagnostics.tsx`'s
 * own ambient save each built the same nine fields the same way (this repo's
 * own doctrine — three statements of one fact, all three changing together —
 * argues against leaving that as it was).
 *
 * Lives beside `ambient.ts`, not under `src/media`, for the same reason the
 * cache itself does: `diagnostics.tsx` is a GPS diagnostics screen with
 * nothing to do with the photo pipeline, and importing this mapping from
 * `src/media` was that exact inversion repeated a second time (see
 * `ambient.ts`'s own doc comment).
 *
 * **What is deliberately NOT shared: the policy over `isMocked ===
 * 'notReported'`.** The two callers disagree on purpose, and both are
 * defensible for their own screen:
 *  - `diagnostics.tsx` refuses the save outright when the cached reading
 *    never said whether it was mocked.
 *  - `useAttachMedia.ts` downgrades to `{ quality: 'none' }` and proceeds —
 *    spec §8.2 will not let attaching a photo or voice note be refused over
 *    a missing location annotation.
 *
 * That decision has to stay with each caller, which is why this function
 * takes `isMocked` as an already-resolved `boolean` rather than reading
 * `cached.isMocked` (a `MockedVerdict`, which can also be `'notReported'`)
 * itself. By the time this runs, "what to do about an unreported verdict"
 * has already been answered — this has no policy of its own left to get
 * wrong.
 *
 * `verticalAccuracyM` is mapped straight through below, outside the altitude
 * branch. That is only correct because `createAmbientCache` (`packages/geo`)
 * already nulls `verticalAccuracyM` whenever `altitudeM` is null — an
 * invariant this function relies on and does not itself enforce.
 */
export function buildAmbientFix(cached: AmbientFix, isMocked: boolean): Fix {
  return {
    quality: 'ambient',
    latitude: cached.latitude,
    longitude: cached.longitude,
    accuracyM: cached.accuracyM,
    datum: 'WGS84',
    ageSeconds: cached.ageSeconds,
    verticalAccuracyM: cached.verticalAccuracyM,
    isMocked,
    // expo-location does not expose which provider produced a reading.
    provider: null,
    // Android's accuracy figure is the 68% confidence radius, not a maximum
    // error (spec §7.5) — the same convention every device-derived position
    // in this app stores.
    accuracyConvention: 'radius68',
    // The ambient cache holds a position and an age, not the satellite clock
    // reading that produced it.
    gpsTime: null,
    ...(cached.altitudeM === null
      ? { altitudeM: null, altitudeReference: null }
      : { altitudeM: cached.altitudeM, altitudeReference: 'wgs84Ellipsoid' }),
  }
}
