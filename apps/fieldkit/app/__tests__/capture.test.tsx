import React from 'react'
import { processColor } from 'react-native'
import { act, fireEvent, render, screen, within } from '@testing-library/react-native'
import { INPUT_AFFORDANCE_ORDER, ThemeProvider, isLocked, radiusForMetres } from '@corymbia/ui'
import { darkTheme, type as typeScale } from '@corymbia/tokens'
import {
  averageReadings,
  createFakeLocationSource,
  distanceMetres,
  gradeAccuracy,
  DUPLICATE_THRESHOLD_M,
  type Reading,
} from '@corymbia/geo'
import type { Fix, FieldRecord } from '@corymbia/data'

/**
 * Tests for the capture screen (spec §9.1–§9.4).
 *
 * WHAT IS AND IS NOT MOCKED, and why. The same division `diagnostics.test.tsx`
 * and `useCapture.test.ts` draw, for the same reasons.
 *
 * Not mocked: `averageReadings`, `holdVerdict`, `gradeAccuracy`, and
 * `useCapture` itself. The screen's job is to render the state machine's
 * output at the right size, in the right words and in the right place, and a
 * test against a stubbed hook could not tell whether the numbers on screen are
 * the numbers the override would actually store.
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

/**
 * The source the screen is currently holding, and how many times any instance
 * of it has been asked to `watch`.
 *
 * `createExpoLocationSource` is a `jest.fn` that builds a FRESH fake on every
 * call — matching what the real factory does — rather than a lazy arrow that
 * hands back the same object every time. `CaptureDeps` requires the screen to
 * pass a referentially stable `source`: a new identity re-requests permission
 * and resubscribes, four times a second during a countdown (see its doc
 * comment). A factory that always returned the same object could not tell a
 * stable ref pattern apart from an implementation that called the factory
 * inline on every render — both would end up handing `useCapture` an
 * identical-looking object. This factory can, because a broken caller now
 * produces a new source, and a new `watch` subscription, on every render.
 */
let mockSource: ReturnType<typeof createFakeLocationSource>
let watchCallCount = 0

const mockCreateSourceSpy = jest.fn(() => {
  const fake = createFakeLocationSource({ permission: 'granted', readings: [] })
  const tracked: ReturnType<typeof createFakeLocationSource> = {
    ...fake,
    async watch(onReading) {
      watchCallCount += 1
      return fake.watch(onReading)
    },
  }
  mockSource = tracked
  return tracked
})

jest.mock('@corymbia/geo', () => {
  const actual = jest.requireActual<typeof import('@corymbia/geo')>('@corymbia/geo')
  return {
    ...actual,
    // The one thing in this package that talks to a device. The averaging, the
    // grading and the hold verdict are all the real implementation.
    createExpoLocationSource: () => mockCreateSourceSpy(),
  }
})

const mockRepo = {
  createRecord: jest.fn(),
  refineRecordFix: jest.fn(),
  renameRecord: jest.fn(),
}

jest.mock('@corymbia/data', () => {
  const actual = jest.requireActual<typeof import('@corymbia/data')>('@corymbia/data')
  return {
    ...actual,
    createRecord: (...args: unknown[]) => mockRepo.createRecord(...args),
    refineRecordFix: (...args: unknown[]) => mockRepo.refineRecordFix(...args),
    renameRecord: (...args: unknown[]) => mockRepo.renameRecord(...args),
  }
})

/**
 * The router, mocked as an object rather than a fresh one per call.
 *
 * The screen's only navigation is the `recorded` state's way out, which until
 * Plan 5 builds the launcher is the gallery at `/`. Nothing here needs a real
 * navigation container, and mounting one would put the whole of expo-router's
 * layout machinery between these tests and the two lines they are about.
 */
const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
}

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
}))

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

/**
 * `let`, not `const`: the ready-guard test below sets this to `opening` for
 * its one render. Every other test leaves it alone, so it stays `ready` —
 * reset in `beforeEach` rather than trusted to be put back, so one test
 * changing it can never leak into the next.
 */
type MockStatus =
  | { state: 'opening'; error: null; applied: string[] }
  | { state: 'ready'; error: null; applied: string[] }
  | { state: 'failed'; error: Error; applied: string[] }
let mockStatus: MockStatus = { state: 'ready', error: null, applied: ['001_initial'] }

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
import CaptureScreen, { VERDICT_SENTENCE } from '../capture'

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

/**
 * Every record the mocked repository has handed out, by id.
 *
 * The three repository functions this screen reaches are not independent
 * fixtures: `refineRecordFix` and `renameRecord` change one column each of a
 * row `createRecord` already wrote, and the real implementations are explicit
 * about what they do *not* touch — `records.ts` names `capture_number` and
 * `captured_at` in both, and `record_capture_number_is_immutable` enforces the
 * first at the database. A fixture that minted a fresh capture number on every
 * refinement would hand the screen a tube label that changed halfway through a
 * capture, and a test asserting the recorded state's capture number would then
 * be asserting the fixture's arithmetic rather than the screen's.
 */
const mockRecords = new Map<string, FieldRecord>()

function recordFrom(fix: Fix): FieldRecord {
  mockCaptureNumber += 1
  const record: FieldRecord = {
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
  mockRecords.set(record.id, record)
  return record
}

/**
 * Applies a change to a stored record the way the repository does — in place,
 * on the row that is already there — or throws the way `refineRecordFix` and
 * `renameRecord` both do when the id names nothing.
 */
function amendRecord(id: string, change: Partial<FieldRecord>): FieldRecord {
  const existing = mockRecords.get(id)
  if (!existing) throw new Error(`Record ${id} does not exist in the fixture.`)
  const amended: FieldRecord = { ...existing, ...change }
  mockRecords.set(id, amended)
  return amended
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
  mockRecords.clear()
  mockStatus = { state: 'ready', error: null, applied: ['001_initial'] }
  mockCreateSourceSpy.mockClear()
  watchCallCount = 0
  mockRouter.push.mockClear()
  mockRouter.replace.mockClear()
  mockRouter.back.mockClear()

  mockRepo.createRecord.mockReset()
  mockRepo.refineRecordFix.mockReset()
  mockRepo.renameRecord.mockReset()
  mockRepo.createRecord.mockImplementation((_db: unknown, input: { fix: Fix }) =>
    Promise.resolve(recordFrom(input.fix)),
  )
  // Mirrors the real `refineRecordFix`'s `{ record, applied }` shape
  // (`packages/data`); the guard itself is proved against real SQL in
  // `records.test.ts`, and the default here always applies, which is what
  // this screen's own tests want unless one specifically overrides it.
  mockRepo.refineRecordFix.mockImplementation(
    (_db: unknown, input: { recordId: string; fix: Fix }) =>
      Promise.resolve({ record: amendRecord(input.recordId, { fix: input.fix }), applied: true }),
  )
  mockRepo.renameRecord.mockImplementation(
    (_db: unknown, input: { recordId: string; title: string | null }) =>
      Promise.resolve(amendRecord(input.recordId, { title: input.title })),
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
  //
  // The theme is pinned to dark — the product default (spec §5.2) — rather
  // than left to resolve from the system colour scheme, which in a headless
  // environment answers light. The traffic light's border colour is asserted
  // below, and that assertion has to be a statement about the frame rather
  // than about what the test host reports.
  const view = await render(
    <ThemeProvider initial="dark">
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
 * Ends the countdown the way her hand does — the same one control, which in the
 * acquiring state reads `ACCEPT NOW`.
 */
async function acceptNow() {
  await fireEvent.press(captureButton())
  await settle()
}

/** The recorded state's way back to `ready`, which is the same control again. */
async function takeAnotherReading() {
  await fireEvent.press(captureButton())
  await settle()
}

/**
 * The flat accuracy that produces a plateau, in metres, and the sample count
 * `holdVerdict` requires before it may claim one. Both are lifted verbatim
 * from `useCapture.test.ts`, including the reason 0.8 is not a rounder number:
 * with uniform readings the crossing point depends only on the accuracy, and
 * from about 4.4 m upward the guarded crossing and the unguarded one coincide
 * — so a test written with 8 m, where both land at n=11, would pass
 * identically against a build with no minimum-sample guard at all. See that
 * file's `FLAT_M` for the computed table.
 */
const FLAT_M = 0.8
const MIN_SAMPLES = 10

/**
 * Stands still until the fix stops improving, which is how a capture normally
 * finishes (spec §9.1.5): the tap's own reading is sample one, so nine more
 * reach the minimum. Nine seconds of readings against a fifteen-second cap, and
 * the override is never touched, so a countdown that ends here ended on the
 * plateau or not at all.
 */
async function standStillUntilItSettles(accuracyM = FLAT_M) {
  for (let i = 0; i < MIN_SAMPLES - 1; i += 1) {
    await emit(accuracyM)
  }
  await settle()
}

/**
 * The accuracy a flat hold of `MIN_SAMPLES` readings at `accuracyM` actually
 * reports, through the real `averageReadings` — the number the completion is
 * judged against, rather than one typed in here.
 */
function averagedOverAFlatHold(accuracyM: number): number {
  return averageReadings(
    Array.from({ length: MIN_SAMPLES }, (_, i) => reading(accuracyM, START_MS + i * 1000)),
  ).accuracyM
}

/**
 * A flat hold whose plateau lands ABOVE the crosshair — the settled
 * completion, and the ordinary case in the field.
 *
 * 6 m is not arbitrary: with uniform readings `averageReadings` reports
 * `max(σ/√n, σ/3)`, so a flat hold at 6 m settles at 2.0 m — a good fix by
 * `gradeAccuracy` (under 5 m) sitting well outside a crosshair pinned to
 * 1.4 m, which is exactly the mismatch the settled level exists for.
 */
const SETTLES_SHORT_M = 6

/**
 * The dial's own subtree.
 *
 * `CaptureDial` carries its own `capture-dial` testID on its root view, so
 * this scopes directly to it rather than to `capture-frame`, the screen's
 * wrapper `View` around it. Scoping to the wrapper was only ever correct
 * while it stayed a single-child container: the moment a sibling was placed
 * beside the dial in there, "inside `capture-frame`" would stop meaning
 * "inside the dial with the button", the very defect §9.1.2 names. Scoping to
 * the dial's own testID is immune to that — it is the dial's rendering, not a
 * container that merely happens to be named after it, whatever else is later
 * placed beside it.
 */
function insideTheDial() {
  return within(screen.getByTestId('capture-dial'))
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
    //
    // The help affordance is excluded by testID rather than by loosening the
    // count, and the distinction is not a convenience: §9.1.4 is about actions
    // on the survey — things that write, or that end a wait — and `?` does
    // neither. It opens an explanation and closes again, leaving the record
    // exactly as it was. Excluding it by name keeps this assertion's teeth: a
    // second capture action added here still fails, because it would not carry
    // that testID.
    const actions = screen
      .getAllByRole('button')
      .filter((node) => node.props.testID !== 'capture-help')
    expect(actions).toHaveLength(1)
    expect(captureButton()).toHaveTextContent('CAPTURE')
    expect(screen.queryByText('ACCEPT NOW')).toBeNull()
  })

  it('carries the screen’s help affordance, which the countdown then takes away', async () => {
    await arriveWithAFix()

    // Doctrine rule 7: a tappable help affordance per screen, and it must open
    // something rather than reveal itself on hover — there is no hover in a
    // paddock. Asserted through the modal it opens, not merely its presence:
    // a `?` that renders and does nothing satisfies presence and fails the rule.
    await fireEvent.press(screen.getByTestId('capture-help'))
    expect(screen.getByText('Capturing a point')).toBeTruthy()
    // A phrase that exists nowhere but the help body, so this cannot pass on
    // the ready state's own line about standing still.
    expect(screen.getByText(/readings agree with each other/)).toBeTruthy()
    await fireEvent.press(screen.getByText('Got it'))

    // And doctrine rule 17's exemption, which is the reason this is asserted
    // rather than assumed: *acquiring* collapses to a single-focus view where
    // nothing else is on screen, and a `?` beside the two numbers she is
    // standing still for is exactly the "else". Recorded in `docs/ui-doctrine.md`
    // as a granted exemption, so a later reader does not read its absence as an
    // oversight and "fix" it.
    await tap()
    expect(screen.queryByTestId('capture-help')).toBeNull()
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

  it('renders the dial, which replaced the rectangular frame', async () => {
    await arriveWithAFix()
    await tap()

    // `CaptureDial` (spec §9.2) is the whole reason this screen changed: the
    // rectangular traffic-light frame and its `TrafficLightFrame`/
    // `CaptureFramePerimeter` are gone from here, replaced by the one
    // circular control that draws the clock, the accuracy and the crosshair
    // together.
    expect(screen.getByTestId('capture-dial')).toBeTruthy()
    expect(screen.queryByTestId('traffic-light-border')).toBeNull()
    expect(screen.queryByTestId('perimeter')).toBeNull()
  })

  it('renders the accuracy larger than anything else on the screen, and the seconds no longer compete with it', async () => {
    await arriveWithAFix()
    await tap()

    // Spec §9.4, as the dial changed it: the accuracy is the number she is
    // standing still for, and it is the largest thing on the screen — legible
    // at arm's length, in glare, without leaning in. The seconds are no
    // longer sized to match it, because §9.2's ring now answers "how much
    // longer" without being read — two numbers at the same size compete, one
    // number and a moving ring do not. The size is asserted, not the mere
    // presence of the text: the diagnostics prototype showed both numbers at
    // the same weight as its other instrument readouts and still got this
    // wrong.
    expect(screen.getByTestId('capture-accuracy').props.style.fontSize).toBe(typeScale.hero.size)
    expect(screen.getByTestId('capture-seconds').props.style.fontSize).not.toBe(typeScale.hero.size)

    // And everything else in the state is subordinate to the accuracy, which
    // is the half of §9.4 a size assertion on its own would not catch. Swept
    // across every rendered string rather than enumerated by testID, so an
    // unlabelled element promoted to hero size is caught too, not only a
    // regression on the one this screen happens to have today.
    const heroSized = screen
      .getAllByText(/./)
      .filter((node) => node.props.style?.fontSize === typeScale.hero.size)
    expect(heroSized).toHaveLength(1)
  })

  /**
   * WHAT THE TWO NUMBERS SAY, not merely how big they are.
   *
   * Their font size and their containment were asserted and their *content*
   * was not, anywhere. Changing `capture.preview?.accuracyM` to
   * `capture.latest?.accuracyM` on the screen — a one-word edit, and the
   * plausible-looking one — left the whole suite passing while the readout
   * showed the raw bouncing single reading instead of the number the override
   * would store, and the traffic light, deriving from the same variable,
   * graded the wrong number with it. That is the exact confusion this design
   * exists to prevent.
   *
   * The fixture is chosen so the two answers differ in both channels: the
   * accumulated fix is ±3.7 m and good, the latest single reading is ±6.0 m
   * and fair.
   */
  describe('the two numbers, by value', () => {
    /** The samples the countdown has accumulated after `standStillBriefly`. */
    const COLLECTED = [
      reading(8, START_MS),
      reading(6, START_MS + 1000),
      reading(6, START_MS + 2000),
    ]

    async function standStillBriefly() {
      await arriveWithAFix(8)
      await tap()
      await emit(6)
      await emit(6)
    }

    it('prints the accuracy the override would store, not the latest single reading', async () => {
      await standStillBriefly()

      // Computed through the real `averageReadings` over the exact samples
      // the countdown collected, as the recorded-state test does, rather than
      // a number typed in here.
      const { accuracyM } = averageReadings(COLLECTED)
      expect(readoutText('capture-accuracy')).toBe(`±${accuracyM.toFixed(1)} m`)

      // And the two candidates really are different numbers, which is what
      // gives the assertion above its teeth.
      expect(`±${accuracyM.toFixed(1)} m`).not.toBe('±6.0 m')
    })

    it('grades that same number, in the word and in the dial colour', async () => {
      await standStillBriefly()

      // The grade derives from the accuracy above, so a readout showing the
      // wrong number grades the wrong number too. Both channels of doctrine
      // rule 9 are asserted: the word, and the colour behind it — the dial's
      // accuracy circle, which is drawn stroked and filled in the grade
      // colour (CaptureDial.tsx).
      const { accuracyM } = averageReadings(COLLECTED)
      expect(gradeAccuracy(accuracyM)).toBe('good')
      // The latest single reading grades differently, so this cannot pass
      // against a screen reading from the wrong variable.
      expect(gradeAccuracy(6)).toBe('fair')

      expect(screen.getByText('GOOD FIX')).toBeTruthy()
      expect(screen.queryByText('FAIR FIX')).toBeNull()
      // react-native-svg lowers a colour prop to its processed native form
      // (`{ type, payload }`) rather than leaving the token string intact —
      // the same shape `CaptureDial.test.tsx` itself asserts against.
      expect(screen.getByTestId('dial-accuracy').props.stroke).toEqual({
        type: 0,
        payload: processColor(darkTheme.colors.statusGood),
      })
    })

    it('counts the seconds down from the cap, in whole seconds', async () => {
      await standStillBriefly()

      // Two seconds of readings against the fifteen-second cap. Pinned to the
      // exact string: `TIME LEFT` is one of the two numbers she is standing
      // still for, and a readout that showed the elapsed time instead — or
      // the cap, unmoved — would satisfy any assertion weaker than this.
      expect(readoutText('capture-seconds')).toBe('13s')
    })

    it('draws the countdown ring while the wait runs, and at no other time', async () => {
      await arriveWithAFix(8)
      // The dial is live at all times (its track, `dial-ring-track`, is
      // always there) but a countdown is not, so there is no progress stroke
      // resting on it before the tap.
      expect(screen.queryByTestId('dial-ring-progress')).toBeNull()

      await tap()
      expect(screen.getByTestId('dial-ring-progress')).toBeTruthy()

      await acceptNow()
      expect(screen.queryByTestId('dial-ring-progress')).toBeNull()
    })

    /**
     * FEEDS THE RING THE CONTINUOUS FRACTION, NOT THE CEIL-ED SECONDS.
     *
     * `useCapture`'s own doc comment on `remainingFraction` names the exact
     * defect this guards against: a ring fed `secondsRemaining / secondsTotal`
     * — a rounded-up integer over a constant — changes at 1 Hz while the
     * ticker underneath it runs at 4 Hz, so it would advance in fifteen
     * discrete jumps on the fifteen-second cap and never reach empty, because
     * the smallest value it would ever take is one fifteenth before the phase
     * flips and the ring unmounts. That defect already shipped once on this
     * branch and was found on hardware.
     *
     * So this asserts the ring actually moves inside a single whole second,
     * where a build fed the ceil-ed seconds would show no change at all: two
     * samples 250 ms apart, neither crossing a whole-second boundary from a
     * tap started exactly on one (`START_MS`), so `secondsRemaining` reports
     * 15 at both. The dial's own `strokeDashoffset` (dialGeometry.ts's
     * `ringDash`) is what encodes `remaining`, so a difference there is a
     * difference in what the screen fed the dial.
     *
     * The first sample is taken 250 ms after the tap rather than at the tap
     * itself: at the instant of the tap `remaining` is exactly 1, where
     * `ringDash`'s `dashoffset` is exactly 0 — and react-native-svg folds a
     * `strokeDashoffset` of exactly 0 away on the native host props it hands
     * to the test renderer (documented on `CaptureDial.test.tsx`'s own
     * `strokeDashoffset` test, which hits the same edge for the same reason).
     * Reading at that instant would be asserting about the fold, not about
     * `remaining`.
     */
    it('feeds the ring the continuous fraction, not the whole seconds beside it', async () => {
      await arriveWithAFix(8)
      await tap()

      function ringDashoffset(): number {
        const value: unknown = screen.getByTestId('dial-ring-progress').props.strokeDashoffset
        if (typeof value !== 'number') {
          throw new Error(
            `Expected dial-ring-progress's strokeDashoffset to be a number, got ${typeof value}.`,
          )
        }
        return value
      }

      // A quarter of a second in, well inside the same whole second the tap
      // started in — `secondsRemaining` cannot have moved.
      await act(async () => {
        jest.advanceTimersByTime(250)
      })
      const atFirstTick = ringDashoffset()
      expect(readoutText('capture-seconds')).toBe('15s')

      // A second quarter-second tick, still inside the same whole second.
      await act(async () => {
        jest.advanceTimersByTime(250)
      })
      expect(readoutText('capture-seconds')).toBe('15s')

      // The ring, fed the continuous fraction, has moved anyway.
      expect(ringDashoffset()).not.toBe(atFirstTick)
    })
  })

  it('says the verdict in the words the spec pins, while the fix is still improving', async () => {
    await arriveWithAFix()
    await tap()
    await emit(7)

    expect(screen.getByTestId('capture-verdict')).toHaveTextContent(VERDICT_SENTENCE.improving)
  })

  it('pins both verdict sentences to spec §9.3, word for word', () => {
    // A `plateaued` verdict during a countdown is committed for exactly one
    // frame — `useCapture`'s plateau effect ends the countdown in the same
    // flush that first reports it, so under `act` (which drains effects
    // before returning) no render can ever be caught showing it live. §9.1.5
    // has since withdrawn the idea of a live plateau announcement anyway: the
    // fact reaches her in the `recorded` phase, not here. So this asserts the
    // sentences directly against the export, which is the same ground a
    // render would cover without mocking `useCapture` to force one.
    expect(VERDICT_SENTENCE.improving).toBe('Still improving — keep standing still.')
    expect(VERDICT_SENTENCE.plateaued).toBe(
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
    //
    // Pinned to the exact digit, through the real `averageReadings` over the
    // exact samples the countdown collected. `/sharper than the tap/` on its
    // own also matched the floor branch's "no sharper than the tap yet", so a
    // build that printed a hard-coded 0.0 satisfied it.
    const { accuracyM } = averageReadings([
      reading(12, START_MS),
      reading(2, START_MS + 1000),
      reading(2, START_MS + 2000),
    ])
    const improvement = readoutText('capture-improvement')
    expect(improvement).toBe(`${(12 - accuracyM).toFixed(1)} m sharper than the tap`)
    expect(improvement).not.toMatch(/[+-]/)
  })

  it('claims no improvement at all when there is none worth claiming', async () => {
    // The other branch of the same readout, and the only thing that exercises
    // `IMPROVEMENT_FLOOR_M`. A tap that was already sharp followed by a
    // reading two orders of magnitude worse moves the combined accuracy by
    // about a ten-thousandth of a metre: real, and below the tenth of a metre
    // the readout can print. Saying "0.0 m sharper than the tap" there is a
    // claim of improvement dressed as none.
    await arriveWithAFix(2)
    await tap()
    await emit(200)

    const { accuracyM } = averageReadings([reading(2, START_MS), reading(200, START_MS + 1000)])
    // The fixture really is inside the floor, asserted rather than assumed —
    // otherwise a change to either number could leave this quietly testing
    // the numeric branch again.
    expect(2 - accuracyM).toBeGreaterThan(0)
    expect(2 - accuracyM).toBeLessThan(0.05)
    expect(readoutText('capture-improvement')).toBe('no sharper than the tap yet')
  })

  it('shows the spread beside it, which is the number that does worsen', async () => {
    await arriveWithAFix()
    await tap()

    // One reading has no disagreement to report, which is not a disagreement of
    // zero — so the readout says so rather than printing ±0.0 m.
    expect(screen.getByTestId('capture-spread')).toHaveTextContent(/one reading/)
    expect(readoutText('capture-samples')).toBe('1 reading averaged')

    // A second reading from about 11 m up the paddock. The accuracy improves
    // regardless; only the spread can say the two readings disagree about where
    // she is standing, which is why §9.3 puts it beside the improvement.
    await emit(8, -37.8137)

    expect(readoutText('capture-improvement')).toMatch(/sharper than the tap/)
    expect(readoutText('capture-samples')).toBe('2 readings averaged')
    // Pinned to the exact digit computed through the real `averageReadings`,
    // as the hook's own test does, rather than `/±5\.\d m apart/`: that
    // pattern also matches ±5.7 m, this fixture's combined accuracy, so an
    // implementation printing accuracy where spread belongs would pass it.
    const { spreadM: expectedSpreadM } = averageReadings([
      reading(8, START_MS),
      reading(8, START_MS + 1000, -37.8137),
    ])
    expect(readoutText('capture-spread')).toBe(`readings ±${expectedSpreadM.toFixed(1)} m apart`)
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
    // height, where non-scrolling content taller than the viewport clips and
    // takes the control off the bottom with it. `flexGrow: 1` fixes that
    // regardless of `justifyContent`: when the children overflow the
    // container grows to fit them and there is no free space left to justify.
    const style: unknown = screen.getByTestId('capture-scroll').props.contentContainerStyle
    expect(style).toMatchObject({ flexGrow: 1 })

    // `justifyContent` is what §5.4 actually cares about, and it is not
    // ambiguous: controls are bottom-anchored on every screen, not centred.
    // `center` and `flex-end` have identical overflow behaviour (the comment
    // above), so this is the assertion that actually tells them apart.
    expect(style).toMatchObject({ justifyContent: 'flex-end' })

    // And the control the countdown is for has to actually be inside the
    // thing that scrolls, not merely a sibling of it — a check the style
    // assertion above cannot make on its own.
    expect(within(screen.getByTestId('capture-scroll')).getByTestId('capture-button')).toBeTruthy()
  })
})

describe('the lock (spec §9.2.1)', () => {
  // TARGET_METRES (dialGeometry.ts) is 1.4 m — the measured floor this
  // hardware reaches — so a reading at or below it is `isLocked`'s own
  // definition of locked, computed by the screen exactly as the brief
  // requires: `isLocked(radiusForMetres(accuracyM))`.
  const LOCKED_M = 1.0
  // Comfortably outside it — the ordinary "still converging" case every
  // other test in this file already exercises via `arriveWithAFix()`'s
  // default of 8 m.
  const NOT_LOCKED_M = 8

  it('adds the word to the grade chip once the fix has converged onto the crosshair', async () => {
    await arriveWithAFix(LOCKED_M)
    await tap()

    // Doctrine rule 9: colour and motion never carry the lock alone. This is
    // the one channel that survives in glare or for a colour-blind reader.
    expect(screen.getByText('GOOD FIX')).toBeTruthy()
    expect(readoutText('capture-lock-label')).toBe('· LOCKED ON')
  })

  it('says nothing of the kind before the fix has converged', async () => {
    await arriveWithAFix(NOT_LOCKED_M)
    await tap()

    expect(screen.queryByTestId('capture-lock-label')).toBeNull()
  })

  it('is computed by the screen, not the dial, from the same accuracy the readout prints', async () => {
    // The independent check that this is really `isLocked(radiusForMetres(...))`
    // rather than a threshold reinvented at the call site: 1.4 m is
    // `TARGET_METRES` exactly, and `isLocked` includes its own boundary
    // (`radiusPx <= TARGET_RADIUS_PX`), so a tap landing exactly on the
    // measured floor locks.
    await arriveWithAFix(1.4)
    await tap()

    expect(readoutText('capture-lock-label')).toBe('· LOCKED ON')
  })

  it('stays unlocked in the ready state, even when the live reading is already sharp enough', async () => {
    // The lock means "this capture has converged as far as this receiver
    // takes it" — and in the ready state there is no capture to have
    // converged. `LOCKED_M` is sharp enough that `isLocked(radiusForMetres(...))`
    // is true on the raw distance test alone (the test above proves exactly
    // that, once a capture is under way), so this is not a test that the
    // fixture fails to reach the threshold — it is a test that the ready
    // state suppresses the lock's treatment regardless.
    await arriveWithAFix(LOCKED_M)

    // No tap: still in the ready state, `CAPTURE` still the one live control.
    expect(captureButton()).toHaveTextContent('CAPTURE')

    expect(screen.queryByTestId('capture-lock-label')).toBeNull()
    // And the dial's own accessibility fact — the channel that survives
    // independently of colour and motion — agrees: not merely "no word
    // rendered" but "the dial itself was told it is not locked".
    expect(screen.getByTestId('capture-dial').props.accessibilityValue).toEqual({
      text: 'Not locked',
    })
  })
})

describe('the adjacency requirement (spec §9.1.2)', () => {
  it('keeps every readout that responds to the countdown inside the dial with the button', async () => {
    await arriveWithAFix()
    await tap()
    await emit(7)

    // THIS IS THE POINT OF THE WHOLE SINGLE-CONTROL DESIGN. On the superseded
    // press-and-hold screen her thumb was on the button while the only part of
    // the screen that moved was somewhere else entirely, and §9.1.2 makes the
    // fix a requirement rather than a layout preference: a design that puts the
    // countdown readout in a panel above the control has not implemented that
    // section. It survived the dial's own redesign unchanged.
    //
    // So this asserts descendancy, not presence. Every one of these readouts
    // responds during a countdown, and each must be inside the dial's own
    // block that also holds the control.
    const dial = insideTheDial()
    for (const testID of [
      'capture-accuracy',
      'capture-seconds',
      'capture-samples',
      'capture-improvement',
      'capture-spread',
      'capture-verdict',
      'capture-button',
    ]) {
      expect(dial.getByTestId(testID)).toBeTruthy()
    }
  })

  it('keeps the lock label inside the dial too, when the fix has converged onto it', async () => {
    // TARGET_METRES (dialGeometry.ts) is 1.4 m — a tap this sharp is already
    // locked from the moment the reading arrives, with no averaging needed:
    // one reading through `averageReadings` is a no-op on the numbers.
    await arriveWithAFix(1.0)
    await tap()

    // The lock label responds to the same accuracy the rest of the countdown
    // readout does — it can appear or disappear as the fix moves — so §9.1.2
    // reaches it exactly as it reaches the others.
    expect(insideTheDial().getByTestId('capture-lock-label')).toBeTruthy()
  })

  it('keeps the coordinates outside it, because they are context and not the wait', async () => {
    await arriveWithAFix()
    await tap()
    await emit(7)

    // The other half of §9.1.2, and the half nothing asserted: the dial is
    // for what answers *how good is it* and *how much longer*. The
    // coordinates are context about the receiver — its current reading, not
    // the fix under construction — and §9.4 puts them outside deliberately.
    // Moving them in passed every test in this file.
    expect(screen.getByTestId('capture-latitude')).toBeTruthy()
    const dial = insideTheDial()
    expect(dial.queryByTestId('capture-latitude')).toBeNull()
    expect(dial.queryByTestId('capture-longitude')).toBeNull()
  })
})

describe('the location source (spec §9.1, CaptureDeps)', () => {
  it('is constructed once and kept stable across a countdown re-rendering four times a second', async () => {
    await arriveWithAFix()
    await tap()

    // The ticker (`useCapture`'s `TICK_MS`) re-renders the screen four times a
    // second for the whole of a countdown, and `CaptureDeps` requires `source`
    // to survive every one of those renders: a new identity re-requests the
    // permission and resubscribes. Advancing three seconds of fake ticks, on
    // top of the readings below, is enough re-renders to catch a source
    // reconstructed inline rather than held in a ref.
    await act(async () => {
      jest.advanceTimersByTime(3000)
    })
    for (const accuracyM of [7, 6, 5]) {
      await emit(accuracyM)
    }

    expect(mockCreateSourceSpy).toHaveBeenCalledTimes(1)
    expect(watchCallCount).toBe(1)
  })
})

describe('the recorded state (spec §9.6, doctrine rule 17)', () => {
  it('reads as finished: the capture number, the final accuracy and what made it', async () => {
    await arriveWithAFix(8)
    await tap()
    await emit(6)
    await acceptNow()

    // Doctrine rule 17: *recorded* is a state that reads as finished — what was
    // saved, its final accuracy, and that it will not change again — not a
    // countdown that stopped.
    expect(readoutText('capture-recorded')).toBe('CAPTURE 1')

    // The FINAL accuracy, which is the refinement's and not the tap's. Computed
    // here through the real `averageReadings` over the same two readings the
    // countdown collected, so a screen that printed the tap's ±8.0 m — the
    // number that was on screen a moment earlier, and the easy mistake — fails.
    const { accuracyM } = averageReadings([
      reading(8, START_MS),
      reading(6, START_MS + 1000),
    ])
    expect(readoutText('capture-recorded-accuracy')).toBe(`±${accuracyM.toFixed(1)} m`)
    expect(readoutText('capture-recorded-samples')).toBe('2 readings averaged')

    // And the two ways onward (doctrine rule 17): capture again, or leave.
    expect(captureButton()).toHaveTextContent('TAKE ANOTHER READING')
    expect(screen.getByTestId('capture-leave')).toBeTruthy()
  })

  it('names where the capture went', async () => {
    await arriveWithAFix()
    await tap()
    await acceptNow()

    // `useCapture` files every capture to the Inbox, which §10.2 treats as a
    // supported destination rather than an error state. Naming it is the
    // point: a state that reads as finished has to say where the thing it
    // finished with has gone, and this is the line Plan 5 turns into the
    // activity name §9.6 asks for.
    expect(readoutText('capture-recorded-destination')).toBe(
      'Saved to the Inbox. You can file it from there later.',
    )
  })

  it('scrolls too, so its two ways onward cannot fall below the fold in landscape', async () => {
    await arriveWithAFix()
    await tap()
    await acceptNow()

    // This state carries considerably more than the acquiring one, and a
    // phone in landscape has roughly 360dp of height. `flexGrow: 1` is what
    // stops content taller than the viewport clipping; `justifyContent` is
    // §5.4's bottom anchoring, which has the same overflow behaviour as
    // centring and so needs asserting separately.
    const style: unknown = screen.getByTestId('capture-recorded-scroll').props.contentContainerStyle
    expect(style).toMatchObject({ flexGrow: 1, justifyContent: 'flex-end' })
    expect(
      within(screen.getByTestId('capture-recorded-scroll')).getByTestId('capture-leave'),
    ).toBeTruthy()
  })

  it('names how the wait ended when she ended it herself', async () => {
    await arriveWithAFix()
    await tap()
    await acceptNow()

    expect(screen.getByTestId('capture-message')).toHaveTextContent('You accepted it early.')
  })

  it('names a plateau here, which is the only place it is ever said', async () => {
    await arriveWithAFix(FLAT_M)
    await tap()
    await standStillUntilItSettles()

    // Spec §9.1.5, corrected: the countdown ending itself on a plateau is the
    // NORMAL way a capture finishes, and the screen deliberately does not
    // announce it live — the render that first reports `plateaued` is the same
    // one that ends the countdown, so on a device the announcement would exist
    // for about a frame. This state is therefore the only place that fact ever
    // reaches her, which is why it is asserted here and nowhere else.
    expect(mockRepo.refineRecordFix).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('capture-message')).toHaveTextContent(
      'The fix stopped improving, so the countdown finished itself.',
    )
  })

  it('takes another reading back to the ready state, with its panels gone again', async () => {
    await arriveWithAFix()
    await tap()
    await acceptNow()
    expect(screen.getByTestId('capture-recorded')).toBeTruthy()

    await takeAnotherReading()

    // Doctrine rule 17 is a round trip, not a one-way transition: the recorded
    // panels have to go away again, or the screen has grown widgets rather than
    // changed mode.
    expect(captureButton()).toHaveTextContent('CAPTURE')
    expect(screen.queryByTestId('capture-recorded')).toBeNull()
    expect(screen.queryByTestId('capture-affordances')).toBeNull()
    expect(screen.queryByTestId('capture-leave')).toBeNull()
  })

  it('leaves to the gallery, which is where the launcher will be', async () => {
    await arriveWithAFix()
    await tap()
    await acceptNow()

    await fireEvent.press(screen.getByTestId('capture-leave'))

    // Plan 5 builds the launcher; until then `/` is the gallery, and it is the
    // only route this screen knows.
    expect(mockRouter.replace).toHaveBeenCalledWith('/')
  })
})

describe('the four affordances (spec §9.6)', () => {
  it('shows all four, in the one order used everywhere in the application', async () => {
    await arriveWithAFix()
    await tap()
    await acceptNow()

    const tiles = within(screen.getByTestId('capture-affordances')).getAllByTestId(
      /^affordance-[a-z]+$/,
    )
    // §9.6, verbatim: "location (already complete), title, voice note, photo.
    // Identical icons, identical order, everywhere in the application."
    expect(tiles.map((tile) => tile.props.testID)).toEqual([
      'affordance-location',
      'affordance-title',
      'affordance-voice',
      'affordance-photo',
    ])

    // And the three this screen shares with `InputAffordanceRow` are in the
    // same relative order as that component's own canonical list — doctrine
    // rule 5's "in the same order" is a claim about the whole application, so
    // it is asserted against the exported constant rather than against a
    // literal repeated here. A screen that reordered its tiles would satisfy
    // the literal above only by being edited to match, and this one not at all.
    const shared = INPUT_AFFORDANCE_ORDER.filter((kind) => kind !== 'description')
    expect(tiles.map((tile) => tile.props.testID)).toEqual([
      'affordance-location',
      ...shared.map((kind) => `affordance-${kind}`),
    ])
  })

  it('has voice and photo present and disabled, and says when they arrive', async () => {
    await arriveWithAFix()
    await tap()
    await acceptNow()

    // There is no media table, so building these would mean inventing storage.
    // Present-and-disabled is the honest state: she can see that the app knows
    // about them and that they are not available yet (doctrine rule 3 — every
    // level of disclosure is a legitimate stopping point, and a level that is
    // not built must not pretend otherwise).
    expect(screen.getByTestId('affordance-voice')).toBeDisabled()
    expect(screen.getByTestId('affordance-photo')).toBeDisabled()
    expect(screen.getByTestId('capture-media-pending')).toHaveTextContent(/media capture/)

    // The one that is real must not be swept up in the same disablement.
    expect(screen.getByTestId('affordance-title')).not.toBeDisabled()
  })

  it('gives the saved point a name, through the repository that writes the event', async () => {
    await arriveWithAFix()
    await tap()
    await acceptNow()

    await fireEvent.press(screen.getByTestId('affordance-title'))
    await fireEvent.changeText(screen.getByTestId('capture-title-input'), '  Frog pond outflow  ')
    await fireEvent.press(screen.getByTestId('capture-title-save'))
    await settle()

    // The record's own id, not the capture number and not a fresh one: a rename
    // that addressed the wrong row would title someone else's pin, and
    // `renameRecord` writes an append-only `'edited'` event either way.
    expect(mockRepo.renameRecord).toHaveBeenCalledTimes(1)
    expect(mockRepo.renameRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recordId: 'record-1', title: 'Frog pond outflow' }),
    )

    // And the tile now reads as complete, which is doctrine rule 9's two
    // channels rather than a colour change: the label itself changes.
    expect(screen.getByTestId('affordance-title-label')).toHaveTextContent('Title ✓')
  })

  it('says the name was not saved, and that the point itself is safe', async () => {
    // A rename writes through the same append-only event log as everything
    // else that happens to a record, in a transaction, and it can fail. What
    // must not be lost in that failure is that the *point* is fine: the title
    // is the one thing at risk, and "the name was not saved" and "the capture
    // was lost" are materially different sentences to read standing in a
    // paddock.
    mockRepo.renameRecord.mockImplementation(() =>
      Promise.reject(new Error('database is locked')),
    )

    await arriveWithAFix()
    await tap()
    await acceptNow()

    await fireEvent.press(screen.getByTestId('affordance-title'))
    await fireEvent.changeText(screen.getByTestId('capture-title-input'), 'Frog pond outflow')
    await fireEvent.press(screen.getByTestId('capture-title-save'))
    await settle()

    expect(screen.getByTestId('capture-title-error')).toHaveTextContent(
      'The name was not saved: database is locked. The point itself is safe.',
    )
    // The record is untouched and the tile has not claimed a title it does
    // not have.
    expect(screen.queryByTestId('capture-title-value')).toBeNull()
    expect(screen.getByTestId('affordance-title-label')).toHaveTextContent('Title')
    expect(screen.getByTestId('affordance-title-label')).not.toHaveTextContent('✓')
    // And the control is live again, so the failure is recoverable rather
    // than a dead end.
    expect(screen.getByTestId('capture-title-save')).not.toBeDisabled()
  })
})

describe('the duplicate guard (spec §9.5, doctrine rule 4)', () => {
  /**
   * Captures a point, ends the wait early, and goes back to ready — so the next
   * capture has a previous point to be compared against.
   */
  async function captureAPoint(latitude?: number) {
    await emit(8, latitude)
    await tap()
    await acceptNow()
  }

  /** The latitude every other point in this block is measured from. */
  const ORIGIN = { latitude: -37.8136, longitude: 144.9631 }

  /** How far a point at `latitude` is from that origin, in metres. */
  function metresFromOrigin(latitude: number): number {
    return distanceMetres(ORIGIN, { latitude, longitude: ORIGIN.longitude })
  }

  /**
   * Two latitudes that straddle `DUPLICATE_THRESHOLD_M`, and the reason they
   * are not round numbers: **the threshold has to be what decides the
   * outcome.** The first version of these tests captured twice at the same
   * coordinate, 0.0 m apart, where no change to the threshold — 1 m, 50 m —
   * could make the pair behave differently. This is the test that has to exist
   * before the 5 m figure can be revisited on field evidence, so it is written
   * to fail when that figure moves by a metre in either direction.
   *
   * About 4.4 m and about 6.1 m from the origin, north of it, at the same
   * longitude. Asserted below rather than trusted.
   */
  const JUST_INSIDE = -37.81356
  const JUST_OUTSIDE = -37.813545

  it('brackets the threshold, so a change to it cannot leave these tests testing the same case', () => {
    expect(metresFromOrigin(JUST_INSIDE)).toBeLessThan(DUPLICATE_THRESHOLD_M)
    expect(metresFromOrigin(JUST_INSIDE)).toBeGreaterThan(DUPLICATE_THRESHOLD_M - 1)
    expect(metresFromOrigin(JUST_OUTSIDE)).toBeGreaterThan(DUPLICATE_THRESHOLD_M)
    expect(metresFromOrigin(JUST_OUTSIDE)).toBeLessThan(DUPLICATE_THRESHOLD_M + 2)
  })

  it('warns just inside the threshold, and says how far apart the two points are', async () => {
    await arriveWithAFix()
    await captureAPoint()
    await takeAnotherReading()
    await captureAPoint(JUST_INSIDE)

    // The record first, for the reason the test below this block gives.
    expect(mockRepo.createRecord).toHaveBeenCalledTimes(2)

    // The distance is asserted, not just the warning's presence: it is the
    // whole content of the sentence, and a guard comparing the wrong pair of
    // points — the tap's position against the refined one, say — would still
    // warn, just with a different number.
    const warning = within(screen.getByTestId('capture-duplicate'))
    expect(
      warning.getByText(
        `This point is ${metresFromOrigin(JUST_INSIDE).toFixed(1)} m from the one before it.`,
      ),
    ).toBeTruthy()
  })

  it('says nothing just outside it', async () => {
    await arriveWithAFix()
    await captureAPoint()
    await takeAnotherReading()
    await captureAPoint(JUST_OUTSIDE)

    // A metre and a half further than the case above, and the whole of the
    // difference is `DUPLICATE_THRESHOLD_M`.
    expect(screen.queryByTestId('capture-duplicate')).toBeNull()
    expect(mockRepo.createRecord).toHaveBeenCalledTimes(2)
  })

  it('warns about a close-spaced pin and still records it — it never blocks', async () => {
    await arriveWithAFix()
    await captureAPoint()
    await takeAnotherReading()
    await captureAPoint()

    // THE RECORD IS THERE. This is doctrine rule 4, and it is the rule most
    // likely to be "improved" away by someone who reasons that a duplicate
    // ought to be prevented: two soil samples a metre apart are a normal thing
    // to record, and only the ecologist standing there knows which she meant.
    // The row is written by the tap, long before any comparison is possible, so
    // the guard is a warning about what just happened and not a gate before it.
    //
    // ASSERTED FIRST, AND DELIBERATELY. A guard moved earlier — to refuse the
    // tap, or to refuse the save — is the mutation this test exists to catch,
    // and it must fail on the RECORD'S ABSENCE rather than on the warning's:
    // "the second point was never written" is the sentence that names what
    // actually went wrong, and a failure reading "no warning found" would send
    // the next reader looking at the warning.
    expect(mockRepo.createRecord).toHaveBeenCalledTimes(2)
    expect(readoutText('capture-recorded')).toBe('CAPTURE 2')
    expect(captureButton()).toHaveTextContent('TAKE ANOTHER READING')

    // And the warning itself. Spec §9.5: a new pin within the threshold of the
    // previous one is worth querying, because an accidental double-capture is a
    // real field failure too.
    expect(screen.getByTestId('capture-duplicate')).toBeTruthy()
  })

  it('says nothing about a pin that is genuinely somewhere else', async () => {
    // About 11 m up the paddock — comfortably outside the threshold, asserted
    // rather than asserted-by-eyeball, so a change to either the fixture
    // latitude or `DUPLICATE_THRESHOLD_M` cannot leave this test quietly
    // testing the same case as the one above.
    const elsewhere = -37.8137
    expect(
      distanceMetres(
        { latitude: -37.8136, longitude: 144.9631 },
        { latitude: elsewhere, longitude: 144.9631 },
      ),
    ).toBeGreaterThan(DUPLICATE_THRESHOLD_M)

    await arriveWithAFix()
    await captureAPoint()
    await takeAnotherReading()
    await captureAPoint(elsewhere)

    expect(screen.queryByTestId('capture-duplicate')).toBeNull()
    expect(mockRepo.createRecord).toHaveBeenCalledTimes(2)
  })

  it('offers to continue, and does not take that answer as standing', async () => {
    await arriveWithAFix()
    await captureAPoint()
    await takeAnotherReading()
    await captureAPoint()

    // §9.5's "offers to continue": the warning is acknowledgeable, which is all
    // continuing can mean when nothing was ever refused.
    await fireEvent.press(screen.getByTestId('capture-duplicate-dismiss'))
    expect(screen.queryByTestId('capture-duplicate')).toBeNull()

    // And the answer was about those two points, not about close-spaced pins in
    // general. A dismissal that carried forward would silently suppress the
    // warning on every capture after the first she waved through — which is the
    // accidental-double-capture failure §9.5 exists to catch, quietly disabled
    // by her own reasonable answer to a different question.
    await takeAnotherReading()
    await captureAPoint()
    expect(screen.getByTestId('capture-duplicate')).toBeTruthy()
  })
})

describe('the ready guard (status.state !== "ready")', () => {
  it('renders the fallback instead of the capture UI while the database is not ready', async () => {
    mockStatus = { state: 'opening', error: null, applied: [] }

    await render(
      <ThemeProvider>
        <CaptureScreen />
      </ThemeProvider>,
    )

    // `useDatabase`, `useDevice` and `useSettings` all throw before the
    // database is ready, so this is also proof the guard runs before any of
    // them are reached: a throwing hook hoisted above it would fail this
    // render, not merely fail to show the right words.
    expect(screen.getByText(/Database opening/)).toBeTruthy()
    expect(screen.queryByTestId('capture-button')).toBeNull()
  })
})

/**
 * THE DEFECT THAT SHIPPED (§9.2, `field.dialMax`).
 *
 * On a Samsung S25 the dial filled the entire viewport: no accuracy, no
 * verdict, no seconds, and no capture button. Every reported symptom — "it
 * went very slowly and never locked", "it's never auto completing, just
 * sitting there measuring" — followed from the one cause, that the only
 * control was off-screen so no capture was ever started.
 *
 * `CaptureDial.test.tsx` asserts the bound on the component; this asserts it
 * survives on the screen that places one, alongside the control it took away.
 */
describe('the dial cannot take the screen (the S25 field defect)', () => {
  it('draws the dial inside a bounded square rather than growing to fill the viewport', async () => {
    await arriveWithAFix()
    await tap()

    const style: unknown = screen.getByTestId('dial-canvas').props.style
    if (typeof style !== 'object' || style === null || Array.isArray(style)) {
      throw new Error(`Expected dial-canvas to carry one style object, got ${typeof style}.`)
    }
    const { maxWidth, aspectRatio } = style as { maxWidth?: unknown; aspectRatio?: unknown }

    expect(typeof maxWidth).toBe('number')
    // Inside the 360dp width of the phone this failed on, so the readouts and
    // the 72dp control still have a screen left to sit on.
    expect(maxWidth as number).toBeGreaterThan(0)
    expect(maxWidth as number).toBeLessThanOrEqual(320)
    expect(aspectRatio).toBe(1)
  })

  it('still has the accuracy, the verdict and the control on screen with it', async () => {
    // The screenshot from the device showed none of these. Asserted together
    // rather than separately, because it is their simultaneous absence that
    // was the bug: §9.4 wants the accuracy the largest *text*, §9.1.2 wants
    // the control visible with the readouts, and a dial that fills the
    // viewport has implemented neither.
    await arriveWithAFix()
    await tap()

    const dial = insideTheDial()
    expect(dial.getByTestId('capture-accuracy')).toBeTruthy()
    expect(dial.getByTestId('capture-verdict')).toBeTruthy()
    expect(dial.getByTestId('capture-seconds')).toBeTruthy()
    expect(dial.getByTestId('capture-button')).toHaveTextContent('ACCEPT NOW')
  })
})

/**
 * THE TWO COMPLETIONS (spec §9.2.1).
 *
 * Both mean "`holdVerdict` says this stopped improving". They differ on
 * whether it stopped improving on the crosshair or short of it, and the
 * difference has to be visible: a settled capture must never be dressed up as
 * a locked one, because the circle's radius is the app's claim about metres.
 */
describe('the two completions (spec §9.2.1)', () => {
  /** The radius the accuracy circle is actually drawn at. */
  function circleRadius(): number {
    const r: unknown = screen.getByTestId('dial-accuracy').props.r
    if (typeof r !== 'number') {
      throw new Error(`Expected dial-accuracy's r to be a number, got ${typeof r}.`)
    }
    return r
  }

  it('says how good it actually got when a capture settles short of the crosshair', async () => {
    await arriveWithAFix(SETTLES_SHORT_M)
    await tap()
    await standStillUntilItSettles(SETTLES_SHORT_M)

    // It really did end on the plateau rather than the cap — nine seconds of
    // readings against a fifteen-second cap, and the override untouched.
    expect(screen.getByTestId('capture-message')).toHaveTextContent(
      'The fix stopped improving, so the countdown finished itself.',
    )

    // The words name the accuracy reached, not a convergence it did not make.
    const settledAt = averagedOverAFlatHold(SETTLES_SHORT_M)
    expect(readoutText('capture-settled-label')).toBe(
      `As good as it gets here — ±${settledAt.toFixed(1)} m`,
    )
    // And the lock's own word is nowhere near it.
    expect(screen.queryByTestId('capture-lock-label')).toBeNull()
  })

  /**
   * THE CIRCLE MUST NOT BE MOVED TO A RADIUS ITS ACCURACY HAS NOT EARNED.
   *
   * Snapping a settled capture's circle onto the crosshair was considered and
   * rejected by the owner: "the radius always means metres" (spec §9.2) is
   * what the whole dial rests on, and a circle drawn on the target after a
   * capture that never reached it makes the picture lie. This is the test
   * that fails if someone reaches for that shortcut.
   */
  it('leaves the settled circle exactly where its accuracy puts it, outside the crosshair', async () => {
    await arriveWithAFix(SETTLES_SHORT_M)
    await tap()
    await standStillUntilItSettles(SETTLES_SHORT_M)

    const settledAt = averagedOverAFlatHold(SETTLES_SHORT_M)
    expect(circleRadius()).toBeCloseTo(radiusForMetres(settledAt), 5)
    expect(isLocked(circleRadius())).toBe(false)

    // The companion ring marks that radius — where the capture actually got
    // to — with the crosshair still visible inside it. The gap between them
    // is the signal.
    const ring: unknown = screen.getByTestId('dial-settled-ring').props.r
    expect(typeof ring).toBe('number')
    expect(ring as number).toBeGreaterThan(circleRadius())
  })

  it('gives the full lock only when the capture also reached the floor', async () => {
    // The same plateau, from a hold flat at 0.8 m, which averages to about
    // 0.27 m — inside the 1.4 m crosshair.
    await arriveWithAFix(FLAT_M)
    await tap()
    await standStillUntilItSettles()

    expect(readoutText('capture-lock-label')).toBe('· LOCKED ON')
    expect(screen.queryByTestId('capture-settled-label')).toBeNull()
    expect(screen.queryByTestId('dial-settled-ring')).toBeNull()
    expect(isLocked(circleRadius())).toBe(true)
    // The dial's own plain fact agrees, which is the channel that survives
    // for a screen reader (doctrine rule 9).
    expect(screen.getByTestId('capture-dial').props.accessibilityValue).toEqual({
      text: 'Locked on',
    })
  })

  it('treats a capture she cut short as neither', async () => {
    // ACCEPT NOW ends the wait on her decision, not on a measurement that ran
    // out of improvement — so there is nothing to celebrate and nothing to
    // offer another go at.
    await arriveWithAFix(SETTLES_SHORT_M)
    await tap()
    await emit(SETTLES_SHORT_M)
    await acceptNow()

    expect(screen.getByTestId('capture-message')).toHaveTextContent('You accepted it early.')
    expect(screen.queryByTestId('capture-settled-label')).toBeNull()
    expect(screen.queryByTestId('capture-lock-label')).toBeNull()
    expect(screen.queryByTestId('capture-try-again')).toBeNull()
  })
})

/**
 * ANOTHER GO AT A CAPTURE THAT SETTLED SHORT.
 *
 * The record is what is being protected: its capture number may already be
 * written on a sample tube, so a second attempt refines the row that exists
 * rather than starting a second capture beside it.
 */
describe('another go at a settled capture', () => {
  async function captureThatSettles() {
    await arriveWithAFix(SETTLES_SHORT_M)
    await tap()
    await standStillUntilItSettles(SETTLES_SHORT_M)
  }

  it('is offered when a capture settles, and not when it locks on', async () => {
    await captureThatSettles()
    expect(screen.getByTestId('capture-try-again')).toBeTruthy()

    await takeAnotherReading()
    await arriveWithAFix(FLAT_M)
    await tap()
    await standStillUntilItSettles()

    // A capture that reached the floor has had what this hardware can give it.
    expect(screen.queryByTestId('capture-try-again')).toBeNull()
  })

  it('keeps the record and runs another countdown over it', async () => {
    await captureThatSettles()
    expect(mockRepo.createRecord).toHaveBeenCalledTimes(1)
    expect(mockRepo.refineRecordFix).toHaveBeenCalledTimes(1)

    await fireEvent.press(screen.getByTestId('capture-try-again'))
    await settle()

    // Back in the acquiring state, with the one control accepting again.
    expect(captureButton()).toHaveTextContent('ACCEPT NOW')
    expect(screen.getByTestId('dial-ring-progress')).toBeTruthy()
    // No second record: the number on the tube is still this capture's.
    expect(mockRepo.createRecord).toHaveBeenCalledTimes(1)

    await emit(3)
    await acceptNow()

    expect(mockRepo.refineRecordFix).toHaveBeenCalledTimes(2)
    for (const call of mockRepo.refineRecordFix.mock.calls) {
      expect(call[1]).toMatchObject({ recordId: 'record-1' })
    }
    expect(readoutText('capture-recorded')).toBe('CAPTURE 1')
  })

  it('says what the second run is measured against, which is not the tap', async () => {
    await captureThatSettles()
    await fireEvent.press(screen.getByTestId('capture-try-again'))
    await settle()
    await emit(3)

    // The baseline is what the first run left on the record, and the words
    // say so — naming the tap here would name a comparison this run is not
    // making.
    expect(readoutText('capture-improvement')).toMatch(/than the last run/)
    expect(readoutText('capture-improvement')).not.toMatch(/than the tap/)
  })
})

/**
 * THE GRADE THE SCREEN SHOWS (spec §9.2, hysteresis).
 *
 * `gradeAccuracy`'s good/fair boundary is exactly 5 m, and at the site this
 * app was measured on the raw live reading hovers either side of it. The owner
 * watched the ready state flip amber → green → amber → green with no change in
 * the quality of the fix.
 */
describe('the grade the screen shows', () => {
  /**
   * The receiver's own jitter at that site once the trend has flattened:
   * about ±0.5 m around 4.7 m, straddling the boundary. Same fixture as
   * `steadyGrade.test.ts`, driven through the whole screen here.
   */
  const JITTER_ACROSS_THE_BOUNDARY = [4.8, 5.1, 4.7, 5.3, 4.9, 5.2, 4.4, 5.0, 4.2]

  function gradeWordOnScreen(): string {
    for (const word of ['GOOD FIX', 'FAIR FIX', 'POOR FIX']) {
      if (screen.queryByText(word) !== null) return word
    }
    throw new Error('The dial rendered no grade word at all.')
  }

  it('does not flicker while the live reading crosses the boundary on jitter', async () => {
    // The raw classifier really does oscillate on this series — asserted
    // first, so this cannot pass because the fixture stopped crossing.
    const raw = JITTER_ACROSS_THE_BOUNDARY.map(gradeAccuracy)
    expect(raw.filter((grade, i) => i > 0 && grade !== raw[i - 1]).length).toBeGreaterThan(2)

    // Opens above the boundary, as the measured run does.
    await arriveWithAFix(5.2)
    const shown = [gradeWordOnScreen()]
    for (const accuracyM of JITTER_ACROSS_THE_BOUNDARY) {
      await emit(accuracyM)
      shown.push(gradeWordOnScreen())
    }

    // One change, from the reading that genuinely crossed into good.
    expect(shown.filter((word, i) => i > 0 && word !== shown[i - 1])).toEqual(['GOOD FIX'])
    expect(shown[0]).toBe('FAIR FIX')
    expect(shown[shown.length - 1]).toBe('GOOD FIX')
  })

  it('keeps the colour and the word saying the same thing at every instant', async () => {
    // Doctrine rule 9: they come from one value, not two. Sampled at a
    // reading whose RAW grade disagrees with what is displayed — 5.2 m is
    // fair to `gradeAccuracy` — which is where a second, separately-computed
    // colour would show up.
    await arriveWithAFix(4.8)
    await emit(5.2)

    expect(gradeAccuracy(5.2)).toBe('fair')
    expect(gradeWordOnScreen()).toBe('GOOD FIX')
    expect(screen.getByTestId('dial-accuracy').props.stroke).toEqual({
      type: 0,
      payload: processColor(darkTheme.colors.statusGood),
    })
  })

  it('reports a fix that has genuinely degraded, rather than holding a grade it lost', async () => {
    // Hysteresis delays a change; it is not a licence to keep claiming a
    // grade. A metre past the boundary is a different fix, not jitter.
    await arriveWithAFix(4.8)
    expect(gradeWordOnScreen()).toBe('GOOD FIX')

    await emit(6.5)
    expect(gradeWordOnScreen()).toBe('FAIR FIX')
  })
})
