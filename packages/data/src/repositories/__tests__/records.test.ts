import { openTestDatabase } from '../../db/better-sqlite3'
import { migrate } from '../../db/migrate'
import type { Database } from '../../db/port'
import { createActivity } from '../activities'
import { createProject } from '../projects'
import { registerDevice } from '../devices'
import { listEvents } from '../events'
import { createRecord, listRecords, listUnfiledRecords, softDeleteRecord } from '../records'
import type { Fix } from '../records'

// Every position carries the full set of per-fix conditions (spec §7.5):
// migration 003 hardened the schema after the original plan was written, so a
// deliberate or ambient fix that omits any of these is not constructible.
const CONDITIONS = {
  verticalAccuracyM: 3,
  accuracyConvention: 'radius68',
  altitudeReference: 'wgs84Ellipsoid',
  isMocked: false,
  provider: 'gps',
} as const

const DELIBERATE: Fix = {
  quality: 'deliberate',
  latitude: -37.82141,
  longitude: 145.03318,
  accuracyM: 4,
  altitudeM: 62,
  datum: 'WGS84',
  sampleCount: 7,
  spreadM: 1.2,
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
  datum: 'WGS84',
  sampleCount: 1,
  spreadM: null,
  holdMs: 0,
  ...CONDITIONS,
}

const AMBIENT: Fix = {
  quality: 'ambient',
  latitude: -37.82088,
  longitude: 145.03402,
  accuracyM: 38,
  altitudeM: null,
  datum: 'WGS84',
  ageSeconds: 240,
  ...CONDITIONS,
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
