const { AccessibilityInfo } = require('react-native')

// Reduced motion is ON by default for every test in this app, and that is a
// harness decision worth stating rather than a convenience.
//
// The diagnostics screen runs an `Animated.loop` on the capture frame while a
// countdown is active. A loop never ends by itself, so under Jest's fake timers
// — which the countdown tests need, because a countdown is a `setTimeout` — a
// running loop is an inexhaustible source of pending timers: `jest.runAllTimers()`
// against one does not return. Defaulting the harness to the reduced-motion
// branch means no loop is ever started by a test that is not specifically about
// the animation, so no test can hang on one. The test that IS about the
// animation overrides this locally, starts the loop, asserts, and unmounts.
//
// It is also the honest default for a headless environment: nothing here is
// rendering frames.
jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true)
jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: () => undefined })
