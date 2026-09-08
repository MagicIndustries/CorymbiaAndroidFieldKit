import type { Database } from '../db/port'
import { newId } from '../ids'
import { nowIso } from '../time'
import { appendEvent } from './events'
import type { Fix } from './records'

// NOT re-declared here. `MediaKind` is owned by `@corymbia/media`, which is
// where the extension per kind lives (`naming.ts`'s `EXTENSION` map), and is
// imported type-only so nothing at runtime crosses the package boundary — a
// type-only import is erased at compile time, so it cannot pull
// `expo-file-system` into this package's bundle.
//
// `media_kind_known` in migration 005, this union (by way of `MediaKind`), and
// `mediaFileName`'s `EXTENSION` map are three statements of the same fact —
// which kinds of attachment exist, and what each is written to disk as — and
// all three change together. A kind added in only one of them is either a row
// nothing can name a file for, or a file written with no extension at all,
// and either way the disagreement surfaces as a `SQLITE_CONSTRAINT` failure
// mid-capture on a field device rather than at review time.
import type { MediaKind } from '@corymbia/media'

export type Attachment = {
  id: string
  recordId: string
  kind: MediaKind
  fileName: string
  byteSize: number
  durationMs: number | null
  ordinal: number
  capturedAt: string
  deletedAt: string | null
}

type MediaRow = {
  id: string
  record_id: string
  kind: MediaKind
  file_name: string
  byte_size: number
  duration_ms: number | null
  ordinal: number
  captured_at: string
  deleted_at: string | null
}

function toAttachment(row: MediaRow): Attachment {
  return {
    id: row.id,
    recordId: row.record_id,
    kind: row.kind,
    fileName: row.file_name,
    byteSize: row.byte_size,
    durationMs: row.duration_ms,
    ordinal: row.ordinal,
    capturedAt: row.captured_at,
    deletedAt: row.deleted_at,
  }
}

const SELECT = `SELECT id, record_id, kind, file_name, byte_size, duration_ms, ordinal,
                       captured_at, deleted_at
                FROM media`

/**
 * Mints an id for a not-yet-existing attachment.
 *
 * Separate from `attachMedia` because the caller needs the id — to derive the
 * filename with `mediaFileName` and write the bytes — before the row can be
 * inserted (spec §12.1). Minting inside `attachMedia` would force either a
 * two-phase write (insert a placeholder, then fill it in) or a rename once the
 * bytes land, and either is a step that can be interrupted by the app dying
 * mid-capture. Minting first and writing the file before the row means the
 * only failure mode is an orphaned file with no row — recoverable by a purge —
 * never a row with no file behind it.
 */
export function newMediaId(): string {
  return newId('med')
}

/**
 * The next display position for a record's attachments: one more than the
 * highest live ordinal, or 1 when it has none.
 *
 * Deliberately excludes soft-deleted rows — `idx_media_record_ordinal` is a
 * partial unique index over live rows only, exactly so a removed attachment's
 * position can be reused rather than leaving a permanent gap. Read inside the
 * same transaction that inserts with it: reading it beforehand and passing it
 * in is how two attachments made in quick succession would land on the same
 * ordinal, since nothing would serialise the read against a concurrent write.
 */
async function nextOrdinal(db: Database, recordId: string): Promise<number> {
  const row = await db.first<{ next: number }>(
    'SELECT COALESCE(MAX(ordinal), 0) + 1 AS next FROM media WHERE record_id = ? AND deleted_at IS NULL',
    [recordId],
  )
  return row?.next ?? 1
}

/**
 * Attaches a photo or voice note to a record (spec §7.1, §12.1).
 *
 * Takes the media id rather than minting one — see `newMediaId`'s doc comment
 * for why. The caller has already derived the filename from that id with
 * `mediaFileName` and written the bytes to it; this call is what makes the
 * attachment exist as a row, in the same append-only chain of custody as
 * every other change to a record (spec §8.5).
 *
 * The ordinal is allocated inside this function's own transaction, from the
 * row on disk — see `nextOrdinal`. The insert and the `media_added` event are
 * one transaction: a row with no event saying where and on which device it was
 * added is a broken chain of custody, the same reasoning `records.ts` applies
 * throughout.
 *
 * Refuses a record that does not exist, and one that has been soft-deleted —
 * an attachment belongs to a capture that is still live, and a tombstone is
 * not that.
 */
export async function attachMedia(
  db: Database,
  input: {
    mediaId: string
    recordId: string
    kind: MediaKind
    fileName: string
    byteSize: number
    durationMs: number | null
    deviceId: string
    fix: Fix
  },
): Promise<Attachment> {
  await db.transaction(async () => {
    const record = await db.first<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM record WHERE id = ?',
      [input.recordId],
    )
    if (!record) {
      throw new Error(
        `Record ${input.recordId} does not exist, so there is nothing to attach ${input.fileName} to.`,
      )
    }
    if (record.deleted_at !== null) {
      throw new Error(
        `Record ${input.recordId} has been deleted, so ${input.fileName} cannot be attached to ` +
          'it. A deleted record is a tombstone, not a capture still being added to.',
      )
    }

    const ordinal = await nextOrdinal(db, input.recordId)
    const at = nowIso()
    await db.execute(
      `INSERT INTO media (id, record_id, kind, file_name, byte_size, duration_ms, ordinal,
                          captured_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.mediaId,
        input.recordId,
        input.kind,
        input.fileName,
        input.byteSize,
        input.durationMs,
        ordinal,
        at,
        at,
        at,
      ],
    )
    await appendEvent(db, {
      recordId: input.recordId,
      action: 'media_added',
      deviceId: input.deviceId,
      fix: input.fix,
      detail: `${input.kind} ${input.fileName}`,
    })
  })

  const attachment = await db.first<MediaRow>(`${SELECT} WHERE id = ?`, [input.mediaId])
  if (!attachment) {
    throw new Error(`Attachment ${input.mediaId} vanished immediately after being attached.`)
  }
  return toAttachment(attachment)
}

/**
 * A record's live attachments, in display order.
 *
 * Soft-deleted rows are excluded (spec §12.1): the file they name still
 * exists on disk until a purge, but the attachment itself is gone from
 * anything she would see on the record.
 */
export async function listMedia(db: Database, recordId: string): Promise<Attachment[]> {
  const rows = await db.all<MediaRow>(
    `${SELECT} WHERE record_id = ? AND deleted_at IS NULL ORDER BY ordinal ASC`,
    [recordId],
  )
  return rows.map(toAttachment)
}

/**
 * Removes an attachment, softly (spec §12.1): the row is flagged and stays in
 * the table, because the file it names is still on disk until a deliberate
 * purge in settings, and the purge needs the row to find it by.
 *
 * There is no `media_removed` event action. Adding one would mean widening
 * `event_action_known` in migration 003's CHECK, which that table's own
 * append-only triggers forbid rebuilding around. Instead this appends an
 * `'edited'` event against the record, with a detail naming what was removed
 * — as honest a record of the removal as a dedicated action, and one that
 * needs no migration.
 *
 * Refused when the attachment does not exist, or has already been removed —
 * the log is append-only, so a second removal could never be taken back, and
 * a caller asking to remove what is already gone is asking for a state the
 * row is already in.
 */
export async function softDeleteMedia(
  db: Database,
  mediaId: string,
  deviceId: string,
  fix: Fix,
): Promise<void> {
  await db.transaction(async () => {
    const existing = await db.first<{
      record_id: string
      kind: MediaKind
      file_name: string
      deleted_at: string | null
    }>('SELECT record_id, kind, file_name, deleted_at FROM media WHERE id = ?', [mediaId])
    if (!existing) {
      throw new Error(`Attachment ${mediaId} does not exist, so there is nothing to remove.`)
    }
    if (existing.deleted_at !== null) {
      throw new Error(`Attachment ${mediaId} has already been removed.`)
    }

    const at = nowIso()
    await db.execute('UPDATE media SET deleted_at = ?, updated_at = ? WHERE id = ?', [
      at,
      at,
      mediaId,
    ])
    await appendEvent(db, {
      recordId: existing.record_id,
      action: 'edited',
      deviceId,
      fix,
      detail: `${existing.kind} ${existing.file_name} removed`,
    })
  })
}
