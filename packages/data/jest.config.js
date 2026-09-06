module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.ts'],
  // Jest silently runs multiple fast test files in-band (same process) to save
  // worker-spawn overhead (see shouldRunInBand in @jest/core). `better-sqlite3`
  // is a native addon: two test files sharing one process each re-require it
  // into a fresh module registry, and the second file's connections stop
  // enforcing CHECK/UNIQUE/FOREIGN KEY constraints — silently, not a crash.
  // Setting workerIdleMemoryLimit forces Jest to always use real worker
  // processes, which is the one documented switch that disables that
  // in-band heuristic (see testSchedulerHelper.js: `!workerIdleMemoryLimit && …`).
  workerIdleMemoryLimit: '512MB',
}
