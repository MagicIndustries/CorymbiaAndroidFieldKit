import { openTestDatabase } from '../../db/better-sqlite3'
import { migrate } from '../../db/migrate'
import type { Database, SqlValue } from '../../db/port'
import { createActivity } from '../activities'
import { createProject } from '../projects'
import { registerDevice } from '../devices'
import { listEvents } from '../events'
import {
  createRecord,
  fileRecord,
  getRecord,
  listRecords,
  listUnfiledRecords,
  moveRecord,
  refileRecord,
  refineRecordFix,
  renameRecord,
  sampleEvidence,
  softDeleteRecord,
} from '../records'
import type { Fix } from '../records'

// Every position carries the full set of per-fix conditions (spec §7.5):
// migration 003 hardened the schema after the original plan was written, so a
// deliberate or ambient fix that omits any of these is not constructible.
// GPS time is provenance of the fix, so it travels inside the position-carrying
// branches of the union rather than beside them: a positionless record has no
// satellite clock reading, and record_none_has_no_position says so.
const CONDITIONS = {
  verticalAccuracyM: 3,
  accuracyConvention: 'radius68',
  isMocked: false,
  provider: 'gps',
  gpsTime: '2026-02-11T09:14:03+11:00',
} as const

const DELIBERATE: Fix = {
  quality: 'deliberate',
  latitude: -37.82141,
  longitude: 145.03318,
  accuracyM: 4,
  altitudeM: 62,
  altitudeReference: 'wgs84Ellipsoid',
  datum: 'WGS84',
  ...sampleEvidence(7, 1.2),
  holdMs: 4200,
  ...CONDITIONS,
}

// SAVE NOW: one tap, one reading — no spread to report, and holding for 0 ms is
// a true statement about a real capture rather than a guess.
const INSTANT: Fix = {
  quality: 'deliberate',
  latitude: -37.8201,
  longitude: 145.0329,
  accuracyM: 6,
  altitudeM: 60,
  altitudeReference: 'wgs84Ellipsoid',
  datum: 'WGS84',
  ...sampleEvidence(1, null),
  holdMs: 0,
  ...CONDITIONS,
}

const AMBIENT: Fix = {
  quality: 'ambient',
  latitude: -37.82088,
  longitude: 145.03402,
  accuracyM: 38,
  // No barometer reading on this fix, so no height — and therefore no reference
  // frame either. The pair is all-or-nothing.
  altitudeM: null,
  altitudeReference: null,
  datum: 'WGS84',
  ageSeconds: 240,
  ...CONDITIONS,
}

// The platform did not expose a provider, a satellite clock or a height on this
// one. Every optional part of a position absent at once, still a real capture.
const SPARSE_AMBIENT: Fix = {
  quality: 'ambient',
  latitude: -37.8199,
  longitude: 145.0341,
  accuracyM: 55,
  altitudeM: null,
  altitudeReference: null,
  datum: 'WGS84',
  ageSeconds: 12,
  verticalAccuracyM: null,
  accuracyConvention: 'unknown',
  isMocked: false,
  provider: null,
  gpsTime: null,
}

describe('records', () => {
  let db: Database
  let activityId: string
  let deviceId: string

  beforeEach(async () => {
    db = await openTestDatabase()
    await migrate(db)
    deviceId = (
      await registerDevice(db, {
        installId: 'install-abc',
        label: 'field-s24',
        manufacturer: 'samsung',
        brand: 'samsung',
        modelName: 'Galaxy S24',
        modelId: 'SM-S938B',
        deviceType: 'phone',
        osName: 'Android',
        osVersion: '16',
        isPhysical: true,
        appVersion: '1.0.0',
        appBuild: '1',
      })
    ).id
    const project = await createProject(db, { name: 'Yarra Flats' })
    activityId = (
      await createActivity(db, { projectId: project.id, kind: 'survey', name: 'Survey 3' })
    ).id
  })
  afterEach(async () => {
    await db.close()
  })

  it('stores a deliberate fix with its full provenance', async () => {
    const record = await createRecord(db, {
      activityId,
      kind: 'pin',
      fix: DELIBERATE,
      deviceId,
    })
    expect(record.fix).toEqual(DELIBERATE)
  })

  it('stores a one-reading deliberate fix with no spread, per SAVE NOW', async () => {
    // A single reading has an undefined spread, not a zero one — the schema
    // requires spreadM to be null exactly when sampleCount is 1.
    const record = await createRecord(db, {
      activityId,
      kind: 'pin',
      fix: INSTANT,
      deviceId,
    })
    expect(record.fix).toEqual(INSTANT)
  })

  it('stores an ambient fix with its age', async () => {
    const record = await createRecord(db, {
      activityId,
      kind: 'pin',
      fix: AMBIENT,
      deviceId,
    })
    expect(record.fix).toEqual(AMBIENT)
  })

  it('stores an ambient fix whose provider, GPS time and altitude are all absent', async () => {
    // The type closes pairs the schema couples; it must not close over a real
    // field shape. Everything optional missing at once is still a capture.
    const record = await createRecord(db, {
      activityId,
      kind: 'pin',
      fix: SPARSE_AMBIENT,
      deviceId,
    })
    expect(record.fix).toEqual(SPARSE_AMBIENT)
  })

  it('keeps the GPS time with the fix it belongs to', async () => {
    // Spec §7.4: the satellite clock reading is provenance of a position, so a
    // positionless record has none — record_none_has_no_position requires
    // gps_time IS NULL, and the type now agrees rather than deferring to it.
    const positioned = await createRecord(db, {
      activityId,
      kind: 'pin',
      fix: DELIBERATE,
      deviceId,
    })
    expect(positioned.fix).toMatchObject({ gpsTime: '2026-02-11T09:14:03+11:00' })

    const positionless = await createRecord(db, {
      activityId,
      kind: 'pin',
      fix: { quality: 'none' },
      deviceId,
    })
    const raw = await db.first<{ gps_time: string | null }>(
      'SELECT gps_time FROM record WHERE id = ?',
      [positionless.id],
    )
    expect(raw?.gps_time).toBeNull()
  })

  it('stores a record with no position at all', async () => {
    const record = await createRecord(db, {
      activityId,
      kind: 'pin',
      fix: { quality: 'none' },
      deviceId,
    })
    expect(record.fix).toEqual({ quality: 'none' })
  })

  it('keeps why a record has no position, which the row itself cannot say', async () => {
    // record_none_has_no_position forces latitude, longitude, accuracy and GPS
    // time all to NULL, so the row can only ever record THAT there was no
    // position. Which absence it was — tapped before the lock, or a platform
    // that never reports whether a position is mocked, so none could be
    // asserted at all — is a different fact, and it goes in the append-only
    // event log rather than in `description`, where an observer's own note
    // lives and could be typed over.
    const record = await createRecord(db, {
      activityId,
      kind: 'pin',
      fix: { quality: 'none' },
      deviceId,
      detail: 'this platform never reported whether the position is mocked',
    })

    const created = (await listEvents(db, record.id)).find((e) => e.action === 'created')
    expect(created?.detail).toBe('this platform never reported whether the position is mocked')
    // And it is not smuggled onto the record itself.
    expect(record.description).toBeNull()
  })

  it('gives a record captured into an activity both numbers', async () => {
    // Spec §7.2: the tube label and the ordinal in the survey. Captured
    // directly into an activity, so nothing was filed after the fact.
    const record = await createRecord(db, { activityId, kind: 'pin', fix: DELIBERATE, deviceId })
    expect(record.captureNumber).toBe(1)
    expect(record.sequence).toBe(1)
    expect(record.filedAt).toBeNull()
  })

  it('gives an Inbox capture a tube label and no ordinal', async () => {
    // She is standing at the site with a sample tube and no project chosen.
    // The label has to exist now; the ordinal cannot, because there is no
    // activity for it to be an ordinal in.
    const record = await createRecord(db, { activityId: null, kind: 'pin', fix: AMBIENT, deviceId })
    expect(record.captureNumber).toBe(1)
    expect(record.sequence).toBeNull()
    expect(record.filedAt).toBeNull()
  })

  it('numbers captures across the whole database, activity or Inbox alike', async () => {
    // The ordinal restarts per activity; the label never restarts at all. A
    // capture number scoped per activity would put two tubes labelled 1 in the
    // same bag.
    const first = await createRecord(db, { activityId, kind: 'pin', fix: DELIBERATE, deviceId })
    const inbox = await createRecord(db, {
      activityId: null,
      kind: 'pin',
      fix: AMBIENT,
      deviceId,
    })
    const project = await createProject(db, { name: 'Other' })
    const other = await createActivity(db, {
      projectId: project.id,
      kind: 'survey',
      name: 'Survey 1',
    })
    const elsewhere = await createRecord(db, {
      activityId: other.id,
      kind: 'pin',
      fix: DELIBERATE,
      deviceId,
    })

    expect([first.captureNumber, inbox.captureNumber, elsewhere.captureNumber]).toEqual([1, 2, 3])
    expect([first.sequence, inbox.sequence, elsewhere.sequence]).toEqual([1, null, 1])
  })

  it('does not reuse a soft-deleted record’s capture number', async () => {
    // A tube in the bin still has 1 written on it. Reissuing that number is
    // also a UNIQUE collision, because idx_record_capture_number is not partial
    // on deleted_at — but the label is the reason the index is shaped that way.
    const first = await createRecord(db, { activityId, kind: 'pin', fix: DELIBERATE, deviceId })
    await softDeleteRecord(db, first.id, deviceId)
    const second = await createRecord(db, { activityId, kind: 'pin', fix: DELIBERATE, deviceId })
    expect(second.captureNumber).toBe(2)
  })

  it('numbers records per activity, starting at 1', async () => {
    const first = await createRecord(db, {
      activityId,
      kind: 'pin',
      fix: DELIBERATE,
      deviceId,
    })
    const second = await createRecord(db, {
      activityId,
      kind: 'pin',
      fix: DELIBERATE,
      deviceId,
    })
    expect([first.sequence, second.sequence]).toEqual([1, 2])
  })

  it('restarts numbering for a different activity', async () => {
    await createRecord(db, { activityId, kind: 'pin', fix: DELIBERATE, deviceId })
    const project = await createProject(db, { name: 'Other' })
    const other = await createActivity(db, {
      projectId: project.id,
      kind: 'survey',
      name: 'Survey 1',
    })
    const record = await createRecord(db, {
      activityId: other.id,
      kind: 'pin',
      fix: DELIBERATE,
      deviceId,
    })
    expect(record.sequence).toBe(1)
  })

  it('accepts a record with no activity — the Inbox is a supported destination', async () => {
    const record = await createRecord(db, {
      activityId: null,
      kind: 'pin',
      fix: AMBIENT,
      deviceId,
    })
    expect(record.activityId).toBeNull()
  })

  it('lists the unfiled records and nothing else', async () => {
    // With only one record in the database, and that one unfiled, an
    // implementation ignoring activity_id entirely passes. There has to be
    // something for the filter to exclude.
    const unfiled = await createRecord(db, {
      activityId: null,
      kind: 'pin',
      fix: AMBIENT,
      deviceId,
    })
    await createRecord(db, { activityId, kind: 'pin', fix: DELIBERATE, deviceId })

    const deleted = await createRecord(db, {
      activityId: null,
      kind: 'pin',
      fix: INSTANT,
      deviceId,
    })
    await softDeleteRecord(db, deleted.id, deviceId)

    expect((await listUnfiledRecords(db)).map((r) => r.id)).toEqual([unfiled.id])
  })

  it('captures the activity that was running, separately from where it is filed', async () => {
    // Spec §8.3: two links. Filing is a deliberate decision (starts empty for
    // the Inbox); the context link is written automatically and is what the
    // Inbox's one-tap filing suggestion is built from.
    const record = await createRecord(db, {
      activityId: null,
      kind: 'pin',
      fix: AMBIENT,
      deviceId,
      contextActivityId: activityId,
    })
    expect(record.activityId).toBeNull()
    expect(record.contextActivityId).toBe(activityId)

    // The creation event stamps what was actually happening, not where the
    // record ended up filed — the behaviour createRecord's comment explains at
    // length, and the whole reason the Inbox keeps two links. Asserting only
    // the two columns above would pass just as well if the event recorded the
    // filed activity instead.
    const [creation] = await listEvents(db, record.id)
    expect(creation?.activityId).toBe(activityId)
  })

  it('writes a creation event, so provenance exists without anyone remembering to log it', async () => {
    const record = await createRecord(db, {
      activityId,
      kind: 'pin',
      fix: DELIBERATE,
      deviceId,
    })
    const events = await listEvents(db, record.id)
    expect(events.map((e) => e.action)).toEqual(['created'])
    expect(events[0]?.deviceId).toBe(deviceId)
  })

  it('does not reuse a soft-deleted record’s sequence number', async () => {
    // nextSequence deliberately queries the bare `record` table rather than the
    // filtered SELECT constant. The unique index on (activity_id, sequence) has
    // no partial predicate, so it still counts tombstones: handing a new record
    // a deleted one's number is a UNIQUE collision, and a lost capture.
    //
    // An "obvious" tidy-up to reuse SELECT here leaves every other test green.
    // This is the one that goes red.
    const first = await createRecord(db, { activityId, kind: 'pin', fix: DELIBERATE, deviceId })
    expect(first.sequence).toBe(1)

    await softDeleteRecord(db, first.id, deviceId)

    const second = await createRecord(db, { activityId, kind: 'pin', fix: DELIBERATE, deviceId })
    expect(second.sequence).toBe(2)
  })

  it('lists an activity’s records most recent first, by capture time', async () => {
    const older = await createRecord(db, { activityId, kind: 'pin', fix: DELIBERATE, deviceId })
    const newer = await createRecord(db, { activityId, kind: 'pin', fix: DELIBERATE, deviceId })

    // nowIso() truncates to whole seconds, so both rows are written with the
    // same captured_at no matter how long the test sleeps between them — and
    // the id tiebreak alone would then decide the order, leaving `captured_at
    // DESC` untested. Push them apart explicitly, and put the times in the
    // OPPOSITE order to the ids, so dropping either term changes the answer.
    await db.execute('UPDATE record SET captured_at = ? WHERE id = ?', [
      '2026-02-11T08:00:00+11:00',
      newer.id,
    ])
    await db.execute('UPDATE record SET captured_at = ? WHERE id = ?', [
      '2026-02-11T09:00:00+11:00',
      older.id,
    ])

    expect((await listRecords(db, activityId)).map((r) => r.id)).toEqual([older.id, newer.id])
  })

  it('breaks a same-second tie by id, so a burst of captures has a stable order', async () => {
    // nowIso() truncates to whole seconds, so two captures in the same second
    // — the normal case for a burst — genuinely share a captured_at and the
    // tiebreak is all there is. Pinned here rather than left to chance: writing
    // the timestamp explicitly keeps the test off the second boundary that
    // would otherwise decide, at random, which term it was exercising.
    //
    // This test would keep passing if `captured_at DESC` were dropped. That is
    // deliberate — it covers `id DESC` only, and the test above covers the
    // other term. Ids are time-ordered, so the later capture still sorts first.
    const first = await createRecord(db, { activityId, kind: 'pin', fix: DELIBERATE, deviceId })
    const second = await createRecord(db, { activityId, kind: 'pin', fix: DELIBERATE, deviceId })
    await db.execute('UPDATE record SET captured_at = ? WHERE activity_id = ?', [
      '2026-02-11T09:14:03+11:00',
      activityId,
    ])

    expect((await listRecords(db, activityId)).map((r) => r.id)).toEqual([second.id, first.id])
  })

  it('soft-deletes, keeping the row and logging the deletion', async () => {
    const record = await createRecord(db, {
      activityId,
      kind: 'pin',
      fix: DELIBERATE,
      deviceId,
    })
    await softDeleteRecord(db, record.id, deviceId)

    expect(await listRecords(db, activityId)).toEqual([])
    const raw = await db.first<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM record WHERE id = ?',
      [record.id],
    )
    expect(raw?.deleted_at).not.toBeNull()
    expect((await listEvents(db, record.id)).map((e) => e.action)).toEqual(['created', 'deleted'])
  })

  it('reports an unknown mocked flag as unknown, not as "not spoofed"', async () => {
    // The record path is the one that reaches an export, so a NULL here must
    // stay NULL rather than becoming `false`.
    //
    // This build cannot write such a row — record_mocked_known_when_positioned
    // refuses it, which is why the CHECKs have to be suspended to plant one.
    // That is the point: the row does not come from here. It comes from a
    // restored backup, a sync peer, or a database written before migration 003
    // added the column, and the reader still has to be honest about it.
    const record = await createRecord(db, { activityId, kind: 'pin', fix: AMBIENT, deviceId })
    await db.execute('PRAGMA ignore_check_constraints = ON')
    await db.execute('UPDATE record SET is_mocked = NULL WHERE id = ?', [record.id])
    await db.execute('PRAGMA ignore_check_constraints = OFF')

    const reread = await listRecords(db, activityId)
    expect(reread[0]?.fix).toMatchObject({ isMocked: null })
  })

  it('stamps the deletion event with where the deletion happened', async () => {
    // Spec §8.5: creation, edits, filing, playback and deletion each carry a
    // context stamp. A deletion is exactly the one whose location matters later.
    const record = await createRecord(db, { activityId, kind: 'pin', fix: DELIBERATE, deviceId })
    await softDeleteRecord(db, record.id, deviceId, AMBIENT)

    const deletion = (await listEvents(db, record.id)).find((e) => e.action === 'deleted')
    expect(deletion?.fixQuality).toBe('ambient')
    expect(deletion?.latitude).toBe(AMBIENT.quality === 'ambient' ? AMBIENT.latitude : null)
    expect(deletion?.isMocked).toBe(false)
  })

  it('leaves the deletion event unstamped when no fix is offered', async () => {
    // A bulk tidy-up from a list has no single position to report; inventing
    // one would be worse than leaving it absent.
    const record = await createRecord(db, { activityId, kind: 'pin', fix: DELIBERATE, deviceId })
    await softDeleteRecord(db, record.id, deviceId)

    const deletion = (await listEvents(db, record.id)).find((e) => e.action === 'deleted')
    expect(deletion?.fixQuality).toBeNull()
    expect(deletion?.isMocked).toBeNull()
  })

  it('treats a second deletion as a no-op, keeping the first deletion’s moment', async () => {
    const record = await createRecord(db, { activityId, kind: 'pin', fix: DELIBERATE, deviceId })
    await softDeleteRecord(db, record.id, deviceId)
    const first = await db.first<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM record WHERE id = ?',
      [record.id],
    )

    await softDeleteRecord(db, record.id, deviceId)

    const second = await db.first<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM record WHERE id = ?',
      [record.id],
    )
    expect(second?.deleted_at).toBe(first?.deleted_at)
    // The log is append-only, so a second entry could never have been retracted.
    expect((await listEvents(db, record.id)).map((e) => e.action)).toEqual(['created', 'deleted'])
  })

  it('says so plainly when asked to delete a record that does not exist', async () => {
    // Previously this updated nothing and then appended an event whose
    // record_id had no referent, surfacing as a FOREIGN KEY error that read as
    // though the delete itself had failed.
    await expect(softDeleteRecord(db, 'rec_missing', deviceId)).rejects.toThrow(
      /rec_missing does not exist/,
    )
    expect(await listEvents(db, 'rec_missing')).toEqual([])
  })

  it('gives two simultaneous Inbox captures distinct capture numbers', async () => {
    // Two rapid taps, each firing an un-awaited promise. Without serialisation
    // the second BEGIN throws and the first COMMIT commits the second's partial
    // work.
    //
    // The capture number is what this now measures, and it is the sharper test
    // of the two it could have made. An Inbox record has no activity ordinal at
    // all any more, so there is nothing there to collide; the capture number is
    // the read-then-write (`MAX(capture_number) + 1`, then INSERT) that two
    // interleaved transactions would both resolve to 1. The UNIQUE index would
    // catch that pair — which is exactly why the assertion is worth making
    // through the repository, where a caller would see a lost capture.
    const [first, second] = await Promise.all([
      createRecord(db, { activityId: null, kind: 'pin', fix: AMBIENT, deviceId }),
      createRecord(db, { activityId: null, kind: 'pin', fix: INSTANT, deviceId }),
    ])

    expect([first.captureNumber, second.captureNumber].sort((a, b) => a - b)).toEqual([1, 2])
    expect([first.sequence, second.sequence]).toEqual([null, null])
    expect((await listUnfiledRecords(db)).map((r) => r.id).sort()).toEqual(
      [first.id, second.id].sort(),
    )
  })

  it('fetches one record by id', async () => {
    const record = await createRecord(db, { activityId, kind: 'pin', fix: DELIBERATE, deviceId })
    expect(await getRecord(db, record.id)).toEqual(record)
  })

  it('returns null for an unknown id, and for one that has been soft-deleted', async () => {
    expect(await getRecord(db, 'rec_nothing')).toBeNull()

    const record = await createRecord(db, { activityId, kind: 'pin', fix: DELIBERATE, deviceId })
    await softDeleteRecord(db, record.id, deviceId)
    expect(await getRecord(db, record.id)).toBeNull()
  })

  it('rejects attributes that are not valid for the kind', async () => {
    await expect(
      createRecord(db, {
        activityId,
        kind: 'pin',
        fix: DELIBERATE,
        deviceId,
        attributes: { species: 'Eucalyptus' },
      }),
    ).rejects.toThrow(/species/)
  })
})

/**
 * Filing (spec §10.2), reordering, and refiling between activities — three uses
 * of the same renumbering.
 *
 * Every assertion about ordering reads the raw `record` table rather than
 * `listRecords`, because tombstones are load-bearing here: `idx_record_sequence`
 * has no `deleted_at` predicate, so a soft-deleted record still holds its
 * ordinal and must shift along with the live ones. A test that could not see
 * tombstones could not tell a correct renumbering from one that left a dead
 * record sitting on a number a live record was about to be given.
 */
describe('filing, reordering and refiling', () => {
  let db: Database
  let activityId: string
  let otherActivityId: string
  let deviceId: string

  /** Every record in an activity, tombstones included, in ordinal order. */
  const placements = async (id: string): Promise<{ id: string; sequence: number }[]> =>
    db.all<{ id: string; sequence: number }>(
      'SELECT id, sequence FROM record WHERE activity_id = ? ORDER BY sequence ASC',
      [id],
    )

  const captureNumbers = async (): Promise<Record<string, number>> => {
    const rows = await db.all<{ id: string; capture_number: number }>(
      'SELECT id, capture_number FROM record',
    )
    return Object.fromEntries(rows.map((row) => [row.id, row.capture_number]))
  }

  beforeEach(async () => {
    db = await openTestDatabase()
    await migrate(db)
    deviceId = (
      await registerDevice(db, {
        installId: 'install-abc',
        label: 'field-s24',
        manufacturer: 'samsung',
        brand: 'samsung',
        modelName: 'Galaxy S24',
        modelId: 'SM-S938B',
        deviceType: 'phone',
        osName: 'Android',
        osVersion: '16',
        isPhysical: true,
        appVersion: '1.0.0',
        appBuild: '1',
      })
    ).id
    const project = await createProject(db, { name: 'Yarra Flats' })
    activityId = (
      await createActivity(db, { projectId: project.id, kind: 'survey', name: 'Survey 3' })
    ).id
    otherActivityId = (
      await createActivity(db, { projectId: project.id, kind: 'survey', name: 'Survey 4' })
    ).id
  })
  afterEach(async () => {
    await db.close()
  })

  const captureInto = async (into: string): Promise<string> =>
    (await createRecord(db, { activityId: into, kind: 'pin', fix: DELIBERATE, deviceId })).id
  const capture = async (): Promise<string> => captureInto(activityId)
  const inboxCapture = async (): Promise<string> =>
    (await createRecord(db, { activityId: null, kind: 'pin', fix: AMBIENT, deviceId })).id

  // No repository function soft-deletes an activity yet, so the destination-
  // guard tests below set the column directly, the same way
  // records-schema.test.ts reaches for raw SQL wherever the repository API
  // has no way to build the state a rule needs to be tested against.
  const softDeleteActivity = async (id: string): Promise<void> => {
    await db.execute('UPDATE activity SET deleted_at = ? WHERE id = ?', [
      new Date().toISOString(),
      id,
    ])
  }

  it('appends to the end of an activity when no position is asked for', async () => {
    const first = await capture()
    const second = await capture()
    const unfiled = await inboxCapture()

    const filed = await fileRecord(db, { recordId: unfiled, activityId, deviceId })

    expect(filed.sequence).toBe(3)
    expect(await placements(activityId)).toEqual([
      { id: first, sequence: 1 },
      { id: second, sequence: 2 },
      { id: unfiled, sequence: 3 },
    ])
  })

  it('files into an empty activity as number 1', async () => {
    const unfiled = await inboxCapture()
    const filed = await fileRecord(db, { recordId: unfiled, activityId: otherActivityId, deviceId })
    expect(filed.sequence).toBe(1)
    expect(await placements(otherActivityId)).toEqual([{ id: unfiled, sequence: 1 }])
  })

  it('inserts into the middle, shifting live and soft-deleted records alike', async () => {
    // THE test for the renumbering. Four records already in the survey, the
    // second of them soft-deleted, and a fifth pushed in at position 2.
    //
    // The tombstone is the part that catches a wrong implementation twice
    // over: it still holds ordinal 2, so a renumbering that filters tombstones
    // leaves it there and the new record collides with a dead row; and it sits
    // in the middle of the range, so the shift cannot be done as a single
    // `UPDATE ... SET sequence = sequence + 1 WHERE sequence >= 2` — SQLite
    // checks idx_record_sequence per row as that statement proceeds, walks the
    // rows in ascending order through that very index, and fails with
    // `UNIQUE constraint failed: record.activity_id, record.sequence` before it
    // reaches the end.
    const one = await capture()
    const two = await capture()
    const three = await capture()
    const four = await capture()
    await softDeleteRecord(db, two, deviceId)
    const unfiled = await inboxCapture()
    const before = await captureNumbers()

    const filed = await fileRecord(db, { recordId: unfiled, activityId, deviceId, position: 2 })

    expect(filed.sequence).toBe(2)
    expect(await placements(activityId)).toEqual([
      { id: one, sequence: 1 },
      { id: unfiled, sequence: 2 },
      { id: two, sequence: 3 },
      { id: three, sequence: 4 },
      { id: four, sequence: 5 },
    ])
    // The whole justification for letting ordinals move: the number written on
    // the tube did not.
    expect(await captureNumbers()).toEqual(before)
  })

  it('inserts at the front, so the first record becomes the second', async () => {
    const one = await capture()
    const two = await capture()
    const unfiled = await inboxCapture()

    await fileRecord(db, { recordId: unfiled, activityId, deviceId, position: 1 })

    expect(await placements(activityId)).toEqual([
      { id: unfiled, sequence: 1 },
      { id: one, sequence: 2 },
      { id: two, sequence: 3 },
    ])
  })

  it('records the filing in the log, and on the row, in one transaction', async () => {
    const unfiled = await inboxCapture()
    const filed = await fileRecord(db, { recordId: unfiled, activityId, deviceId, fix: AMBIENT })

    // The column is the list screen's answer to "was this filed later?" — a
    // hundred records must not cost a hundred queries. The event is the source
    // of truth for where and on which device it happened.
    expect(filed.filedAt).not.toBeNull()
    const events = await listEvents(db, unfiled)
    expect(events.map((e) => e.action)).toEqual(['created', 'filed'])
    const filing = events[1]
    expect(filing?.activityId).toBe(activityId)
    expect(filing?.detail).toBe('sequence 1')
    expect(filing?.fixQuality).toBe('ambient')
  })

  it('leaves a record captured in place unmarked, so filing is visible after the fact', async () => {
    // Without a contrast this assertion is vacuous: a column that is always
    // null passes "filed_at is null for a capture" perfectly well.
    const inPlace = await capture()
    const unfiled = await inboxCapture()
    await fileRecord(db, { recordId: unfiled, activityId, deviceId })

    expect((await getRecord(db, inPlace))?.filedAt).toBeNull()
    expect((await getRecord(db, unfiled))?.filedAt).not.toBeNull()
  })

  it('refuses to file a record that is already in an activity', async () => {
    const record = await capture()
    await expect(
      fileRecord(db, { recordId: record, activityId: otherActivityId, deviceId }),
    ).rejects.toThrow(/already filed into activity/)
  })

  it('refuses to file a record that does not exist, or one that has been deleted', async () => {
    await expect(fileRecord(db, { recordId: 'rec_missing', activityId, deviceId })).rejects.toThrow(
      /rec_missing does not exist/,
    )
    const unfiled = await inboxCapture()
    await softDeleteRecord(db, unfiled, deviceId)
    await expect(fileRecord(db, { recordId: unfiled, activityId, deviceId })).rejects.toThrow(
      /has been deleted/,
    )
  })

  it('refuses to file into an activity that does not exist, or one that has been deleted', async () => {
    // A missing id used to fail on the foreign key with a raw, unexplained
    // message; a soft-deleted one used to succeed silently and strand the
    // record where no list would ever show it again — there is no un-file
    // operation to recover it with.
    const unfiled = await inboxCapture()
    await expect(
      fileRecord(db, { recordId: unfiled, activityId: 'act_missing', deviceId }),
    ).rejects.toThrow(/act_missing does not exist/)
    expect((await getRecord(db, unfiled))?.activityId).toBeNull()

    await softDeleteActivity(otherActivityId)
    await expect(
      fileRecord(db, { recordId: unfiled, activityId: otherActivityId, deviceId }),
    ).rejects.toThrow(/has been deleted/)

    // Refused before any write: the record is still unfiled and its log is
    // still just the capture.
    expect((await getRecord(db, unfiled))?.activityId).toBeNull()
    expect((await listEvents(db, unfiled)).map((e) => e.action)).toEqual(['created'])
  })

  it('refuses a position past the end of the activity, and leaves nothing half-done', async () => {
    const one = await capture()
    const unfiled = await inboxCapture()

    // One record in the activity, so 1 and 2 are legal and 3 is not.
    await expect(
      fileRecord(db, { recordId: unfiled, activityId, deviceId, position: 3 }),
    ).rejects.toThrow(/whole number from 1 to 2/)
    await expect(
      fileRecord(db, { recordId: unfiled, activityId, deviceId, position: 0 }),
    ).rejects.toThrow(/whole number from 1 to 2/)

    expect(await placements(activityId)).toEqual([{ id: one, sequence: 1 }])
    expect((await getRecord(db, unfiled))?.activityId).toBeNull()
    expect((await listEvents(db, unfiled)).map((e) => e.action)).toEqual(['created'])
  })

  it('moves a record up, shifting the records it displaces down', async () => {
    const one = await capture()
    const two = await capture()
    const three = await capture()
    const four = await capture()
    const before = await captureNumbers()

    const moved = await moveRecord(db, { recordId: four, position: 2, deviceId })

    expect(moved.sequence).toBe(2)
    expect(await placements(activityId)).toEqual([
      { id: one, sequence: 1 },
      { id: four, sequence: 2 },
      { id: two, sequence: 3 },
      { id: three, sequence: 4 },
    ])
    expect(await captureNumbers()).toEqual(before)
  })

  it('moves a record down, shifting the records it passes up', async () => {
    const one = await capture()
    const two = await capture()
    const three = await capture()
    const four = await capture()

    await moveRecord(db, { recordId: one, position: 3, deviceId })

    expect(await placements(activityId)).toEqual([
      { id: two, sequence: 1 },
      { id: three, sequence: 2 },
      { id: one, sequence: 3 },
      { id: four, sequence: 4 },
    ])
  })

  it('moves a record past a soft-deleted one, which shifts like any other', async () => {
    const one = await capture()
    const two = await capture()
    const three = await capture()
    await softDeleteRecord(db, two, deviceId)

    await moveRecord(db, { recordId: three, position: 1, deviceId })

    expect(await placements(activityId)).toEqual([
      { id: three, sequence: 1 },
      { id: one, sequence: 2 },
      { id: two, sequence: 3 },
    ])
  })

  it('logs a reorder as an edit, not as a filing, and does not backdate filed_at', async () => {
    // 'filed' in this log means a record reached an activity. A record that was
    // already there and merely changed places did not, and a history that said
    // otherwise would be wrong about the one thing it exists to record.
    const one = await capture()
    const two = await capture()

    await moveRecord(db, { recordId: two, position: 1, deviceId })

    const events = await listEvents(db, two)
    expect(events.map((e) => e.action)).toEqual(['created', 'edited'])
    expect(events[1]?.detail).toBe('sequence 2 to 1')
    expect(events[1]?.activityId).toBe(activityId)
    expect((await getRecord(db, two))?.filedAt).toBeNull()
    expect((await getRecord(db, one))?.filedAt).toBeNull()
  })

  it('treats a move to the position it already holds as a no-op', async () => {
    await capture()
    const two = await capture()

    const moved = await moveRecord(db, { recordId: two, position: 2, deviceId })

    expect(moved.sequence).toBe(2)
    // The log is append-only, so an entry saying it moved from 2 to 2 could
    // never have been taken back.
    expect((await listEvents(db, two)).map((e) => e.action)).toEqual(['created'])
  })

  it('refuses to move a record that is in the Inbox', async () => {
    const unfiled = await inboxCapture()
    await expect(moveRecord(db, { recordId: unfiled, position: 1, deviceId })).rejects.toThrow(
      /is in the Inbox/,
    )
  })

  it('refuses a move position outside the activity', async () => {
    await capture()
    const two = await capture()
    await expect(moveRecord(db, { recordId: two, position: 3, deviceId })).rejects.toThrow(
      /whole number from 1 to 2/,
    )
    await expect(moveRecord(db, { recordId: two, position: 1.5, deviceId })).rejects.toThrow(
      /whole number from 1 to 2/,
    )
  })

  it('keeps every capture number fixed across a filing and two reorders', async () => {
    // The end-to-end version of the promise the tube label makes. Ordinals move
    // three times; the labels are compared before and after the lot.
    const one = await capture()
    const two = await capture()
    const unfiled = await inboxCapture()
    const before = await captureNumbers()

    // [unfiled, one, two] → [one, unfiled, two] → [one, two, unfiled]
    await fileRecord(db, { recordId: unfiled, activityId, deviceId, position: 1 })
    await moveRecord(db, { recordId: one, position: 1, deviceId })
    await moveRecord(db, { recordId: two, position: 2, deviceId })

    expect(await captureNumbers()).toEqual(before)
    expect(await placements(activityId)).toEqual([
      { id: one, sequence: 1 },
      { id: two, sequence: 2 },
      { id: unfiled, sequence: 3 },
    ])
    // The record captured second ended up second again, but by a different
    // route, and the one captured last is now last — the ordinals genuinely
    // moved, or the capture-number assertion above is about numbers nothing
    // ever disturbed.
    expect(before[unfiled]).toBe(3)
  })

  // ---------------------------------------------------------------------------
  // Refiling: the same renumbering run twice, in opposite directions, on two
  // activities at once. The destination opens a slot; the source closes the gap.
  // ---------------------------------------------------------------------------

  it('moves a record out of the middle of one survey into the middle of another', async () => {
    const a1 = await capture()
    const a2 = await capture()
    const a3 = await capture()
    const a4 = await capture()
    const b1 = await captureInto(otherActivityId)
    const b2 = await captureInto(otherActivityId)
    const b3 = await captureInto(otherActivityId)
    const before = await captureNumbers()

    const refiled = await refileRecord(db, {
      recordId: a2,
      activityId: otherActivityId,
      deviceId,
      position: 2,
    })

    expect(refiled.activityId).toBe(otherActivityId)
    expect(refiled.sequence).toBe(2)
    // The source closes up: 1, 2, 3 with no hole where a2 used to be.
    expect(await placements(activityId)).toEqual([
      { id: a1, sequence: 1 },
      { id: a3, sequence: 2 },
      { id: a4, sequence: 3 },
    ])
    expect(await placements(otherActivityId)).toEqual([
      { id: b1, sequence: 1 },
      { id: a2, sequence: 2 },
      { id: b2, sequence: 3 },
      { id: b3, sequence: 4 },
    ])
    // The justification for letting the ordinals in BOTH surveys move: not one
    // of the seven tube labels did.
    expect(await captureNumbers()).toEqual(before)
  })

  it('shifts a tombstone behind the departing record, and leaves one in front of it alone', async () => {
    // THE test for the gap-closing. idx_record_sequence has no deleted_at
    // predicate, so a soft-deleted record still occupies its ordinal: a
    // close-up that skipped tombstones would leave a4's dead row on 4 while
    // a5 renumbered onto it — `UNIQUE constraint failed` — and a close-up that
    // shifted the rows in front of the departure would corrupt ordinals nothing
    // asked to move.
    const a1 = await capture()
    const a2 = await capture()
    const a3 = await capture()
    const a4 = await capture()
    const a5 = await capture()
    await softDeleteRecord(db, a2, deviceId) // in front of the departure
    await softDeleteRecord(db, a4, deviceId) // behind it
    const before = await captureNumbers()

    await refileRecord(db, { recordId: a3, activityId: otherActivityId, deviceId })

    expect(await placements(activityId)).toEqual([
      { id: a1, sequence: 1 },
      { id: a2, sequence: 2 }, // tombstone in front: unmoved
      { id: a4, sequence: 3 }, // tombstone behind: shifted down like any other
      { id: a5, sequence: 4 },
    ])
    expect(await placements(otherActivityId)).toEqual([{ id: a3, sequence: 1 }])
    expect(await captureNumbers()).toEqual(before)
  })

  it('appends to the end of an empty activity when no position is asked for', async () => {
    const a1 = await capture()
    const a2 = await capture()

    const refiled = await refileRecord(db, {
      recordId: a2,
      activityId: otherActivityId,
      deviceId,
    })

    expect(refiled.sequence).toBe(1)
    expect(await placements(activityId)).toEqual([{ id: a1, sequence: 1 }])
    expect(await placements(otherActivityId)).toEqual([{ id: a2, sequence: 1 }])
  })

  it('refiles the only record in an activity, leaving that activity empty', async () => {
    const only = await capture()
    const b1 = await captureInto(otherActivityId)
    const b2 = await captureInto(otherActivityId)
    const before = await captureNumbers()

    const refiled = await refileRecord(db, {
      recordId: only,
      activityId: otherActivityId,
      deviceId,
    })

    expect(refiled.sequence).toBe(3)
    // An empty source is a legal end state, not an error: closing a gap of one
    // in a survey of one leaves nothing behind.
    expect(await placements(activityId)).toEqual([])
    expect(await placements(otherActivityId)).toEqual([
      { id: b1, sequence: 1 },
      { id: b2, sequence: 2 },
      { id: only, sequence: 3 },
    ])
    expect(await captureNumbers()).toEqual(before)
  })

  it('logs the refiling as a filing that names the activity it came from', async () => {
    // A log entry that cannot tell you where something was is not an audit
    // trail. The event's activity_id is the destination, so the source and the
    // ordinal it held there have to be in the detail or they are nowhere.
    const a1 = await capture()
    const a2 = await capture()
    await captureInto(otherActivityId)

    await refileRecord(db, {
      recordId: a2,
      activityId: otherActivityId,
      deviceId,
      position: 1,
      fix: AMBIENT,
    })

    const events = await listEvents(db, a2)
    expect(events.map((e) => e.action)).toEqual(['created', 'filed'])
    const refiling = events[1]
    expect(refiling?.activityId).toBe(otherActivityId)
    expect(refiling?.detail).toBe(
      `refiled from activity ${activityId} sequence 2 to sequence 1`,
    )
    expect(refiling?.fixQuality).toBe('ambient')
    expect(refiling?.isMocked).toBe(false)
    // a1 never moved, so nothing was written about it.
    expect((await listEvents(db, a1)).map((e) => e.action)).toEqual(['created'])
  })

  it('stamps filed_at on a record that had been in its activity since capture', async () => {
    // filed_at answers "did this record arrive in the activity it is in NOW by
    // a filing decision, and when". A record captured straight into Survey 3
    // and then refiled into Survey 4 did not arrive there at capture, so the
    // column has to start saying so.
    const captured = await capture()
    expect((await getRecord(db, captured))?.filedAt).toBeNull()

    const refiled = await refileRecord(db, {
      recordId: captured,
      activityId: otherActivityId,
      deviceId,
    })

    expect(refiled.filedAt).not.toBeNull()
  })

  it('refuses to refile a record into the activity it is already in', async () => {
    await capture()
    const two = await capture()

    await expect(
      refileRecord(db, { recordId: two, activityId, deviceId, position: 1 }),
    ).rejects.toThrow(/already in activity/)
    // The sentence has to name the function that does what was probably meant.
    await expect(
      refileRecord(db, { recordId: two, activityId, deviceId, position: 1 }),
    ).rejects.toThrow(/moveRecord/)
    expect(await placements(activityId)).toHaveLength(2)
    expect((await listEvents(db, two)).map((e) => e.action)).toEqual(['created'])
  })

  it('refuses to refile a record that is in the Inbox, a deleted one, or a missing one', async () => {
    const unfiled = await inboxCapture()
    await expect(
      refileRecord(db, { recordId: unfiled, activityId, deviceId }),
    ).rejects.toThrow(/is in the Inbox/)

    await expect(
      refileRecord(db, { recordId: 'rec_missing', activityId, deviceId }),
    ).rejects.toThrow(/rec_missing does not exist/)

    const deleted = await capture()
    await softDeleteRecord(db, deleted, deviceId)
    await expect(
      refileRecord(db, { recordId: deleted, activityId: otherActivityId, deviceId }),
    ).rejects.toThrow(/has been deleted/)
  })

  it('refuses to refile into an activity that does not exist, or one that has been deleted', async () => {
    // Same failure as fileRecord's: a missing destination used to raise a raw
    // FOREIGN KEY error, and a soft-deleted one used to succeed silently,
    // stranding the record in an activity every list filters out.
    const a1 = await capture()
    const a2 = await capture()
    await expect(
      refileRecord(db, { recordId: a2, activityId: 'act_missing', deviceId }),
    ).rejects.toThrow(/act_missing does not exist/)

    await softDeleteActivity(otherActivityId)
    await expect(
      refileRecord(db, { recordId: a2, activityId: otherActivityId, deviceId }),
    ).rejects.toThrow(/has been deleted/)

    // Refused before any write: both the record and the source activity's
    // numbering are exactly as they were.
    expect(await placements(activityId)).toEqual([
      { id: a1, sequence: 1 },
      { id: a2, sequence: 2 },
    ])
    expect((await getRecord(db, a2))?.activityId).toBe(activityId)
    expect((await listEvents(db, a2)).map((e) => e.action)).toEqual(['created'])
  })

  it('refuses a position past the end of the destination, leaving both activities untouched', async () => {
    const a1 = await capture()
    const a2 = await capture()
    const b1 = await captureInto(otherActivityId)

    // One record in the destination, so 1 and 2 are legal and 3 is not. The
    // check runs before the first UPDATE, which is what "untouched" below is
    // actually testing.
    await expect(
      refileRecord(db, { recordId: a2, activityId: otherActivityId, deviceId, position: 3 }),
    ).rejects.toThrow(/whole number from 1 to 2/)
    await expect(
      refileRecord(db, { recordId: a2, activityId: otherActivityId, deviceId, position: 0 }),
    ).rejects.toThrow(/whole number from 1 to 2/)

    expect(await placements(activityId)).toEqual([
      { id: a1, sequence: 1 },
      { id: a2, sequence: 2 },
    ])
    expect(await placements(otherActivityId)).toEqual([{ id: b1, sequence: 1 }])
    expect((await listEvents(db, a2)).map((e) => e.action)).toEqual(['created'])
  })

  /**
   * The same database, with one statement made to fail — the only way to reach
   * the middle of a transaction from outside it without editing the production
   * code the test is supposed to be judging.
   *
   * It wraps `execute` only. `transaction` is spread through untouched, so
   * BEGIN/COMMIT/ROLLBACK still run against the same connection and the
   * rollback under test is the real one.
   */
  const failingOn = (
    base: Database,
    doomed: (sql: string, params: SqlValue[]) => boolean,
    message = 'the tablet died mid-refile',
  ): Database => ({
    ...base,
    async execute(sql, params = []) {
      if (doomed(sql, params)) throw new Error(message)
      await base.execute(sql, params)
    },
  })

  it('rolls BOTH activities back when the refile dies after the source has renumbered', async () => {
    // The strongest partial state this implementation can reach: the
    // destination has opened its slot, the record has landed in it, and the
    // source has closed its gap over a3 — and then the last statement of all,
    // a4's shift down, never happens. Nothing may survive.
    const a1 = await capture()
    const a2 = await capture()
    const a3 = await capture()
    const a4 = await capture()
    const b1 = await captureInto(otherActivityId)
    const b2 = await captureInto(otherActivityId)
    const before = await captureNumbers()

    const doomed = failingOn(
      db,
      (sql, params) => /UPDATE record SET sequence/.test(sql) && params.includes(a4),
    )
    await expect(
      refileRecord(doomed, { recordId: a2, activityId: otherActivityId, deviceId, position: 1 }),
    ).rejects.toThrow(/died mid-refile/)

    expect(await placements(activityId)).toEqual([
      { id: a1, sequence: 1 },
      { id: a2, sequence: 2 },
      { id: a3, sequence: 3 },
      { id: a4, sequence: 4 },
    ])
    expect(await placements(otherActivityId)).toEqual([
      { id: b1, sequence: 1 },
      { id: b2, sequence: 2 },
    ])
    expect((await getRecord(db, a2))?.activityId).toBe(activityId)
    expect((await getRecord(db, a2))?.filedAt).toBeNull()
    expect((await listEvents(db, a2)).map((e) => e.action)).toEqual(['created'])
    expect(await captureNumbers()).toEqual(before)
  })

  it('rolls BOTH activities back when the refile dies after the destination has opened its slot', async () => {
    // The mirror partial state: the destination has made room and the record
    // has not yet moved into it, so the destination is the half that is wrong.
    // A rollback that only restored the source would leave b1 and b2 sitting on
    // 2 and 3 with nothing on 1.
    const a1 = await capture()
    const a2 = await capture()
    const b1 = await captureInto(otherActivityId)
    const b2 = await captureInto(otherActivityId)

    const doomed = failingOn(db, (sql) => /UPDATE record SET activity_id/.test(sql))
    await expect(
      refileRecord(doomed, { recordId: a2, activityId: otherActivityId, deviceId, position: 1 }),
    ).rejects.toThrow(/died mid-refile/)

    expect(await placements(activityId)).toEqual([
      { id: a1, sequence: 1 },
      { id: a2, sequence: 2 },
    ])
    expect(await placements(otherActivityId)).toEqual([
      { id: b1, sequence: 1 },
      { id: b2, sequence: 2 },
    ])
  })

  // Spec §9.1: one tap saves the fix that exists at that instant, the screen
  // counts down while she stands still, and the saved row is then refined in
  // place. These prove the second half of that against real SQL — including
  // migration 003's CHECK constraints, which is where a refinement that wrote
  // the wrong combination of columns would actually be caught.
  describe('refineRecordFix', () => {
    it('sharpens a one-tap fix into the averaged one the countdown produced', async () => {
      const record = await createRecord(db, { activityId, kind: 'pin', fix: INSTANT, deviceId })
      expect(record.fix).toEqual(INSTANT)

      const { record: refined, applied } = await refineRecordFix(db, {
        recordId: record.id,
        fix: DELIBERATE,
        deviceId,
      })

      // INSTANT is ±6 m, DELIBERATE is ±4 m — a genuine improvement, so it
      // applies (see the `keeps the better fix` block below for the guard
      // itself).
      expect(applied).toBe(true)
      // Every fix column moves together, spread included: INSTANT is a
      // one-reading capture whose spread must be NULL, DELIBERATE is a
      // seven-reading one whose spread must not be —
      // record_spread_matches_sample_count refuses anything in between.
      expect(refined.fix).toEqual(DELIBERATE)
      // On disk, not merely in the object handed back.
      expect((await getRecord(db, record.id))?.fix).toEqual(DELIBERATE)
    })

    it('leaves the number written on the tube, and the capture time, exactly where they were', async () => {
      // Two records so a reassignment would actually be visible: refining the
      // second must not hand it the first one's label, or renumber either.
      const first = await createRecord(db, { activityId, kind: 'pin', fix: INSTANT, deviceId })
      const second = await createRecord(db, { activityId, kind: 'pin', fix: INSTANT, deviceId })

      const { record: refined } = await refineRecordFix(db, {
        recordId: second.id,
        fix: DELIBERATE,
        deviceId,
      })

      // capture_number is the label written in marker on a physical sample
      // tube. A refinement that moved it would leave the tube naming a
      // different record — and record_capture_number_is_immutable would abort
      // the whole transaction, losing the refinement too.
      expect(refined.captureNumber).toBe(second.captureNumber)
      expect((await getRecord(db, first.id))?.captureNumber).toBe(first.captureNumber)
      // The capture happened at the tap, not at the end of the countdown.
      expect(refined.capturedAt).toBe(second.capturedAt)
      expect(refined.sequence).toBe(second.sequence)
    })

    it('records both accuracies, so the history shows a fix that was improved', async () => {
      const record = await createRecord(db, { activityId, kind: 'pin', fix: INSTANT, deviceId })
      await refineRecordFix(db, { recordId: record.id, fix: DELIBERATE, deviceId })

      const events = await listEvents(db, record.id)
      expect(events.map((e) => e.action)).toEqual(['created', 'edited'])
      const refinement = events[1]
      // Without the previous figure written down here, the log would show a
      // record that was always ±4.0 m, when what happened is that a ±6.0 m fix
      // was stood over and sharpened. The event's own columns can only hold
      // one position, and they hold the new one.
      expect(refinement?.detail).toBe('fix refined from ±6.0 m to ±4.0 m')
      expect(refinement?.accuracyM).toBe(4)
      expect(refinement?.fixQuality).toBe('deliberate')
      expect(refinement?.activityId).toBe(activityId)
    })

    it('says so when the tap happened before the receiver had a position at all', async () => {
      // Doctrine rule 4: nothing blocks capture, so a tap with no fix yet still
      // writes a row — and the countdown that follows is what gives it one.
      const record = await createRecord(db, {
        activityId,
        kind: 'pin',
        fix: { quality: 'none' },
        deviceId,
      })
      await refineRecordFix(db, { recordId: record.id, fix: DELIBERATE, deviceId })

      const refinement = (await listEvents(db, record.id)).find((e) => e.action === 'edited')
      expect(refinement?.detail).toBe('fix refined from no position to ±4.0 m')
      expect((await getRecord(db, record.id))?.fix).toEqual(DELIBERATE)
    })

    // The two tests above refine upward — a sparse fix into a richer one — so
    // every column they check is being SET. A column added to the insert and
    // forgotten in the shared `FIX_COLUMNS` list would still be set correctly
    // by them, because the insert wrote it and the update simply never cleared
    // it. The clearing direction is the one that catches that: refine to a fix
    // whose fields are absent, and a column the update does not name keeps the
    // old value, leaving a row wearing half of its old position and half of its
    // new one — exactly the silent half-and-half `FIX_COLUMNS` exists to
    // prevent, and a row every CHECK constraint in migration 003 accepts.

    it('clears the columns a sparser fix does not carry, not just the ones it sets', async () => {
      // DELIBERATE carries the lot: seven readings, a spread, a hold, an
      // altitude with its reference frame, a vertical accuracy, a provider and
      // a satellite clock reading. Started coarser than BARE below (±20 m,
      // rather than DELIBERATE's own ±4 m) so that refining down to BARE is a
      // genuine improvement — this test is about column clearing, not about
      // the `keeps the better fix` guard, and a starting accuracy sharper than
      // the target would trip that guard and leave BARE discarded.
      const record = await createRecord(db, {
        activityId,
        kind: 'pin',
        fix: { ...DELIBERATE, accuracyM: 20 },
        deviceId,
      })

      // A one-reading capture on a receiver that reported none of it. Every
      // optional part of the previous fix is absent here, and each absence has
      // to reach the row: spread NULL because one reading has no disagreement
      // (record_spread_matches_sample_count), altitude and its reference NULL
      // together (record_altitude_has_reference), and the rest simply unknown.
      const BARE: Fix = {
        quality: 'deliberate',
        latitude: -37.8215,
        longitude: 145.0334,
        accuracyM: 9,
        altitudeM: null,
        altitudeReference: null,
        datum: 'WGS84',
        ...sampleEvidence(1, null),
        holdMs: 0,
        verticalAccuracyM: null,
        // Stays known: record_deliberate_is_survey_grade requires a real
        // convention on a deliberate fix, because a survey-grade number whose
        // confidence radius is unstated is not survey grade. The absences this
        // test is about are the four beside it.
        accuracyConvention: 'radius68',
        isMocked: false,
        provider: null,
        gpsTime: null,
      }

      const { record: refined, applied } = await refineRecordFix(db, {
        recordId: record.id,
        fix: BARE,
        deviceId,
      })

      expect(applied).toBe(true)
      expect(refined.fix).toEqual(BARE)
      expect((await getRecord(db, record.id))?.fix).toEqual(BARE)

      // Read straight out of SQL as well, because the mapper reconstructs a
      // union from these columns and could in principle hide a stale one behind
      // the discriminant. NULL here is the assertion; `toEqual` above would
      // pass on a leftover 62 m altitude only if the mapper dropped it.
      const row = await db.first<{
        altitude_m: number | null
        altitude_reference: string | null
        vertical_accuracy_m: number | null
        location_provider: string | null
        gps_time: string | null
        fix_spread_m: number | null
        fix_sample_count: number | null
        fix_hold_ms: number | null
      }>(
        `SELECT altitude_m, altitude_reference, vertical_accuracy_m, location_provider,
                gps_time, fix_spread_m, fix_sample_count, fix_hold_ms
         FROM record WHERE id = ?`,
        [record.id],
      )
      expect(row?.altitude_m).toBeNull()
      expect(row?.altitude_reference).toBeNull()
      expect(row?.vertical_accuracy_m).toBeNull()
      expect(row?.location_provider).toBeNull()
      expect(row?.gps_time).toBeNull()
      expect(row?.fix_spread_m).toBeNull()
      expect(row?.fix_sample_count).toBe(1)
      expect(row?.fix_hold_ms).toBe(0)
    })

    it('clears the ambient age when an ambient fix is upgraded to a deliberate one', async () => {
      // The class discriminant swaps which set of columns is legal: an
      // ambient fix has an age and none of a deliberate one's averaging
      // evidence; a deliberate fix has sample count, spread and hold and no
      // age. record_ambient_carries_age and record_deliberate_is_survey_grade
      // each police their own half, so a stale age left behind by the update
      // aborts the transaction rather than surviving — which is the same
      // failure, caught one layer down.
      //
      // This test used to run the other way — a deliberate fix refined down
      // to an ambient one, started at a coarse ±50 m purely to get past the
      // old accuracy-only guard. Spec §9.6.2 now forbids that direction
      // outright: a deliberate fix is never replaced by an ambient one,
      // whatever the accuracy figures say. That version is not adjusted here,
      // it is gone — it was proving a transition that can no longer happen,
      // and restoring it would be restoring the defect this file exists to
      // close. An upgrade (ambient to deliberate) is the direction §9.6.2
      // leaves legal, applies unconditionally on rank alone, and is the
      // transition the application will actually perform once Plan 5's
      // media-first entry points land — so it is what exercises this
      // clearing now.
      const record = await createRecord(db, { activityId, kind: 'pin', fix: AMBIENT, deviceId })

      const { record: refined, applied } = await refineRecordFix(db, {
        recordId: record.id,
        fix: DELIBERATE,
        deviceId,
      })

      expect(applied).toBe(true)
      expect(refined.fix).toEqual(DELIBERATE)
      expect((await getRecord(db, record.id))?.fix).toEqual(DELIBERATE)

      const row = await db.first<{
        fix_quality: string
        fix_age_seconds: number | null
        fix_sample_count: number | null
        fix_spread_m: number | null
        fix_hold_ms: number | null
      }>(
        `SELECT fix_quality, fix_age_seconds, fix_sample_count, fix_spread_m, fix_hold_ms
         FROM record WHERE id = ?`,
        [record.id],
      )
      expect(row?.fix_quality).toBe('deliberate')
      expect(row?.fix_age_seconds).toBeNull()
      expect(row?.fix_sample_count).toBe(DELIBERATE.sampleCount)
      expect(row?.fix_spread_m).toBe(DELIBERATE.spreadM)
      expect(row?.fix_hold_ms).toBe(DELIBERATE.holdMs)
    })

    // TRY AGAIN's whole promise: a second countdown over a record that already
    // has a fix is a real second measurement, not guaranteed to land closer
    // than the first — and the record must never end up worse for having been
    // tried again. These prove the guard directly against real SQL, including
    // the CHECK constraints a half-applied write would trip.
    describe('keeps the better fix (a run must not make the record worse)', () => {
      it('leaves the record untouched when a run comes back worse, and says so in the event log', async () => {
        const record = await createRecord(db, { activityId, kind: 'pin', fix: INSTANT, deviceId })

        const worse: Fix = { ...INSTANT, accuracyM: 9 }
        const { record: refined, applied } = await refineRecordFix(db, {
          recordId: record.id,
          fix: worse,
          deviceId,
        })

        expect(applied).toBe(false)
        // Not merely "an equally-accurate fix" — the same row, untouched.
        expect(refined.fix).toEqual(INSTANT)
        expect((await getRecord(db, record.id))?.fix).toEqual(INSTANT)

        // The attempt is still on the record: an 'edited' event exists, and it
        // reports what THIS RUN reached (±9.0 m) — not what stayed stored.
        const events = await listEvents(db, record.id)
        expect(events.map((e) => e.action)).toEqual(['created', 'edited'])
        const attemptEvent = events[1]
        expect(attemptEvent?.accuracyM).toBe(9)
        expect(attemptEvent?.fixQuality).toBe('deliberate')
        expect(attemptEvent?.detail).toBe(
          'fix refinement reached ±9.0 m, kept the sharper ±6.0 m already on the record',
        )
      })

      it('replaces the record when a run comes back better', async () => {
        const record = await createRecord(db, { activityId, kind: 'pin', fix: INSTANT, deviceId })

        const better: Fix = { ...INSTANT, accuracyM: 3 }
        const { record: refined, applied } = await refineRecordFix(db, {
          recordId: record.id,
          fix: better,
          deviceId,
        })

        expect(applied).toBe(true)
        expect(refined.fix).toEqual(better)
        expect((await getRecord(db, record.id))?.fix).toEqual(better)

        const events = await listEvents(db, record.id)
        expect(events.map((e) => e.action)).toEqual(['created', 'edited'])
        expect(events[1]?.detail).toBe('fix refined from ±6.0 m to ±3.0 m')
      })

      it('a second run worse than the first leaves the first run in place, not the tap', async () => {
        // The real TRY AGAIN shape: a tap with no fix yet, a countdown that
        // gives it one, and a second countdown that comes back worse than
        // that FIRST RUN — the baseline is the previous run's own result, not
        // the tap's.
        const record = await createRecord(db, {
          activityId,
          kind: 'pin',
          fix: { quality: 'none' },
          deviceId,
        })

        const firstRun: Fix = { ...INSTANT, accuracyM: 6 }
        const { applied: firstApplied } = await refineRecordFix(db, {
          recordId: record.id,
          fix: firstRun,
          deviceId,
        })
        expect(firstApplied).toBe(true)

        const secondRun: Fix = { ...INSTANT, accuracyM: 8 }
        const { record: afterSecond, applied: secondApplied } = await refineRecordFix(db, {
          recordId: record.id,
          fix: secondRun,
          deviceId,
        })

        expect(secondApplied).toBe(false)
        expect(afterSecond.fix).toEqual(firstRun)
        expect((await getRecord(db, record.id))?.fix).toEqual(firstRun)

        const events = await listEvents(db, record.id)
        expect(events.map((e) => e.action)).toEqual(['created', 'edited', 'edited'])
        expect(events[2]?.detail).toBe(
          'fix refinement reached ±8.0 m, kept the sharper ±6.0 m already on the record',
        )
      })

      it('applies a run of exactly the same accuracy — a tie is not a regression', async () => {
        // The first countdown over the tap's own reading can end with exactly
        // one sample and land on precisely the tap's own accuracy (see
        // `CapturePreview.improvedByM`'s doc comment on why that delta is
        // "structurally incapable of going negative" for a first run). The
        // guard must not treat that as a loss — only "not worse" is refused,
        // never "not strictly better" — or the ordinary, non-retry refinement
        // this project's other caller (`diagnostics.tsx`) always performs
        // would silently stop writing.
        const record = await createRecord(db, { activityId, kind: 'pin', fix: INSTANT, deviceId })

        const tie: Fix = { ...INSTANT, latitude: INSTANT.latitude + 0.0001 }
        const { record: refined, applied } = await refineRecordFix(db, {
          recordId: record.id,
          fix: tie,
          deviceId,
        })

        expect(applied).toBe(true)
        expect(refined.fix).toEqual(tie)
      })
    })

    it('rolls back the fix update when the event insert fails, leaving neither written', async () => {
      // The property the doc comment leans on: "a record whose columns say
      // ±3 m with no event saying how it got there" must not be reachable. If
      // the record UPDATE landed and the event INSERT then failed, that is
      // exactly the state it would produce — a refined fix on disk with no
      // audit trail explaining how it got there.
      const record = await createRecord(db, { activityId, kind: 'pin', fix: INSTANT, deviceId })

      const doomed = failingOn(
        db,
        (sql) => /INSERT INTO event/.test(sql),
        'the tablet died mid-refinement',
      )
      await expect(
        refineRecordFix(doomed, { recordId: record.id, fix: DELIBERATE, deviceId }),
      ).rejects.toThrow(/died mid-refinement/)

      // The record still reads exactly as the tap wrote it — the UPDATE was
      // rolled back along with the failed INSERT, not left standing alone.
      expect((await getRecord(db, record.id))?.fix).toEqual(INSTANT)
      // And no 'edited' event exists: the failed refinement left no trace,
      // rather than a half-written one.
      expect((await listEvents(db, record.id)).map((e) => e.action)).toEqual(['created'])
    })

    it('refuses a record that does not exist', async () => {
      await expect(
        refineRecordFix(db, { recordId: 'rec_missing', fix: DELIBERATE, deviceId }),
      ).rejects.toThrow(/does not exist, so there is no fix to refine/)
    })

    it('refuses a record that has been deleted', async () => {
      const record = await createRecord(db, { activityId, kind: 'pin', fix: INSTANT, deviceId })
      await softDeleteRecord(db, record.id, deviceId)

      await expect(
        refineRecordFix(db, { recordId: record.id, fix: DELIBERATE, deviceId }),
      ).rejects.toThrow(/has been deleted, so its fix cannot be refined/)
      // And the tombstone's own fix is untouched, which is the point: a
      // deletion is history, not a row to keep editing.
      const row = await db.first<{ accuracy_m: number }>(
        'SELECT accuracy_m FROM record WHERE id = ?',
        [record.id],
      )
      expect(row?.accuracy_m).toBe(6)
    })

    it('refuses to refine a position away', async () => {
      const record = await createRecord(db, { activityId, kind: 'pin', fix: DELIBERATE, deviceId })

      await expect(
        refineRecordFix(db, { recordId: record.id, fix: { quality: 'none' }, deviceId }),
      ).rejects.toThrow(/cannot be refined to no position at all/)

      expect((await getRecord(db, record.id))?.fix).toEqual(DELIBERATE)
      expect((await listEvents(db, record.id)).map((e) => e.action)).toEqual(['created'])
    })
  })

  // §9.6.2's rule: a deliberate fix always supersedes an ambient or absent
  // one, whatever the two accuracy numbers say — the accuracy comparison
  // above is only a same-class rule, and these prove it stays that way.
  // Nothing in the app can reach this today (every record starts from a
  // deliberate capture), which is exactly why it needs its own coverage
  // rather than waiting for a caller to exercise it by accident.
  describe('refineRecordFix across fix classes (spec §9.6.2)', () => {
    it('applies a deliberate fix over an ambient one that claims to be sharper', async () => {
      // The trap this rule exists for. The ambient number comes off a cached
      // reading that never waited for anything; the deliberate one is a held,
      // averaged, accuracy-gated measurement. They are not comparable, and
      // comparing them leaves the record stamped ambient after she stood
      // still to fix it — exactly what §8.2 forbids.
      const record = await createRecord(db, {
        activityId,
        kind: 'pin',
        fix: { ...AMBIENT, accuracyM: 3 },
        deviceId,
      })
      const sharperDeliberate: Fix = { ...DELIBERATE, accuracyM: 4 }

      const { record: refined, applied } = await refineRecordFix(db, {
        recordId: record.id,
        fix: sharperDeliberate,
        deviceId,
      })

      expect(applied).toBe(true)
      expect(refined.fix).toEqual(sharperDeliberate)
      expect((await getRecord(db, record.id))?.fix).toEqual(sharperDeliberate)
    })

    it('applies a deliberate fix over no position at all', async () => {
      const record = await createRecord(db, {
        activityId,
        kind: 'pin',
        fix: { quality: 'none' },
        deviceId,
      })
      const looseDeliberate: Fix = { ...DELIBERATE, accuracyM: 12 }

      const { record: refined, applied } = await refineRecordFix(db, {
        recordId: record.id,
        fix: looseDeliberate,
        deviceId,
      })

      expect(applied).toBe(true)
      expect(refined.fix).toEqual(looseDeliberate)
      expect((await getRecord(db, record.id))?.fix).toEqual(looseDeliberate)
    })

    it('still refuses a blunter deliberate fix over a sharper deliberate one', async () => {
      // Same class, so the accuracy comparison is the right one and keeps
      // working. This is the rule from the `keeps the better fix` block above
      // and it is not being relaxed by the class rank sitting in front of it.
      const sharper: Fix = { ...DELIBERATE, accuracyM: 2 }
      const record = await createRecord(db, { activityId, kind: 'pin', fix: sharper, deviceId })
      const blunter: Fix = { ...DELIBERATE, accuracyM: 5 }

      const { record: refined, applied } = await refineRecordFix(db, {
        recordId: record.id,
        fix: blunter,
        deviceId,
      })

      expect(applied).toBe(false)
      expect(refined.fix).toEqual(sharper)
      expect((await getRecord(db, record.id))?.fix).toEqual(sharper)
    })

    it('never downgrades a deliberate fix to an ambient one, however sharp', async () => {
      // The other direction, and the more dangerous one: an ambient fix
      // overwriting a survey-grade measurement would put an unwaited-for
      // coordinate into a biodiversity dataset under a solid teal chip.
      const original: Fix = { ...DELIBERATE, accuracyM: 9 }
      const record = await createRecord(db, { activityId, kind: 'pin', fix: original, deviceId })
      const sharpAmbient: Fix = { ...AMBIENT, accuracyM: 1 }

      const { record: refined, applied } = await refineRecordFix(db, {
        recordId: record.id,
        fix: sharpAmbient,
        deviceId,
      })

      expect(applied).toBe(false)
      expect(refined.fix).toEqual(original)
      expect((await getRecord(db, record.id))?.fix).toEqual(original)

      // The wording has to differ from the same-class refusal: this run was
      // not beaten on accuracy — on the numbers it looks sharper — it was
      // outranked. A message that said "kept the sharper" here would be a
      // lie about what actually happened.
      const events = await listEvents(db, record.id)
      expect(events[events.length - 1]?.detail).toBe(
        'fix refinement reached ±1.0 m, but an ambient fix cannot supersede the deliberate ' +
          '±9.0 m already on the record',
      )
    })

    it('still refuses a blunter ambient fix over a sharper ambient one', async () => {
      // The equal-rank fallback has to still be a real comparison, not "same
      // rank always applies" — this is the ambient-side twin of the
      // deliberate-side test above, catching a guard that ranks correctly
      // but stops comparing accuracy once the ranks tie.
      const sharper: Fix = { ...AMBIENT, accuracyM: 12 }
      const record = await createRecord(db, { activityId, kind: 'pin', fix: sharper, deviceId })
      const blunter: Fix = { ...AMBIENT, accuracyM: 30 }

      const { record: refined, applied } = await refineRecordFix(db, {
        recordId: record.id,
        fix: blunter,
        deviceId,
      })

      expect(applied).toBe(false)
      expect(refined.fix).toEqual(sharper)
    })

    it('compares accuracy between two ambient fixes', async () => {
      const record = await createRecord(db, {
        activityId,
        kind: 'pin',
        fix: { ...AMBIENT, accuracyM: 30 },
        deviceId,
      })
      const sharperAmbient: Fix = { ...AMBIENT, accuracyM: 12 }

      const { record: refined, applied } = await refineRecordFix(db, {
        recordId: record.id,
        fix: sharperAmbient,
        deviceId,
      })

      expect(applied).toBe(true)
      expect(refined.fix).toEqual(sharperAmbient)
      expect((await getRecord(db, record.id))?.fix).toEqual(sharperAmbient)
    })
  })

  describe('renameRecord', () => {
    it('gives a saved record a title', async () => {
      const record = await createRecord(db, { activityId, kind: 'pin', fix: INSTANT, deviceId })

      const renamed = await renameRecord(db, {
        recordId: record.id,
        title: 'Frog pool, north end',
        deviceId,
      })

      expect(renamed.title).toBe('Frog pool, north end')
      expect((await getRecord(db, record.id))?.title).toBe('Frog pool, north end')
    })

    it('records the change in the event log, because a title is part of the observation', async () => {
      const record = await createRecord(db, { activityId, kind: 'pin', fix: INSTANT, deviceId })

      await renameRecord(db, { recordId: record.id, title: 'Frog pool', deviceId })

      const events = await listEvents(db, record.id)
      expect(events.map((e) => e.action)).toEqual(['created', 'edited'])
      const renaming = events[1]
      expect(renaming?.detail).toBe('title set to "Frog pool"')
      expect(renaming?.activityId).toBe(activityId)
    })

    it('accepts a null title, because clearing a name is a real edit', async () => {
      const record = await createRecord(db, {
        activityId,
        kind: 'pin',
        fix: INSTANT,
        deviceId,
        title: 'Wrong',
      })

      const renamed = await renameRecord(db, { recordId: record.id, title: null, deviceId })

      expect(renamed.title).toBeNull()
      const renaming = (await listEvents(db, record.id)).find((e) => e.action === 'edited')
      expect(renaming?.detail).toBe('title cleared')
    })

    it('leaves description untouched when the caller does not supply one', async () => {
      const record = await createRecord(db, {
        activityId,
        kind: 'pin',
        fix: INSTANT,
        deviceId,
        description: 'Original notes',
      })

      const renamed = await renameRecord(db, { recordId: record.id, title: 'Named', deviceId })

      expect(renamed.description).toBe('Original notes')
    })

    it('overwrites description, including clearing it with an explicit null', async () => {
      const record = await createRecord(db, {
        activityId,
        kind: 'pin',
        fix: INSTANT,
        deviceId,
        description: 'Original notes',
      })

      const renamed = await renameRecord(db, {
        recordId: record.id,
        title: 'Named',
        description: null,
        deviceId,
      })

      expect(renamed.description).toBeNull()
      expect((await getRecord(db, record.id))?.description).toBeNull()
    })

    it('does not touch the capture number, which may be written on a sample tube', async () => {
      const record = await createRecord(db, { activityId, kind: 'pin', fix: INSTANT, deviceId })

      const renamed = await renameRecord(db, { recordId: record.id, title: 'Named', deviceId })

      expect(renamed.captureNumber).toBe(record.captureNumber)
    })

    it('does not touch capturedAt, because naming happens later but the capture did not', async () => {
      const record = await createRecord(db, { activityId, kind: 'pin', fix: INSTANT, deviceId })

      const renamed = await renameRecord(db, { recordId: record.id, title: 'Named', deviceId })

      expect(renamed.capturedAt).toBe(record.capturedAt)
    })

    it('refuses a record that does not exist, with a sentence', async () => {
      await expect(
        renameRecord(db, { recordId: 'rec_missing', title: 'x', deviceId }),
      ).rejects.toThrow(/does not exist/)
    })

    it('refuses a deleted record, because a tombstone is not editable', async () => {
      const record = await createRecord(db, { activityId, kind: 'pin', fix: INSTANT, deviceId })
      await softDeleteRecord(db, record.id, deviceId)

      await expect(
        renameRecord(db, { recordId: record.id, title: 'x', deviceId }),
      ).rejects.toThrow(/has been deleted/)
    })
  })
})

// Outside the `records` describe on purpose: this is a pure function and needs
// no database, so it should not pay for one.
describe('sampleEvidence', () => {
  it('builds the two shapes the schema accepts', () => {
    expect(sampleEvidence(1, null)).toEqual({ sampleCount: 1, spreadM: null })
    expect(sampleEvidence(7, 1.2)).toEqual({ sampleCount: 7, spreadM: 1.2 })
    // Zero spread is a real result from several readings that agreed exactly —
    // quite different from a single reading forced to invent one.
    expect(sampleEvidence(3, 0)).toEqual({ sampleCount: 3, spreadM: 0 })
  })

  it('refuses a one-reading fix that claims a spread — the case TypeScript cannot express', () => {
    // `{ sampleCount: number; spreadM: number }` is satisfiable with 1, so
    // without this the only thing catching it was migration 003's CHECK,
    // arriving as a raw SQLITE_CONSTRAINT message mid-capture.
    expect(() => sampleEvidence(1, 0)).toThrow(/one-reading fix has no spread/)
  })

  it('refuses an averaged fix with no spread to show for it', () => {
    expect(() => sampleEvidence(7, null)).toThrow(/must report their spread/)
  })

  it('refuses counts and spreads that are not readings and distances', () => {
    expect(() => sampleEvidence(0, null)).toThrow(/at least one/)
    expect(() => sampleEvidence(2.5, 1)).toThrow(/whole number/)
    expect(() => sampleEvidence(3, -1)).toThrow(/cannot be negative/)
  })
})
