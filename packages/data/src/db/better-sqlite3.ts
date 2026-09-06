import { AsyncLocalStorage } from 'node:async_hooks'
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
   * a link that cannot settle until the body returns, which is a deadlock — a
   * worse failure than the "transaction within a transaction" error it
   * replaces, because the app simply stops: no error, no stack, nothing in the
   * log. On a field tablet mid-capture that is indistinguishable from a dead
   * device. `insideTransaction` below makes it an immediate, named error.
   *
   * No repository nests today, but "no caller does this" is a survey, and plans
   * 3 through 7 add media, batches, export and a capture screen all writing
   * through this port. A guard outlives a survey.
   */
  let queue: Promise<void> = Promise.resolve()

  /**
   * Whether the caller is executing inside this database's transaction body.
   *
   * An in-flight boolean cannot answer that. A transaction is also open while a
   * legitimately CONCURRENT caller waits its turn, and rejecting those would
   * undo the serialisation this queue exists to provide. The question is not "is
   * a transaction open" but "did this call originate inside one", and an async
   * context is what tells them apart — it follows the body through every `await`
   * the body makes, and does not leak to callers that merely overlap it.
   *
   * Created per database, so a transaction on one connection never reports the
   * caller as being inside a different connection's transaction.
   */
  const insideTransaction = new AsyncLocalStorage<true>()

  async function runTransaction<T>(fn: () => Promise<T>): Promise<T> {
    db.prepare('BEGIN').run()
    try {
      const result = await insideTransaction.run(true, fn)
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
      if (insideTransaction.getStore()) {
        // Thrown before the queue is touched, so the guard costs the queue
        // nothing: the transaction already in flight finishes normally (this
        // rejection propagates out of its body, so it rolls back like any other
        // failure), and the next caller runs exactly as it would have.
        throw new Error(
          'Nested transaction: this code is already running inside a transaction on this ' +
            'database, and transactions here are serialised, so waiting for another one would ' +
            'deadlock. Pass every statement of the unit of work to a single transaction() call ' +
            'instead of opening a second one.',
        )
      }
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
