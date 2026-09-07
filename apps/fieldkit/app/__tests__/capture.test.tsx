import React from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react-native'
import { ThemeProvider } from '@corymbia/ui'
import { type as typeScale } from '@corymbia/tokens'
import { createFakeLocationSource, type Reading } from '@corymbia/geo'
import type { Fix, FieldRecord } from '@corymbia/data'
import type { Capture, CaptureDeps } from '../../src/capture/useCapture'

/**
 * Tests for the capture screen (spec §9.1–§9.4).
 *
 * WHAT IS AND IS NOT MOCKED, and why. The same division `diagnostics.test.tsx`
 * and `useCapture.test.ts` draw, for the same reasons.
 *
 * Not mocked: `averageReadings`, `holdVerdict`, `gradeAccuracy`, and — the
 * point of this file — `useCapture` itself. The screen's job is to render the
 * state machine's output at the right size, in the right words and in the right
 * place, and a test against a stubbed hook could not tell whether the numbers
 * on screen are the numbers the override would actually store.
 *
 * Mocked: the database, because it is already proved (348 tests in
 * packages/data cover the schema, the CHECK constraints and both repository
 * functions this screen reaches through the hook), and
 * `createExpoLocationSource`, replaced by `createFakeLocationSource` — the
 * scripted source that exists for exactly this, and whose `emit` delivers the
 * reading sequences that are tedious or impossible to produce outdoors.
 */

// ---------------------------------------------------------------------------
// Module mocks. Every factory reaches its fixtures through a lazy arrow rather
// than by spreading them in directly: `jest.mock` calls are hoisted above the
// `const` declarations, so a factory that touched a fixture at definition time
// would run before it exists.
// ---------------------------------------------------------------------------

let mockSource: ReturnType<typeof createFakeLocationSource>

jest.mock('@corymbia/geo', () => {
  const actual = jest.requireActual<typeof import('@corymbia/geo')>('@corymbia/geo')
  return {
    ...actual,
    // The one thing in this package that talks to a device. The averaging, the
    // grading and the hold verdict are all the real implementation.
    createExpoLocationSource: () => mockSource,
  }
})

const mockRepo = {
  createRecord: jest.fn(),
  refineRecordFix: jest.fn(),
}

jest.mock('@corymbia/data', () => {
  const actual = jest.requireActual<typeof import('@corymbia/data')>('@corymbia/data')
  return {
    ...actual,
    createRecord: (...args: unknown[]) => mockRepo.createRecord(...args),
    refineRecordFix: (...args: unknown[]) => mockRepo.refineRecordFix(...args),
  }
})

/**
 * Fields overlaid onto whatever the REAL `useCapture` returns, for the single
 * test that needs a state the state machine cannot hold still.
 *
 * A plateaued verdict during a countdown is committed for exactly one frame:
 * `useCapture`'s plateau effect ends the countdown in the same flush that
 * renders it, so under `act` — which drains effects before returning — no
 * assertion can ever observe the acquiring screen showing it. The sentence is
 * pinned by spec §9.3 all the same, and it is what the screen must say at the
 * moment the fix stops improving, so the branch is exercised by overlaying the
 * verdict onto the real hook's own state rather than by replacing the hook.
 * Everything else in that render — the phase, the preview, the seconds — is
 * still the genuine state machine's.
 *
 * Empty for every other test, where the mock is a pass-through.
 */
let mockCaptureOverlay: Partial<Capture> = {}

jest.mock('../../src/capture/useCapture', () => {
  const actual =
    jest.requireActual<typeof import('../../src/capture/useCapture')>('../../src/capture/useCapture')
  return {
    ...actual,
    useCapture: (deps: CaptureDeps): Capture => ({ ...actual.useCapture(deps), ...mockCaptureOverlay }),
  }
})

const mockDevice = {
  id: 'device-under-test',
  installId: 'install-1',
  label: 'test-handset',
  manufacturer: 'Test',
  brand: 'Test',
  modelName: 'Model',
  modelId: 'model-1',
  deviceType: 'phone' as const,
  osName: 'Android',
  osVersion: '15',
  isPhysical: true,
  appVersion: '1.0.0',
  appBuild: '1',
  firstSeenAt: '2026-09-07T00:00:00.000Z',
  lastSeenAt: '2026-09-07T00:00:00.000Z',
}

const mockSettings = {
  theme: 'dark' as const,
  handedness: 'right' as const,
  capturePrimary: 'saveNow' as const,
  density: 'comfortable' as const,
}

const mockUseSettings = {
  settings: mockSettings,
  updateSetting: () => Promise.resolve(),
}

// Identity-stable module-level constants, which is what the real provider hands
// out — the one `db` handle, the one registered device and the one settings
// object it holds in context. It has to be identity-stable rather than merely
// equal: `db` is a dependency of the hook's write path, and a fresh object per
// render is the difference between a screen that settles and one that does not.
const mockDb = { handle: 'not a real database' }
const mockStatus = { state: 'ready' as const, error: null, applied: ['001_initial'] }

jest.mock('../../src/db/provider', () => ({
  // A handle, not a database. Nothing here calls a method on it: the two
  // repository functions that would are replaced above, and the screen only
  // ever passes it through.
  useDatabase: () => mockDb,
  useDatabaseStatus: () => mockStatus,
  useDevice: () => mockDevice,
  useSettings: () => mockUseSettings,
}))

// Imported after the mocks so it picks them up.
import CaptureScreen from '../capture'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A reading with everything the save path insists on: a usable accuracy, and an
 * explicit `isMocked: false`. `undefined` there is the platform declining to
 * say, which the save path refuses to store — correct behaviour, and not what
 * any test below is about.
 */
function reading(accuracyM: number, timestampMs: number, latitude = -37.8136): Reading {
  return {
    latitude,
    longitude: 144.9631,
    accuracyM,
    altitudeM: 31,
    verticalAccuracyM: 4,
    isMocked: false,
    timestampMs,
  }
}

let mockCaptureNumber = 0

function recordFrom(fix: Fix): FieldRecord {
  mockCaptureNumber += 1
  return {
    id: `record-${String(mockCaptureNumber)}`,
    activityId: null,
    contextActivityId: null,
    kind: 'pin',
    captureNumber: mockCaptureNumber,
    sequence: null,
    filedAt: null,
    title: null,
    description: null,
    fix,
    capturedAt: new Date(Date.now()).toISOString(),
    deviceId: mockDevice.id,
    attributes: {},
  }
}

const START_MS = Date.UTC(2026, 8, 7, 1, 0, 0)

beforeEach(() => {
  // `setImmediate`, `nextTick` and `queueMicrotask` are deliberately left real.
  // React's async `act` flushes its work queue through `setImmediate`, so
  // faking it means every `await act(...)` waits for a callback the test itself
  // is holding, and every test fails on the 5 s timeout instead of on its
  // assertion. Everything the screen schedules — `setTimeout` for the
  // countdown, `setInterval` for the ticker, `Date.now` for the seconds
  // remaining — is still faked, which is the part that matters.
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] })
  jest.setSystemTime(START_MS)

  mockCaptureNumber = 0
  mockCaptureOverlay = {}
  mockSource = createFakeLocationSource({ permission: 'granted', readings: [] })

  mockRepo.createRecord.mockReset()
  mockRepo.refineRecordFix.mockReset()
  mockRepo.createRecord.mockImplementation((_db: unknown, input: { fix: Fix }) =>
    Promise.resolve(recordFrom(input.fix)),
  )
  mockRepo.refineRecordFix.mockImplementation(
    (_db: unknown, input: { recordId: string; fix: Fix }) =>
      Promise.resolve({ ...recordFrom(input.fix), id: input.recordId }),
  )
})

afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
  // Deliberately NOT `jest.restoreAllMocks()`: the reduced-motion spies in
  // jest.setup.js are installed once for the whole file, and restoring them
  // after the first test would hand every later test the real
  // `AccessibilityInfo`, which in a headless environment never answers.
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Lets every pending promise continuation run, and React apply what they set. */
async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

/**
 * Renders the screen, lets the permission request and the subscription resolve,
 * and delivers one reading so there is a fix on screen to record.
 */
async function arriveWithAFix(accuracyM = 8) {
  // @testing-library/react-native v14 is async throughout: `render`,
  // `fireEvent.*` and `unmount` all return promises and must be awaited, or the
  // work they queue lands in the middle of the next assertion.
  const view = await render(
    <ThemeProvider>
      <CaptureScreen />
    </ThemeProvider>,
  )
  await settle()
  await act(async () => {
    mockSource.emit(reading(accuracyM, Date.now()))
  })
  return view
}

function captureButton() {
  return screen.getByTestId('capture-button')
}

/** Taps the one control, and lets the insert it starts resolve. */
async function tap() {
  await fireEvent.press(captureButton())
  await settle()
}

/** Delivers one reading, a second after the last thing that happened. */
async function emit(accuracyM: number, latitude?: number) {
  await act(async () => {
    jest.advanceTimersByTime(1000)
    mockSource.emit(reading(accuracyM, Date.now(), latitude))
  })
}

/**
 * The traffic-light frame's own subtree.
 *
 * `TrafficLightFrame` takes no `testID` of its own, so the screen wraps it in
 * the capture block — a container whose ONLY child is the frame, and which
 * carries the reach anchoring. Scoping a query to it is therefore the same
 * question as "is this inside the frame, beside the button", which spec §9.1.2
 * makes a requirement rather than a layout preference. The border assertion
 * below is what keeps that equivalence honest: the handle is queried against
 * the frame's own rendering, not merely against a container that happens to be
 * named after it.
 */
function insideTheFrame() {
  const block = screen.getByTestId('capture-frame')
  expect(within(block).getByTestId('traffic-light-border')).toBeTruthy()
  return within(block)
}

/** The single string a readout renders, for assertions about its exact shape. */
function readoutText(testID: string): string {
  const value: unknown = screen.getByTestId(testID).props.children
  if (typeof value !== 'string') {
    throw new Error(`Expected ${testID} to render exactly one string, got ${typeof value}.`)
  }
  return value
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('the ready state', () => {
  it('offers exactly one control, and it says CAPTURE', async () => {
    await arriveWithAFix()

    // Spec §9.1.4: exactly one action is ever live. Not "the primary one is
    // obvious" — one.
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(captureButton()).toHaveTextContent('CAPTURE')
    expect(screen.queryByText('ACCEPT NOW')).toBeNull()
  })

  it('renders the live coordinates in monospace', async () => {
    await arriveWithAFix()

    // Spec §9.4: coordinates are context about the receiver. Monospaced so the
    // digits do not jitter sideways while she watches them settle.
    expect(screen.getByTestId('capture-latitude').props.style.fontFamily).toBe(
      typeScale.mono.fontFamily,
    )
    expect(screen.getByTestId('capture-longitude').props.style.fontFamily).toBe(
      typeScale.mono.fontFamily,
    )
    expect(screen.getByTestId('capture-latitude')).toHaveTextContent('-37.813600')
  })
})

describe('the acquiring state', () => {
  it('is where a tap goes, and the same control now accepts the fix early', async () => {
    await arriveWithAFix()
    await tap()

    expect(mockRepo.createRecord).toHaveBeenCalledTimes(1)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(captureButton()).toHaveTextContent('ACCEPT NOW')
    expect(screen.queryByText('CAPTURE')).toBeNull()
  })

  it('renders the accuracy and the seconds remaining larger than anything else on the screen', async () => {
    await arriveWithAFix()
    await tap()

    // Spec §9.4: these are the two numbers she is standing still for, and in
    // this state they are the largest things on the screen — legible at arm's
    // length, in glare, without leaning in. The size is asserted, not the mere
    // presence of the text: the diagnostics prototype showed both numbers and
    // still got this wrong, rendering them at the same weight as its other
    // instrument readouts.
    expect(screen.getByTestId('capture-accuracy').props.style.fontSize).toBe(typeScale.hero.size)
    expect(screen.getByTestId('capture-seconds').props.style.fontSize).toBe(typeScale.hero.size)

    // And everything else in the state is subordinate to them, which is the
    // half of §9.4 a size assertion on its own would not catch.
    for (const testID of ['capture-samples', 'capture-improvement', 'capture-spread', 'capture-verdict']) {
      const size: unknown = screen.getByTestId(testID).props.style.fontSize
      expect(typeof size).toBe('number')
      expect(size).toBeLessThan(typeScale.hero.size)
    }
  })

  it('says the verdict in the words the spec pins, while the fix is still improving', async () => {
    await arriveWithAFix()
    await tap()
    await emit(7)

    expect(screen.getByTestId('capture-verdict')).toHaveTextContent(
      'Still improving — keep standing still.',
    )
  })

  it('says the other pinned sentence once the fix has stopped improving', async () => {
    // See `mockCaptureOverlay` above for why the verdict is overlaid rather than
    // driven: the state machine ends the countdown in the same flush that first
    // reports a plateau, so this render exists on a real device and cannot be
    // held still under `act`.
    mockCaptureOverlay = { verdict: 'plateaued' }
    await arriveWithAFix()
    await tap()

    expect(screen.getByTestId('capture-verdict')).toHaveTextContent(
      'About as sharp as it gets here — accepting now costs nothing.',
    )
  })

  it('reports how much sharper the fix is without pretending the number is signed', async () => {
    await arriveWithAFix(12)
    await tap()
    await emit(2)
    await emit(2)

    // Spec §9.3, corrected: this number is structurally incapable of going
    // negative — inverse-variance weighting is monotonic and the tap's own
    // reading is always in the sample set — so presenting it as a signed delta
    // would claim a worsening it can never show.
    const improvement = readoutText('capture-improvement')
    expect(improvement).toMatch(/sharper than the tap/)
    expect(improvement).not.toMatch(/[+-]/)
  })

  it('shows the spread beside it, which is the number that does worsen', async () => {
    await arriveWithAFix()
    await tap()

    // One reading has no disagreement to report, which is not a disagreement of
    // zero — so the readout says so rather than printing ±0.0 m.
    expect(screen.getByTestId('capture-spread')).toHaveTextContent(/one reading/)

    // A second reading from about 11 m up the paddock. The accuracy improves
    // regardless; only the spread can say the two readings disagree about where
    // she is standing, which is why §9.3 puts it beside the improvement.
    await emit(8, -37.8137)

    expect(readoutText('capture-improvement')).toMatch(/sharper than the tap/)
    expect(screen.getByTestId('capture-spread')).toHaveTextContent(/±5\.\d m apart/)
  })

  it('keeps the override live for every moment of the countdown', async () => {
    await arriveWithAFix()
    await tap()

    // Spec §9.1.4: the override is reachable at every moment the countdown is
    // running. Not merely rendered — pressable.
    expect(captureButton()).not.toBeDisabled()
    for (const accuracyM of [7, 6, 5]) {
      await emit(accuracyM)
      expect(captureButton()).not.toBeDisabled()
    }

    await fireEvent.press(captureButton())
    await settle()
    expect(mockRepo.refineRecordFix).toHaveBeenCalledTimes(1)
  })

  it('scrolls, so the override cannot be pushed off the bottom in landscape', async () => {
    await arriveWithAFix()
    await tap()

    // Rotation is unlocked and a phone in landscape has roughly 360dp of
    // height, where centred content in a non-scrolling container clips
    // symmetrically and takes the control with it. `flexGrow: 1` with
    // `justifyContent: 'center'` renders identically when the content fits and
    // keeps §9.1.4's "reachable at every moment" true when it does not.
    const style: unknown = screen.getByTestId('capture-scroll').props.contentContainerStyle
    expect(style).toMatchObject({ flexGrow: 1, justifyContent: 'center' })
  })
})

describe('the adjacency requirement (spec §9.1.2)', () => {
  it('keeps every readout that responds to the countdown inside the frame with the button', async () => {
    await arriveWithAFix()
    await tap()
    await emit(7)

    // THIS IS THE POINT OF THE WHOLE SINGLE-CONTROL DESIGN. On the superseded
    // press-and-hold screen her thumb was on the button while the only part of
    // the screen that moved was somewhere else entirely, and §9.1.2 makes the
    // fix a requirement rather than a layout preference: a design that puts the
    // countdown readout in a panel above the control has not implemented that
    // section.
    //
    // So this asserts descendancy, not presence. Every one of these readouts
    // responds during a countdown, and each must be inside the traffic-light
    // frame that also holds the control.
    const frame = insideTheFrame()
    for (const testID of [
      'capture-accuracy',
      'capture-seconds',
      'capture-samples',
      'capture-improvement',
      'capture-spread',
      'capture-verdict',
      'capture-button',
    ]) {
      expect(frame.getByTestId(testID)).toBeTruthy()
    }
  })
})
