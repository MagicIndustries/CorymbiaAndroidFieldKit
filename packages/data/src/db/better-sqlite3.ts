import BetterSqlite3 from 'better-sqlite3'
import type { Database, SqlValue } from './port'

/**
 * An in-memory database for tests. `better-sqlite3` is synchronous; the async
 * signatures exist so the same repository code runs unchanged against
 * `expo-sqlite` on device.
 *
 * Foreign keys are enabled explicitly because SQLite disables them by default —
 * without this, a test would happily insert an orphaned row and the schema's
 * relationships would be decorative.
 *
 * `recursive_triggers` is enabled for the same reason, and it is not optional.
 * The event log's append-only guarantee is two BEFORE triggers (migration 003).
 * `INSERT OR REPLACE` deletes the conflicting row before inserting, and with
 * this pragma OFF — SQLite's default — that deletion does not fire the BEFORE
 * DELETE trigger. `INSERT OR REPLACE INTO event` then rewrites an existing
 * event's content and returns success, which defeats the one table whose entire
 * purpose is being tamper-evident. Any adapter that opens this database must
 * set it; see records-schema.test.ts, "refuses an INSERT OR REPLACE".
 */
export async function openTestDatabase(): Promise<Database> {
  const db = new BetterSqlite3(':memory:')
  db.pragma('foreign_keys = ON')
  db.pragma('recursive_triggers = ON')

  return {
    async execute(sql, params = []) {
      db.prepare(sql).run(...(params as SqlValue[]))
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      return db.prepare(sql).all(...params) as T[]
    },
    async first<T>(sql: string, params: SqlValue[] = []) {
      return (db.prepare(sql).get(...params) as T | undefined) ?? null
    },
    async transaction<T>(fn: () => Promise<T>) {
      db.prepare('BEGIN').run()
      try {
        const result = await fn()
        db.prepare('COMMIT').run()
        return result
      } catch (error) {
        db.prepare('ROLLBACK').run()
        throw error
      }
    },
    async close() {
      db.close()
    },
  }
}
