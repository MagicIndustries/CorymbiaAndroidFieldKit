import { openTestDatabase } from '../../db/better-sqlite3'
import { migrate } from '../../db/migrate'
import type { Database } from '../../db/port'
import { DEFAULT_SETTINGS, readSettings, writeSetting } from '../settings'

describe('settings', () => {
  let db: Database
  beforeEach(async () => {
    db = await openTestDatabase()
    await migrate(db)
  })
  afterEach(async () => {
    await db.close()
  })

  it('returns the documented defaults on a fresh install', async () => {
    expect(await readSettings(db)).toEqual(DEFAULT_SETTINGS)
  })

  it('defaults to following the system theme, right-handed, SAVE NOW dominant, comfortable', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      theme: 'system',
      handedness: 'right',
      capturePrimary: 'saveNow',
      density: 'comfortable',
    })
  })

  it('persists a written value', async () => {
    await writeSetting(db, 'handedness', 'left')
    expect((await readSettings(db)).handedness).toBe('left')
  })

  it('overwrites rather than accumulating rows for the same key', async () => {
    await writeSetting(db, 'theme', 'dark')
    await writeSetting(db, 'theme', 'light')
    expect((await readSettings(db)).theme).toBe('light')
    const rows = await db.all('SELECT key FROM setting WHERE key = ?', ['theme'])
    expect(rows).toHaveLength(1)
  })

  it('leaves other settings untouched when one is written', async () => {
    await writeSetting(db, 'capturePrimary', 'sharpen')
    const settings = await readSettings(db)
    expect(settings.capturePrimary).toBe('sharpen')
    expect(settings.theme).toBe(DEFAULT_SETTINGS.theme)
    expect(settings.handedness).toBe(DEFAULT_SETTINGS.handedness)
  })

  it('swaps the capture controls independently of handedness', async () => {
    await writeSetting(db, 'capturePrimary', 'sharpen')
    const settings = await readSettings(db)
    expect(settings.capturePrimary).toBe('sharpen')
    expect(settings.handedness).toBe('right')
  })

  it('falls back to the default when a stored value is outside its vocabulary', async () => {
    await db.execute('INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)', [
      'handedness',
      'sideways',
      '2026-09-06T00:00:00+10:00',
    ])
    expect((await readSettings(db)).handedness).toBe('right')
  })

  it('ignores a key it does not recognise rather than failing to start', async () => {
    await db.execute('INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)', [
      'favouriteBird',
      'lyrebird',
      '2026-09-06T00:00:00+10:00',
    ])
    expect(await readSettings(db)).toEqual(DEFAULT_SETTINGS)
  })
})
