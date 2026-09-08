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
 */

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

/**
 * Ordinals default to an auto-incrementing counter, not a fixed 1, so that two
 * `insertMedia` calls in the same test don't collide on idx_media_record_ordinal
 * by accident when the test is about something else entirely (the same-file-name
 * test, for one). Tests that ARE about the ordinal constraint pass one explicitly.
 */
let nextOrdinal = 1

async function insertMedia(db: Database, over: MediaOverrides = {}): Promise<string> {
  const id = over.id ?? `med_${nextOrdinal}`
  const kind = over.kind ?? 'photo'
  const ordinal = over.ordinal ?? nextOrdinal
  nextOrdinal += 1

  const row = {
    id,
    record_id: over.recordId ?? 'rec_a',
    kind,
    file_name: over.fileName ?? `${id}.jpg`,
    byte_size: over.byteSize ?? 123_456,
    duration_ms:
      over.durationMs !== undefined ? over.durationMs : kind === 'voice' ? 4200 : null,
    ordinal,
    captured_at: NOW,
    deleted_at: null,
    created_at: NOW,
    updated_at: NOW,
  }
  const columns = Object.keys(row)
  await db.execute(
    `INSERT INTO media (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    Object.values(row) as (string | number | null)[],
  )
  return id
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

  it('stores a photo attached to a record', async () => {
    await insertMedia(db, { id: 'med_one', fileName: 'med_one.jpg' })
    const rows = await db.all<{ id: string; record_id: string; kind: string }>(
      'SELECT id, record_id, kind FROM media WHERE id = ?',
      ['med_one'],
    )
    expect(rows).toEqual([{ id: 'med_one', record_id: 'rec_a', kind: 'photo' }])
  })

  it('refuses a kind it does not know', async () => {
    await expect(insertMedia(db, { kind: 'video' })).rejects.toThrow(/media_kind_known/)
  })

  it('refuses a voice note with no duration', async () => {
    // A voice note whose length is unknown cannot be shown, played back with a
    // progress bar, or costed for export. Photos have no duration at all, and
    // one constraint enforces both halves so neither can drift.
    await expect(insertMedia(db, { kind: 'voice', durationMs: null })).rejects.toThrow(
      /media_duration_matches_kind/,
    )
  })

  it('refuses a photo that claims a duration', async () => {
    await expect(insertMedia(db, { kind: 'photo', durationMs: 5000 })).rejects.toThrow(
      /media_duration_matches_kind/,
    )
  })

  it('refuses a zero-byte file', async () => {
    // An empty file is a failed capture that reported success. Storing the row
    // makes it look like she has a photo she does not have.
    await expect(insertMedia(db, { byteSize: 0 })).rejects.toThrow(/media_byte_size_positive/)
  })

  it('refuses two rows claiming the same file', async () => {
    await insertMedia(db, { id: 'med_one', fileName: 'med_one.jpg' })
    await expect(insertMedia(db, { id: 'med_two', fileName: 'med_one.jpg' })).rejects.toThrow(
      /idx_media_file_name|UNIQUE/,
    )
  })

  it('refuses two live attachments at the same position on one record', async () => {
    await insertMedia(db, { id: 'med_one', recordId: 'rec_a', ordinal: 1 })
    await expect(
      insertMedia(db, { id: 'med_two', recordId: 'rec_a', ordinal: 1 }),
    ).rejects.toThrow(/idx_media_record_ordinal|UNIQUE/)
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

  it('refuses an attachment on a record that does not exist', async () => {
    await expect(insertMedia(db, { recordId: 'rec_nope' })).rejects.toThrow(/FOREIGN KEY/)
  })
})
