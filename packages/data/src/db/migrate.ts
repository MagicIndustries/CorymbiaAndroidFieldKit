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
