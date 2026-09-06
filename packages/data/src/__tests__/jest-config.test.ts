/// <reference types="node" />
import fs from 'node:fs'
import path from 'node:path'

/**
 * The defence, defending itself.
 *
 * Two lines in `jest.config.js` are the only thing standing between this
 * package and a suite that enforces nothing. `better-sqlite3` is a native
 * addon: when Jest hands a second test file to a worker process that already
 * ran a first one, the second file's connections silently stop enforcing
 * CHECK, UNIQUE and FOREIGN KEY constraints — no crash, no warning, just
 * permissive SQL that looks exactly like a passing suite. This project has
 * already shipped that once.
 *
 * `workerIdleMemoryLimit: '1MB'` forces a fresh process per test file, and
 * `setupFilesAfterEnv` runs `jest.setup.js`'s constraint probes before every
 * file's tests so the forcing is checked rather than assumed. Delete either
 * line and the whole suite goes green with enforcement unproven — including
 * `jest.setup.js` itself, which cannot report a failure it is no longer being
 * run to detect.
 *
 * So the config is asserted here, by a test that lives inside the suite it
 * protects. Deleting a line now fails a test that names the line.
 *
 * If this test is what went red, do not "fix" it by editing the expected
 * values to match the config. Restore the config.
 */

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..')

// A plain `require`, run as an ordinary statement, is how a Jest config file
// (CommonJS, and outside the TypeScript program) is read from a test. There is
// nothing to type here beyond the two keys under assertion.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const config = require('../../jest.config.js') as Record<string, unknown>

describe('the jest configuration that makes every constraint assertion meaningful', () => {
  it("sets workerIdleMemoryLimit to '1MB', which forces one process per test file", () => {
    // Not merely "is set": a merely-nonzero limit only defeats Jest's in-band
    // path. jest-worker recycles a worker between tasks solely when its
    // measured memory exceeds this limit, and these are tiny in-memory SQLite
    // suites that never approach a "reasonable-sounding" 512MB — so a worker
    // would keep the process and reuse it for a second file anyway. The value
    // has to be low enough that ANY worker exceeds it after one file.
    expect(config.workerIdleMemoryLimit).toBe('1MB')
  })

  it('runs jest.setup.js before every test file, so the limit above is checked per file', () => {
    // As a setupFilesAfterEnv hook the probe runs once per test file, so any
    // file that has lost enforcement fails loudly and by name. As a test file
    // of its own — where it used to live — it only noticed the failure when
    // the scheduler happened to place THAT file second on a worker, the same
    // lottery that produced the original intermittent flake.
    expect(config.setupFilesAfterEnv).toEqual(['<rootDir>/jest.setup.js'])
  })

  it('has a jest.setup.js on disk for that entry to point at', () => {
    // A path in the config that resolves to nothing would make Jest fail
    // loudly rather than silently, but the assertion above would still pass.
    expect(fs.existsSync(path.join(PACKAGE_ROOT, 'jest.setup.js'))).toBe(true)
  })
})
