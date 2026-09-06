module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.ts'],
  // Runs the constraint-enforcement check before EVERY test file's tests, so
  // `workerIdleMemoryLimit` below is checked by the whole suite rather than by
  // one canary file that only noticed the failure when the scheduler happened
  // to place it second on a worker. See jest.setup.js.
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  // Jest silently runs multiple fast test files in ONE process to save
  // worker-spawn overhead — either by skipping the worker pool entirely
  // (`shouldRunInBand` in @jest/core, defeated by merely setting
  // `workerIdleMemoryLimit`; see testSchedulerHelper.js: `!workerIdleMemoryLimit
  // && …`), or, just as fatally, by handing a SECOND test file to a worker
  // process that already ran a FIRST one, once there are more test files than
  // `maxWorkers` — which this package now has. `better-sqlite3` is a native
  // addon: two test files sharing one process each re-require it into a fresh
  // JS module registry, but the underlying native library is only loaded once
  // per OS process, and the second file's connections silently stop enforcing
  // CHECK/UNIQUE/FOREIGN KEY constraints — no crash, no warning.
  //
  // A merely-nonzero `workerIdleMemoryLimit` only fixes the first failure mode.
  // jest-worker recycles a worker between tasks solely when its measured memory
  // exceeds this limit, and these tests are tiny in-memory SQLite suites that
  // never approach even 512MB — so a worker kept it and reused it for a second
  // file anyway, and the check went red intermittently (roughly 1 run in 3)
  // purely on how the scheduler happened to bin-pack files onto workers that
  // run. Setting the limit low enough that ANY worker's usage exceeds it after
  // one file forces a fresh process — and therefore a fresh native-module load
  // — before every test file, independent of how many files this package grows
  // to relative to CPU count.
  //
  // Do not raise it toward a "reasonable-sounding" size like 512MB. That is not
  // a judgement call any more: with the setup hook above running in every file,
  // raising it to 512MB fails test files on every single run, naming this
  // setting in the message. Verified by doing exactly that, when this package
  // had 11 test files and 2 of them went red; it has 16 now, and more files
  // means more chances for the scheduler to double one up on a worker, not
  // fewer.
  //
  // Both this line and `setupFilesAfterEnv` above are asserted by
  // src/__tests__/jest-config.test.ts, because deleting either one leaves the
  // entire suite green with constraint enforcement unproven — the defence has
  // to defend itself.
  workerIdleMemoryLimit: '1MB',
}
