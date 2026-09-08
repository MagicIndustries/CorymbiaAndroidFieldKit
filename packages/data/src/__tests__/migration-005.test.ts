import { openTestDatabase } from '../db/better-sqlite3'
import { migrate } from '../db/migrate'
import type { Database } from '../db/port'

const NOW = '2026-09-08T09:14:00+10:00'

/**
 * Every negative assertion below names the constraint it expects, for the same
 * reason records-schema.test.ts does: `.rejects.toThrow()` with no matcher
 * passes on a column typo, a renamed table or a dropped constraint alike. The
 * constraints in this migration are named, so SQLite reports them by name and
 * a test can insist the rule it is about is the rule that fired.
 *
 * CHECK() reproduces records-schema.test.ts's helper: SQLite's real message is
 * `CHECK constraint failed: <name>`, and a bare `/media_kind_known/` would also
 * match an unrelated error that merely mentioned the name in passing.
 *
 * The two UNIQUE indexes get the same treatment records-schema.test.ts already
 * gives record's two unique indexes, for the same reason: SQLite never puts an
 * index name in a UNIQUE error, so `/idx_media_file_name|UNIQUE/` only ever
 * matches through its right-hand `/UNIQUE/` branch — the left alternative is
 * dead, and the test would pass just the same if the *other* unique index
 * fired. Matching the column list instead ties each assertion to the rule it
 * names.
 */
const CHECK = (name: string): RegExp => new RegExp(`CHECK constraint failed: ${name}`)
const UNIQUE_FILE_NAME = /UNIQUE constraint failed: media\.file_name/
const UNIQUE_RECORD_ORDINAL = /UNIQUE constraint failed: media\.record_id, media\.ordinal/

async function seedDevice(db: Database): Promise<void> {
  await db.execute(
    `INSERT INTO device (id, install_id, label, device_type, is_physical, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
    ['dev-1', 'install-abc', 'field-s24', 'phone', NOW, NOW],
  )
}

async function seedActivity(db: Database): Promise<void> {
  await db.execute(
    'INSERT INTO project (id, name, client_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ['p1', 'Yarra Flats', 'client-internal', NOW, NOW],
  )
  await db.execute(
    'INSERT INTO activity (id, project_id, kind, name, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['a1', 'p1', 'survey', 'Survey 3', NOW, NOW, NOW],
  )
}

/**
 * One well-formed deliberate-fix record, 'rec_a'. The media tests below do not
 * exercise anything about the record schema itself — this is just a valid
 * parent row for the foreign key — so it borrows the same shape
 * records-schema.test.ts already proves is accepted, rather than inventing a
 * second one.
 */
async function seedRecord(db: Database): Promise<void> {
  const row: Record<string, unknown> = {
    id: 'rec_a',
    activity_id: 'a1',
    context_activity_id: null,
    kind: 'pin',
    capture_number: 1,
    sequence: 1,
    filed_at: null,
    title: null,
    short_label: null,
    description: null,
    latitude: -37.82141,
    longitude: 145.03318,
    accuracy_m: 4,
    altitude_m: 62,
    datum: 'WGS84',
    fix_quality: 'deliberate',
    fix_age_seconds: null,
    fix_sample_count: 7,
    fix_spread_m: 1.2,
    fix_hold_ms: 4200,
    captured_at: NOW,
    gps_time: NOW,
    device_id: 'dev-1',
    vertical_accuracy_m: 3,
    is_mocked: 0,
    location_provider: 'gps',
    accuracy_convention: 'radius68',
    altitude_reference: 'wgs84Ellipsoid',
    attributes: '{}',
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
  }
  const columns = Object.keys(row)
  await db.execute(
    `INSERT INTO record (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    Object.values(row) as (string | number | null)[],
  )
}

interface MediaOverrides {
  id?: string
  recordId?: string
  kind?: string
  fileName?: string
  byteSize?: number
  durationMs?: number | null
  ordinal?: number
}

interface MediaRow {
  id: string
  record_id: string
  kind: string
  file_name: string
  byte_size: number
  duration_ms: number | null
  ordinal: number
  captured_at: string
  deleted_at: string | null
  created_at: string
  updated_at: string
}

/**
 * Ordinals default to an auto-incrementing counter, not a fixed 1, so that two
 * `insertMedia` calls in the same test don't collide on idx_media_record_ordinal
 * by accident when the test is about something else entirely (the same-file-name
 * test, for one). Tests that ARE about the ordinal constraint pass one explicitly.
 */
let nextOrdinal = 1

/** Row-building shared by `insertMedia` and `replaceMedia`, mirroring `recordRow`. */
function mediaRow(over: MediaOverrides = {}): MediaRow {
  const counter = nextOrdinal
  nextOrdinal += 1
  const id = over.id ?? `med_${counter}`
  const kind = over.kind ?? 'photo'
  const ordinal = over.ordinal ?? counter
  return {
    id,
    record_id: over.recordId ?? 'rec_a',
    kind,
    file_name: over.fileName ?? `${id}.jpg`,
    byte_size: over.byteSize ?? 123_456,
    duration_ms: over.durationMs !== undefined ? over.durationMs : kind === 'voice' ? 4200 : null,
    ordinal,
    captured_at: NOW,
    deleted_at: null,
    created_at: NOW,
    updated_at: NOW,
  }
}

const MEDIA_COLUMNS =
  'id, record_id, kind, file_name, byte_size, duration_ms, ordinal, captured_at, deleted_at, created_at, updated_at'
const MEDIA_PLACEHOLDERS = '?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?'

/**
 * `row` is concretely typed as `MediaRow` (unlike `seedRecord`'s dynamically
 * shaped `Record<string, unknown>`), so its values are read out by name into a
 * fixed-length tuple rather than via `Object.keys`/`Object.values` — that
 * needs no `as` cast at all, where the generic column-list approach would
 * need one to recover the key and value types `Object.keys`/`Object.values`
 * erase.
 */
function mediaParams(row: MediaRow): (string | number | null)[] {
  return [
    row.id,
    row.record_id,
    row.kind,
    row.file_name,
    row.byte_size,
    row.duration_ms,
    row.ordinal,
    row.captured_at,
    row.deleted_at,
    row.created_at,
    row.updated_at,
  ]
}

async function insertMedia(db: Database, over: MediaOverrides = {}): Promise<string> {
  const row = mediaRow(over)
  await db.execute(
    `INSERT INTO media (${MEDIA_COLUMNS}) VALUES (${MEDIA_PLACEHOLDERS})`,
    mediaParams(row),
  )
  return row.id
}

/**
 * Same row-building as `insertMedia`, but via `INSERT OR REPLACE` — the route
 * around `media_is_never_hard_deleted`'s `BEFORE DELETE` trigger that migration
 * 005's doc comment stakes the soft-delete guarantee on, the same hole
 * records-schema.test.ts's `replaceRecord` exercises for `record` and `event`.
 */
async function replaceMedia(db: Database, over: MediaOverrides = {}): Promise<string> {
  const row = mediaRow(over)
  await db.execute(
    `INSERT OR REPLACE INTO media (${MEDIA_COLUMNS}) VALUES (${MEDIA_PLACEHOLDERS})`,
    mediaParams(row),
  )
  return row.id
}

async function softDelete(db: Database, id: string): Promise<void> {
  await db.execute('UPDATE media SET deleted_at = ? WHERE id = ?', [NOW, id])
}

describe('the media table', () => {
  let db: Database
  beforeEach(async () => {
    nextOrdinal = 1
    db = await openTestDatabase()
    await migrate(db)
    await seedDevice(db)
    await seedActivity(db)
    await seedRecord(db)
  })
  afterEach(async () => {
    await db.close()
  })

  it('stores a photo attached to a record, every column intact', async () => {
    // Reads back the whole row rather than three of eleven columns, so a
    // column/value misalignment in the shared insert helper cannot pass
    // unnoticed — the earlier version of this test asserted only id, record_id
    // and kind.
    await insertMedia(db, {
      id: 'med_one',
      fileName: 'med_one.jpg',
      byteSize: 654_321,
      ordinal: 3,
    })
    const row = await db.first<MediaRow>('SELECT * FROM media WHERE id = ?', ['med_one'])
    expect(row).toEqual({
      id: 'med_one',
      record_id: 'rec_a',
      kind: 'photo',
      file_name: 'med_one.jpg',
      byte_size: 654_321,
      duration_ms: null,
      ordinal: 3,
      captured_at: NOW,
      deleted_at: null,
      created_at: NOW,
      updated_at: NOW,
    })
  })

  it('refuses a kind it does not know', async () => {
    await expect(insertMedia(db, { kind: 'video' })).rejects.toThrow(CHECK('media_kind_known'))
  })

  it('stores a voice note with its duration', async () => {
    // The negative voice tests below are both about what a voice note must
    // NOT look like; nothing until now proved a well-formed one is storable
    // at all. Narrowing media_duration_matches_kind to the photo half alone
    // would make every voice note unstorable and still leave those negative
    // tests green.
    await insertMedia(db, { id: 'med_voice', kind: 'voice', durationMs: 4200 })
    const row = await db.first<{ kind: string; duration_ms: number | null }>(
      'SELECT kind, duration_ms FROM media WHERE id = ?',
      ['med_voice'],
    )
    expect(row).toEqual({ kind: 'voice', duration_ms: 4200 })
  })

  it('refuses a voice note with no duration', async () => {
    // A voice note whose length is unknown cannot be shown, played back with a
    // progress bar, or costed for export. Photos have no duration at all, and
    // one constraint enforces both halves so neither can drift.
    await expect(insertMedia(db, { kind: 'voice', durationMs: null })).rejects.toThrow(
      CHECK('media_duration_matches_kind'),
    )
  })

  it.each([0, -100])('refuses a voice note with a duration of %i ms', async (durationMs) => {
    // duration_ms > 0 is a separate half of the same constraint from IS NOT
    // NULL — weakening it to IS NOT NULL alone would accept a duration of zero
    // or less, and nothing above exercises either.
    await expect(insertMedia(db, { kind: 'voice', durationMs })).rejects.toThrow(
      CHECK('media_duration_matches_kind'),
    )
  })

  it('refuses a photo that claims a duration', async () => {
    await expect(insertMedia(db, { kind: 'photo', durationMs: 5000 })).rejects.toThrow(
      CHECK('media_duration_matches_kind'),
    )
  })

  it('refuses a zero-byte file', async () => {
    // An empty file is a failed capture that reported success. Storing the row
    // makes it look like she has a photo she does not have.
    await expect(insertMedia(db, { byteSize: 0 })).rejects.toThrow(
      CHECK('media_byte_size_positive'),
    )
  })

  it('refuses an ordinal of zero', async () => {
    await expect(insertMedia(db, { ordinal: 0 })).rejects.toThrow(
      CHECK('media_ordinal_positive'),
    )
  })

  it('refuses two rows claiming the same file', async () => {
    await insertMedia(db, { id: 'med_one', fileName: 'med_one.jpg' })
    await expect(insertMedia(db, { id: 'med_two', fileName: 'med_one.jpg' })).rejects.toThrow(
      UNIQUE_FILE_NAME,
    )
  })

  it('refuses a new attachment claiming a soft-deleted attachment’s file name', async () => {
    // idx_media_record_ordinal is properly pinned by "frees a position once the
    // attachment at it is soft-deleted" below: the ordinal is display order
    // alone, so reusing one after a soft delete is correct. idx_media_file_name
    // must NOT get the same treatment — the file it names is still sitting on
    // disk, awaiting a deliberate purge, and handing its name to a new capture
    // overwrites those bytes. One record's photo would silently become
    // another's, with both rows still looking correct. Adding
    // `WHERE deleted_at IS NULL` here — "make the two indexes consistent" — is
    // exactly the tidy-up that would reopen that hole.
    await insertMedia(db, { id: 'med_one', fileName: 'shared.jpg' })
    await softDelete(db, 'med_one')
    await expect(insertMedia(db, { id: 'med_two', fileName: 'shared.jpg' })).rejects.toThrow(
      UNIQUE_FILE_NAME,
    )
  })

  it('refuses two live attachments at the same position on one record', async () => {
    await insertMedia(db, { id: 'med_one', recordId: 'rec_a', ordinal: 1 })
    await expect(
      insertMedia(db, { id: 'med_two', recordId: 'rec_a', ordinal: 1 }),
    ).rejects.toThrow(UNIQUE_RECORD_ORDINAL)
  })

  it('frees a position once the attachment at it is soft-deleted', async () => {
    // The ordinal is display order and nothing else now that filenames are
    // derived from the media id, so reusing one is safe — and required, or
    // removing a photo would leave a permanent hole in the numbering.
    await insertMedia(db, { id: 'med_one', recordId: 'rec_a', ordinal: 1 })
    await softDelete(db, 'med_one')
    await expect(
      insertMedia(db, { id: 'med_two', recordId: 'rec_a', ordinal: 1 }),
    ).resolves.toBeDefined()
  })

  it('refuses to let a stored filename be rewritten', async () => {
    // The row is the only thing that knows which bytes belong to this record.
    // An UPDATE here silently re-points it at another record's file — or at
    // nothing — and every export afterwards carries the wrong image.
    await insertMedia(db, { id: 'med_one', fileName: 'med_one.jpg' })
    await expect(
      db.execute('UPDATE media SET file_name = ? WHERE id = ?', ['other.jpg', 'med_one']),
    ).rejects.toThrow(/media_file_name_is_immutable/)
  })

  it('refuses to let a media row be hard-deleted', async () => {
    // Deletion is soft (spec §12.1): the row is flagged and the file survives
    // until a deliberate purge. A hard DELETE loses the record that the file
    // on disk was ever attached to anything, so the purge can never find it.
    await insertMedia(db, { id: 'med_one' })
    await expect(db.execute('DELETE FROM media WHERE id = ?', ['med_one'])).rejects.toThrow(
      /media_is_never_hard_deleted/,
    )
  })

  it('refuses an INSERT OR REPLACE: the route around the hard-delete guard', async () => {
    // REPLACE conflict resolution deletes the conflicting row before inserting
    // the new one — not an UPDATE, so media_file_name_is_immutable (a BEFORE
    // UPDATE trigger) never runs on this path. media_is_never_hard_deleted (a
    // BEFORE DELETE trigger) is what actually catches it, provided
    // recursive_triggers is ON — see the next test.
    await insertMedia(db, { id: 'med_one', fileName: 'med_one.jpg', byteSize: 111_111 })
    await expect(
      replaceMedia(db, { id: 'med_one', fileName: 'med_one.jpg', byteSize: 999_999 }),
    ).rejects.toThrow(/media_is_never_hard_deleted/)
    const row = await db.first<{ byte_size: number }>(
      'SELECT byte_size FROM media WHERE id = ?',
      ['med_one'],
    )
    expect(row?.byte_size).toBe(111_111)
  })

  it('leaves recursive_triggers on, which is what makes that REPLACE refusal work', async () => {
    // Confirmed, not assumed: with the pragma OFF the same REPLACE succeeds and
    // silently rewrites the row, which is exactly the failure this trigger
    // exists to stop. This test flips the pragma itself to prove the causation
    // rather than only reading its value.
    await insertMedia(db, { id: 'med_one', fileName: 'med_one.jpg', byteSize: 111_111 })
    await db.execute('PRAGMA recursive_triggers = OFF')
    await replaceMedia(db, { id: 'med_one', fileName: 'med_one.jpg', byteSize: 999_999 })
    const row = await db.first<{ byte_size: number }>(
      'SELECT byte_size FROM media WHERE id = ?',
      ['med_one'],
    )
    expect(row?.byte_size).toBe(999_999)
  })

  it('refuses an attachment on a record that does not exist', async () => {
    await expect(insertMedia(db, { recordId: 'rec_nope' })).rejects.toThrow(/FOREIGN KEY/)
  })
})
