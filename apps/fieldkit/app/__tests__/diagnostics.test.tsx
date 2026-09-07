import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { AccessibilityInfo } from 'react-native'
import { ThemeProvider } from '@corymbia/ui'
import { createFakeLocationSource, type Reading } from '@corymbia/geo'
import type { Fix, FieldRecord } from '@corymbia/data'

/**
 * Tests for the diagnostics capture control.
 *
 * WHAT IS AND IS NOT MOCKED, and why.
 *
 * Not mocked: `averageReadings`, `holdVerdict`, `gradeAccuracy`, `nowIso`,
 * `sampleEvidence`. They are the logic under observation. A test that stubbed
 * `holdVerdict` could not tell whether the screen ends a countdown on a plateau,
 * which is the single most important rule below.
 *
 * Mocked: the database. Not because SQLite is inconvenient but because it is
 * already proved — 338 tests in packages/data cover the schema, the CHECK
 * constraints and every repository function this screen calls. What is NOT
 * proved anywhere is this screen's state machine: how many records one tap
 * produces, how many refinements one countdown produces, and what happens to
 * the timers when the screen goes away. Standing up a real database would test
 * packages/data a second time and this screen no harder.
 *
 * Mocked: `createExpoLocationSource`, replaced by `createFakeLocationSource`
 * from @corymbia/geo — the scripted source that exists for exactly this, and
 * whose `emit` lets a test deliver readings on demand, including the sequences
 * that are tedious or impossible to produce outdoors (an accuracy that goes
 * flat, an accuracy that gets worse).
 */

// ---------------------------------------------------------------------------
// Module mocks. Every factory below reaches its fixtures through a lazy arrow
// (`(...args) => mockRepo.createRecord(...args)`) rather than by spreading them
// in directly: `jest.mock` calls are hoisted above the `const` declarations, so
// a factory that touched a fixture at definition time would run before it
// exists.
// ---------------------------------------------------------------------------

let mockSource: ReturnType<typeof createFakeLocationSource>

jest.mock('@corymbia/geo', () => {
  const actual = jest.requireActual('@corymbia/geo')
  return {
    ...actual,
    // The one thing in this package that talks to a device. Everything else —
    // the averaging, the grading, the hold verdict, the ambient cache — is the
    // real implementation.
    createExpoLocationSource: () => mockSource,
  }
})

const mockRepo = {
  listProjects: jest.fn(),
  listActivities: jest.fn(),
  createProject: jest.fn(),
  createActivity: jest.fn(),
  createRecord: jest.fn(),
  refineRecordFix: jest.fn(),
  listRecords: jest.fn(),
}

jest.mock('@corymbia/data', () => {
  const actual = jest.requireActual('@corymbia/data')
  return {
    ...actual,
    listProjects: (...args: unknown[]) => mockRepo.listProjects(...args),
    listActivities: (...args: unknown[]) => mockRepo.listActivities(...args),
    createProject: (...args: unknown[]) => mockRepo.createProject(...args),
    createActivity: (...args: unknown[]) => mockRepo.createActivity(...args),
    createRecord: (...args: unknown[]) => mockRepo.createRecord(...args),
    refineRecordFix: (...args: unknown[]) => mockRepo.refineRecordFix(...args),
    listRecords: (...args: unknown[]) => mockRepo.listRecords(...args),
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
  firstSeenAt: '2026-09-05T00:00:00.000Z',
  lastSeenAt: '2026-09-05T00:00:00.000Z',
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

// Every value below is a module-level constant returned by identity, which is
// what the real provider does — it hands out the one `db` handle, the one
// registered device and the one settings object it holds in context.
//
// It has to be identity-stable, not merely equal. `DiagnosticsBody`'s
// on-arrival load is `useEffect(..., [db, setRecords])`; a mock that returned a
// fresh object per call changes `db` on every render, so the effect re-runs,
// calls `setRecords` with a fresh array, re-renders, and the screen never stops
// rendering. That is a property of the mock rather than of the screen — but it
// is worth knowing that this effect is one `db` identity away from a loop.
const mockDb = { handle: 'not a real database' }
const mockStatus = { state: 'ready' as const, error: null, applied: ['001_initial'] }

// The only navigation this screen does: the way out of the Recorded state.
const mockPush = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: (href: string) => mockPush(href) }),
}))

jest.mock('../../src/db/provider', () => ({
  // A handle, not a database. Nothing in this file calls a method on it: every
  // repository function that would has been replaced above, and the screen only
  // ever passes it through.
  useDatabase: () => mockDb,
  useDatabaseStatus: () => mockStatus,
  useDevice: () => mockDevice,
  useSettings: () => mockUseSettings,
}))

// Imported after the mocks so it picks them up.
import Diagnostics from '../diagnostics'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A promise a test resolves by hand, so a capture can be held open between two
 * of its awaits — which is the window the double-tap defect lived in.
 *
 * Written without a definite-assignment assertion: the initial no-op is
 * replaced synchronously by the executor, which runs before `Promise` returns.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let settle: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolveWith) => {
    settle = resolveWith
  })
  return {
    promise,
    resolve: (value) => {
      settle(value)
    },
  }
}

/**
 * A reading with everything the save path insists on: a usable accuracy, and an
 * explicit `isMocked: false`. `undefined` there is the platform declining to
 * say, which `buildDeliberateFix` refuses to store — correct behaviour, and not
 * what any test below is about.
 */
function reading(accuracyM: number, timestampMs: number): Reading {
  return {
    latitude: -37.8136,
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
    activityId: 'activity-1',
    contextActivityId: 'activity-1',
    kind: 'pin',
    captureNumber: mockCaptureNumber,
    sequence: mockCaptureNumber,
    filedAt: null,
    title: null,
    description: null,
    fix,
    capturedAt: new Date(Date.now()).toISOString(),
    deviceId: mockDevice.id,
    attributes: {},
  }
}

let mockStored: FieldRecord[] = []

const START_MS = Date.UTC(2026, 8, 5, 1, 0, 0)

/** The steady opacity the pulse ring holds when reduced motion is on. */
const PULSE_STEADY_OPACITY = 0.6

/** Where the animated ring's opacity starts, and returns to when the loop stops. */
const PULSE_MIN_OPACITY = 0.15

/** Queries that must see the decorative, accessibility-hidden pulse ring. */
const HIDDEN = { includeHiddenElements: true }

beforeEach(() => {
  // `setImmediate` and `nextTick` are deliberately left real. React's async
  // `act` flushes its work queue through `setImmediate` (see
  // `recursivelyFlushAsyncActWork` in react.development.js), so faking it — which
  // Jest's modern fake timers do by default — means every `await act(...)` in
  // this file waits for a callback the test itself is holding, and every test
  // fails on the 5 s timeout instead of on its assertion. Everything the screen
  // schedules (`setTimeout` for the countdown, `setInterval` for the ticker,
  // `Date.now` for the remaining seconds) is still faked, which is the part that
  // matters: a 60 s countdown must not take 60 s to test.
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] })
  jest.setSystemTime(START_MS)

  mockCaptureNumber = 0
  mockStored = []
  mockSource = createFakeLocationSource({ permission: 'granted', readings: [] })

  mockRepo.listProjects.mockReset()
  mockRepo.listActivities.mockReset()
  mockRepo.createProject.mockReset()
  mockRepo.createActivity.mockReset()
  mockRepo.createRecord.mockReset()
  mockRepo.refineRecordFix.mockReset()
  mockRepo.listRecords.mockReset()

  mockRepo.listProjects.mockResolvedValue([{ id: 'project-1', name: 'Diagnostics' }])
  mockRepo.listActivities.mockResolvedValue([{ id: 'activity-1', name: 'Diagnostics run' }])
  mockRepo.listRecords.mockImplementation(() => Promise.resolve([...mockStored]))
  mockRepo.createRecord.mockImplementation((_db: unknown, input: { fix: Fix }) => {
    const created = recordFrom(input.fix)
    mockStored = [created, ...mockStored]
    return Promise.resolve(created)
  })
  mockRepo.refineRecordFix.mockImplementation((_db: unknown, input: { recordId: string; fix: Fix }) => {
    const existing = mockStored.find((r) => r.id === input.recordId)
    const refined: FieldRecord = { ...(existing ?? recordFrom(input.fix)), fix: input.fix }
    mockStored = mockStored.map((r) => (r.id === refined.id ? refined : r))
    return Promise.resolve(refined)
  })
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

async function renderScreen() {
  // @testing-library/react-native v14 is async throughout: `render`,
  // `fireEvent.*` and `unmount` all return promises and must be awaited, or the
  // work they queue lands in the middle of the next assertion.
  return await render(
    <ThemeProvider>
      <Diagnostics />
    </ThemeProvider>,
  )
}

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
  const view = await renderScreen()
  await settle()
  await act(async () => {
    mockSource.emit(reading(accuracyM, Date.now()))
  })
  return view
}

function captureButton() {
  return screen.getByTestId('capture-button')
}

/** Emits `count` readings a second apart, each with the given accuracy. */
async function emitReadings(accuracies: number[]) {
  for (const accuracyM of accuracies) {
    await act(async () => {
      jest.advanceTimersByTime(1000)
      mockSource.emit(reading(accuracyM, Date.now()))
    })
  }
}

/** Runs the clock past the longest countdown this screen offers. */
async function runOutTheCountdown() {
  await act(async () => {
    jest.advanceTimersByTime(61_000)
  })
  await settle()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('the capture control', () => {
  it('does not write a second record when it is tapped twice before the countdown starts', async () => {
    // The window this test is about: `captureNow` runs three awaits before
    // `beginCountdown` sets `countdownRef`, and `Button` is a bare `Pressable`
    // with no debounce, so the second tap of a double-tap arrives while the
    // first capture is parked at one of those awaits — `countdownRef` still
    // null and the `disabled` prop not yet rendered. The record it produced was
    // not a harmless duplicate: it had one sample, no spread and a zero-length
    // hold, which on disk is indistinguishable from "the countdown produced no
    // improvement" — the exact negative result this instrument is carried
    // outdoors to look for.
    // The insert is held open, so the first capture is genuinely parked between
    // `createRecord` and `beginCountdown` for as long as this test wants.
    const created = deferred<FieldRecord>()
    mockRepo.createRecord.mockImplementation((_db: unknown, input: { fix: Fix }) => {
      const record = recordFrom(input.fix)
      mockStored = [record, ...mockStored]
      return created.promise.then(() => record)
    })

    await arriveWithAFix()

    // Two taps with no commit between them, which is what a double-tap on a
    // device is. Both presses are dispatched inside one outer `act`, and
    // neither is awaited: `fireEvent.press` invokes the handler synchronously,
    // so both reach `captureNow` before React has committed anything and before
    // the `disabled` prop is in the tree to stop the second. Only
    // `writeInFlightRef` can turn it away.
    //
    // One outer `act`, not two `fireEvent.press` promises awaited together:
    // concurrent (rather than nested) act scopes restore React's act
    // environment out of order, and the resulting tree reports the body as
    // unmounted part-way through the capture — a defect in the test, not in the
    // screen, but one that quietly turns this assertion green for the wrong
    // reason.
    await act(async () => {
      void fireEvent.press(captureButton())
      void fireEvent.press(captureButton())
    })

    // A third, now genuinely parked mid-await inside the first capture: the
    // insert has begun, `beginCountdown` has not run, and `countdownRef` is
    // still null.
    await settle()
    await fireEvent.press(captureButton())

    created.resolve(recordFrom({ quality: 'none' }))
    await settle()

    expect(mockRepo.createRecord).toHaveBeenCalledTimes(1)
    expect(mockStored).toHaveLength(1)
    // And exactly one acquisition came out of it.
    expect(screen.getByTestId('capture-state')).toHaveTextContent('SAVED — REFINING')
  })

  it('refines the record exactly once when the countdown runs to completion', async () => {
    await arriveWithAFix()

    await fireEvent.press(captureButton())
    await settle()
    expect(mockRepo.createRecord).toHaveBeenCalledTimes(1)

    await emitReadings([7, 6, 5, 4])
    await runOutTheCountdown()

    expect(mockRepo.refineRecordFix).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/Countdown complete/)).toBeTruthy()
  })

  it('refines exactly once when the override accepts early, and no later timer refines again', async () => {
    await arriveWithAFix()

    await fireEvent.press(captureButton())
    await settle()

    await emitReadings([7, 6])

    // The same control, now the override.
    await fireEvent.press(captureButton())
    await settle()

    expect(mockRepo.refineRecordFix).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/^Accepted —/)).toBeTruthy()

    // The countdown's own timeout was still pending when the override ran. If
    // it were not torn down — or if `countdownRef` were not claimed
    // synchronously — this is where the second refinement would land.
    await runOutTheCountdown()
    expect(mockRepo.refineRecordFix).toHaveBeenCalledTimes(1)
  })

  it('does not end the countdown on a plateau while auto-finish is switched off', async () => {
    // Auto-finish is ON by default now that the plateau signal has a
    // minimum-sample guard, so this test has to switch it off first. That
    // setting is kept — and proved here — because a fixed full-length wait is
    // still the thing a self-finishing one has to be measured against.
    await arriveWithAFix(6)

    await fireEvent.press(screen.getByTestId('auto-finish-toggle'))
    await settle()
    expect(screen.getByText(/^AUTO-FINISH OFF/)).toBeTruthy()

    await fireEvent.press(captureButton())
    await settle()

    // Ten samples — the tap's own reading plus nine — with no improvement
    // across them is what `holdVerdict` calls `plateaued`. Nine would not be:
    // the rule cannot claim a plateau before ten samples have accumulated,
    // because the hardware measurements say the fix is still improving below
    // that.
    await emitReadings([6, 6, 6, 6, 6, 6, 6, 6, 6])

    // The screen says so — in words, and by making the override prominent.
    expect(screen.getByText('ACCEPT NOW — NOT IMPROVING')).toBeTruthy()
    expect(screen.getByText(/About as sharp as it gets here/)).toBeTruthy()

    // And does not act on it: still acquiring, still no refinement.
    expect(mockRepo.refineRecordFix).not.toHaveBeenCalled()
    expect(screen.getByTestId('capture-state')).toHaveTextContent('SAVED — REFINING')

    // Only the timer running out ends it, and it refines exactly once.
    await runOutTheCountdown()
    expect(mockRepo.refineRecordFix).toHaveBeenCalledTimes(1)
  })

  it('ends the countdown on a plateau by default, refining exactly once', async () => {
    await arriveWithAFix(6)

    // On by default. Nothing is pressed to arrange this — that is the point of
    // the assertion.
    expect(screen.getByText(/^AUTO-FINISH ON/)).toBeTruthy()

    await fireEvent.press(captureButton())
    await settle()
    await emitReadings([6, 6, 6, 6, 6, 6, 6, 6, 6])
    await settle()

    // Finished by itself, inside the 12 s countdown, and exactly once.
    expect(mockRepo.refineRecordFix).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('capture-state')).toHaveTextContent('POINT #1 RECORDED')
    expect(screen.getByText(/The fix stopped improving, so the countdown finished itself\./)).toBeTruthy()
    expect(screen.getByText(/ended by auto-finish, on the plateau signal/)).toBeTruthy()

    // The countdown's own timeout was still pending. It must not refine again.
    await runOutTheCountdown()
    expect(mockRepo.refineRecordFix).toHaveBeenCalledTimes(1)
  })

  it('leaves no timer running and updates no state when the screen unmounts mid-countdown', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    const view = await arriveWithAFix()
    await fireEvent.press(captureButton())
    await settle()
    expect(jest.getTimerCount()).toBeGreaterThan(0)

    await view.unmount()

    // A loop reschedules itself forever, so "the timer queue drains and stays
    // drained" is what proves it was actually stopped rather than merely
    // hidden. One one-shot callback outlives the countdown (React Native's
    // animation module flushes its own queue); two more turns of a very long
    // clock leave nothing at all.
    await act(async () => {
      jest.advanceTimersByTime(30_000)
    })
    expect(jest.getTimerCount()).toBe(0)
    await act(async () => {
      jest.advanceTimersByTime(30_000)
    })
    expect(jest.getTimerCount()).toBe(0)

    await runOutTheCountdown()
    expect(mockRepo.refineRecordFix).not.toHaveBeenCalled()
    // React reports an update on an unmounted component through console.error.
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('keeps one transcript row per collected reading, and keeps them after the countdown completes', async () => {
    await arriveWithAFix(9)

    await fireEvent.press(captureButton())
    await settle()

    // Nothing but the capture frame is on screen during an acquisition, the
    // transcript included — this asserts that deliberately rather than working
    // around it, because a transcript she cannot read while standing still is
    // the whole reason the screen collapses.
    expect(screen.queryAllByTestId('transcript-row')).toHaveLength(0)

    await emitReadings([7, 6, 5])
    await runOutTheCountdown()

    // And it is all there the instant the point is recorded: one row per
    // collected reading — the tap's own, plus the three that arrived during the
    // countdown — with the closing marker saying how it ended. These rows are
    // the artefact the trip exists to produce; they survive the countdown that
    // made them and are cleared only by the next tap.
    expect(screen.getAllByTestId('transcript-row')).toHaveLength(4)
    expect(screen.getByText(/ended by the countdown, 4 readings averaged/)).toBeTruthy()
  })
})

describe('the ambient save', () => {
  it('cannot run while a write is in flight', async () => {
    const created = deferred<FieldRecord>()
    mockRepo.createRecord.mockImplementation((_db: unknown, input: { fix: Fix }) => {
      const record = recordFrom(input.fix)
      mockStored = [record, ...mockStored]
      return created.promise.then(() => record)
    })

    await arriveWithAFix()

    // The capture claims the write; the ambient save is pressed while it is
    // still in flight and before React has committed the `disabled` prop, in
    // the same window as the double-tap above. Only `writeInFlightRef` can turn
    // it away.
    await act(async () => {
      void fireEvent.press(captureButton())
      void fireEvent.press(screen.getByTestId('ambient-button'))
    })
    await settle()

    // Only the capture's own insert.
    expect(mockRepo.createRecord).toHaveBeenCalledTimes(1)
    // And once React catches up the control is not merely refusing, it is not
    // on the screen at all: a tap puts the screen into its single-focus
    // Acquiring state. `writeInFlightRef` is what turned the press away in the
    // instant before that; this is what stops a second one being possible.
    expect(screen.queryByTestId('ambient-button')).toBeNull()

    created.resolve(recordFrom({ quality: 'none' }))
    await settle()
  })

  it('cannot run twice at once, and says so on the control', async () => {
    // The same guard, on the path where the control stays on screen: an ambient
    // save does not collapse the screen, so this is where the mirrored
    // `disabled` state is actually visible.
    const created = deferred<FieldRecord>()
    mockRepo.createRecord.mockImplementation((_db: unknown, input: { fix: Fix }) => {
      const record = recordFrom(input.fix)
      mockStored = [record, ...mockStored]
      return created.promise.then(() => record)
    })

    await arriveWithAFix()

    await act(async () => {
      void fireEvent.press(screen.getByTestId('ambient-button'))
      void fireEvent.press(screen.getByTestId('ambient-button'))
    })
    await settle()

    expect(mockRepo.createRecord).toHaveBeenCalledTimes(1)
    // Both controls say the same thing, because both are refusing for the same
    // reason: one write is already in flight.
    expect(screen.getByTestId('ambient-button')).toBeDisabled()
    expect(screen.getByTestId('capture-button')).toBeDisabled()
    expect(screen.getAllByText('SAVING…')).toHaveLength(2)

    created.resolve(recordFrom({ quality: 'none' }))
    await settle()
    expect(screen.getByTestId('ambient-button')).not.toBeDisabled()
  })

  it('is not even reachable while a countdown is running', async () => {
    await arriveWithAFix()

    await fireEvent.press(captureButton())
    await settle()
    expect(mockRepo.createRecord).toHaveBeenCalledTimes(1)

    // The Acquiring state takes the whole screen, so the control is not on it.
    // The guard inside `saveAmbient` still exists and still refuses — this
    // asserts the stronger fact that there is nothing to press.
    expect(screen.queryByTestId('ambient-button')).toBeNull()

    // And it is back, enabled, the moment the point is recorded.
    await runOutTheCountdown()
    expect(screen.getByTestId('ambient-button')).not.toBeDisabled()
    expect(screen.getByText('Save ambient fix')).toBeTruthy()
  })
})

describe('the three screen states', () => {
  it('collapses to the capture frame when a reading is taken, and comes back when it is recorded', async () => {
    await arriveWithAFix()

    // Ready: the instrument, in full.
    expect(screen.getByText('DEVICE')).toBeTruthy()
    expect(screen.getByText('COUNTDOWN TRANSCRIPT')).toBeTruthy()
    expect(screen.getByText('READING LOG')).toBeTruthy()
    expect(screen.getByText('STORED RECORDS')).toBeTruthy()
    expect(screen.getByTestId('auto-finish-toggle')).toBeTruthy()
    expect(screen.getByTestId('ambient-button')).toBeTruthy()

    await fireEvent.press(captureButton())
    await settle()

    // Acquiring: one job on screen. Every panel, log, chooser and list is gone,
    // and what is left is the frame, the position, the time left and the one
    // control (doctrine rules 1 and 2).
    expect(screen.queryByText('DEVICE')).toBeNull()
    expect(screen.queryByText('COUNTDOWN TRANSCRIPT')).toBeNull()
    expect(screen.queryByText('READING LOG')).toBeNull()
    expect(screen.queryByText('STORED RECORDS')).toBeNull()
    expect(screen.queryByTestId('auto-finish-toggle')).toBeNull()
    expect(screen.queryByTestId('ambient-button')).toBeNull()
    expect(screen.getByTestId('capture-frame')).toBeTruthy()
    expect(screen.getByTestId('capture-latitude')).toBeTruthy()
    expect(screen.getByTestId('capture-countdown')).toBeTruthy()
    expect(screen.getByTestId('capture-button')).toBeTruthy()

    await runOutTheCountdown()

    // Recorded: the fuller view is back, so the transcript this trip exists to
    // produce is readable again the moment it is complete.
    expect(screen.getByText('DEVICE')).toBeTruthy()
    expect(screen.getByText('COUNTDOWN TRANSCRIPT')).toBeTruthy()
    expect(screen.getByTestId('capture-state')).toHaveTextContent('POINT #1 RECORDED')
  })

  it('goes back to acquiring when another reading is taken from the recorded state', async () => {
    await arriveWithAFix()
    await fireEvent.press(captureButton())
    await settle()
    await emitReadings([7, 6])
    await runOutTheCountdown()
    expect(screen.getByText('TAKE ANOTHER READING')).toBeTruthy()

    await fireEvent.press(captureButton())
    await settle()

    // A second acquisition, a second record, and the panels are hidden again.
    expect(mockRepo.createRecord).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('capture-state')).toHaveTextContent('SAVED — REFINING')
    expect(screen.queryByText('STORED RECORDS')).toBeNull()

    await runOutTheCountdown()
    expect(screen.getByTestId('capture-state')).toHaveTextContent('POINT #2 RECORDED')
  })

  it('offers a way out of the recorded state, to the only destination there is', async () => {
    await arriveWithAFix()
    await fireEvent.press(captureButton())
    await settle()
    await runOutTheCountdown()

    await fireEvent.press(screen.getByTestId('leave-button'))
    expect(mockPush).toHaveBeenCalledWith('/')
  })
})

describe('the live position readout', () => {
  it('shows the position beside the control and moves it as readings arrive', async () => {
    await arriveWithAFix()

    // Ready: the live reading.
    expect(screen.getByTestId('capture-latitude')).toHaveTextContent('-37.813600')
    expect(screen.getByTestId('capture-accuracy')).toHaveTextContent('±8.0 m')

    await fireEvent.press(captureButton())
    await settle()

    const beforeLat = screen.getByTestId('capture-latitude').props.children
    const beforeAccuracy = screen.getByTestId('capture-accuracy').props.children

    // A sharper reading, from a slightly different place. The readout shows the
    // running average — the position the override would actually store — so
    // both numbers have to move.
    await act(async () => {
      jest.advanceTimersByTime(1000)
      mockSource.emit({ ...reading(2, Date.now()), latitude: -37.8137, longitude: 144.9632 })
    })

    expect(screen.getByTestId('capture-latitude').props.children).not.toBe(beforeLat)
    expect(screen.getByTestId('capture-accuracy').props.children).not.toBe(beforeAccuracy)

    await runOutTheCountdown()

    // Recorded: what is on disk, not wherever the receiver has wandered since.
    const recordedLat = screen.getByTestId('capture-latitude').props.children
    await act(async () => {
      jest.advanceTimersByTime(1000)
      mockSource.emit({ ...reading(9, Date.now()), latitude: -37.9, longitude: 145.1 })
    })
    expect(screen.getByTestId('capture-latitude').props.children).toBe(recordedLat)
  })
})

describe('the capture frame', () => {
  it('says in words that the fix is saved, that it is being refined, and that the wait can be skipped', async () => {
    await arriveWithAFix()

    // Nothing captured yet: no claim either way.
    expect(screen.queryByTestId('capture-state')).toBeNull()

    await fireEvent.press(captureButton())
    await settle()

    // All three, in words rather than by colour or motion (doctrine rule 9).
    expect(screen.getByTestId('capture-state')).toHaveTextContent('SAVED — REFINING')
    expect(screen.getByText(/This reading is already saved\./)).toBeTruthy()
    expect(screen.getByText(/It is being refined now — stand still/)).toBeTruthy()
    expect(screen.getByText(/Or skip the wait: ACCEPT NOW keeps the fix exactly as measured so far\./)).toBeTruthy()

    await emitReadings([7, 6])
    await runOutTheCountdown()

    // And the finished point reads as finished, not as a stopped countdown.
    expect(screen.getByTestId('capture-state')).toHaveTextContent('POINT #1 RECORDED')
    expect(screen.getByText(/This position is final — it will not change again\./)).toBeTruthy()
  })

  it('pulses only while a countdown is running, and holds steady under reduced motion', async () => {
    // Reduced motion is the harness default (see jest.setup.js), so this is the
    // branch a user who asked the system for less motion gets: the ring is
    // rendered, at a fixed opacity, and no animation is started.
    // The ring is decorative and hidden from accessibility (it repeats what the
    // words already say), so the queries have to be told to look at hidden
    // elements — which is itself the assertion that it carries no meaning of
    // its own.
    await arriveWithAFix()
    expect(screen.queryByTestId('capture-pulse', HIDDEN)).toBeNull()

    await fireEvent.press(captureButton())
    await settle()

    const ring = screen.getByTestId('capture-pulse', HIDDEN)
    expect(ring.props.style.opacity).toBe(PULSE_STEADY_OPACITY)

    await runOutTheCountdown()
    expect(screen.queryByTestId('capture-pulse', HIDDEN)).toBeNull()
  })

  it('animates the frame when reduced motion is off, and leaves nothing running after', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false)

    await arriveWithAFix()
    await fireEvent.press(captureButton())
    await settle()

    // The animated ring, not the steady one: its opacity is the `Animated.Value`
    // the loop drives, which starts at the bottom of the range rather than at
    // the held middle. (The value itself does not move under Jest — the pulse
    // asks for the native driver, and the native animation module is mocked
    // here, so the JS-side value stays where the loop left it. What this
    // asserts is the branch, which is the part the reduced-motion setting
    // actually decides.)
    const ring = screen.getByTestId('capture-pulse', HIDDEN)
    expect(ring.props.style.opacity).toBe(PULSE_MIN_OPACITY)
    expect(ring.props.style.opacity).not.toBe(PULSE_STEADY_OPACITY)

    // The whole point of the teardown: a loop is infinite, so anything it has
    // scheduled must be gone once the countdown ends, or a field device
    // animates a frame nobody is looking at until the battery goes.
    await runOutTheCountdown()
    expect(screen.queryByTestId('capture-pulse', HIDDEN)).toBeNull()
    // A loop reschedules itself forever, so "the timer queue drains and stays
    // drained" is what proves it was actually stopped rather than merely
    // hidden. One one-shot callback outlives the countdown (React Native's
    // animation module flushes its own queue); two more turns of a very long
    // clock leave nothing at all.
    await act(async () => {
      jest.advanceTimersByTime(30_000)
    })
    expect(jest.getTimerCount()).toBe(0)
    await act(async () => {
      jest.advanceTimersByTime(30_000)
    })
    expect(jest.getTimerCount()).toBe(0)

    // Restored by hand rather than by `jest.restoreAllMocks()`, which would
    // also remove the file-wide reduced-motion default from jest.setup.js.
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true)
  })
})
