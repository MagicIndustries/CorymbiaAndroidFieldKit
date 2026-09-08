import { useCallback } from 'react'
import { attachMedia, newMediaId, type Database, type Fix } from '@corymbia/data'
import { mediaFileName, type MediaKind } from '@corymbia/media'
import { useDatabase, useDevice } from '../db/provider'
import { mediaStore } from './store'
import { readAmbient } from './ambient'

/**
 * The pipeline behind `attachPhoto` and `attachVoice` (`src/media`, Tasks 8
 * and 9's seams) — spec §12.1.
 *
 * **Ordering, and why it is this way round.** A row without its file is a
 * broken record: the strip shows a tile, the tile shows nothing, and export
 * produces a manifest entry pointing at a missing file. A file without its
 * row is garbage: invisible, harmless, cleanable by a purge. So this always
 * mints the media id, derives the filename, writes the bytes, and only then
 * inserts the row — and if the insert is refused, removes the file it just
 * wrote. If that removal also fails, the insert's own error is what gets
 * reported: a leaked file is recoverable by a purge, and the insert failure
 * is the one thing she needs to hear about right now. A crash between the
 * write and the insert leaves an orphaned file — the one failure mode this
 * ordering chooses, because the alternative (a row with no file) is worse.
 *
 * `attachMedia` takes the media id rather than minting its own, precisely so
 * this can derive the filename and write the bytes before the row exists —
 * see `newMediaId`'s own doc comment in `@corymbia/data`.
 */

export type AttachPhotoInput = {
  recordId: string
  sourceUri: string
}

export type AttachVoiceInput = {
  recordId: string
  sourceUri: string
  durationMs: number
}

/**
 * Turns whatever the ambient cache currently holds into the `Fix` stamped on
 * the `media_added` event (spec §8.1: every event carries where it
 * happened).
 *
 * Never reads a live position — `readAmbient` only ever returns what is
 * already cached, so attaching a photo can never wait on the GPS.
 *
 * `{ quality: 'none' }` covers two cases, not one: the cache holding nothing
 * at all, and the cache holding a reading whose mocked status was never
 * reported. The first has no position to stamp. The second has a position
 * but nothing honest to say about `isMocked` — that field is a required
 * `boolean` on an ambient `Fix`, and defaulting an unknown answer to `false`
 * would assert "not spoofed" about a reading that never said so (the same
 * mistake `mockedVerdict`'s own doc comment, in `@corymbia/geo`, warns
 * against). Downgrading to `'none'` here costs the event its location
 * annotation, not the attachment itself — the photo or voice note is
 * attached either way, which is the one thing spec §8.2 will not let this
 * function refuse to do.
 */
function ambientFix(): Fix {
  const cached = readAmbient()
  if (cached === null || cached.isMocked === 'notReported') {
    return { quality: 'none' }
  }
  return {
    quality: 'ambient',
    latitude: cached.latitude,
    longitude: cached.longitude,
    accuracyM: cached.accuracyM,
    datum: 'WGS84',
    ageSeconds: cached.ageSeconds,
    verticalAccuracyM: cached.verticalAccuracyM,
    // Guarded above: `cached.isMocked === 'notReported'` already returned,
    // so the only two verdicts reaching here are 'mocked' and 'notMocked'.
    // No cast and no `?? false` — see the doc comment above for why.
    isMocked: cached.isMocked === 'mocked',
    // expo-location does not expose which provider produced a reading (the
    // same reason `useCapture.ts`'s CONDITIONS leaves this null).
    provider: null,
    // Android's accuracy figure is the 68% confidence radius, not a maximum
    // error (spec §7.5) — the same convention every device-derived position
    // in this app stores.
    accuracyConvention: 'radius68',
    // The ambient cache holds a position and an age, not the satellite
    // clock reading that produced it — `diagnostics.tsx`'s own ambient save
    // stamps the same null for the same reason.
    gpsTime: null,
    ...(cached.altitudeM === null
      ? { altitudeM: null, altitudeReference: null }
      : { altitudeM: cached.altitudeM, altitudeReference: 'wgs84Ellipsoid' }),
  }
}

/**
 * The five steps, shared by both `attachPhoto` and `attachVoice`: mint the
 * id, derive the name, write the bytes, insert the row, roll back the file
 * if the row is refused.
 */
async function attachOne(
  db: Database,
  deviceId: string,
  kind: MediaKind,
  input: { recordId: string; sourceUri: string; durationMs: number | null },
): Promise<void> {
  const mediaId = newMediaId()
  const fileName = mediaFileName(mediaId, kind)

  const saved = await mediaStore.save(fileName, input.sourceUri)

  try {
    await attachMedia(db, {
      mediaId,
      recordId: input.recordId,
      kind,
      fileName,
      // The store's own measurement of what it wrote, not a figure carried
      // in from the caller — a source file can grow or shrink between
      // whatever the caller last measured and the byte-for-byte copy this
      // just made.
      byteSize: saved.byteSize,
      durationMs: input.durationMs,
      deviceId,
      fix: ambientFix(),
    })
  } catch (insertError) {
    try {
      await mediaStore.remove(fileName)
    } catch {
      // A rollback failure here is a leaked file — recoverable later by a
      // purge. `insertError`, thrown below, is the failure she needs to
      // hear about now: a photo or voice note she believes was saved and
      // was not.
    }
    throw insertError
  }
}

/**
 * Fills the `attachPhoto`/`attachVoice` seams (`src/media/attachPhoto.ts`,
 * `src/media/attachVoice.ts`) with the real pipeline.
 *
 * Reads the database and the device from context (`src/db/provider.tsx`)
 * rather than taking them as parameters — unlike `useCapture`, which is
 * handed its dependencies because it is unit-tested against a scripted
 * `LocationSource`. Nothing here needs a live GPS; the ambient cache and the
 * media store are read the same way regardless of who is asking, so there is
 * nothing a caller could usefully inject.
 */
export function useAttachMedia(): {
  attachPhoto(input: AttachPhotoInput): Promise<void>
  attachVoice(input: AttachVoiceInput): Promise<void>
} {
  const db = useDatabase()
  const device = useDevice()

  const attachPhoto = useCallback(
    (input: AttachPhotoInput) =>
      attachOne(db, device.id, 'photo', { ...input, durationMs: null }),
    [db, device],
  )

  const attachVoice = useCallback(
    (input: AttachVoiceInput) => attachOne(db, device.id, 'voice', input),
    [db, device],
  )

  return { attachPhoto, attachVoice }
}
