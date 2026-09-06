import { openTestDatabase } from '../../db/better-sqlite3'
import { migrate } from '../../db/migrate'
import type { Database } from '../../db/port'
import { registerDevice } from '../devices'
import { appendEvent, listEvents } from '../events'

describe('the event log', () => {
  let db: Database
  let deviceId: string
  beforeEach(async () => {
    db = await openTestDatabase()
    await migrate(db)
    deviceId = (
      await registerDevice(db, {
        installId: 'install-abc',
        label: 'field-s24',
        manufacturer: null,
        brand: null,
        modelName: null,
        modelId: null,
        deviceType: 'phone',
        osName: null,
        osVersion: null,
        isPhysical: true,
        appVersion: null,
        appBuild: null,
      })
    ).id
  })
  afterEach(async () => {
    await db.close()
  })

  it('records an action with the device it happened on', async () => {
    await appendEvent(db, { recordId: null, action: 'created', deviceId })
    const events = await listEvents(db, null)
    expect(events[0]?.deviceId).toBe(deviceId)
  })

  it('stamps an ambient position onto the event, not just the record', async () => {
    await appendEvent(db, {
      recordId: null,
      action: 'played',
      deviceId,
      fix: {
        quality: 'ambient',
        latitude: -37.8,
        longitude: 145.0,
        accuracyM: 38,
        altitudeM: null,
        altitudeReference: null,
        datum: 'WGS84',
        ageSeconds: 240,
        verticalAccuracyM: 3,
        accuracyConvention: 'radius68',
        isMocked: false,
        provider: 'gps',
        gpsTime: null,
      },
    })
    const [event] = await listEvents(db, null)
    expect(event?.fixQuality).toBe('ambient')
    expect(event?.accuracyM).toBe(38)
  })

  it('stamps the accuracy convention and the "not spoofed" claim, not only the number', async () => {
    // The event table has no altitude, vertical accuracy or provider columns —
    // only what migration 003 actually stores — but a stored accuracy without
    // its convention would be exactly the meaningless-number bug this schema
    // was hardened against.
    await appendEvent(db, {
      recordId: null,
      action: 'filed',
      deviceId,
      fix: {
        quality: 'deliberate',
        latitude: -37.82141,
        longitude: 145.03318,
        accuracyM: 4,
        altitudeM: 62,
        altitudeReference: 'wgs84Ellipsoid',
        datum: 'WGS84',
        sampleCount: 7,
        spreadM: 1.2,
        holdMs: 4200,
        verticalAccuracyM: 3,
        accuracyConvention: 'radius68',
        isMocked: false,
        provider: 'gps',
        gpsTime: '2026-02-11T09:14:03+11:00',
      },
    })
    const [event] = await listEvents(db, null)
    expect(event?.accuracyConvention).toBe('radius68')
    expect(event?.datum).toBe('WGS84')
    expect(event?.isMocked).toBe(false)
  })

  it('accepts an event with no position', async () => {
    await appendEvent(db, { recordId: null, action: 'edited', deviceId })
    const event = (await listEvents(db, null))[0]
    expect(event?.fixQuality).toBeNull()
    expect(event?.isMocked).toBeNull()
  })

  it('returns events oldest first, by occurrence rather than by insertion order', async () => {
    // `nowIso()` truncates to whole seconds, so two `appendEvent` calls
    // milliseconds apart share an `occurred_at` however long the test sleeps
    // between them, and `listEvents`' `id ASC` tiebreak alone decided this
    // test — leaving the `occurred_at ASC` term it is named for untested.
    //
    // The timestamps have to be written at insert time rather than corrected
    // afterwards: the event log is append-only, in the schema and not only in
    // prose, so the `UPDATE` that records.test.ts uses for this is refused by
    // a trigger. Written directly, with the times in the OPPOSITE order to the
    // ids, so dropping either ordering term changes the answer.
    const insert = async (id: string, action: string, occurredAt: string): Promise<void> => {
      await db.execute(
        'INSERT INTO event (id, record_id, action, device_id, occurred_at) VALUES (?, NULL, ?, ?, ?)',
        [id, action, deviceId, occurredAt],
      )
    }
    await insert('evt-aaa', 'edited', '2026-02-11T09:00:00+11:00')
    await insert('evt-bbb', 'created', '2026-02-11T08:00:00+11:00')

    // By id it would read edited-then-created, which is not a narrative.
    expect((await listEvents(db, null)).map((e) => e.action)).toEqual(['created', 'edited'])
  })

  it('breaks a same-second tie by id, so a burst of events keeps a stable order', async () => {
    // The companion to the test above, which covers `occurred_at ASC` only.
    // Two events genuinely written in the same second — the normal case — have
    // nothing but `id ASC` to order them, and ids are time-ordered, so the
    // first appended still reads first.
    await appendEvent(db, { recordId: null, action: 'created', deviceId })
    await appendEvent(db, { recordId: null, action: 'edited', deviceId })
    const events = await listEvents(db, null)
    expect(events.map((e) => e.action)).toEqual(['created', 'edited'])
    expect(events[0]!.occurredAt).toBe(events[1]!.occurredAt)
  })
})
