import { openTestDatabase } from '../better-sqlite3'
import { migrate, readAppliedMigrationIds } from '../migrate'
import { migrations } from '../../migrations'
import type { Database } from '../port'

async function tableNames(db: Database): Promise<string[]> {
  const rows = await db.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )
  return rows.map((r) => r.name)
}

describe('migrate', () => {
  let db: Database
  beforeEach(async () => {
    db = await openTestDatabase()
  })
  afterEach(async () => {
    await db.close()
  })

  it('creates the project and activity tables', async () => {
    await migrate(db)
    const names = await tableNames(db)
    expect(names).toEqual(
      expect.arrayContaining(['activity', 'client', 'location', 'project', 'project_location']),
    )
  })

  it('reports which migrations it applied', async () => {
    expect(await migrate(db)).toContain('001-projects')
  })

  it('names every migration so that sorting the ids reproduces the order they run in', async () => {
    // `readAppliedMigrationIds` orders by `applied_at, id`, and the id tiebreak
    // is what makes its promise ("in the order they were applied") true at all:
    // every migration in a fresh database commits inside the same millisecond,
    // so `applied_at` alone leaves them unordered. That works only while ids
    // carry a zero-padded ordinal prefix matching their position in this list.
    // Add `add-media` without one and the tiebreak silently stops meaning the
    // order it claims — which is what this assertion is here to prevent.
    const ids = migrations.map((migration) => migration.id)
    expect(ids).toEqual([...ids].sort())
    for (const id of ids) expect(id).toMatch(/^\d{3}-/)
  })

  it('is idempotent — running twice applies nothing the second time', async () => {
    await migrate(db)
    expect(await migrate(db)).toEqual([])
  })

  it('readAppliedMigrationIds reports everything that has committed, independent of migrate\'s own return value', async () => {
    const ran = await migrate(db)
    expect(await readAppliedMigrationIds(db)).toEqual(ran)
  })

  it('seeds the default client and location that §7.3 requires', async () => {
    await migrate(db)
    const client = await db.first<{ name: string }>('SELECT name FROM client WHERE id = ?', [
      'client-internal',
    ])
    const location = await db.first<{ name: string }>('SELECT name FROM location WHERE id = ?', [
      'location-office',
    ])
    expect(client?.name).toBe('Corymbia (internal)')
    expect(location?.name).toBe('Office / Lab')
  })

  it('refuses a project with no name', async () => {
    await migrate(db)
    await expect(
      db.execute(
        'INSERT INTO project (id, name, client_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ['p1', '', 'client-internal', '2026-09-06T00:00:00Z', '2026-09-06T00:00:00Z'],
      ),
    ).rejects.toThrow()
  })

  it('refuses an activity whose kind is not one of the five in the spec', async () => {
    await migrate(db)
    await db.execute(
      'INSERT INTO project (id, name, client_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['p1', 'Yarra Flats', 'client-internal', '2026-09-06T00:00:00Z', '2026-09-06T00:00:00Z'],
    )
    await expect(
      db.execute(
        'INSERT INTO activity (id, project_id, kind, name, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['a1', 'p1', 'picnic', 'Nope', '2026-09-06T00:00:00Z', '2026-09-06T00:00:00Z', '2026-09-06T00:00:00Z'],
      ),
    ).rejects.toThrow()
  })
})
