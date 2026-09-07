import React from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react-native'
import { INPUT_AFFORDANCE_ORDER, ThemeProvider } from '@corymbia/ui'
import { type as typeScale } from '@corymbia/tokens'
import {
  averageReadings,
  createFakeLocationSource,
  distanceMetres,
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
  mockRepo.refineRecordFix.mockImplementation(
    (_db: unknown, input: { recordId: string; fix: Fix }) =>
      Promise.resolve(amendRecord(input.recordId, { fix: input.fix })),
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
 * for anything from about 1 m to 6.7 m it lands exactly on the minimum sample
 * count — so a test written with 8 m would pass identically against a build
 * with no minimum-sample guard at all.
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
async function standStillUntilItSettles() {
  for (let i = 0; i < MIN_SAMPLES - 1; i += 1) {
    await emit(FLAT_M)
  }
  await settle()
}

/**
 * The traffic-light frame's own subtree.
 *
 * `TrafficLightFrame` takes no `testID` of its own, so this scopes to
 * `traffic-light-border`'s own parent — the frame's actual root — rather than
 * to `capture-frame`, the screen's wrapper `View` around it. Scoping to the
 * wrapper was only ever correct while it stayed a single-child container: the
 * moment a sibling was placed beside the frame in there, "inside
 * `capture-frame`" would stop meaning "inside the frame with the button", the
 * very defect §9.1.2 names. Scoping to the border's own parent is immune to
 * that — it is the frame's rendering, not a container that merely happens to
 * be named after it, whatever else is later placed beside it.
 */
function insideTheFrame() {
  const border = screen.getByTestId('traffic-light-border')
  if (border.parent === null) {
    throw new Error('Expected traffic-light-border to have a parent to scope queries to.')
  }
  return within(border.parent)
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
    // half of §9.4 a size assertion on its own would not catch. Swept across
    // every rendered string rather than enumerated by testID, so an
    // unlabelled element promoted to hero size is caught too, not only a
    // regression on the four this screen happens to have today.
    const heroSized = screen
      .getAllByText(/./)
      .filter((node) => node.props.style?.fontSize === typeScale.hero.size)
    expect(heroSized).toHaveLength(2)
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
