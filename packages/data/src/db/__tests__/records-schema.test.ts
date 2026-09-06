import { openTestDatabase } from '../better-sqlite3'
import { migrate } from '../migrate'
import type { Database } from '../port'

const NOW = '2026-09-06T09:14:00+10:00'

async function seedDevice(db: Database): Promise<void> {
  await db.execute(
    `INSERT INTO device (id, install_id, label, device_type, is_physical, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
    ['dev-1', 'install-abc', 'field-s24', 'phone', NOW, NOW],
  )
}

async function seedActivity(db: Database): Promise<void> {
  await db.execute(
    'INSERT INTO project (id, name, client_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ['p1', 'Yarra Flats', 'client-internal', NOW, NOW],
  )
  await db.execute(
    'INSERT INTO activity (id, project_id, kind, name, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['a1', 'p1', 'survey', 'Survey 3', NOW, NOW, NOW],
  )
}

async function insertRecord(db: Database, over: Record<string, unknown> = {}): Promise<void> {
  const row = {
    id: 'r1',
    activity_id: 'a1',
    kind: 'pin',
    sequence: 1,
    title: null,
    short_label: null,
    description: null,
    latitude: -37.82141,
    longitude: 145.03318,
    accuracy_m: 4,
    altitude_m: 62,
    datum: 'WGS84',
    fix_quality: 'deliberate',
    fix_age_seconds: null,
    fix_sample_count: 7,
    fix_spread_m: 1.2,
    fix_hold_ms: 4200,
    captured_at: NOW,
    gps_time: NOW,
    device_id: 'dev-1',
    vertical_accuracy_m: 3,
    is_mocked: 0,
    location_provider: 'gps',
    accuracy_convention: 'radius68',
    altitude_reference: 'wgs84Ellipsoid',
    attributes: '{}',
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    ...over,
  }
  const columns = Object.keys(row)
  await db.execute(
    `INSERT INTO record (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    Object.values(row) as (string | number | null)[],
  )
}

describe('the record schema', () => {
  let db: Database
  beforeEach(async () => {
    db = await openTestDatabase()
    await migrate(db)
    await seedDevice(db)
    await seedActivity(db)
  })
  afterEach(async () => {
    await db.close()
  })

  it('accepts a well-formed deliberate fix', async () => {
    await insertRecord(db)
    expect(await db.all('SELECT id FROM record')).toHaveLength(1)
  })

  it('refuses a deliberate fix with no accuracy — the whole point of the class', async () => {
    await expect(insertRecord(db, { accuracy_m: null })).rejects.toThrow()
  })

  it('refuses a deliberate fix that claims an age; it was taken just now', async () => {
    await expect(insertRecord(db, { fix_age_seconds: 240 })).rejects.toThrow()
  })

  it('accepts an ambient fix carrying its age', async () => {
    await insertRecord(db, {
      id: 'r2',
      fix_quality: 'ambient',
      accuracy_m: 38,
      fix_age_seconds: 240,
      fix_sample_count: null,
      fix_spread_m: null,
      fix_hold_ms: null,
    })
    expect(await db.all('SELECT id FROM record')).toHaveLength(1)
  })

  it('refuses an ambient fix with no accuracy', async () => {
    await expect(
      insertRecord(db, { id: 'r3', fix_quality: 'ambient', accuracy_m: null, fix_age_seconds: 60 }),
    ).rejects.toThrow()
  })

  it('accepts a record with no position at all, recorded as absent', async () => {
    await insertRecord(db, {
      id: 'r4',
      fix_quality: 'none',
      latitude: null,
      longitude: null,
      accuracy_m: null,
      altitude_m: null,
      datum: null,
      fix_age_seconds: null,
      fix_sample_count: null,
      fix_spread_m: null,
      fix_hold_ms: null,
      vertical_accuracy_m: null,
      accuracy_convention: null,
      altitude_reference: null,
    })
    expect(await db.all('SELECT id FROM record')).toHaveLength(1)
  })

  it('refuses a positionless record that nonetheless carries coordinates', async () => {
    await expect(
      insertRecord(db, { id: 'r5', fix_quality: 'none', accuracy_m: null }),
    ).rejects.toThrow()
  })

  it('refuses a datum the destination does not accept', async () => {
    // The VBA takes exactly WGS84, GDA94 and AGD66. GDA2020 is not one of them,
    // and the app never produces it — Android returns WGS84 and nothing here
    // transforms it. See docs/research/2026-09-06-victorian-biodiversity-destinations.md §5.3.
    await expect(insertRecord(db, { id: 'r6', datum: 'GDA2020' })).rejects.toThrow()
  })

  it('keeps sequence numbers unique per activity, not per project', async () => {
    await insertRecord(db)
    await expect(insertRecord(db, { id: 'r7', sequence: 1 })).rejects.toThrow()

    await db.execute(
      'INSERT INTO activity (id, project_id, kind, name, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['a2', 'p1', 'survey', 'Survey 4', NOW, NOW, NOW],
    )
    await insertRecord(db, { id: 'r8', activity_id: 'a2', sequence: 1 })
    expect(await db.all('SELECT id FROM record')).toHaveLength(2)
  })

  it('refuses a record naming a device that was never registered', async () => {
    await expect(insertRecord(db, { id: 'r9', device_id: 'ghost' })).rejects.toThrow()
  })

  it('refuses an accuracy stored without the convention that gives it meaning', async () => {
    await expect(insertRecord(db, { id: 'r10', accuracy_convention: null })).rejects.toThrow()
  })

  it('records a mocked position as such, so a spoofed fix is identifiable', async () => {
    await insertRecord(db, { id: 'r11', is_mocked: 1 })
    const row = await db.first<{ is_mocked: number }>(
      'SELECT is_mocked FROM record WHERE id = ?',
      ['r11'],
    )
    expect(row?.is_mocked).toBe(1)
  })

  it('stores an event with its own context stamp', async () => {
    await insertRecord(db)
    await db.execute(
      `INSERT INTO event (id, record_id, action, device_id, occurred_at, latitude, longitude, accuracy_m, fix_quality, activity_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['e1', 'r1', 'created', 'dev-1', NOW, -37.82141, 145.03318, 4, 'deliberate', 'a1'],
    )
    const event = await db.first<{ action: string }>('SELECT action FROM event WHERE id = ?', ['e1'])
    expect(event?.action).toBe('created')
  })

  it('refuses an event action outside the known set', async () => {
    await insertRecord(db)
    await expect(
      db.execute(
        'INSERT INTO event (id, record_id, action, device_id, occurred_at) VALUES (?, ?, ?, ?, ?)',
        ['e2', 'r1', 'teleported', 'dev-1', NOW],
      ),
    ).rejects.toThrow()
  })
})
