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

  it('returns events oldest first, so a history reads as a narrative', async () => {
    await appendEvent(db, { recordId: null, action: 'created', deviceId })
    await new Promise((r) => setTimeout(r, 5))
    await appendEvent(db, { recordId: null, action: 'edited', deviceId })
    expect((await listEvents(db, null)).map((e) => e.action)).toEqual(['created', 'edited'])
  })
})
