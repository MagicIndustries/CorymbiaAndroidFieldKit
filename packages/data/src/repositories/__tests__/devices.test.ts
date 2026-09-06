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
    const first = await registerDevice(db, FACTS)
    await new Promise((r) => setTimeout(r, 5))
    const second = await registerDevice(db, FACTS)
    expect(second.firstSeenAt).toBe(first.firstSeenAt)
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
})
