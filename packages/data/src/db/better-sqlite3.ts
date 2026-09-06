import BetterSqlite3 from 'better-sqlite3'
import type { Database, SqlValue } from './port'
import { createTransactionRunner, type TransactionRunnerOptions } from './transactions'

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
 *
 * Transaction serialisation and the nested-transaction guard are NOT
 * implemented here. They live in `./transactions`, which this adapter and the
 * on-device `expo` adapter share, so a fix to that machinery cannot land in the
 * adapter the tests exercise while missing the adapter that ships. Read that
 * file for the reasoning; it is not repeated here.
 */
export interface OpenTestDatabaseOptions {
  /**
   * How long a queued transaction waits for its turn before it is reported as
   * a nested transaction. See `./transactions`.
   */
  readonly transactionStartTimeoutMs?: number
}

export async function openTestDatabase(options: OpenTestDatabaseOptions = {}): Promise<Database> {
  const db = new BetterSqlite3(':memory:')
  db.pragma('foreign_keys = ON')
  db.pragma('recursive_triggers = ON')

  const runnerOptions: TransactionRunnerOptions = {
    startTimeoutMs: options.transactionStartTimeoutMs,
  }
  const transaction = createTransactionRunner(async (sql) => {
    db.prepare(sql).run()
  }, runnerOptions)

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
    transaction,
    async close() {
      db.close()
    },
  }
}
