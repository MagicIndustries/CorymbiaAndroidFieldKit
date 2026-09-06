export type { Database, SqlValue } from './db/port'
export { migrate } from './db/migrate'
export type { Migration } from './db/migrate'

// Note: openTestDatabase is not re-exported here. It remains available for tests
// that import directly from './db/better-sqlite3', but is kept out of the public
// barrel to prevent Metro from pulling the native 'better-sqlite3' module into
// the React Native bundle, which would fail the Android build.
