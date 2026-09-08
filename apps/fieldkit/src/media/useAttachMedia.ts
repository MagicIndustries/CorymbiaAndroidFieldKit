import { useCallback } from 'react'
import {
  attachMedia,
  newMediaId,
  AttachmentPersistError,
  type Database,
  type Fix,
} from '@corymbia/data'
import { mediaFileName, type MediaKind } from '@corymbia/media'
import { useDatabase, useDevice } from '../db/provider'
import { mediaStore } from './store'
import { ambientCache, type AmbientReader } from '../geo/ambient'
import { ambientFixOrNone } from '../geo/ambientFix'

/**
 * Typed as the narrow read-only view, not the full `AmbientCache` —
 * `ambientCache` itself still exposes `record` and `refresh` (`diagnostics.tsx`
 * needs both), but this module must only ever call `.read()`. Assigning it
 * once, to a binding of the narrower type, turns "an attach never waits or
 * writes" from a rule this file has to remember into one the compiler
 * enforces: `ambientReader.record(...)` or `ambientReader.refresh()` below
 * would not type-check. See `AmbientReader`'s own doc comment
 * (`../geo/ambient.ts`) for why the wide type still exists at all.
 */
const ambientReader: AmbientReader = ambientCache

/**
 * The pipeline that attaches a photo (`app/camera.tsx`) or a voice note
 * (`app/voice.tsx`) to a record — spec §12.1.
 *
 * **Ordering, and why it is this way round.** A row without its file is a
 * broken record: the strip shows a tile, the tile shows nothing, and export
 * produces a manifest entry pointing at a missing file. A file without its
 * row is garbage: invisible, and damaging to nothing but free space. So this
 * always mints the media id, derives the filename, writes the bytes, and only
 * then inserts the row — and if the insert is refused, removes the file it
 * just wrote. If that removal also fails, the insert's own error is what gets
 * reported: a leaked file costs storage, and the insert failure is the one
 * thing she needs to hear about right now. A crash between the write and the
 * insert leaves an orphaned file — the one failure mode this ordering
 * chooses, because the alternative (a row with no file) is worse.
 *
 * **Nothing ever collects those orphans.** Spec §12.1's purge is not built —
 * no settings route, no reconciliation — so every file this path abandons,
 * and every soft-deleted attachment's bytes, stay on the device for good.
 * That is the accepted cost of the ordering above rather than a temporary
 * one, and `docs/media-storage.md` §5 is where it is written down.
 *
 * `attachMedia` takes the media id rather than minting its own, precisely so
 * this can derive the filename and write the bytes before the row exists —
 * see `newMediaId`'s own doc comment in `@corymbia/data`.
 *
 * **The rollback is narrower than "`attachMedia` threw."** `attachMedia`'s
 * insert runs inside its own transaction, which commits before that function
 * returns — and only then does it re-read the row to hand back, throwing if
 * that re-read fails. A throw from that post-commit read is not a refused
 * insert: the row already exists, and deleting the file it names would
 * create the exact outcome this ordering exists to prevent, a row with no
 * file. `attachMedia` signals that case distinctly, as `AttachmentPersistError`
 * (`@corymbia/data`) — see its own doc comment — and this rollback checks for
 * it and skips the delete when it sees one, propagating the error unrolled
 * either way.
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
 * Never reads a live position — `ambientReader.read()` only ever returns what
 * is already cached, so attaching a photo can never wait on the GPS. The full
 * cache's other methods, `record()` and `refresh()`, are not reachable
 * through `ambientReader`'s type at all — `refresh()` reaches for a live
 * position and is exactly the wait this must not take; the screens that watch
 * a GPS are what feed the cache (`src/geo/ambient.ts`).
 *
 * The downgrade-to-`{ quality: 'none' }` policy — and the field-by-field
 * construction of a positioned reading — live in `ambientFixOrNone`
 * (`../geo/ambientFix.ts`), shared with `capture.tsx`'s own play/removal
 * events. `diagnostics.tsx` resolves the same "what about an unreported
 * mocked verdict" question the opposite way (a refusal, not a downgrade) and
 * deliberately does not share this function — see `ambientFixOrNone`'s own
 * doc comment for why both answers are kept.
 */
const ambientFix = (): Fix => ambientFixOrNone(ambientReader)

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
    // The transaction already committed and only the confirming re-read
    // afterwards failed — see the doc comment at the top of this file. The
    // row exists; removing the file it names here would be exactly the
    // outcome this ordering exists to prevent, so this does not roll back
    // and simply reports the failure onward.
    if (insertError instanceof AttachmentPersistError) {
      throw insertError
    }
    try {
      await mediaStore.remove(fileName)
    } catch {
      // A rollback failure here leaks a file permanently — nothing collects
      // it, because the purge is not built (see the top of this file).
      // `insertError`, thrown below, is still the failure she needs to hear
      // about now: a photo or voice note she believes was saved and was not.
      // Storage she will not miss today outranks a record she will.
    }
    throw insertError
  }
}

/**
 * What `camera.tsx` and `voice.tsx` call once a photo or a recording has been
 * written to a temporary file.
 *
 * **This is a hook, and that is a precondition on its callers.** `useDatabase`
 * and `useDevice` both throw before the database is open, so a screen that
 * calls this must sit under `DatabaseProvider` and check `useDatabaseStatus`
 * before rendering the part of itself that calls it — which is why both
 * screens are split into a guard and a body, the same shape `capture.tsx` and
 * `diagnostics.tsx` already use.
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
    (input: AttachPhotoInput) => attachOne(db, device.id, 'photo', { ...input, durationMs: null }),
    [db, device],
  )

  const attachVoice = useCallback(
    (input: AttachVoiceInput) => attachOne(db, device.id, 'voice', input),
    [db, device],
  )

  return { attachPhoto, attachVoice }
}
