import type { Database } from '../db/port'
import { nowIso } from '../time'

export type Handedness = 'left' | 'right'
export type CapturePrimary = 'saveNow' | 'sharpen'
export type ThemePreference = 'system' | 'dark' | 'light'
export type Density = 'comfortable' | 'compact'

export type Settings = {
  theme: ThemePreference
  handedness: Handedness
  /** Which capture control takes the dominant side (spec §5.4, §9.1). */
  capturePrimary: CapturePrimary
  density: Density
}

/**
 * `capturePrimary` defaults to `saveNow` because it is the more frequent action.
 * But `sharpen` demands a sustained press and may deserve the stronger thumb —
 * which is hers to decide after a day in the field, and is why this is a setting
 * rather than a layout decision. It is independent of handedness: swapping the
 * controls does not mean she has changed hands.
 */
export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  handedness: 'right',
  capturePrimary: 'saveNow',
  density: 'comfortable',
}

const VOCABULARIES: { [K in keyof Settings]: readonly Settings[K][] } = {
  theme: ['system', 'dark', 'light'],
  handedness: ['left', 'right'],
  capturePrimary: ['saveNow', 'sharpen'],
  density: ['comfortable', 'compact'],
}

function isSettingKey(key: string): key is keyof Settings {
  return Object.prototype.hasOwnProperty.call(VOCABULARIES, key)
}

/**
 * Stored values are merged over the defaults. Anything missing, unrecognised, or
 * outside its vocabulary falls back — a preference is never worth failing a
 * startup over.
 */
export async function readSettings(db: Database): Promise<Settings> {
  const rows = await db.all<{ key: string; value: string }>('SELECT key, value FROM setting')
  const settings: Settings = { ...DEFAULT_SETTINGS }

  for (const row of rows) {
    if (!isSettingKey(row.key)) continue
    const allowed = VOCABULARIES[row.key] as readonly string[]
    if (!allowed.includes(row.value)) continue
    // Safe: the value was just checked against this key's own vocabulary.
    const key = row.key as keyof Settings
    ;(settings as Record<keyof Settings, unknown>)[key] = row.value
  }

  return settings
}

export async function writeSetting<K extends keyof Settings>(
  db: Database,
  key: K,
  value: Settings[K],
): Promise<void> {
  await db.execute(
    `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, nowIso()],
  )
}
