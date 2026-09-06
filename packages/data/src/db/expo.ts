import { AsyncLocalStorage } from 'node:async_hooks'
import { openDatabaseAsync } from 'expo-sqlite'
import type { Database, SqlValue } from './port'

/**
 * The on-device adapter. `expo-sqlite` does not run in Node, so this file is
 * verified two ways: the unit tests alongside it, which prove the translation
 * against a stubbed `expo-sqlite` module and nothing more, and the on-device
 * diagnostic screen (a later task), which is the only thing that proves this
 * genuinely works against real SQLite on a device.
 *
 * Deliberately thin otherwise: everything interesting lives in the
 * repositories, which are tested against real SQL through the better-sqlite3
 * adapter. What this file must get right is the translation, the two pragmas,
 * and — because on device this is the only `Database` implementation that
 * ever runs — the same transaction-safety behaviour the test adapter has.
 * See `better-sqlite3.ts` for the long-form reasoning; it is not repeated
 * here, only replicated.
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
export async function openDatabase(name = 'fieldkit.db'): Promise<Database> {
  const db = await openDatabaseAsync(name)
  await db.runAsync('PRAGMA foreign_keys = ON')
  await db.runAsync('PRAGMA recursive_triggers = ON')

  // The tail of the transaction queue. See better-sqlite3.ts for why
  // overlapping `transaction()` calls must be serialised rather than
  // interleaved: this one connection has no nested transactions, and two
  // rapid taps on the capture button are enough to produce the overlap.
  let queue: Promise<void> = Promise.resolve()

  // Whether the caller is executing inside this database's transaction body,
  // tracked with an async context so a transaction body that calls
  // `transaction()` again is rejected immediately rather than deadlocking the
  // queue — a hang here has no error, no stack, and nothing in the log, which
  // on a field tablet is indistinguishable from a dead device.
  const insideTransaction = new AsyncLocalStorage<true>()

  async function runTransaction<T>(fn: () => Promise<T>): Promise<T> {
    await db.runAsync('BEGIN')
    try {
      const result = await insideTransaction.run(true, fn)
      await db.runAsync('COMMIT')
      return result
    } catch (error) {
      await db.runAsync('ROLLBACK')
      throw error
    }
  }

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
    async transaction<T>(fn: () => Promise<T>) {
      if (insideTransaction.getStore()) {
        // Thrown before the queue is touched, so the guard costs the queue
        // nothing: the transaction already in flight finishes normally (this
        // rejection propagates out of its body, so it rolls back like any
        // other failure), and the next caller runs exactly as it would have.
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
      await db.closeAsync()
    },
  }
}
