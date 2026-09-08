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
import type { Attachment, Fix, FieldRecord } from '@corymbia/data'

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
  // Typed against the real function rather than left bare: the notes-survive-a
  // -title-save test below asserts this mock's exact payload, and an untyped
  // `jest.fn()` would let `toHaveBeenLastCalledWith` be handed an object the
  // real `renameRecord` would never accept.
  renameRecord: jest.fn<
    ReturnType<typeof import('@corymbia/data').renameRecord>,
    Parameters<typeof import('@corymbia/data').renameRecord>
  >(),
  listMedia: jest.fn<
    ReturnType<typeof import('@corymbia/data').listMedia>,
    Parameters<typeof import('@corymbia/data').listMedia>
  >(),
}

jest.mock('@corymbia/data', () => {
  const actual = jest.requireActual<typeof import('@corymbia/data')>('@corymbia/data')
  return {
    ...actual,
    createRecord: (...args: unknown[]) => mockRepo.createRecord(...args),
    refineRecordFix: (...args: unknown[]) => mockRepo.refineRecordFix(...args),
    renameRecord: (...args: Parameters<typeof import('@corymbia/data').renameRecord>) =>
      mockRepo.renameRecord(...args),
    listMedia: (...args: Parameters<typeof import('@corymbia/data').listMedia>) =>
      mockRepo.listMedia(...args),
  }
})

// A plain alias, matching the brief's own naming — not referenced from inside
// the `jest.mock` factory above, which is hoisted ahead of this declaration.
const listMedia = mockRepo.listMedia

/**
 * The router, mocked as an object rather than a fresh one per call.
 *
 * The screen's navigation is the `recorded` state's two ways out — the
 * gallery at `/`, until Plan 5 builds the launcher — and, as of Task 11, the
 * push to `/camera` and `/voice` a photo or voice tile makes. Nothing here
 * needs a real navigation container, and mounting one would put the whole of
 * expo-router's layout machinery between these tests and the lines they are
 * actually about.
 */
const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
}

/**
 * Every focus effect currently registered by a mounted component.
 *
 * `useFocusEffect` is the screen's answer to a problem this test file cannot
 * reproduce with a real navigator: she leaves the recorded state for
 * `/camera`, attaches a photo, and comes back, and the screen has to notice.
 * Mounting expo-router's own navigation container here would put its entire
 * layout machinery between these tests and the lines they are about — so the
 * mock keeps the one property that matters, which is *when* the effect runs:
 * once when the component mounts and becomes focused, and again on every
 * later focus, with `refocus()` below standing in for the return from a push.
 */
const mockFocusEffects = new Set<() => void>()

/**
 * The hook lives inside the factory rather than beside this set, and that is
 * forced from both ends: `babel-plugin-jest-hoist` hoists `jest.mock` above
 * every declaration in the file and so refuses a factory that reaches for any
 * out-of-scope name not prefixed `mock`, while `react-hooks/rules-of-hooks`
 * refuses to let a function whose name does not begin with `use` call
 * `useEffect`. No single module-scope name satisfies both. As an object
 * property it is named `useFocusEffect`, which the lint rule reads as a hook,
 * and `require('react')` inside a factory is allowed where a reference to the
 * imported `React` would not be — `react` is not mocked here, so it is the
 * same module instance the screen itself renders through.
 */
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (effect: () => void) => {
      // The identity-keyed `useEffect` is what makes this a faithful stand-in
      // for the real hook on first focus: an effect whose dependencies
      // changed re-runs, and one whose dependencies did not does not.
      // `capture.tsx` wraps its callback in `useCallback` precisely so this is
      // a stable identity.
      useEffect(() => {
        mockFocusEffects.add(effect)
        effect()
        return () => {
          mockFocusEffects.delete(effect)
        }
      }, [effect])
    },
  }
})

/**
 * `mediaStore`, mocked whole — the same reason `useAttachMedia.test.ts` mocks
 * it (`../store`, from `src/media`): it is backed by `expo-file-system`, a
 * native module with no meaningful behaviour in a headless test environment.
 * This screen only ever calls `uriFor`, to turn an attachment's stored file
 * name into the URI `MediaStrip` renders a photo tile from; `save`, `remove`
 * and `exists` are not reachable from here at all — attaching happens on
 * `/camera` and `/voice`, not on this screen — so each throws if anything
 * ever reaches for it, rather than silently returning something plausible.
 */
jest.mock('../../src/media/store', () => ({
  mediaStore: {
    save: () => Promise.reject(new Error('not used by capture.tsx')),
    remove: () => Promise.reject(new Error('not used by capture.tsx')),
    exists: () => Promise.reject(new Error('not used by capture.tsx')),
    uriFor: (fileName: string) => `file:///media/${fileName}`,
  },
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
// The real module — only `@corymbia/geo`'s `createExpoLocationSource` is
// mocked above. Used solely for `.reset()` in `afterEach`, below.
import { ambientCache } from '../../src/geo/ambient'

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
  // A component that failed to unmount cleanly must not leave a focus effect
  // behind for the next test's `refocus()` to fire into.
  mockFocusEffects.clear()
  mockStatus = { state: 'ready', error: null, applied: ['001_initial'] }
  mockCreateSourceSpy.mockClear()
  watchCallCount = 0
  mockRouter.push.mockClear()
  mockRouter.replace.mockClear()
  mockRouter.back.mockClear()

  mockRepo.createRecord.mockReset()
  mockRepo.refineRecordFix.mockReset()
  mockRepo.renameRecord.mockReset()
  mockRepo.listMedia.mockReset()
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
  // Mirrors the real `renameRecord`'s own rule (`records.ts`): `description`
  // is only ever touched when the caller's input actually carries that key —
  // a title-only save must leave whatever notes are already on the record
  // alone, exactly as the real repository function's `'description' in input`
  // check does.
  mockRepo.renameRecord.mockImplementation((_db, input) =>
    Promise.resolve(
      amendRecord(
        input.recordId,
        'description' in input
          ? { title: input.title, description: input.description ?? null }
          : { title: input.title },
      ),
    ),
  )
  // No attachments unless a test says otherwise — the ordinary case for a
  // capture that has just finished and has had nothing added to it yet.
  mockRepo.listMedia.mockResolvedValue([])
})

afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
  // Deliberately NOT `jest.restoreAllMocks()`: the reduced-motion spies in
  // jest.setup.js are installed once for the whole file, and restoring them
  // after the first test would hand every later test the real
  // `AccessibilityInfo`, which in a headless environment never answers.

  // `'../src/geo/ambient'` is the real module (only `@corymbia/geo`'s
  // location factory is mocked above), so every test that mounts
  // `CaptureScreen` writes a position into the real, app-wide singleton —
  // both from the countdown readings `arriveWithAFix`/`emit` deliver and, as
  // of Task 10b's review, from the mount effect's own `refresh()`. Nothing in
  // this file reads the cache back, so a stale position has cost nothing yet
  // — but leaving it uncleared would silently hand a future test here
  // whatever position the previous one left behind. `.reset()` only forgets
  // the position; it deliberately leaves `src/geo/ambient.ts`'s own
  // `platformSource` alone, which the "constructed once" test below depends
  // on staying a stable, already-built singleton across this whole file.
  ambientCache.reset()
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
 * Captures a point and accepts the fix straight away, landing on the
 * `recorded` state with its affordances ready to press — the same three
 * steps every test in "the four affordances" describe block used to repeat
 * inline. `accuracyM` defaults to the same 8 m `arriveWithAFix` itself
 * defaults to; a caller passing a different one is asking for a specific
 * final accuracy to assert against, not for a different completion — 8 m is
 * comfortably short of both `TARGET_METRES` (so it never locks) and the flat
 * hold that would plateau it, so ending the wait early with `acceptNow` is
 * always what actually happens here.
 */
async function renderRecorded(options: { accuracyM?: number } = {}): Promise<void> {
  await arriveWithAFix(options.accuracyM ?? 8)
  await tap()
  await acceptNow()
}

/**
 * Comes back to this screen from `/camera` or `/voice`.
 *
 * With the root layout a `Stack` (`_layout.tsx`), the push never unmounted
 * this screen — so a return is a focus, not a mount, and running the
 * registered focus effects is the whole of what the navigator does to it.
 * That is exactly the event a mount-only fetch cannot see, which is why the
 * refresh test below fails against one.
 */
async function refocus() {
  await act(async () => {
    for (const effect of mockFocusEffects) effect()
    await Promise.resolve()
  })
  await settle()
}

/**
 * A promise a test resolves by hand, so a write can be held open for as long
 * as an assertion about the in-flight state needs. `resolve` is assigned
 * synchronously by the `Promise` constructor, so it is never read before it
 * is set — but it is typed and initialised so that neither a non-null
 * assertion nor a cast is needed to say so.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((settleWith) => {
    resolve = settleWith
  })
  return { promise, resolve: (value: T) => { resolve(value) } }
}

/**
 * An attachment fixture, matching `useAttachMedia.test.ts`'s own `fakeAttachment`
 * shape — the two files are testing opposite ends of the same pipeline
 * (`attachMedia`'s insert there, `listMedia`'s read here), so the row either
 * of them hands out is worth keeping recognisably the same shape.
 *
 * `id` is a required, explicit argument rather than a default — every test
 * below that renders more than one attachment needs them to have distinct
 * ids, since `MediaStrip` keys its tiles by `id` and a repeated one would
 * silently collapse two tiles into one under React's own reconciliation
 * rather than fail the test that rendered them.
 */
function photoRow(id: string, overrides: Partial<Attachment> = {}): Attachment {
  return {
    id,
    recordId: 'record-1',
    kind: 'photo',
    fileName: `${id}.jpg`,
    byteSize: 2048,
    durationMs: null,
    ordinal: 1,
    capturedAt: '2026-09-07T01:00:05.000Z',
    deletedAt: null,
    ...overrides,
  }
}

/**
 * The other kind of attachment, which nothing in this file used to supply.
 *
 * Its absence was not a gap in coverage so much as a hole the mapping fell
 * through: with `photoRow` the only fixture, `kind: item.kind` could be
 * hardcoded to `'photo'`, `durationMs: item.durationMs` to `null`, and the
 * voice count to `0`, and every test here stayed green. A voice note carries
 * a length and no image, so it is the only fixture that can tell any of those
 * apart from the real mapping.
 *
 * `durationMs` is 8000 rather than a round minute because `MediaStrip`
 * formats `m:ss` with the seconds zero-padded — 8 s renders `0:08`, which a
 * raw-milliseconds or unpadded implementation could not produce by accident.
 */
function voiceRow(id: string, overrides: Partial<Attachment> = {}): Attachment {
  return {
    id,
    recordId: 'record-1',
    kind: 'voice',
    fileName: `${id}.m4a`,
    byteSize: 40960,
    durationMs: 8000,
    ordinal: 2,
    capturedAt: '2026-09-07T01:00:09.000Z',
    deletedAt: null,
    ...overrides,
  }
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

  it('scrolls, so the help affordance and the coordinates cannot be lost off the top', async () => {
    await arriveWithAFix()

    // Ready was the one state with no scroll container, on the reasoning that
    // `flex-end` keeps the button visible. It does — and the button is not
    // what is at risk. Ready carries a help row, a message line, two
    // coordinate rows, a 300dp dial, the grade word, the accuracy, a
    // paragraph and a 72dp control: over 340dp, against roughly 360dp of
    // height on a phone in landscape, with rotation unlocked. Anchored to the
    // bottom and unable to scroll, what is lost is everything above the fold,
    // starting with doctrine rule 7's required help affordance.
    const style: unknown = screen.getByTestId('capture-ready-scroll').props.contentContainerStyle
    expect(style).toMatchObject({ flexGrow: 1 })
    // §5.4's bottom anchoring, which has identical overflow behaviour to
    // centring and so needs asserting in its own right.
    expect(style).toMatchObject({ justifyContent: 'flex-end' })

    // And the things that go off the top have to actually be inside the thing
    // that scrolls, not siblings of it — which the style assertion cannot say.
    const inside = within(screen.getByTestId('capture-ready-scroll'))
    expect(inside.getByTestId('capture-help')).toBeTruthy()
    expect(inside.getByTestId('capture-latitude')).toBeTruthy()
    expect(inside.getByTestId('capture-button')).toBeTruthy()
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
    //
    // This used to also query `traffic-light-border` and `perimeter` and
    // assert them null. Those testIDs belonged to components deleted on this
    // branch, so nothing in the repository can produce them and the two
    // assertions could not fail — a guard against a return that a `null`
    // check cannot mount. What actually stops the frame coming back is that
    // its files are gone; the dial's own presence is the assertion worth
    // keeping here.
    expect(screen.getByTestId('capture-dial')).toBeTruthy()
    expect(screen.getByTestId('dial-ring-progress')).toBeTruthy()
    expect(screen.getByTestId('dial-crosshair')).toBeTruthy()
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

describe('the affordances (spec §9.6, Task 11)', () => {
  it('offers all four inputs, in the one order used everywhere in the application', async () => {
    await renderRecorded()

    // §9.6, as media capture completes it: title, notes, voice, photo — the
    // whole of `InputAffordanceRow`'s own canonical list, with none of them
    // held back any more. Asserted against the exported constant rather than
    // a literal repeated here (doctrine rule 5's "in the same order" is a
    // claim about the whole application) — a screen that reordered its tiles
    // would satisfy a hand-typed array only by being edited to match, and
    // this one not at all.
    const tiles = within(screen.getByTestId('capture-affordances')).getAllByTestId(
      /^affordance-[a-z]+$/,
    )
    expect(tiles.map((tile) => tile.props.testID)).toEqual(
      INPUT_AFFORDANCE_ORDER.map((kind) => `affordance-${kind}`),
    )
  })

  it('does not offer location, because the capture just took one', async () => {
    await renderRecorded()

    // Spec §9.6: location is not an input here, it is the fix the capture
    // just made — the thing the tile would have restated rather than let her
    // do. Its removal is the point of this test, not an incidental check.
    expect(screen.queryByTestId('affordance-location')).toBeNull()
  })

  it('still says what position was stored, now that the location tile is gone', async () => {
    // A distinctive accuracy, not one already used elsewhere in this file for
    // a different reason, so a hardcoded readout could not coincidentally
    // satisfy this.
    await renderRecorded({ accuracyM: 2.4 })

    // Removing the tile must not remove the reassurance it carried — the
    // recorded state's own accuracy readout already says so, untouched by
    // this change. A single reading through the real `averageReadings`
    // reports exactly its own accuracy, so `2.4` here is not a coincidence.
    expect(readoutText('capture-recorded-accuracy')).toBe('±2.4 m')
  })

  it('opens the camera for the record that was just captured', async () => {
    await renderRecorded()

    await fireEvent.press(screen.getByTestId('affordance-photo'))

    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/camera',
      params: { recordId: 'record-1' },
    })
  })

  it('opens the voice recorder for the record that was just captured', async () => {
    await renderRecorded()

    await fireEvent.press(screen.getByTestId('affordance-voice'))

    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/voice',
      params: { recordId: 'record-1' },
    })
  })

  it('shows how many photos are attached', async () => {
    listMedia.mockResolvedValue([photoRow('med_a'), photoRow('med_b')])

    await renderRecorded()
    await settle()

    // The whole label, exactly — `toHaveTextContent` defaults to an exact
    // match, and this is the assertion that makes the number load-bearing. A
    // substring check for `'2'` was satisfied by `Photo · 12` just as
    // happily, so it could not tell a correct count from an arithmetic
    // mistake that happens to contain the right digit.
    expect(screen.getByTestId('affordance-photo-label')).toHaveTextContent('Photo · 2')
    // And it is really the photo count, not a count leaking onto every tile
    // regardless of kind — two attachments of one kind and none of the
    // other, not a label that only ever reads "some".
    expect(screen.getByTestId('affordance-voice-label')).toHaveTextContent('Voice')
  })

  it('counts each kind against its own tile, and neither against the other', async () => {
    // One of each, which is the only shape that can catch the two mistakes a
    // photo-only fixture cannot: a photo count computed as `media.length`
    // (which would read `Photo · 2` here) and a voice count hardcoded to
    // zero (which would leave the voice tile a bare `Voice`). Both halves
    // matter — `InputAffordanceRow` renders no count at all for zero, so a
    // stale or hardcoded zero is visually identical to nothing attached,
    // which is a denial rather than a gap.
    listMedia.mockResolvedValue([photoRow('med_p'), voiceRow('med_v')])

    await renderRecorded()
    await settle()

    expect(screen.getByTestId('affordance-photo-label')).toHaveTextContent('Photo · 1')
    expect(screen.getByTestId('affordance-voice-label')).toHaveTextContent('Voice · 1')
  })

  it('shows the attachments on the record', async () => {
    listMedia.mockResolvedValue([photoRow('med_a')])

    await renderRecorded()
    await settle()

    expect(screen.getByTestId('media-tile-med_a')).toBeTruthy()
    // The thumbnail is the stored file, resolved through `mediaStore.uriFor`
    // — the one reason this file mocks that module at all. Without this the
    // screen could hand `MediaStrip` an empty `uri` and every other test
    // here would still pass, because a tile with no image is still a tile.
    expect(screen.getByTestId('media-thumb-med_a').props.source).toEqual({
      uri: 'file:///media/med_a.jpg',
    })
  })

  it('shows a voice note by its length, not as a picture of nothing', async () => {
    listMedia.mockResolvedValue([voiceRow('med_v')])

    await renderRecorded()
    await settle()

    // `MediaStrip` renders a voice tile as a glyph (SVG, deliberately not
    // text) plus its duration in `m:ss`, so the tile's only text content is
    // the length — which pins both `kind` and `durationMs` coming through the
    // mapping intact. A tile mapped as a photo would render an `Image` and no
    // text at all; one mapped with a null duration would render an empty
    // string.
    expect(screen.getByTestId('media-tile-med_v')).toHaveTextContent('0:08')
    expect(screen.queryByTestId('media-thumb-med_v')).toBeNull()
  })

  it('renders no media strip at all when nothing has been attached', async () => {
    // `MediaStrip` rendering nothing for an empty list is a requirement
    // (`packages/ui/src/media/MediaStrip.tsx`'s own doc comment), not an
    // optimisation — so this screen must not wrap it in a container that
    // would leave an empty frame where the component itself renders null.
    await renderRecorded()

    expect(screen.queryByTestId('capture-media-strip')).toBeNull()
  })

  it('hangs the strip beside the tiles, not inside a wrapper of its own', async () => {
    // The companion to the test above, and the reason that one can be
    // trusted. `queryByTestId(...)` returning null only proves `MediaStrip`
    // itself rendered nothing; an un-testID'd `View` wrapped around it would
    // satisfy that assertion and still leave an empty frame on the screen.
    // What rules the wrapper out is where the strip sits when it does render:
    // as a direct sibling of the affordance row, under the same parent, so
    // there is no container of its own left behind when it renders null.
    listMedia.mockResolvedValue([photoRow('med_a')])

    await renderRecorded()
    await settle()

    expect(screen.getByTestId('capture-media-strip').parent).toBe(
      screen.getByTestId('capture-affordances').parent,
    )
  })

  it('picks up a photo attached while she was away on the camera screen', async () => {
    // The defect this whole task exists for. Nothing on this screen writes an
    // attachment — `/camera` does — so the only moment it can learn a photo
    // exists is the moment she comes back to it. A fetch that runs on mount
    // cannot see that: the screen was already mounted when she left.
    //
    // Both halves are asserted because both come from the same state and both
    // lie in the same way. An empty strip reads as "nothing here yet"; a
    // count that never arrives leaves a bare `Photo` tile, which reads as a
    // denial of the photo she just took.
    listMedia.mockResolvedValue([])

    await renderRecorded()
    await settle()

    expect(screen.queryByTestId('capture-media-strip')).toBeNull()
    expect(screen.getByTestId('affordance-photo-label')).toHaveTextContent('Photo')

    await fireEvent.press(screen.getByTestId('affordance-photo'))
    // What `useAttachMedia` wrote on the camera screen while this one stayed
    // mounted underneath it.
    listMedia.mockResolvedValue([photoRow('med_new')])

    await refocus()

    expect(screen.getByTestId('media-tile-med_new')).toBeTruthy()
    expect(screen.getByTestId('affordance-photo-label')).toHaveTextContent('Photo · 1')
  })

  it('keeps the newest answer when two reads come back out of order', async () => {
    // Camera → back → voice → back takes a couple of seconds in the field,
    // and each return starts a read without cancelling the one before it. If
    // the older read resolves last it would overwrite the newer answer with a
    // list one attachment short — and `mounted.current`, which is the only
    // other guard on this write, is true for both, so it cannot tell them
    // apart.
    const first = deferred<Attachment[]>()
    const second = deferred<Attachment[]>()
    listMedia.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    await renderRecorded()
    await refocus()

    // The second focus answers first, with what is actually on the record.
    await act(async () => {
      second.resolve([photoRow('med_a'), voiceRow('med_v')])
      await Promise.resolve()
    })
    await settle()
    // The first, stale, read lands afterwards — with the record as it was.
    await act(async () => {
      first.resolve([])
      await Promise.resolve()
    })
    await settle()

    expect(screen.getByTestId('media-tile-med_a')).toBeTruthy()
    expect(screen.getByTestId('media-tile-med_v')).toBeTruthy()
    expect(screen.getByTestId('affordance-photo-label')).toHaveTextContent('Photo · 1')
    expect(screen.getByTestId('affordance-voice-label')).toHaveTextContent('Voice · 1')
  })

  it('saves notes against the record', async () => {
    await renderRecorded()

    await fireEvent.press(screen.getByTestId('affordance-description'))
    await fireEvent.changeText(screen.getByTestId('capture-description-input'), 'Wet gully, ferns')
    await fireEvent.press(screen.getByTestId('capture-description-save'))
    await settle()

    expect(mockRepo.renameRecord).toHaveBeenCalledTimes(1)
    expect(mockRepo.renameRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recordId: 'record-1', description: 'Wet gully, ferns' }),
    )

    // The tile reads as complete the same two-channel way the title one does,
    // and the value itself is shown, the way a saved title already is.
    expect(screen.getByTestId('affordance-description-label')).toHaveTextContent('Notes ✓')
    expect(screen.getByTestId('capture-description-value')).toHaveTextContent('Wet gully, ferns')
  })

  it('says the notes were not saved, and that the point itself is safe', async () => {
    mockRepo.renameRecord.mockImplementation(() =>
      Promise.reject(new Error('database is locked')),
    )

    await renderRecorded()

    await fireEvent.press(screen.getByTestId('affordance-description'))
    await fireEvent.changeText(screen.getByTestId('capture-description-input'), 'Wet gully, ferns')
    await fireEvent.press(screen.getByTestId('capture-description-save'))
    await settle()

    expect(screen.getByTestId('capture-description-error')).toHaveTextContent(
      'The notes were not saved: database is locked. The point itself is safe.',
    )
    expect(screen.queryByTestId('capture-description-value')).toBeNull()
    expect(screen.getByTestId('capture-description-save')).not.toBeDisabled()
  })

  it('gives the saved point a name, through the repository that writes the event', async () => {
    await renderRecorded()

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

    await renderRecorded()

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
    // Exact, which is this file's default: `Title` and not `Title ✓`. The
    // `.not.toHaveTextContent('✓')` that used to sit here was redundant with
    // that — and worse than redundant, since with `exact` defaulting to true
    // it asserted only that the label was not the single character `✓`, which
    // it could never be.
    expect(screen.getByTestId('affordance-title-label')).toHaveTextContent('Title')
    // And the control is live again, so the failure is recoverable rather
    // than a dead end.
    expect(screen.getByTestId('capture-title-save')).not.toBeDisabled()
  })

  it('takes the failure away with the editor that produced it', async () => {
    mockRepo.renameRecord.mockImplementation(() => Promise.reject(new Error('database is locked')))

    await renderRecorded()

    await fireEvent.press(screen.getByTestId('affordance-title'))
    await fireEvent.changeText(screen.getByTestId('capture-title-input'), 'Frog pond outflow')
    await fireEvent.press(screen.getByTestId('capture-title-save'))
    await settle()
    expect(screen.getByTestId('capture-title-error')).toBeTruthy()

    // Opening the notes editor must not leave "The name was not saved…"
    // standing underneath it, where it reads as a refusal of notes she has
    // not typed yet.
    await fireEvent.press(screen.getByTestId('affordance-description'))

    expect(screen.queryByTestId('capture-title-error')).toBeNull()
    expect(screen.getByTestId('capture-description-input')).toBeTruthy()
  })

  it('says the title is saving while the write is still in flight', async () => {
    // `busy` is what stops a second tap landing on a tile whose write has not
    // returned, and doctrine rule 9 requires it to read from the wording and
    // not only from the dimmed tile. Holding the repository's promise open is
    // the only way to observe it at all: every other test in this file lets
    // the write resolve within the same `settle()`, so `busy` is always `[]`
    // by the time an assertion runs.
    const write = deferred<FieldRecord>()
    mockRepo.renameRecord.mockImplementation(() => write.promise)

    await renderRecorded()

    await fireEvent.press(screen.getByTestId('affordance-title'))
    await fireEvent.changeText(screen.getByTestId('capture-title-input'), 'Frog pond outflow')
    await fireEvent.press(screen.getByTestId('capture-title-save'))
    await settle()

    expect(screen.getByTestId('affordance-title-label')).toHaveTextContent('Title · Saving')
    expect(screen.getByTestId('affordance-title')).toBeDisabled()
    // Only the tile being written, not every tile: notes are not in flight.
    expect(screen.getByTestId('affordance-description-label')).toHaveTextContent('Notes')
    expect(screen.getByTestId('affordance-description')).not.toBeDisabled()

    // Let it finish, so the screen is not left mid-write with a pending
    // promise for the next test to inherit.
    await act(async () => {
      write.resolve(amendRecord('record-1', { title: 'Frog pond outflow' }))
      await Promise.resolve()
    })
    await settle()

    expect(screen.getByTestId('affordance-title-label')).toHaveTextContent('Title ✓')
  })

  it('does not wipe the notes when a title is saved after them', async () => {
    // `renameRecord` takes `title` unconditionally but touches `description`
    // only when the caller's input actually carries that key
    // (`records.ts`: `'description' in input`), and the fixture above mirrors
    // that rule exactly. This is the sequence the rule exists for, and until
    // now nothing performed it: notes saved, then a title saved, and the
    // notes must still be on the record afterwards rather than cleared by a
    // save that was never about them.
    await renderRecorded()

    await fireEvent.press(screen.getByTestId('affordance-description'))
    await fireEvent.changeText(screen.getByTestId('capture-description-input'), 'Wet gully, ferns')
    await fireEvent.press(screen.getByTestId('capture-description-save'))
    await settle()

    await fireEvent.press(screen.getByTestId('affordance-title'))
    await fireEvent.changeText(screen.getByTestId('capture-title-input'), 'Frog pond outflow')
    await fireEvent.press(screen.getByTestId('capture-title-save'))
    await settle()

    // An exact payload, not `objectContaining`: the absence of the
    // `description` key is the entire assertion, and `objectContaining` could
    // not see it.
    expect(mockRepo.renameRecord).toHaveBeenLastCalledWith(mockDb, {
      recordId: 'record-1',
      title: 'Frog pond outflow',
      deviceId: mockDevice.id,
    })
    expect(screen.getByTestId('capture-description-value')).toHaveTextContent('Wet gully, ferns')
    expect(screen.getByTestId('capture-title-value')).toHaveTextContent('Frog pond outflow')
    expect(screen.getByTestId('affordance-description-label')).toHaveTextContent('Notes ✓')
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

  /**
   * A RETRY THAT COULD ACTUALLY WIN.
   *
   * This test used to drive the retry with `emit(3)` alone. `refineAgain`
   * seeds the new run with the reading on screen — a 6 m one, left over from
   * the hold that settled — so the run's samples were [6, 3], which the real
   * `averageReadings` reports as ±2.68 m against the ±2.0 m already on the
   * record. The real `refineRecordFix` would have refused that outright (spec
   * §9.2.1, *Keeping the better fix*): the only screen-level proof that a
   * successful retry works was being driven by a retry that cannot succeed,
   * and it never looked at the resulting number at all.
   *
   * So the reading on screen is sharpened *before* TRY AGAIN is pressed —
   * which is what standing there watching it improve actually looks like —
   * and the run is genuinely sharper than what the first one stored. The
   * accuracy the screen ends up showing is asserted, because that is the
   * thing a retry is for.
   */
  it('keeps the record and runs another countdown over it, sharpening what it holds', async () => {
    await captureThatSettles()
    expect(mockRepo.createRecord).toHaveBeenCalledTimes(1)
    expect(mockRepo.refineRecordFix).toHaveBeenCalledTimes(1)

    const settledAt = averagedOverAFlatHold(SETTLES_SHORT_M)
    expect(readoutText('capture-recorded-accuracy')).toBe(`±${settledAt.toFixed(1)} m`)

    // The receiver improves while the finished capture is on screen, so the
    // reading `refineAgain` seeds the new run with is a sharp one rather than
    // the 6 m one the settled hold left behind.
    await emit(2)

    await fireEvent.press(screen.getByTestId('capture-try-again'))
    await settle()

    // Back in the acquiring state, with the one control accepting again.
    expect(captureButton()).toHaveTextContent('ACCEPT NOW')
    expect(screen.getByTestId('dial-ring-progress')).toBeTruthy()
    // No second record: the number on the tube is still this capture's.
    expect(mockRepo.createRecord).toHaveBeenCalledTimes(1)

    await emit(2)
    await acceptNow()

    expect(mockRepo.refineRecordFix).toHaveBeenCalledTimes(2)
    for (const call of mockRepo.refineRecordFix.mock.calls) {
      expect(call[1]).toMatchObject({ recordId: 'record-1' })
    }
    expect(readoutText('capture-recorded')).toBe('CAPTURE 1')

    // The run this retry actually collected — two readings at 2 m, through
    // the real `averageReadings`, computed here rather than typed in.
    const retriedTo = averageReadings([reading(2, START_MS), reading(2, START_MS + 1000)]).accuracyM
    // It is genuinely sharper than what the record held, so the real
    // `refineRecordFix` would have applied it — this test is not driving a
    // retry that could only ever be refused.
    expect(retriedTo).toBeLessThan(settledAt)
    // And the number on screen moved to it, which is the whole point of a
    // retry and the thing nothing asserted before.
    expect(readoutText('capture-recorded-accuracy')).toBe(`±${retriedTo.toFixed(1)} m`)
  })

  /**
   * AND A RETRY THAT LOSES SAYS SO, IN THE WORDS §9.2.1 PINS.
   *
   * The repository refuses a refinement that is not sharper than what is
   * stored — `accuracy_m` becomes the Victorian Biodiversity Atlas's
   * mandatory positional-accuracy field, so a retry must not be able to
   * degrade it — and reports `applied: false`. Every other test on this
   * screen runs against a fixture that applies unconditionally, so until this
   * one the discarded wording existed only in `useCapture`'s own unit test
   * and had never reached a rendered assertion. The sentence is asserted
   * whole, not by fragment: it is pinned copy in §9.2.1, and the failure it
   * guards against is a screen that reports an ordinary finish over a write
   * that never happened.
   */
  it('says the run bought nothing when the record keeps the fix it already had', async () => {
    await captureThatSettles()
    const settledAt = averagedOverAFlatHold(SETTLES_SHORT_M)

    // What the real `refineRecordFix` does with a run that is not sharper:
    // every fix column untouched, the row re-read from disk, `applied: false`.
    mockRepo.refineRecordFix.mockImplementationOnce((_db: unknown, input: { recordId: string }) => {
      const kept = mockRecords.get(input.recordId)
      if (!kept) throw new Error(`Record ${input.recordId} does not exist in the fixture.`)
      return Promise.resolve({ record: { ...kept }, applied: false })
    })

    await fireEvent.press(screen.getByTestId('capture-try-again'))
    await settle()
    // A worse run. `refineAgain` seeds it with the reading on screen — the
    // 6 m one the settled hold left — and this adds a 9 m one, which together
    // average well above the ±2.0 m already stored.
    await emit(9)
    await acceptNow()

    const reachedAt = averageReadings([
      reading(SETTLES_SHORT_M, START_MS),
      reading(9, START_MS + 1000),
    ]).accuracyM
    expect(reachedAt).toBeGreaterThan(settledAt)
    expect(screen.getByTestId('capture-message')).toHaveTextContent(
      `You accepted it early. This run reached ±${reachedAt.toFixed(1)} m — no better than the ` +
        `±${settledAt.toFixed(1)} m already on the record, so that fix was kept.`,
    )
    // And the record still shows what it kept, not what the run reached.
    expect(readoutText('capture-recorded-accuracy')).toBe(`±${settledAt.toFixed(1)} m`)
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

  /**
   * THE HYSTERESIS IS PER SERIES, AND THE SCREEN FEEDS IT TWO.
   *
   * While a countdown runs the graded accuracy is the *preview's* — the
   * averaged fix, converging toward the hardware floor. Every other moment it
   * is the live single reading, which at the measured site wobbles at 4–7 m
   * and never converges (spec §9.2). Those differ by metres, and the held
   * grade used to survive the change: a capture that converged to ±1.5 m left
   * `good` on the ref, and the ready state that followed held `GOOD FIX` in
   * green over a ±5.5 m reading for as long as it sat in the 5–6 m band. Two
   * identical live readings then produced different grades depending on
   * capture history, which is the opposite of what steadying is for — and a
   * 4 m step is far outside the ±0.5 m jitter `steadyGrade` is calibrated for.
   */
  it('does not carry a grade earned by a converged capture into the ready state', async () => {
    // A hold flat at 6 m: every LIVE reading is fair, while the preview the
    // dial is grading converges to about 2.0 m, which is good. That gap is
    // the whole of this test — the two series genuinely disagree about the
    // grade at the same instant, which is exactly what happens in the field.
    expect(gradeAccuracy(SETTLES_SHORT_M)).toBe('fair')
    expect(gradeAccuracy(averagedOverAFlatHold(SETTLES_SHORT_M))).toBe('good')

    await arriveWithAFix(SETTLES_SHORT_M)
    await tap()
    await standStillUntilItSettles(SETTLES_SHORT_M)
    // The capture earned `good` on the preview's own series.

    // Back to ready, where the live reading — never better than 6 m — is what
    // is graded.
    await takeAnotherReading()
    await emit(5.5)

    // 5.5 m is fair to `gradeAccuracy`, and inside the 1 m margin that would
    // hold a `good` carried over from the capture — so this is exactly the
    // reading a leaked grade lies about, indefinitely, for as long as the
    // reading sits in the 5–6 m band.
    expect(gradeAccuracy(5.5)).toBe('fair')
    expect(gradeWordOnScreen()).toBe('FAIR FIX')
  })

  it('still steadies the live reading once it is the series being graded', async () => {
    // The key drops the held grade at a phase boundary; it must not disable
    // the hysteresis WITHIN a series, which is the whole point of the module.
    await arriveWithAFix(4.8)
    expect(gradeWordOnScreen()).toBe('GOOD FIX')
    await emit(5.2)
    expect(gradeAccuracy(5.2)).toBe('fair')
    expect(gradeWordOnScreen()).toBe('GOOD FIX')
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
