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
 * Hardware characteristics do not change under one installation — they
 * genuinely cannot, so a second registration's values for `manufacturer`,
 * `brand`, `modelName`, `modelId`, `deviceType` and `isPhysical` are ignored
 * rather than trusted, and the row keeps whatever it was first created with.
 * The OS and the application version do change under one installation, so
 * those are refreshed, along with `label` — a device can legitimately be
 * renamed. `firstSeenAt` is preserved. A reinstall produces a new install id
 * and therefore a new device row, which is correct: it is exactly the moment
 * the data-collection setup could have changed underneath the records.
 *
 * This is a single `INSERT … ON CONFLICT(install_id) DO UPDATE` rather than a
 * SELECT-then-branch: two concurrent registrations for the same, not-yet-seen
 * install (two app-lifecycle hooks firing at cold start, say) must not race
 * to INSERT and have the loser blow up on the UNIQUE constraint. `install_id`
 * is already UNIQUE (see migration 002), so no schema change is needed for
 * SQLite to resolve the conflict atomically and hand back the single
 * surviving row via `RETURNING`.
 */
export async function registerDevice(db: Database, facts: DeviceFacts): Promise<Device> {
  const at = nowIso()
  const id = newId('dev')

  const row = await db.first<DeviceRow>(
    `INSERT INTO device (id, install_id, label, manufacturer, brand, model_name, model_id,
                         device_type, os_name, os_version, is_physical, app_version, app_build,
                         first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(install_id) DO UPDATE SET
       label = excluded.label,
       os_name = excluded.os_name,
       os_version = excluded.os_version,
       app_version = excluded.app_version,
       app_build = excluded.app_build,
       last_seen_at = excluded.last_seen_at
     RETURNING id, install_id, label, manufacturer, brand, model_name, model_id,
               device_type, os_name, os_version, is_physical, app_version, app_build,
               first_seen_at, last_seen_at`,
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

  if (!row) throw new Error(`Device upsert for install ${facts.installId} returned no row.`)
  return toDevice(row)
}

export async function getDevice(db: Database, id: string): Promise<Device | null> {
  const row = await db.first<DeviceRow>(`${SELECT} WHERE id = ?`, [id])
  return row ? toDevice(row) : null
}

export async function listDevices(db: Database): Promise<Device[]> {
  const rows = await db.all<DeviceRow>(`${SELECT} ORDER BY last_seen_at DESC`)
  return rows.map(toDevice)
}
