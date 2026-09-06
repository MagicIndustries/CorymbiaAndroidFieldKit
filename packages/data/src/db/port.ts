/** The only value types this application stores. Booleans are 0/1, dates are ISO-8601 text. */
export type SqlValue = string | number | null

/**
 * The narrow surface both SQLite adapters satisfy: `expo-sqlite` on device,
 * `better-sqlite3` in tests. Keeping it this small is what lets every
 * repository test run against real SQL rather than a mock — the schema,
 * its constraints and its indexes are then genuinely under test.
 */
export interface Database {
  execute(sql: string, params?: SqlValue[]): Promise<void>
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>
  first<T>(sql: string, params?: SqlValue[]): Promise<T | null>
  /**
   * Runs `fn` inside one transaction, committing when it resolves and rolling
   * back when it throws.
   *
   * Overlapping calls MUST be serialised by the adapter, not interleaved. Both
   * adapters hold a single connection to a database with no nested
   * transactions, so a second `BEGIN` arriving mid-transaction cannot mean
   * anything sensible — and read-then-write bodies such as `createRecord`'s
   * (read the next sequence number, then insert with it) are only atomic if the
   * next caller waits. Two rapid taps on the capture button are enough to
   * produce that overlap.
   *
   * `fn` must not call `transaction` again. There is nothing to nest into, and
   * a serialising adapter would otherwise turn the attempt into a deadlock: the
   * inner call waits for a queue that cannot advance until the outer body it is
   * running inside returns. Put every statement of a unit of work in one call.
   *
   * An adapter MUST detect that and reject the inner call with an error naming
   * the problem, rather than relying on nobody ever writing it. A hang has no
   * error, no stack and nothing in the log; on a field tablet it looks exactly
   * like a broken device, and the app stops mid-capture.
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>
  close(): Promise<void>
}
