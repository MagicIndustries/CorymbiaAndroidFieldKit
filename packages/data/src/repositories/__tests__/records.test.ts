import { openTestDatabase } from '../../db/better-sqlite3'
import { migrate } from '../../db/migrate'
import type { Database } from '../../db/port'
import { createActivity } from '../activities'
import { createProject } from '../projects'
import { registerDevice } from '../devices'
import { listEvents } from '../events'
import {
  createRecord,
  getRecord,
  listRecords,
  listUnfiledRecords,
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
    expect((await listUnfiledRecords(db)).map((r) => r.id)).toEqual([record.id])
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

  it('lists an activity’s records most recent first', async () => {
    const first = await createRecord(db, {
      activityId,
      kind: 'pin',
      fix: DELIBERATE,
      deviceId,
    })
    await new Promise((r) => setTimeout(r, 5))
    const second = await createRecord(db, {
      activityId,
      kind: 'pin',
      fix: DELIBERATE,
      deviceId,
    })
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

  it('gives two simultaneous Inbox captures distinct sequence numbers', async () => {
    // Two rapid taps, each firing an un-awaited promise. Without serialisation
    // the second BEGIN throws and the first COMMIT commits the second's partial
    // work — and the Inbox cannot fall back on the UNIQUE index to notice,
    // because SQLite treats NULL activity_ids as distinct.
    const [first, second] = await Promise.all([
      createRecord(db, { activityId: null, kind: 'pin', fix: AMBIENT, deviceId }),
      createRecord(db, { activityId: null, kind: 'pin', fix: INSTANT, deviceId }),
    ])

    expect([first.sequence, second.sequence].sort((a, b) => a - b)).toEqual([1, 2])
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
