import { openTestDatabase } from '../better-sqlite3'
import type { Database } from '../port'

/**
 * This is a canary for a test-harness failure mode, not a schema test.
 *
 * `better-sqlite3` is a native addon. Jest's scheduler runs multiple fast test
 * files in a single OS process to save worker-spawn overhead (`shouldRunInBand`
 * in `@jest/core/build/testSchedulerHelper.js`). When two files in this package
 * each `require('better-sqlite3')` into a fresh module registry inside that one
 * shared process, the SECOND file's connections silently stop enforcing
 * CHECK / UNIQUE / FOREIGN KEY constraints — no crash, no warning, just
 * permissive SQL that looks like a passing test. `packages/data/jest.config.js`
 * sets `workerIdleMemoryLimit` specifically to defeat that heuristic
 * (`!workerIdleMemoryLimit && (...)` in the same source file), forcing every
 * test file into its own process.
 *
 * If THIS test goes red, the almost-certain cause is that the
 * `workerIdleMemoryLimit` defence in jest.config.js has stopped working — a
 * Jest upgrade reworded the in-band condition, the setting was removed, etc.
 * — and constraints are silently unenforced across the whole suite. The fix
 * is to restore/repair that Jest setting, not to touch the schema.
 *
 * This only reproduces with more than one test file in the suite, so it must
 * stay in its own file alongside the others rather than being folded into one
 * of them.
 */
describe('constraint-enforcement canary (test-harness guard, not a schema test)', () => {
  let db: Database

  beforeEach(async () => {
    db = await openTestDatabase()
    await db.execute(
      'CREATE TABLE canary (id TEXT PRIMARY KEY, n INTEGER NOT NULL UNIQUE CHECK (n > 0))',
    )
    await db.execute(
      'CREATE TABLE canary_child (id TEXT PRIMARY KEY, canary_id TEXT NOT NULL REFERENCES canary(id))',
    )
  })

  afterEach(async () => {
    await db.close()
  })

  it(
    'enforces CHECK, UNIQUE and FOREIGN KEY constraints — a failure here means Jest is running ' +
      'test files in-band and workerIdleMemoryLimit in jest.config.js has stopped defeating that, ' +
      'NOT that the schema under test elsewhere in this package is wrong',
    async () => {
      await expect(db.execute('INSERT INTO canary (id, n) VALUES (?, ?)', ['a', 0])).rejects.toThrow(
        /CHECK constraint failed/,
      )

      await db.execute('INSERT INTO canary (id, n) VALUES (?, ?)', ['a', 1])
      await expect(db.execute('INSERT INTO canary (id, n) VALUES (?, ?)', ['b', 1])).rejects.toThrow(
        /UNIQUE constraint failed/,
      )

      await expect(
        db.execute('INSERT INTO canary_child (id, canary_id) VALUES (?, ?)', ['c1', 'missing']),
      ).rejects.toThrow(/FOREIGN KEY constraint failed/)
    },
  )
})
