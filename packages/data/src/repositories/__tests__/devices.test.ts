import { openTestDatabase } from '../../db/better-sqlite3'
import { migrate } from '../../db/migrate'
import type { Database } from '../../db/port'
import { getDevice, listDevices, registerDevice, type DeviceFacts } from '../devices'

const FACTS: DeviceFacts = {
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
}

describe('the device registry', () => {
  let db: Database
  beforeEach(async () => {
    db = await openTestDatabase()
    await migrate(db)
  })
  afterEach(async () => {
    await db.close()
  })

  it('registers a device with its fixed characteristics', async () => {
    const device = await registerDevice(db, FACTS)
    expect(device.modelId).toBe('SM-S938B')
    expect(device.deviceType).toBe('phone')
    expect(device.isPhysical).toBe(true)
  })

  it('returns the same device on a second registration rather than duplicating it', async () => {
    const first = await registerDevice(db, FACTS)
    const second = await registerDevice(db, FACTS)
    expect(second.id).toBe(first.id)
    expect(await listDevices(db)).toHaveLength(1)
  })

  it('keeps the original first-seen date across re-registrations', async () => {
    // `nowIso()` truncates to whole seconds, so a re-registration milliseconds
    // later writes a byte-identical timestamp and this test could not fail:
    // adding `first_seen_at = excluded.first_seen_at` to registerDevice's
    // upsert left it green, and this is the ONLY test of that guard. Sleeping
    // 5 ms, as it used to, does not push the two apart — the truncation is in
    // the format, not the clock.
    //
    // So the stored date is pushed somewhere today's clock cannot reach. An
    // overwrite would replace it with a 2026 timestamp and is unmistakable.
    const ORIGINALLY_SEEN = '2020-03-01T06:15:00+11:00'
    const first = await registerDevice(db, FACTS)
    await db.execute('UPDATE device SET first_seen_at = ?, last_seen_at = ? WHERE id = ?', [
      ORIGINALLY_SEEN,
      ORIGINALLY_SEEN,
      first.id,
    ])

    const second = await registerDevice(db, FACTS)

    expect(second.id).toBe(first.id)
    expect(second.firstSeenAt).toBe(ORIGINALLY_SEEN)
    // And the upsert genuinely ran: without this, an `ON CONFLICT DO NOTHING`
    // would preserve first_seen_at trivially while refreshing nothing at all.
    // last_seen_at is the column that must move when first_seen_at does not.
    expect(second.lastSeenAt).not.toBe(ORIGINALLY_SEEN)
  })

  it('refreshes the OS and application version, which do change under one install', async () => {
    await registerDevice(db, FACTS)
    const updated = await registerDevice(db, { ...FACTS, osVersion: '17', appVersion: '1.1.0' })
    expect(updated.osVersion).toBe('17')
    expect(updated.appVersion).toBe('1.1.0')
  })

  it('treats a different install as a different device, so records stay attributable', async () => {
    await registerDevice(db, FACTS)
    await registerDevice(db, { ...FACTS, installId: 'install-xyz', label: 'tablet', deviceType: 'tablet' })
    expect(await listDevices(db)).toHaveLength(2)
  })

  it('distinguishes the tablet from the phone by type', async () => {
    const tablet = await registerDevice(db, {
      ...FACTS,
      installId: 'install-tab',
      label: 'tablet',
      deviceType: 'tablet',
      modelId: 'SM-X510',
    })
    expect(tablet.deviceType).toBe('tablet')
  })

  it('records an emulator as not physical, so test data is identifiable later', async () => {
    const device = await registerDevice(db, { ...FACTS, installId: 'i2', isPhysical: false })
    expect(device.isPhysical).toBe(false)
  })

  it('tolerates characteristics the platform declines to report', async () => {
    const device = await registerDevice(db, {
      ...FACTS,
      installId: 'i3',
      manufacturer: null,
      brand: null,
      modelName: null,
      modelId: null,
      osName: null,
      osVersion: null,
      appVersion: null,
      appBuild: null,
    })
    expect(device.manufacturer).toBeNull()
  })

  it('reads a device back by id and returns null for an unknown one', async () => {
    const device = await registerDevice(db, FACTS)
    expect((await getDevice(db, device.id))?.label).toBe('field-s24')
    expect(await getDevice(db, 'nope')).toBeNull()
  })

  it('resolves concurrent registrations of the same install to one row', async () => {
    const results = await Promise.all([
      registerDevice(db, FACTS),
      registerDevice(db, FACTS),
      registerDevice(db, FACTS),
      registerDevice(db, FACTS),
      registerDevice(db, FACTS),
    ])

    expect(await listDevices(db)).toHaveLength(1)
    const ids = new Set(results.map((device) => device.id))
    expect(ids.size).toBe(1)
  })

  it('relabels a device on re-registration, since a device can be renamed', async () => {
    const first = await registerDevice(db, FACTS)
    const renamed = await registerDevice(db, { ...FACTS, label: 'renamed-s24' })
    expect(renamed.id).toBe(first.id)
    expect(renamed.label).toBe('renamed-s24')
  })

  it('preserves hardware facts across re-registration, since they cannot change under one install', async () => {
    await registerDevice(db, FACTS)
    const reregistered = await registerDevice(db, {
      ...FACTS,
      manufacturer: 'google',
      modelId: 'DIFFERENT-MODEL',
      deviceType: 'tablet',
      isPhysical: false,
    })

    expect(reregistered.manufacturer).toBe(FACTS.manufacturer)
    expect(reregistered.modelId).toBe(FACTS.modelId)
    expect(reregistered.deviceType).toBe(FACTS.deviceType)
    expect(reregistered.isPhysical).toBe(FACTS.isPhysical)
  })
})
