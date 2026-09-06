module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.ts'],
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
  // file anyway, and the canary went red intermittently (roughly 1 run in 3)
  // purely on how the scheduler happened to bin-pack files onto workers that
  // run. Setting the limit low enough that ANY worker's usage exceeds it after
  // one file forces a fresh process — and therefore a fresh native-module load
  // — before every test file, independent of how many files this package grows
  // to relative to CPU count. Confirmed stable across 10 consecutive full runs
  // at this value; do not raise it back toward a "reasonable-sounding" size
  // like 512MB without re-running the suite ~10x to check the canary stays
  // green when test-file count exceeds `maxWorkers`.
  workerIdleMemoryLimit: '1MB',
}
