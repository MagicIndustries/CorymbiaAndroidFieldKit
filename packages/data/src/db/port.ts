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
  transaction<T>(fn: () => Promise<T>): Promise<T>
  close(): Promise<void>
}
