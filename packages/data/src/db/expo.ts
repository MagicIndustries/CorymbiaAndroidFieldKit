import { openDatabaseAsync } from 'expo-sqlite'
import type { Database, SqlValue } from './port'
import { createTransactionRunner, type TransactionRunnerOptions } from './transactions'

/**
 * The on-device adapter. `expo-sqlite` does not run in Node, so this file is
 * verified two ways: the unit tests alongside it, which prove the translation
 * against a stubbed `expo-sqlite` module and nothing more, and the on-device
 * diagnostic screen (a later task), which is the only thing that proves this
 * genuinely works against real SQLite on a device.
 *
 * Deliberately thin otherwise: everything interesting lives in the
 * repositories, which are tested against real SQL through the better-sqlite3
 * adapter. What this file must get right is the translation and the two
 * pragmas. Transaction safety is no longer replicated here — it is imported
 * from `./transactions`, the single module the test adapter also uses, so the
 * two cannot drift. Nothing in this package may run on device with a different
 * transaction guard from the one the tests exercise.
 *
 * `PRAGMA foreign_keys = ON` — SQLite disables foreign keys by default, so
 * without it the schema's relationships are decorative and orphaned rows
 * insert happily.
 *
 * `PRAGMA recursive_triggers = ON` — without it, `INSERT OR REPLACE` deletes
 * a row WITHOUT firing the delete trigger, so the append-only event log can be
 * silently rewritten. SQLite defaults it off. Verified against the
 * better-sqlite3 adapter: with the pragma off the tamper succeeds and returns
 * success; with it on the trigger aborts and the original row survives. The
 * event log is what makes chain-of-custody real rather than aspirational, so
 * this is not optional.
 */
export interface OpenDatabaseOptions {
  /**
   * How long a queued transaction waits for its turn before it is reported as
   * a nested transaction. See `./transactions`.
   */
  readonly transactionStartTimeoutMs?: number
}

export async function openDatabase(
  name = 'fieldkit.db',
  options: OpenDatabaseOptions = {},
): Promise<Database> {
  const db = await openDatabaseAsync(name)
  await db.runAsync('PRAGMA foreign_keys = ON')
  await db.runAsync('PRAGMA recursive_triggers = ON')

  const runnerOptions: TransactionRunnerOptions = {
    startTimeoutMs: options.transactionStartTimeoutMs,
  }
  const transaction = createTransactionRunner(async (sql) => {
    await db.runAsync(sql)
  }, runnerOptions)

  return {
    async execute(sql, params = []) {
      await db.runAsync(sql, params as SqlValue[])
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      return (await db.getAllAsync(sql, params)) as T[]
    },
    async first<T>(sql: string, params: SqlValue[] = []) {
      return ((await db.getFirstAsync(sql, params)) as T | undefined | null) ?? null
    },
    transaction,
    async close() {
      await db.closeAsync()
    },
  }
}
