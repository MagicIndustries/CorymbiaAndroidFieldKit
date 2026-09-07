module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testMatch: ['**/__tests__/**/*.test.tsx', '**/__tests__/**/*.test.ts'],
  // Every `jest.spyOn` is undone after the test that installed it, so a spy
  // cannot silently change what a LATER test is exercising.
  //
  // This is not hygiene for its own sake — it closed a real hole.
  // `CaptureDial.test.tsx` installs
  // `isReduceMotionEnabled().mockResolvedValue(true)` inside two tests in a
  // describe block with no teardown of its own, and every test after them in
  // the file inherited it. Two tests named for the *other* branch were
  // therefore running on the reduced-motion-on path: the one named "while
  // reduced motion is still unresolved" never saw an unresolved setting, and
  // the one named "when the dial mounts already locked" never reached the
  // `wasLocked` guard it is about, so deleting that guard left it green.
  //
  // A file that needs a spy for its whole run installs it in its own
  // `beforeEach`, which this re-applies rather than defeats. Note that
  // `apps/fieldkit` deliberately does NOT set this: its `jest.setup.js`
  // installs process-wide `AccessibilityInfo` spies once, and restoring those
  // per test would hand every later test a real API that never answers in a
  // headless environment (see the note in `capture.test.tsx`'s `afterEach`).
  restoreMocks: true,
}
