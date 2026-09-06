import { openTestDatabase } from '../better-sqlite3'
import type { Database } from '../port'
import type { Migration } from '../migrate'

// `readAppliedMigrationIds` must reflect exactly what committed, including the
// case that matters most: partway through a `migrate` call that threw. That
// requires a migration that genuinely fails mid-run, which the shipped list in
// `../../migrations` never does by design — so this file supplies its own via
// `jest.mock`, following the hoisting rules documented in `expo.test.ts`
// (mock factories may only reference other module-scope `mock`-prefixed
// bindings).
const mockMigrations: Migration[] = [
  { id: 'm1', up: ['CREATE TABLE t1 (id TEXT PRIMARY KEY)'] },
  { id: 'm2', up: ['CREATE TABLE t2 (id TEXT PRIMARY KEY)'] },
  { id: 'm3', up: ['THIS IS NOT VALID SQL'] },
]

jest.mock('../../migrations', () => ({ migrations: mockMigrations }))

// Required after the mock, per the same hoisting rules as expo.test.ts: a
// static `import { migrate } from '../migrate'` at the top of the file would
// be hoisted above `jest.mock`, resolving `../../migrations` against the
// real module before the mock is registered.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { migrate, readAppliedMigrationIds } = require('../migrate') as typeof import('../migrate')

describe('readAppliedMigrationIds', () => {
  let db: Database
  beforeEach(async () => {
    db = await openTestDatabase()
  })
  afterEach(async () => {
    await db.close()
  })

  it('returns an empty list for a database schema_migration has never been created on', async () => {
    expect(await readAppliedMigrationIds(db)).toEqual([])
  })

  it('orders same-millisecond migrations by id, not by whatever order the rows come back in', async () => {
    // Every migration in a fresh database commits inside the same millisecond,
    // so `applied_at` alone leaves the result unordered among ties and the
    // function's promise — "in the order they were applied" — was kept only by
    // the accident of insertion order. Inserted deliberately backwards here,
    // with one identical `applied_at`, so ordering by that column alone would
    // return them backwards too.
    const AT = '2026-02-11T09:14:03.412Z'
    await db.execute(
      `CREATE TABLE IF NOT EXISTS schema_migration (
         id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`,
    )
    for (const id of ['003-records', '001-projects', '004-settings', '002-devices']) {
      await db.execute('INSERT INTO schema_migration (id, applied_at) VALUES (?, ?)', [id, AT])
    }

    expect(await readAppliedMigrationIds(db)).toEqual([
      '001-projects',
      '002-devices',
      '003-records',
      '004-settings',
    ])
  })

  it('reports only the migrations that committed when a later one fails partway through', async () => {
    await expect(migrate(db)).rejects.toThrow()
    const ids = await readAppliedMigrationIds(db)
    expect(ids).toContain('m1')
    expect(ids).toContain('m2')
    expect(ids).not.toContain('m3')
  })
})
