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

  /**
   * The tail of the transaction queue.
   *
   * SQLite has one connection here and no nested transactions, so two
   * `transaction()` calls in flight at once used to interleave: the second
   * `BEGIN` threw "cannot start a transaction within a transaction", its
   * `catch` issued a `ROLLBACK` that discarded the FIRST call's work, and the
   * first call then committed whatever the second had managed to write. Two
   * rapid taps on the capture button — each firing an un-awaited promise — is
   * all it takes.
   *
   * For a filed record the UNIQUE index on (activity_id, sequence) turns that
   * race into a hard error: a lost capture wearing a raw SQLite message. For
   * the Inbox it does not, because SQLite treats NULLs as distinct in a unique
   * index — so two unfiled records could quietly take the same sequence number,
   * on precisely the path that has no activity to serialise on.
   *
   * Serialising here means overlapping callers queue instead. The chain holds a
   * promise that never rejects (failures are swallowed into it, and rethrown
   * only to the caller that owns them), so a transaction body that throws
   * cannot wedge every later transaction behind a rejected link.
   *
   * A transaction body must not itself call `transaction()`. That would wait on
   * a link that cannot settle until the body returns, which is a deadlock —
   * a worse failure than the "transaction within a transaction" error it
   * replaces. No repository does this: the bodies call `execute`/`first`
   * directly, and a batch that needs several statements passes them all to one
   * `transaction()` call.
   */
  let queue: Promise<void> = Promise.resolve()

  async function runTransaction<T>(fn: () => Promise<T>): Promise<T> {
    db.prepare('BEGIN').run()
    try {
      const result = await fn()
      db.prepare('COMMIT').run()
      return result
    } catch (error) {
      db.prepare('ROLLBACK').run()
      throw error
    }
  }

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
      const result = queue.then(() => runTransaction(fn))
      queue = result.then(
        () => undefined,
        () => undefined,
      )
      return result
    },
    async close() {
      db.close()
    },
  }
}
