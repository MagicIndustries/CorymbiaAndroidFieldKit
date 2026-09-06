import type { Database } from '../db/port'
import { newId } from '../ids'
import { nowIso } from '../time'

export type DeviceType = 'phone' | 'tablet' | 'desktop' | 'tv' | 'unknown'

export type DeviceFacts = {
  /** Stable for the life of an installation. See the note on identifiers below. */
  installId: string
  /** What the interface shows: "field-s24", "tablet". */
  label: string
  manufacturer: string | null
  brand: string | null
  modelName: string | null
  modelId: string | null
  deviceType: DeviceType
  osName: string | null
  osVersion: string | null
  isPhysical: boolean
  appVersion: string | null
  appBuild: string | null
}

export type Device = DeviceFacts & {
  id: string
  firstSeenAt: string
  lastSeenAt: string
}

type DeviceRow = {
  id: string
  install_id: string
  label: string
  manufacturer: string | null
  brand: string | null
  model_name: string | null
  model_id: string | null
  device_type: DeviceType
  os_name: string | null
  os_version: string | null
  is_physical: number
  app_version: string | null
  app_build: string | null
  first_seen_at: string
  last_seen_at: string
}

function toDevice(row: DeviceRow): Device {
  return {
    id: row.id,
    installId: row.install_id,
    label: row.label,
    manufacturer: row.manufacturer,
    brand: row.brand,
    modelName: row.model_name,
    modelId: row.model_id,
    deviceType: row.device_type,
    osName: row.os_name,
    osVersion: row.os_version,
    isPhysical: row.is_physical === 1,
    appVersion: row.app_version,
    appBuild: row.app_build,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  }
}

const SELECT = `SELECT id, install_id, label, manufacturer, brand, model_name, model_id,
                       device_type, os_name, os_version, is_physical, app_version, app_build,
                       first_seen_at, last_seen_at
                FROM device`

/**
 * Upserts on `installId`.
 *
 * Hardware characteristics do not change under one installation, but the OS and
 * the application version do — so those are refreshed, and `firstSeenAt` is
 * preserved. A reinstall produces a new install id and therefore a new device
 * row, which is correct: it is exactly the moment the data-collection setup
 * could have changed underneath the records.
 */
export async function registerDevice(db: Database, facts: DeviceFacts): Promise<Device> {
  const at = nowIso()
  const existing = await db.first<DeviceRow>(`${SELECT} WHERE install_id = ?`, [facts.installId])

  if (existing) {
    await db.execute(
      `UPDATE device
         SET label = ?, os_name = ?, os_version = ?, app_version = ?, app_build = ?, last_seen_at = ?
       WHERE id = ?`,
      [
        facts.label,
        facts.osName,
        facts.osVersion,
        facts.appVersion,
        facts.appBuild,
        at,
        existing.id,
      ],
    )
    const refreshed = await db.first<DeviceRow>(`${SELECT} WHERE id = ?`, [existing.id])
    if (!refreshed) throw new Error(`Device ${existing.id} vanished during re-registration.`)
    return toDevice(refreshed)
  }

  const id = newId('dev')
  await db.execute(
    `INSERT INTO device (id, install_id, label, manufacturer, brand, model_name, model_id,
                         device_type, os_name, os_version, is_physical, app_version, app_build,
                         first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      facts.installId,
      facts.label,
      facts.manufacturer,
      facts.brand,
      facts.modelName,
      facts.modelId,
      facts.deviceType,
      facts.osName,
      facts.osVersion,
      facts.isPhysical ? 1 : 0,
      facts.appVersion,
      facts.appBuild,
      at,
      at,
    ],
  )

  const created = await db.first<DeviceRow>(`${SELECT} WHERE id = ?`, [id])
  if (!created) throw new Error(`Device ${id} vanished immediately after registration.`)
  return toDevice(created)
}

export async function getDevice(db: Database, id: string): Promise<Device | null> {
  const row = await db.first<DeviceRow>(`${SELECT} WHERE id = ?`, [id])
  return row ? toDevice(row) : null
}

export async function listDevices(db: Database): Promise<Device[]> {
  const rows = await db.all<DeviceRow>(`${SELECT} ORDER BY last_seen_at DESC`)
  return rows.map(toDevice)
}
