/**
 * Proves, before EVERY test file's tests run, that this file's SQLite
 * connections actually enforce constraints.
 *
 * `better-sqlite3` is a native addon. Jest's scheduler likes to run several
 * fast test files in one OS process — either by skipping the worker pool
 * outright (`shouldRunInBand` in `@jest/core/build/testSchedulerHelper.js`) or
 * by handing a second test file to a worker that already ran a first one, once
 * there are more test files than `maxWorkers`. Each file requires the addon
 * into a fresh JS module registry, but the underlying native library loads only
 * once per process, and the SECOND file's connections silently stop enforcing
 * CHECK / UNIQUE / FOREIGN KEY constraints. No crash, no warning: just
 * permissive SQL that looks exactly like a passing test suite.
 *
 * `workerIdleMemoryLimit` in jest.config.js is the defence, and this is the
 * check that keeps it honest. It used to live in a test file of its own, which
 * meant it only noticed the failure when the scheduler happened to place THAT
 * file second on a worker — the same lottery that produced the original
 * intermittent flake, now deciding whether the flake gets reported. As a
 * `setupFilesAfterEnv` hook it runs once per test file, so any file that has
 * lost enforcement fails loudly and by name, and the config value is
 * self-checking rather than checked by one file's luck.
 *
 * If this goes red, the near-certain cause is that the `workerIdleMemoryLimit`
 * defence has stopped working — a Jest upgrade reworded the in-band condition,
 * the setting was dropped, the value was raised to something
 * "reasonable-sounding". The fix is to restore that Jest setting, NOT to touch
 * the schema or the test that reported it.
 *
 * Plain JS and `require`, because a setup file runs before the module graph the
 * package's own tsconfig covers; the adapter it pulls in is transformed by the
 * same babel pipeline as the tests.
 */
const { openTestDatabase } = require('./src/db/better-sqlite3')

const WHERE_TO_LOOK =
  'Constraints are NOT being enforced in this test file, so every schema ' +
  'assertion in it is meaningless. The cause is almost certainly the ' +
  'workerIdleMemoryLimit setting in packages/data/jest.config.js no longer ' +
  'forcing each test file into its own process (better-sqlite3 cannot survive ' +
  're-registration into a second Jest module registry in one OS process). Fix ' +
  'that setting, not the schema.'

beforeAll(async () => {
  const db = await openTestDatabase()
  try {
    await db.execute(
      'CREATE TABLE canary (id TEXT PRIMARY KEY, n INTEGER NOT NULL UNIQUE CHECK (n > 0))',
    )
    await db.execute(
      'CREATE TABLE canary_child (id TEXT PRIMARY KEY, canary_id TEXT NOT NULL REFERENCES canary(id))',
    )

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
  } catch (error) {
    throw new Error(`${WHERE_TO_LOOK}\n\nUnderlying assertion:\n${error.message}`)
  } finally {
    await db.close()
  }
})
