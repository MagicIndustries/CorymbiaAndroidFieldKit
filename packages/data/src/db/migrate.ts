import type { Database } from './port'
import { migrations } from '../migrations'

export type Migration = {
  id: string
  /** Statements applied in order, inside one transaction. */
  up: string[]
}

/**
 * Applies any migration not yet recorded in `schema_migration`, each inside its
 * own transaction so a failure leaves the database on the last good version
 * rather than half-migrated.
 *
 * Returns the ids applied, so a caller can log what happened on a device where
 * nobody is watching a console.
 */
export async function migrate(db: Database): Promise<string[]> {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS schema_migration (
       id          TEXT PRIMARY KEY,
       applied_at  TEXT NOT NULL
     )`,
  )

  const applied = await db.all<{ id: string }>('SELECT id FROM schema_migration')
  const done = new Set(applied.map((row) => row.id))
  const ran: string[] = []

  for (const migration of migrations) {
    if (done.has(migration.id)) continue
    await db.transaction(async () => {
      for (const statement of migration.up) {
        await db.execute(statement)
      }
      await db.execute('INSERT INTO schema_migration (id, applied_at) VALUES (?, ?)', [
        migration.id,
        new Date().toISOString(),
      ])
    })
    ran.push(migration.id)
  }

  return ran
}

/**
 * Reads the ids of migrations already recorded as committed in
 * `schema_migration`, in the order they were applied.
 *
 * "In the order they were applied" needs the id tiebreak below to be true at
 * all. `applied_at` is millisecond-resolution and every migration in a fresh
 * database commits inside the same millisecond, so ordering by it alone leaves
 * the result unordered among ties — SQLite is free to return them in any order
 * for equal keys, and a promise kept only by the accident of insertion order is
 * not a promise. Migration ids carry a zero-padded ordinal prefix
 * (`001-projects`, `002-devices`, …) and `migrations` in ../migrations/index.ts
 * is that same sequence, so sorting the tie by id reproduces the order they
 * were applied in. That convention is asserted by test — if a future migration
 * is named without an ordinal, the tiebreak stops meaning this and the test
 * says so.
 *
 * `migrate` only returns the ids it itself ran to completion in this call: if
 * it throws partway through, that return value is lost with the throw, even
 * though every earlier migration committed in its own transaction and is
 * durable on disk. This is how a caller recovers that truth afterwards —
 * most importantly from a `catch` block, where `migrate`'s own return value
 * is unavailable but the database handle is still open.
 *
 * Returns an empty list, rather than throwing, when `schema_migration` does
 * not exist yet — i.e. nothing has ever been applied, including the case
 * where the very first migration failed before `migrate`'s own
 * `CREATE TABLE IF NOT EXISTS` had a chance to run against a corrupt
 * connection. Any other read failure (for example a connection left
 * unusable by whatever caused the caller's failure) still propagates: it is
 * the caller's job to decide what an unreadable table means for it.
 */
export async function readAppliedMigrationIds(db: Database): Promise<string[]> {
  const table = await db.first<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migration'",
  )
  if (!table) return []

  const rows = await db.all<{ id: string }>(
    'SELECT id FROM schema_migration ORDER BY applied_at, id',
  )
  return rows.map((row) => row.id)
}
