import React from 'react'
import {
  BackHandler,
  StyleSheet,
  TextInput,
  processColor,
  type HardwareBackPressEvent,
  type ViewStyle,
} from 'react-native'
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
import type { AudioPlayer } from 'expo-audio'

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
  // Typed against the real functions for the same reason `renameRecord`
  // above is: `softDeleteMedia is called with (this task's own
  // "removes it once confirmed" test asserts its exact payload, and
  // `appendEvent`'s "logs that a voice note was played" test asserts
  // `action`/`recordId` on an `objectContaining` — an untyped `jest.fn()`
  // would let either be handed a shape the real functions never accept.
  softDeleteMedia: jest.fn<
    ReturnType<typeof import('@corymbia/data').softDeleteMedia>,
    Parameters<typeof import('@corymbia/data').softDeleteMedia>
  >(),
  appendEvent: jest.fn<
    ReturnType<typeof import('@corymbia/data').appendEvent>,
    Parameters<typeof import('@corymbia/data').appendEvent>
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
    softDeleteMedia: (...args: Parameters<typeof import('@corymbia/data').softDeleteMedia>) =>
      mockRepo.softDeleteMedia(...args),
    appendEvent: (...args: Parameters<typeof import('@corymbia/data').appendEvent>) =>
      mockRepo.appendEvent(...args),
  }
})

// Plain aliases, matching the brief's own naming — not referenced from inside
// the `jest.mock` factory above, which is hoisted ahead of this declaration.
const listMedia = mockRepo.listMedia
const softDeleteMedia = mockRepo.softDeleteMedia
const appendEvent = mockRepo.appendEvent

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

/**
 * `expo-audio`'s `useAudioPlayer`, mocked whole — a native module with no
 * meaningful behaviour in a headless test environment, the same reason
 * `mediaStore` above is. `mockPlayer` is one stable object for the life of a
 * render, matching what the real hook hands back (`AudioPlayer` is a
 * `SharedObject`, not a fresh value per call) — `capture.tsx` calls
 * `useAudioPlayer(null)` once, at the top of `RecordedAffordances`, and
 * `replace`/`play` on whichever tile she presses.
 *
 * `play` and `pause` are plain `jest.fn()`s: both are genuinely `(): void`
 * on `AudioPlayer` (`node_modules/expo-audio/build/AudioModule.types.d.ts`),
 * so there is no payload for an untyped mock to hide the shape of. `play` is
 * what the "plays a voice note" and "logs that a voice note was played"
 * tests below assert was called, and what the "does not log a play that
 * never started" test makes throw.
 *
 * `replace` is different and typed accordingly: `AudioPlayer.replace(source:
 * AudioSource): void` takes an argument, unlike `play`/`pause`. The typing
 * does not make "plays a voice note when its tile is pressed" below any
 * safer — this repo is on `@types/jest@^29.5.14`, whose
 * `toHaveBeenCalledWith<E extends any[]>(...params: E)` is unconstrained by
 * the mock's own parameter type, so a wrong payload passed to `expect(...)
 * .toHaveBeenCalledWith(...)` would be accepted whether `replace` were typed
 * or not. What the generic does buy is `mockImplementation`: an untyped
 * `jest.fn()` would let one be written to accept any shape, silently
 * drifting from `AudioSource` as the real method's signature changes; typed,
 * a wrong implementation fails to compile instead.
 */
const play = jest.fn()
const pause = jest.fn()
const replace = jest.fn<ReturnType<AudioPlayer['replace']>, Parameters<AudioPlayer['replace']>>()
const mockPlayer = { play, pause, replace }

jest.mock('expo-audio', () => ({
  useAudioPlayer: () => mockPlayer,
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

/**
 * What the current-context hook answers for one test.
 *
 * The hook itself is proved in `src/context/__tests__/useCurrentContext.test.ts`
 * — which query answers which question, and the ordering that stops a slow
 * read overwriting a newer one — and running the real one here would need the
 * whole repository layer that `@corymbia/data` is mocked out of above. What
 * this file is about is the other end of the wire: that whatever the context
 * says is what the record is actually filed into, and what the recorded state
 * says it was filed into.
 *
 * `let`, not `const`: the two filing tests below set it for their one render,
 * and `beforeEach` puts it back to "no activity running" — the state every
 * other test in this file was written against.
 */
type MockCurrentContext = ReturnType<
  typeof import('../../src/context/useCurrentContext').useCurrentContext
>
const NO_ACTIVITY: MockCurrentContext = {
  carryOn: null,
  activityId: null,
  unfiledCount: 0,
  loading: false,
  refresh: () => Promise.resolve(),
}
let mockCurrentContext: MockCurrentContext = NO_ACTIVITY

jest.mock('../../src/context/useCurrentContext', () => ({
  useCurrentContext: () => mockCurrentContext,
}))

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

function recordFrom(
  fix: Fix,
  activityId: string | null,
  contextActivityId: string | null,
): FieldRecord {
  mockCaptureNumber += 1
  const record: FieldRecord = {
    id: `record-${String(mockCaptureNumber)}`,
    // The row carries what the caller asked for, rather than a hardcoded
    // null. A fixture that always answered "unfiled" would let the recorded
    // state's destination line be asserted against the fixture's own opinion
    // instead of against what the screen filed.
    activityId,
    contextActivityId,
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
  mockCurrentContext = NO_ACTIVITY
  mockCreateSourceSpy.mockClear()
  watchCallCount = 0
  mockRouter.push.mockClear()
  mockRouter.replace.mockClear()
  mockRouter.back.mockClear()

  mockRepo.createRecord.mockReset()
  mockRepo.refineRecordFix.mockReset()
  mockRepo.renameRecord.mockReset()
  mockRepo.listMedia.mockReset()
  mockRepo.softDeleteMedia.mockReset()
  mockRepo.appendEvent.mockReset()
  mockRepo.softDeleteMedia.mockResolvedValue(undefined)
  mockRepo.appendEvent.mockResolvedValue(undefined)
  play.mockReset()
  pause.mockReset()
  replace.mockReset()
  mockRepo.createRecord.mockImplementation(
    (
      _db: unknown,
      input: { fix: Fix; activityId: string | null; contextActivityId: string | null },
    ) => Promise.resolve(recordFrom(input.fix, input.activityId, input.contextActivityId)),
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
  return {
    promise,
    resolve: (value: T) => {
      resolve(value)
    },
  }
}

/**
 * The overlay surface an element is rendered on, or a failure. `within(...)`
 * on the result then reads that subtree and nothing else.
 *
 * WHY THIS IS A TREE WALK AND NOT A QUERY. "Is this on a surface of its own"
 * is not a question any supported query can ask: RNTL v14 removed the
 * `UNSAFE_*ByType` queries outright (14.0.1 exposes no `UNSAFE_getByType` on
 * `screen` or on a render result — checked against its `dist/`), and every
 * query that remains matches on props.
 *
 * WHY IT MATCHES ON THE TWO PROPERTIES AND NOT ON A `testID`. This replaced a
 * walk for a host element of type `'Modal'`, which no `<View>` could be
 * mistaken for. The editor is no longer a `Modal` — it is an overlay in this
 * Activity's own window (see `FieldEditor`) — and the naive replacement, a
 * walk for `testID="capture-editor-overlay"`, would be satisfied by any plain
 * `<View>` carrying that id, including one rendered back inside the recorded
 * column, which is precisely the build this has to be able to fail on. So it
 * matches on what actually makes the node a surface instead: a box lifted out
 * of the flow and laid over everything (`position: 'absolute'` with all four
 * insets at 0), which claims any touch that reaches it
 * (`onStartShouldSetResponder` returning `true`) so nothing behind is
 * pressable. An inline `<View>` in the column has neither.
 */
function overlayAround(
  element: ReturnType<typeof screen.getByTestId>,
): ReturnType<typeof screen.getByTestId> {
  let node = element.parent
  const seen: string[] = []
  while (node !== null) {
    if (typeof node.type === 'string') {
      const style = StyleSheet.flatten<ViewStyle>(node.props.style)
      const claimsTouches: unknown = node.props.onStartShouldSetResponder
      if (
        style.position === 'absolute' &&
        style.top === 0 &&
        style.left === 0 &&
        style.right === 0 &&
        style.bottom === 0 &&
        typeof claimsTouches === 'function' &&
        claimsTouches() === true
      ) {
        return node
      }
      seen.push(node.type)
    }
    node = node.parent
  }
  throw new Error(
    `Expected the element to be on an overlay surface — an absolutely filled box that claims ` +
      `touches. Its ancestors were: ${seen.join(' < ')}.`,
  )
}

/**
 * The `testID` of every `ScrollView` above an element, innermost first.
 *
 * A tree walk for the same reason `overlayAround` is one: the claim is about
 * an ANCESTOR RELATIONSHIP in the React tree, which no prop-matching query can
 * express. It matters because React Native's responder system builds its
 * propagation path from the React tree, and a `ScrollView` on that path takes
 * the responder for the first touch on a control while a dismissible keyboard
 * is up (`ScrollView.js`, `_handleStartShouldSetResponderCapture`) — the
 * reported "it just closes the keyboard … then i hit save again". So what has
 * to be provable about the editor's SAVE is a NEGATIVE: that
 * `capture-recorded-scroll` is not on its path at all.
 *
 * A negative asserted through a tree walk is worthless if the walk is broken —
 * it would pass against a walk that found nothing ever — so every test using
 * this pairs it with a positive control on a control that IS in that column.
 *
 * `'RCTScrollView'` and not `'ScrollView'`: `@react-native/jest-preset`'s mock
 * renders `<RCTScrollView {...props}>`, spreading the props straight onto the
 * host element, so that is both the type that survives and the node the props
 * can be read from.
 */
function enclosingScrollViewTestIDs(element: ReturnType<typeof screen.getByTestId>): unknown[] {
  let node = element.parent
  const found: unknown[] = []
  while (node !== null) {
    if (node.type === 'RCTScrollView') found.push(node.props.testID)
    node = node.parent
  }
  return found
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
/**
 * The context hook's answer for a device with an activity running. The id and
 * the name are deliberately different strings: a screen that filed by name,
 * or named by id, fails rather than coincidentally passing.
 */
function runningActivity(activityId: string, activityName: string): MockCurrentContext {
  return {
    carryOn: {
      projectName: 'Yarra Flats eDNA',
      activityName,
      activityKind: 'survey',
      startedAt: '2026-09-07T00:40:00.000Z',
      captureCount: 2,
      clientName: 'Parks Victoria',
    },
    activityId,
    unfiledCount: 0,
    loading: false,
    refresh: () => Promise.resolve(),
  }
}

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
    const { accuracyM } = averageReadings([reading(8, START_MS), reading(6, START_MS + 1000)])
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

    // Nothing is running (`NO_ACTIVITY`), so this one really did go to the
    // Inbox — a supported destination rather than an error state (§10.2).
    // Naming it is the point: a state that reads as finished has to say where
    // the thing it finished with has gone.
    expect(readoutText('capture-recorded-destination')).toBe(
      'Saved to the Inbox. You can file it from there later.',
    )
  })

  it('files the capture into the activity that is running', async () => {
    mockCurrentContext = runningActivity('act_reach_3', 'Reach 3 transect')
    await arriveWithAFix()
    await tap()

    // BOTH fields, because they are two different facts that happen to share
    // a value here (spec §8.3): `activityId` is where it is filed, which she
    // can change later by refiling, and `contextActivityId` is where she was,
    // which nothing may ever revise. An implementation that stamped only one
    // of them would leave a later Inbox screen unable to say where an
    // unfiled record probably belongs.
    expect(mockRepo.createRecord).toHaveBeenLastCalledWith(
      mockDb,
      expect.objectContaining({ activityId: 'act_reach_3', contextActivityId: 'act_reach_3' }),
    )
  })

  it('files to the Inbox when no activity is running', async () => {
    // The other half of the pair above, with the same assertion shape: a
    // screen that hardcoded an activity id would pass one of these and fail
    // the other, and one that hardcoded null would fail the first.
    await arriveWithAFix()
    await tap()

    expect(mockRepo.createRecord).toHaveBeenLastCalledWith(
      mockDb,
      expect.objectContaining({ activityId: null, contextActivityId: null }),
    )
  })

  it('names the activity it was filed into, rather than the Inbox', async () => {
    mockCurrentContext = runningActivity('act_reach_3', 'Reach 3 transect')
    await arriveWithAFix()
    await tap()
    await acceptNow()

    // The sentence a person actually reads. Until an activity could be
    // running this line said "Saved to the Inbox" whatever had happened, and
    // an activity that files correctly while the screen goes on naming the
    // Inbox is a lie she has no way to catch.
    expect(readoutText('capture-recorded-destination')).toBe('Saved to Reach 3 transect.')
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
    // text) plus its duration in `m:ss` — which pins both `kind` and
    // `durationMs` coming through the mapping intact. A tile mapped as a
    // photo would render an `Image` and no such text at all; one mapped with
    // a null duration would render an empty string.
    //
    // `{ exact: false }` as of this task: the tile is no longer *only* its
    // duration — `capture.tsx` now passes `onRemove` to `MediaStrip`, so
    // every tile also carries the remove control's own `✕` text (asserted on
    // its own in "confirms before removing an attachment", below). An exact
    // match here would be pinned to that control's glyph, which is not what
    // this test is about.
    expect(screen.getByTestId('media-tile-med_v')).toHaveTextContent('0:08', { exact: false })
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
    mockRepo.renameRecord.mockImplementation(() => Promise.reject(new Error('database is locked')))

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
    mockRepo.renameRecord.mockImplementation(() => Promise.reject(new Error('database is locked')))

    await renderRecorded()

    await fireEvent.press(screen.getByTestId('affordance-title'))
    await fireEvent.changeText(screen.getByTestId('capture-title-input'), 'Frog pond outflow')
    await fireEvent.press(screen.getByTestId('capture-title-save'))
    await settle()

    expect(screen.getByTestId('capture-title-error')).toHaveTextContent(
      'The name was not saved: database is locked. The point itself is safe.',
    )
    /*
      `includeHiddenElements` FOR EVERY QUERY INTO THE COLUMN BELOW, and it is
      not a convenience. The editor is still open here, and while it is open
      the recorded column carries `importantForAccessibility="no-hide-descendants"`
      (see `RecordedState`) so a screen reader cannot wander behind the scrim.
      RNTL models exactly that: its queries default to `includeHiddenElements:
      false` and skip anything under such an ancestor. Left at the default,
      `queryByTestId('capture-title-value')).toBeNull()` below would pass
      against a build that had just written the title and rendered it — it
      would be asserting the hiding, not the absence. These assertions are
      about the VISIBLE state of the dimmed column, so they have to ask for
      the hidden tree explicitly.
    */
    // The record is untouched and the tile has not claimed a title it does
    // not have.
    expect(screen.queryByTestId('capture-title-value', { includeHiddenElements: true })).toBeNull()
    // Exact, which is this file's default: `Title` and not `Title ✓`. The
    // `.not.toHaveTextContent('✓')` that used to sit here was redundant with
    // that — and worse than redundant, since with `exact` defaulting to true
    // it asserted only that the label was not the single character `✓`, which
    // it could never be.
    expect(
      screen.getByTestId('affordance-title-label', { includeHiddenElements: true }),
    ).toHaveTextContent('Title')
    // And the control is live again, so the failure is recoverable rather
    // than a dead end.
    expect(screen.getByTestId('capture-title-save')).not.toBeDisabled()
  })

  it('strips a trailing stop from the save failure rather than doubling it', async () => {
    // Both fixtures above ('database is locked') carry no trailing
    // punctuation, so neither can tell a stripping build from one that
    // interpolates `${detail}.` raw — they render the same sentence either
    // way. This was the last error sentence on the branch still doubling its
    // stop: `camera.tsx`, `voice.tsx` and the removal path beside it all
    // strip, and their own suites all pin it with a punctuated cause. Both
    // kinds of save go through the same line, so the notes case below rules
    // out a fix applied to only one of them.
    mockRepo.renameRecord.mockImplementation(() => Promise.reject(new Error('disk is full!')))

    await renderRecorded()

    await fireEvent.press(screen.getByTestId('affordance-title'))
    await fireEvent.changeText(screen.getByTestId('capture-title-input'), 'Frog pond outflow')
    await fireEvent.press(screen.getByTestId('capture-title-save'))
    await settle()

    expect(screen.getByTestId('capture-title-error')).toHaveTextContent(
      'The name was not saved: disk is full. The point itself is safe.',
    )
  })

  it('strips a run of trailing punctuation from a notes save failure too', async () => {
    // `?!` rather than a single mark, for the same reason the removal path's
    // own pair of tests uses one: `/[.?!…]+$/` and a narrower `/[.!]$/` are
    // indistinguishable on one character, so the `+` is not exercised by the
    // test above.
    mockRepo.renameRecord.mockImplementation(() => Promise.reject(new Error('disk is full?!')))

    await renderRecorded()

    await fireEvent.press(screen.getByTestId('affordance-description'))
    await fireEvent.changeText(screen.getByTestId('capture-description-input'), 'Turbid, cattle')
    await fireEvent.press(screen.getByTestId('capture-description-save'))
    await settle()

    expect(screen.getByTestId('capture-description-error')).toHaveTextContent(
      'The notes were not saved: disk is full. The point itself is safe.',
    )
  })

  /**
   * CHANGED when the editor became a modal, and the change is the point.
   *
   * This test used to press `affordance-description` with the title editor
   * still open, because inline that was a reachable sequence: both editors
   * and both tiles were in the same scrolling column. With the editor on a
   * modal surface the tiles are behind a scrim while it is open, so that
   * sequence describes taps a device cannot deliver — under `jest-expo`'s
   * inline `Modal` mock it still "passes", which is exactly the kind of
   * assertion that proves nothing.
   *
   * The reachable route is the one below: leave the editor, then open the
   * other one. The requirement it guards is unchanged — "The name was not
   * saved…" must not still be on screen underneath a notes box she has not
   * typed into yet — and it now has two lines to survive rather than one
   * (`closeEditor` clears the error with the surface; `openEditor` clears it
   * again defensively).
   */
  it('takes the failure away with the editor that produced it', async () => {
    mockRepo.renameRecord.mockImplementation(() => Promise.reject(new Error('database is locked')))

    await renderRecorded()

    await fireEvent.press(screen.getByTestId('affordance-title'))
    await fireEvent.changeText(screen.getByTestId('capture-title-input'), 'Frog pond outflow')
    await fireEvent.press(screen.getByTestId('capture-title-save'))
    await settle()
    expect(screen.getByTestId('capture-title-error')).toBeTruthy()

    await fireEvent.press(screen.getByTestId('capture-editor-cancel'))
    expect(screen.queryByTestId('capture-title-error')).toBeNull()

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

    /*
      `includeHiddenElements`, for the reason spelled out on the failure test
      above: the editor is still open, so the column behind it is hidden from
      a screen reader by `importantForAccessibility` and RNTL's queries skip it
      by default. Nothing is lost to a reader by that — the editor's own
      description says `Saving.` and its SAVE reads `SAVING…` — and these four
      assertions are about the visible tiles, so they ask for the hidden tree.
    */
    expect(
      screen.getByTestId('affordance-title-label', { includeHiddenElements: true }),
    ).toHaveTextContent('Title · Saving')
    expect(screen.getByTestId('affordance-title', { includeHiddenElements: true })).toBeDisabled()
    // Only the tile being written, not every tile: notes are not in flight.
    expect(
      screen.getByTestId('affordance-description-label', { includeHiddenElements: true }),
    ).toHaveTextContent('Notes')
    expect(
      screen.getByTestId('affordance-description', { includeHiddenElements: true }),
    ).not.toBeDisabled()

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

/**
 * The field-reported blocker: "Their text boxes are not visible when the
 * keyboard appears", and "not sure they're being saved".
 *
 * WHAT THESE TESTS CAN AND CANNOT SEE. Jest can prove the input is on a
 * surface of its own, outside the recorded state's own column, and that a
 * save says so afterwards. It cannot see a keyboard: whether the box ends up
 * genuinely clear of one on a device is a property of Android's window
 * insets, `KeyboardAvoidingView` under edge-to-edge and `adjustResize` — none
 * of which exists here. Those go to the owner as device checks, not as
 * assertions.
 *
 * THE EDITOR IS NO LONGER A `Modal`, AND THESE TESTS CHANGED WITH IT. A
 * `Modal` is a separate Android window, and that window is where both reported
 * faults came from (`FieldEditor` carries the mechanism, read out of RN
 * 0.86.3's `ReactModalHostView.kt`). The editor is now an overlay in this
 * Activity's own window. The assertions below moved from "is it inside a
 * `Modal` element" to "is it on an absolutely filled surface that claims
 * touches, and NOT inside `capture-recorded-scroll`" — see `overlayAround` and
 * `enclosingScrollViewTestIDs` for why those two properties, and not a
 * `testID`, are what a plain inline `<View>` in the column cannot fake.
 */
describe('the editor, which is an overlay and not the foot of the column', () => {
  it('keeps the box out of the record’s own column until it is opened, and on a surface of its own when it is', async () => {
    await renderRecorded()

    // Nothing until she asks for it. Inline, the box was rendered after the
    // tiles, the strip and the saved values — the exact band of screen the
    // Android soft keyboard occupies.
    expect(screen.queryByTestId('capture-title-input')).toBeNull()

    await fireEvent.press(screen.getByTestId('affordance-title'))

    // `within` the OVERLAY, found by the two properties that make it a
    // surface rather than by a testID any `<View>` could carry: an absolutely
    // filled box that claims the touches reaching it. A build that rendered
    // this card back into the recorded column with the same testIDs fails
    // here rather than passing quietly.
    const overlay = overlayAround(screen.getByTestId('capture-title-input'))
    expect(within(overlay).getByTestId('capture-title-input')).toBeTruthy()
    expect(within(overlay).getByTestId('capture-title-save')).toBeTruthy()
    expect(within(overlay).getByTestId('capture-editor-cancel')).toBeTruthy()
  })

  it('holds the notes box on the same kind of surface, so a fix applied to one field is not mistaken for both', async () => {
    await renderRecorded()
    await fireEvent.press(screen.getByTestId('affordance-description'))

    const overlay = overlayAround(screen.getByTestId('capture-description-input'))
    expect(within(overlay).getByTestId('capture-description-input')).toBeTruthy()
    expect(within(overlay).getByTestId('capture-description-save')).toBeTruthy()
  })

  it('closes without writing anything when she leaves it', async () => {
    await renderRecorded()

    await fireEvent.press(screen.getByTestId('affordance-title'))
    await fireEvent.changeText(screen.getByTestId('capture-title-input'), 'Frog pond outflow')
    await fireEvent.press(screen.getByTestId('capture-editor-cancel'))
    await settle()

    expect(screen.queryByTestId('capture-title-input')).toBeNull()
    expect(mockRepo.renameRecord).not.toHaveBeenCalled()
    // And no confirmation, because nothing was confirmed. A cancel and a save
    // both close the surface, which is exactly why the closing surface cannot
    // be the confirmation on its own.
    expect(screen.queryByTestId('capture-save-confirmation')).toBeNull()
    expect(screen.getByTestId('affordance-title-label')).toHaveTextContent('Title')
  })

  it('says in words that the name was saved, and quotes back what was stored', async () => {
    await renderRecorded()

    // Nothing claims a save before there is one.
    expect(screen.queryByTestId('capture-save-confirmation')).toBeNull()

    await fireEvent.press(screen.getByTestId('affordance-title'))
    await fireEvent.changeText(screen.getByTestId('capture-title-input'), 'Frog pond outflow')
    await fireEvent.press(screen.getByTestId('capture-title-save'))
    await settle()

    expect(screen.queryByTestId('capture-title-input')).toBeNull()
    expect(screen.getByTestId('capture-save-confirmation')).toHaveTextContent(
      'Name saved: Frog pond outflow',
    )
    // Doctrine rule 9's second channel, and neither of them colour: the
    // sentence above, and the tile's own label beside it.
    expect(screen.getByTestId('affordance-title-label')).toHaveTextContent('Title ✓')
    // The screen-reader half of the same moment. The modal has its own spoken
    // description, so a reader is focused inside a surface that is about to
    // be removed from the tree; without a live region the removal is silent.
    expect(screen.getByTestId('capture-save-confirmation').props.accessibilityLiveRegion).toBe(
      'polite',
    )
  })

  it('says the same for notes, naming the notes and not the name', async () => {
    await renderRecorded()

    await fireEvent.press(screen.getByTestId('affordance-description'))
    await fireEvent.changeText(screen.getByTestId('capture-description-input'), 'Wet gully, ferns')
    await fireEvent.press(screen.getByTestId('capture-description-save'))
    await settle()

    expect(screen.getByTestId('capture-save-confirmation')).toHaveTextContent(
      'Notes saved: Wet gully, ferns',
    )
  })

  it('calls an emptied box cleared, rather than confirming a save of nothing', async () => {
    await renderRecorded()

    await fireEvent.press(screen.getByTestId('affordance-description'))
    await fireEvent.changeText(screen.getByTestId('capture-description-input'), 'Wet gully, ferns')
    await fireEvent.press(screen.getByTestId('capture-description-save'))
    await settle()

    await fireEvent.press(screen.getByTestId('affordance-description'))
    await fireEvent.changeText(screen.getByTestId('capture-description-input'), '   ')
    await fireEvent.press(screen.getByTestId('capture-description-save'))
    await settle()

    // `renameRecord` models an emptied box as `null` — a cleared value, not
    // text made of no characters — and the confirmation has to read as one,
    // or she is told "Notes saved:" followed by a blank.
    expect(screen.getByTestId('capture-save-confirmation')).toHaveTextContent('Notes cleared')
    expect(screen.queryByTestId('capture-description-value')).toBeNull()
  })

  it('quotes the record that came back, not the text that was typed', async () => {
    // A repository that stored something other than what was typed must not
    // be confirmed as having stored what was typed. The fixture normalises
    // the value on the way through, which a confirmation built from the draft
    // would render as the un-normalised original.
    mockRepo.renameRecord.mockImplementation((_db, input) =>
      Promise.resolve(amendRecord(input.recordId, { title: 'FROG POND OUTFLOW' })),
    )

    await renderRecorded()
    await fireEvent.press(screen.getByTestId('affordance-title'))
    await fireEvent.changeText(screen.getByTestId('capture-title-input'), 'Frog pond outflow')
    await fireEvent.press(screen.getByTestId('capture-title-save'))
    await settle()

    expect(screen.getByTestId('capture-save-confirmation')).toHaveTextContent(
      'Name saved: FROG POND OUTFLOW',
    )
  })

  it('takes the confirmation away with the editor that produced it', async () => {
    await renderRecorded()

    await fireEvent.press(screen.getByTestId('affordance-title'))
    await fireEvent.changeText(screen.getByTestId('capture-title-input'), 'Frog pond outflow')
    await fireEvent.press(screen.getByTestId('capture-title-save'))
    await settle()
    expect(screen.getByTestId('capture-save-confirmation')).toBeTruthy()

    // "Name saved: Frog pond outflow" standing under a freshly opened notes
    // box reads as a confirmation of notes she has not typed yet — the same
    // failure the error message was already fixed for.
    await fireEvent.press(screen.getByTestId('affordance-description'))

    expect(screen.queryByTestId('capture-save-confirmation')).toBeNull()
  })

  it('shows a failed save inside the editor, where she is looking, with her text still in the box', async () => {
    mockRepo.renameRecord.mockImplementation(() => Promise.reject(new Error('database is locked')))

    await renderRecorded()
    await fireEvent.press(screen.getByTestId('affordance-title'))
    await fireEvent.changeText(screen.getByTestId('capture-title-input'), 'Frog pond outflow')
    await fireEvent.press(screen.getByTestId('capture-title-save'))
    await settle()

    // ON THE EDITING SURFACE. Left at the foot of the recorded column, the
    // sentence would be behind the scrim, unreadable, while the surface she is
    // actually looking at said nothing at all.
    const overlay = overlayAround(screen.getByTestId('capture-title-input'))
    expect(within(overlay).getByTestId('capture-title-error')).toHaveTextContent(
      'The name was not saved: database is locked. The point itself is safe.',
    )
    // And the retry is a second tap, not a second typing.
    expect(screen.getByTestId('capture-title-input').props.value).toBe('Frog pond outflow')
    // Nothing claims a save that did not happen.
    expect(screen.queryByTestId('capture-save-confirmation')).toBeNull()
  })

  it('shows a failed notes save inside the editor too', async () => {
    mockRepo.renameRecord.mockImplementation(() => Promise.reject(new Error('database is locked')))

    await renderRecorded()
    await fireEvent.press(screen.getByTestId('affordance-description'))
    await fireEvent.changeText(screen.getByTestId('capture-description-input'), 'Wet gully, ferns')
    await fireEvent.press(screen.getByTestId('capture-description-save'))
    await settle()

    const overlay = overlayAround(screen.getByTestId('capture-description-input'))
    expect(within(overlay).getByTestId('capture-description-error')).toHaveTextContent(
      'The notes were not saved: database is locked. The point itself is safe.',
    )
  })

  it('genuinely disables both of the editor’s controls while the write is out (doctrine rule 18)', async () => {
    // Not an `onPress` that returns early: a control that looks pressable and
    // swallows the tap teaches her the tap did not register when it did.
    const write = deferred<FieldRecord>()
    mockRepo.renameRecord.mockImplementation(() => write.promise)

    await renderRecorded()
    await fireEvent.press(screen.getByTestId('affordance-title'))
    await fireEvent.changeText(screen.getByTestId('capture-title-input'), 'Frog pond outflow')
    await fireEvent.press(screen.getByTestId('capture-title-save'))
    await settle()

    expect(screen.getByTestId('capture-title-save')).toBeDisabled()
    expect(screen.getByTestId('capture-title-save').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    )
    // The cancel too, and for a reason of its own: closing the editor takes
    // the failure message with it, so a cancel accepted while the write is
    // still out could land a failure on a surface that no longer exists.
    expect(screen.getByTestId('capture-editor-cancel')).toBeDisabled()
    expect(screen.getByTestId('capture-editor-cancel').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    )

    await act(async () => {
      write.resolve(amendRecord('record-1', { title: 'Frog pond outflow' }))
      await Promise.resolve()
    })
    await settle()

    expect(screen.getByTestId('capture-save-confirmation')).toHaveTextContent(
      'Name saved: Frog pond outflow',
    )
  })
})

/**
 * The three keyboard faults reported off the S25 release build, once the modal
 * itself was judged right ("modal works well"):
 *
 *   1. "it's a pain to shift from bottom of screen to top. make the text box
 *      and controls appear in the middle of the screen above where the
 *      keyboard appears."
 *   2. "when the screen opens, the keyboard should already be open and the
 *      text box focused so the user can just start typing."
 *   3. "I try to tap save but it just closes the keyboard as the focus
 *      changes, then i hit save again, which is bad ux."
 *
 * WHAT THESE TESTS CANNOT SEE, STATED PLAINLY. Jest has no keyboard, no
 * layout engine and no window manager. **Nothing below proves any of the
 * three faults is fixed on a device** — there is no soft keyboard to sit
 * above, no measured frame for `KeyboardAvoidingView` to shrink, no input
 * method to open, no window for one to be granted focus in, and RNTL's
 * `fireEvent.press` calls `onPress` directly rather than running the touch
 * through the responder system that ate the real tap. What they prove is that
 * the specific mechanism each fix rests on is present and cannot be deleted in
 * silence:
 *
 * - the card is centred in a flexed box rather than hugging the top,
 * - the input carries `autoFocus` and nothing focuses it imperatively (which
 *   would be the no-op, not the other way round — see `FieldEditor`),
 * - the editor's SAVE is NOT inside `capture-recorded-scroll`, so the scroll
 *   view that ate the first tap is no longer on its responder path at all.
 *
 * Whether each of those actually produces the behaviour she asked for is a
 * device check, and is written up as one.
 */
describe('the editor’s keyboard behaviour (the second S25 report)', () => {
  it('centres the box and its controls in the space left above the keyboard, as one block', async () => {
    await renderRecorded()
    await fireEvent.press(screen.getByTestId('affordance-title'))

    // ONE BLOCK. The complaint was the eye travelling between the keys at the
    // bottom and a box at the top, so the box and both controls that act on
    // it have to be inside the same card — not merely both somewhere in the
    // modal, which the surrounding suite already asserts and which a layout
    // that split them across the surface would still satisfy.
    const card = screen.getByTestId('capture-editor')
    expect(within(card).getByTestId('capture-title-input')).toBeTruthy()
    expect(within(card).getByTestId('capture-title-save')).toBeTruthy()
    expect(within(card).getByTestId('capture-editor-cancel')).toBeTruthy()

    // And that card is centred in whatever height it is handed, rather than
    // pinned to the top of it — which is what shipped, and what was reported
    // back. The height it is handed is `KeyboardAvoidingView`'s content box,
    // which on a device is the band above the keyboard; that part is not
    // visible from here.
    const holder = card.parent
    if (holder === null) {
      throw new Error('The editor card is not inside anything.')
    }
    const style = StyleSheet.flatten<ViewStyle>(holder.props.style)
    // Both, and both load-bearing: without `flex: 1` there is no box to
    // centre in and the card collapses back to the top of the surface.
    expect(style.flex).toBe(1)
    expect(style.justifyContent).toBe('center')
  })

  it('asks for the keyboard the one way that works in this window, and does not fight itself over it', async () => {
    // The mocked `TextInput`'s `focus` lives on its prototype
    // (`@react-native/jest-preset`'s `mockComponent` assigns `MockNativeMethods`
    // there), so a spy here would catch any imperative focus the component
    // made through a ref. Restored by hand: this file deliberately does not
    // `restoreAllMocks` between tests.
    const focus = jest.spyOn(TextInput.prototype, 'focus')
    try {
      await renderRecorded()

      // BOTH FIELDS, because the last two attempts each worked for the title
      // and not for the notes, and a test that only opened one would have
      // reported both of them fixed.
      for (const [tile, input] of [
        ['affordance-title', 'capture-title-input'],
        ['affordance-description', 'capture-description-input'],
      ] as const) {
        await fireEvent.press(screen.getByTestId(tile))

        // `autoFocus`, AND IT IS NOW THE WHOLE MECHANISM. In RN 0.86.3
        // `autoFocus` is a native prop, not a JS effect:
        // `ReactEditText.onAttachedToWindow` calls
        // `requestFocusProgrammatically()`, which is `requestFocus()` followed
        // by an explicit `showSoftKeyboard()` —
        // `inputMethodManager.showSoftInput(this, 0)`. It failed inside a
        // `Modal` because the dialog's window is created with
        // `FLAG_NOT_FOCUSABLE` and only has it cleared after `show()`
        // (`ReactModalHostView.kt`), so the request landed on a window that
        // could not yet hold IME focus. In this Activity's window there is no
        // such wait.
        expect(screen.getByTestId(input).props.autoFocus).toBe(true)

        // AND NOTHING FOCUSES IT IMPERATIVELY. Not belt-and-braces if added:
        // the native focus `autoFocus` causes sets
        // `TextInputState.currentlyFocusedInputRef`, and `focusTextInput`
        // returns early for the field that is already current — so a
        // `ref.focus()` alongside this would be the no-op, and would read in
        // the source as though it were the thing doing the work.
        expect(focus).not.toHaveBeenCalled()

        await fireEvent.press(screen.getByTestId('capture-editor-cancel'))
      }
    } finally {
      focus.mockRestore()
    }
  })

  it('takes the editor’s SAVE off the responder path of the scroll view that ate the first tap', async () => {
    await renderRecorded()
    await fireEvent.press(screen.getByTestId('affordance-title'))

    // THE ANCESTOR IS THE POINT, AND THE CLAIM IS NOW A NEGATIVE. React
    // Native's responder system builds its propagation path from the REACT
    // tree, so while the editor was a child of this scroll view — even as a
    // `Modal`, in a separate Android window — the scroll view's
    // `onStartShouldSetResponderCapture` ran first for a touch on SAVE, took
    // the responder and blurred the input instead of letting the press
    // through (`ScrollView.js`). That is the reported "it just closes the
    // keyboard … then i hit save again". The editor is a SIBLING of that
    // scroll view now, so the path does not pass through it at all.
    // `includeHiddenElements` so that THIS assertion is what fails when the
    // editor moves back into the column, rather than the lookup: a SAVE inside
    // that scroll view is also hidden from a reader by the
    // `importantForAccessibility` the scroll view carries while the editor is
    // open, and a failure that says "unable to find capture-title-save" names
    // the symptom rather than the claim.
    expect(
      enclosingScrollViewTestIDs(
        screen.getByTestId('capture-title-save', { includeHiddenElements: true }),
      ),
    ).not.toContain('capture-recorded-scroll')

    // THE POSITIVE CONTROL, without which the line above proves nothing: a
    // walk that found no scroll views ever would satisfy it just as well. A
    // tile in the recorded column IS inside that scroll view, so the walk
    // demonstrably works.
    expect(
      enclosingScrollViewTestIDs(
        screen.getByTestId('affordance-title', { includeHiddenElements: true }),
      ),
    ).toContain('capture-recorded-scroll')

    // The prop itself stays, and is no longer what holds the fault off — see
    // the comment on the scroll view. `'handled'` and not `'always'`: a tap on
    // nothing in particular should still put a keyboard away.
    expect(
      screen.getByTestId('capture-recorded-scroll', { includeHiddenElements: true }).props
        .keyboardShouldPersistTaps,
    ).toBe('handled')
  })

  it('covers the whole screen and swallows the touches that reach it, so nothing behind is pressable', async () => {
    await renderRecorded()
    await fireEvent.press(screen.getByTestId('affordance-title'))

    const overlay = screen.getByTestId('capture-editor-overlay')

    /*
      A `Modal` gave both of these for free by being a separate Android
      window. An overlay has to state them.

      Absolutely filled, and filled against `Screen` — which carries
      `spacing.lg` of padding. That matters and is not obvious: Yoga positions
      an absolutely positioned child with insets against its containing
      block's PADDING box, not its content box (`AbsoluteLayout.cpp` —
      `positionAbsoluteChild` adds the parent's border and not its padding,
      and the child is sized `measuredDimension - borders - insets`), so the
      scrim reaches the screen edge rather than stopping a gutter short of it.
    */
    const style = StyleSheet.flatten<ViewStyle>(overlay.props.style)
    expect(style.position).toBe('absolute')
    expect([style.top, style.right, style.bottom, style.left]).toEqual([0, 0, 0, 0])

    /*
      And it claims any touch that reaches it. React Native does not re-hit-test
      the siblings underneath a node it has already hit, so a scrim that
      claimed nothing would drop the touch too — by accident. Saying so is what
      makes it survive a refactor, and it is the BUBBLE phase (`...Responder`,
      not `...ResponderCapture`), so the box and the two buttons inside still
      take their own touches first.
    */
    const claimsTouches: unknown = overlay.props.onStartShouldSetResponder
    if (typeof claimsTouches !== 'function') {
      throw new Error('The overlay does not claim touches at all.')
    }
    expect(claimsTouches()).toBe(true)
    expect(overlay.props.onStartShouldSetResponderCapture).toBeUndefined()
  })

  describe('the Android back button, which a Modal used to give for free', () => {
    /**
     * The handler the editor registers, or a failure.
     *
     * WHY A SPY AND NOT A FIRED EVENT. `jest-expo` defaults to the **ios**
     * platform (`jest-preset.js`, `haste.defaultPlatform`), so `BackHandler`
     * resolves to `BackHandler.ios.js` — whose `addEventListener` is a stub
     * that stores nothing and whose `exitApp` is `emptyFunction`. There is no
     * `hardwareBackPress` to emit and nothing that would receive it. Spying on
     * `addEventListener` reaches the one thing that IS real here: the
     * component's own registration, and the function it registered.
     *
     * STATED PLAINLY: this proves `FieldEditor`'s contract — that it registers
     * for BACK while it is open, consumes the press, respects the mid-write
     * guard, and unregisters when it closes. It does not prove Android
     * delivers the press, which is a device check.
     */
    function backHandlerOf(
      spy: jest.SpiedFunction<typeof BackHandler.addEventListener>,
    ): (event: HardwareBackPressEvent) => boolean | null | undefined {
      const registrations = spy.mock.calls.filter(
        ([eventName]) => eventName === 'hardwareBackPress',
      )
      // THE LATEST, NOT THE FIRST, and the difference is the guard itself.
      // `FieldEditor`'s effect lists `saving` as a dependency, so starting a
      // write tears the old listener down and registers a new one — the old
      // one closed over `saving === false` and would dismiss the editor out
      // from under a write in flight. Reading the first registration back
      // tests a listener the component has already removed.
      const registration = registrations[registrations.length - 1]
      if (registration === undefined) {
        throw new Error('The editor registered no hardwareBackPress handler.')
      }
      return registration[1]
    }

    /** The event object RN hands a `hardwareBackPress` handler. */
    const backPress: HardwareBackPressEvent = { type: 'hardwareBackPress', timeStamp: 0 }

    it('closes the editor without writing anything, and consumes the press', async () => {
      const add = jest.spyOn(BackHandler, 'addEventListener')
      try {
        await renderRecorded()
        // Nothing registered until the editor is up: BACK on the recorded
        // screen has to keep meaning what it means everywhere else.
        expect(add).not.toHaveBeenCalled()

        await fireEvent.press(screen.getByTestId('affordance-title'))
        await fireEvent.changeText(screen.getByTestId('capture-title-input'), 'Frog pond outflow')

        // `true` in both branches, which is the shape `Modal`'s
        // `onRequestClose` had: BACK is consumed for as long as this surface
        // is up. Returning `false` here would let the press fall through to
        // expo-router and pop the route, taking her off the recorded point
        // entirely with an editor open over it.
        let consumed: unknown
        await act(async () => {
          consumed = backHandlerOf(add)(backPress)
          await Promise.resolve()
        })
        expect(consumed).toBe(true)

        // Closed, and nothing written — a dismissal is a cancel.
        expect(screen.queryByTestId('capture-title-input')).toBeNull()
        expect(mockRepo.renameRecord).not.toHaveBeenCalled()
        // And no confirmation, because nothing was confirmed.
        expect(screen.queryByTestId('capture-save-confirmation')).toBeNull()
      } finally {
        add.mockRestore()
      }
    })

    it('refuses to dismiss mid-write, so a failure cannot land on a surface that has gone', async () => {
      // The same guard CANCEL carries, and for the same reason: closing the
      // editor takes the failure message with it, and this one is hardware —
      // there is nothing on screen to disable, so it has to be a guard.
      const write = deferred<FieldRecord>()
      mockRepo.renameRecord.mockImplementation(() => write.promise)

      const add = jest.spyOn(BackHandler, 'addEventListener')
      try {
        await renderRecorded()
        await fireEvent.press(screen.getByTestId('affordance-title'))
        await fireEvent.changeText(screen.getByTestId('capture-title-input'), 'Frog pond outflow')
        await fireEvent.press(screen.getByTestId('capture-title-save'))
        await settle()

        // The listener was re-registered when `saving` became `true` — which
        // is the mechanism, not an implementation detail: a listener that
        // stayed as it was would still be closed over `saving === false` and
        // would dismiss the editor with the write still out.
        expect(
          add.mock.calls.filter(([eventName]) => eventName === 'hardwareBackPress').length,
        ).toBeGreaterThan(1)

        let consumed: unknown
        await act(async () => {
          consumed = backHandlerOf(add)(backPress)
          await Promise.resolve()
        })
        // Still consumed — BACK must not escape the surface either — but the
        // editor is still there, with her text and the SAVING… label.
        expect(consumed).toBe(true)
        expect(screen.getByTestId('capture-title-input').props.value).toBe('Frog pond outflow')
        expect(screen.getByTestId('capture-editor-cancel')).toBeDisabled()

        await act(async () => {
          write.resolve(amendRecord('record-1', { title: 'Frog pond outflow' }))
          await Promise.resolve()
        })
        await settle()

        expect(screen.getByTestId('capture-save-confirmation')).toHaveTextContent(
          'Name saved: Frog pond outflow',
        )
      } finally {
        add.mockRestore()
      }
    })

    it('gives the button back when the editor closes', async () => {
      // A listener left registered would go on swallowing BACK on the
      // recorded screen, where it is the way out.
      const remove = jest.fn<void, []>()
      const add = jest.spyOn(BackHandler, 'addEventListener').mockReturnValue({ remove })
      try {
        await renderRecorded()
        await fireEvent.press(screen.getByTestId('affordance-title'))
        expect(add).toHaveBeenCalled()

        await fireEvent.press(screen.getByTestId('capture-editor-cancel'))

        expect(remove).toHaveBeenCalled()
      } finally {
        add.mockRestore()
      }
    })
  })

  it('saves and closes on that one press, with the confirmation left standing behind it', async () => {
    await renderRecorded()
    await fireEvent.press(screen.getByTestId('affordance-title'))
    await fireEvent.changeText(screen.getByTestId('capture-title-input'), 'Frog pond outflow')

    // ONE press. Not a press to dismiss a keyboard and a second to hit the
    // button. Jest cannot make the first kind of press happen — `fireEvent`
    // calls `onPress` — so what this pins is the other half of the report:
    // that a save which does land is a single action, writing and closing,
    // with nothing further to press.
    await fireEvent.press(screen.getByTestId('capture-title-save'))
    await settle()

    expect(mockRepo.renameRecord).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('capture-title-input')).toBeNull()
    // And the closing modal is still not the confirmation — a cancel closes
    // it identically. The sentence and the tick are.
    expect(screen.getByTestId('capture-save-confirmation')).toHaveTextContent(
      'Name saved: Frog pond outflow',
    )
    expect(screen.getByTestId('affordance-title-label')).toHaveTextContent('Title ✓')
  })
})

describe('playing a voice note back, and removing an attachment (Task 12)', () => {
  it('plays a voice note when its tile is pressed', async () => {
    listMedia.mockResolvedValue([voiceRow('med_b')])
    await renderRecorded()
    await settle()

    await fireEvent.press(screen.getByTestId('media-tile-med_b'))

    // The player is handed the stored file's URI, not merely pressed —
    // `replace` before `play` is what lets the one player this screen owns
    // stand in for whichever voice tile she taps.
    expect(replace).toHaveBeenCalledWith('file:///media/med_b.m4a')
    expect(play).toHaveBeenCalled()
  })

  it('does nothing when a photo tile is pressed', async () => {
    // The other half of the same wiring: `MediaStrip` takes one `onPress` for
    // the whole strip, so a photo tile reaches this screen's handler too —
    // and the handler is required to recognise it is a photo and do nothing,
    // rather than handing its URI to an audio player that cannot play it. A
    // build that called `replace`/`play` regardless of kind would satisfy
    // "plays a voice note" above and only fail here.
    listMedia.mockResolvedValue([photoRow('med_a')])
    await renderRecorded()
    await settle()

    await fireEvent.press(screen.getByTestId('media-tile-med_a'))

    expect(replace).not.toHaveBeenCalled()
    expect(play).not.toHaveBeenCalled()
  })

  it('logs that a voice note was played', async () => {
    // `'played'` is already a valid event action in migration 003's CHECK —
    // it was put there for exactly this. The event log is chain of custody
    // (spec §8.5), and who listened to a field note and when is part of it.
    listMedia.mockResolvedValue([voiceRow('med_b')])
    await renderRecorded()
    await settle()

    await fireEvent.press(screen.getByTestId('media-tile-med_b'))
    await settle()

    expect(appendEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'played', recordId: 'record-1' }),
    )
  })

  it('does not log a play that never started', async () => {
    // `play` throwing is `AudioPlayer.play()`'s own failure mode for a
    // decoder or source refusal — both `play` and `replace` are synchronous
    // (`node_modules/expo-audio/build/AudioModule.types.d.ts`), so a failure
    // surfaces here, not through a rejected promise. An event logged from
    // this path would be a false entry in a log nothing can remove.
    play.mockImplementation(() => {
      throw new Error('decoder failed')
    })
    listMedia.mockResolvedValue([voiceRow('med_b')])
    await renderRecorded()
    await settle()

    await fireEvent.press(screen.getByTestId('media-tile-med_b'))
    await settle()

    expect(appendEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'played' }),
    )
  })

  it('carries a help affordance for what attaching means (doctrine rule 7)', async () => {
    // The recorded state used to be exempt from rule 7, and the exemption was
    // granted with an explicit expiry written into `docs/ui-doctrine.md` and
    // into `capture.tsx`'s own comment: it held only while everything the
    // state asked for explained itself, and named "attaching media" in
    // advance as the change that would end it. This branch made that change,
    // so the affordance is here. Asserted through the modal it opens, the way
    // the ready state's own help test is — a `?` that renders and does
    // nothing satisfies presence and fails the rule.
    listMedia.mockResolvedValue([])
    await renderRecorded()
    await settle()

    await fireEvent.press(screen.getByTestId('capture-media-help'))
    expect(screen.getByText('Photos and voice notes')).toBeTruthy()
    // The one fact nothing on the screen can show her, and the reason a `?`
    // here is not decoration: removing an attachment does not give the
    // storage back, because there is no purge. Phrased without the word.
    expect(screen.getByText(/does not free up any space/)).toBeTruthy()
    expect(screen.queryByText(/purge/i)).toBeNull()
  })

  it('confirms before removing an attachment', async () => {
    // Doctrine rule 4: warn, never block. But a photo removed by a mis-tap on
    // a strip of thumbnails is gone from her view with no undo on this
    // screen, so this is the one input affordance that asks first.
    listMedia.mockResolvedValue([photoRow('med_a')])
    await renderRecorded()
    await settle()

    await fireEvent.press(screen.getByTestId('media-remove-med_a'))

    expect(softDeleteMedia).not.toHaveBeenCalled()
    expect(screen.getByTestId('media-remove-confirm')).toBeTruthy()
    // On screen, not an `Alert` — the same reason the camera screen's error
    // is inline: a modal that dismisses takes the question with it. Asserted
    // by what the confirmation actually says, not merely that some element
    // with the right testID exists.
    expect(screen.getByText(/Remove photo 1 of 1\?/)).toBeTruthy()
  })

  it('names which attachment it is about to remove, not merely its kind', async () => {
    // "Remove this photo?" names a kind, and a kind is not an identity. The
    // strip holds up to ten near-identical 64dp thumbnails, roughly five
    // visible, back at offset 0 after every refresh, and there is no undo
    // anywhere in the app — so the question has to say WHICH. The ordinal is
    // the strip's own (`mediaStripLabel`), so the sentence and the tile it
    // marks cannot disagree.
    listMedia.mockResolvedValue([photoRow('med_a'), photoRow('med_b'), photoRow('med_c')])
    await renderRecorded()
    await settle()

    await fireEvent.press(screen.getByTestId('media-remove-med_b'))

    expect(screen.getByText(/Remove photo 2 of 3\?/)).toBeTruthy()
    expect(screen.getByTestId('media-remove-confirm').props.accessibilityLabel).toBe(
      'Remove photo 2 of 3',
    )
  })

  it('numbers a voice note among the voice notes, not among everything attached', async () => {
    // The same within-kind numbering `MediaStrip` uses for its own tiles. A
    // flat count over the strip would ask "Remove voice note 4 of 4?" of the
    // second of two voice notes sitting behind two photos — a number she
    // cannot match to anything she can see.
    listMedia.mockResolvedValue([
      photoRow('med_a'),
      photoRow('med_b'),
      voiceRow('med_v'),
      voiceRow('med_w'),
    ])
    await renderRecorded()
    await settle()

    await fireEvent.press(screen.getByTestId('media-remove-med_w'))

    expect(screen.getByText(/Remove voice note 2 of 2\?/)).toBeTruthy()
  })

  it('marks the tile in the strip that the question is about', async () => {
    // The other half of naming it: the sentence says "photo 2 of 3" and the
    // strip says which tile that is. Without this, counting tiles against a
    // number is the only way to tell, on a strip that does not all fit on
    // screen.
    listMedia.mockResolvedValue([photoRow('med_a'), photoRow('med_b'), photoRow('med_c')])
    await renderRecorded()
    await settle()

    await fireEvent.press(screen.getByTestId('media-remove-med_b'))

    expect(screen.getByTestId('media-tile-med_b').props.accessibilityLabel).toBe(
      'Photo 2 of 3, the attachment the removal question is about',
    )
    expect(screen.getByTestId('media-tile-med_a').props.accessibilityLabel).toBe('Photo 1 of 3')
    expect(screen.getByTestId('media-tile-med_b').props.style.borderColor).toBe(
      darkTheme.colors.statusFair,
    )
    expect(screen.getByTestId('media-tile-med_a').props.style.borderColor).toBe(
      darkTheme.colors.border,
    )
  })

  it('promises no purge, because there is none', async () => {
    // This sentence used to end "The file stays on the device until a purge."
    // No purge exists — no settings route, no reconciliation, nothing in the
    // application that deletes a media file (`docs/media-storage.md` §5) — so
    // that was a mechanism offered to a field ecologist that nobody had
    // built, and "purge" is a software word besides (doctrine rule 6). The
    // duplicate-pin warning a few lines up the same screen already models
    // the honest version: it stopped offering a deletion the app cannot
    // perform. What is true is that the file stays on the device, and the
    // sentence stops there.
    listMedia.mockResolvedValue([photoRow('med_a')])
    await renderRecorded()
    await settle()

    await fireEvent.press(screen.getByTestId('media-remove-med_a'))

    expect(screen.queryByText(/purge/i)).toBeNull()
    expect(screen.getByText(/The file stays on the device\./)).toBeTruthy()
  })

  it('names a voice note correctly, not as a photo', async () => {
    // Every removal test above and below this one uses `photoRow` — a build
    // that hardcoded 'photo' at both call sites of the kind→noun mapping
    // would pass every one of them and still ask "Remove this photo?", in
    // text and out loud, over a voice note. Both call sites of the mapping
    // are asserted: the on-screen sentence, and the confirm button's own
    // spoken label — a screen reader must not say the wrong noun even if the
    // visible text somehow got it right.
    listMedia.mockResolvedValue([voiceRow('med_v')])
    await renderRecorded()
    await settle()

    await fireEvent.press(screen.getByTestId('media-remove-med_v'))

    expect(screen.getByText(/Remove voice note 1 of 1\?/)).toBeTruthy()
    expect(screen.getByTestId('media-remove-confirm').props.accessibilityLabel).toBe(
      'Remove voice note 1 of 1',
    )
  })

  it('removes it once confirmed', async () => {
    listMedia.mockResolvedValue([photoRow('med_a')])
    await renderRecorded()
    await settle()

    await fireEvent.press(screen.getByTestId('media-remove-med_a'))
    await fireEvent.press(screen.getByTestId('media-remove-confirm'))
    await settle()

    expect(softDeleteMedia).toHaveBeenCalledWith(
      expect.anything(),
      'med_a',
      mockDevice.id,
      expect.anything(),
    )
  })

  it('paints REMOVE and KEEP IT differently, not just labels them differently', async () => {
    // Doctrine rule 9: colour never alone. `kind="danger"` on REMOVE versus
    // `kind="secondary"` on KEEP IT is what makes the destructive control
    // read differently by *colour*, not merely by the word printed on it —
    // nothing above this test would notice `kind="danger"` being reverted to
    // `kind="secondary"`, since both still render, both still say what they
    // say, and every other assertion in this file passes either way.
    listMedia.mockResolvedValue([photoRow('med_a')])
    await renderRecorded()
    await settle()

    await fireEvent.press(screen.getByTestId('media-remove-med_a'))

    const confirmBg = screen.getByTestId('media-remove-confirm').props.style.backgroundColor
    const cancelBg = screen.getByTestId('media-remove-cancel').props.style.backgroundColor
    expect(confirmBg).toBe(darkTheme.colors.statusPoor)
    expect(cancelBg).toBe(darkTheme.colors.surfaceRaised)
    expect(confirmBg).not.toBe(cancelBg)
  })

  it('stops showing a removed attachment', async () => {
    // The initial fetch (on focus) sees the photo; `confirmRemoval` calls
    // `listMedia` again to refresh, rather than computing the new list
    // itself by filtering the removed id out of `media` locally. (This does
    // not, on its own, prove that second call is the SAME ticketed
    // `refresh()` a focus return uses — `capture.tsx`'s own doc comment on
    // `refresh` — since a hand-rolled `setMedia(await listMedia(...))` also
    // calls `listMedia` twice and would pass the assertion below, while
    // dropping the generation ticket and the mounted guard.) The
    // `toHaveBeenCalledTimes(2)` below is what actually pins that: a local
    // filter would leave the strip and the count exactly as they are
    // asserted below while `listMedia` was called only once — this is the
    // assertion that fails on that shortcut and only on it, since a local
    // filter renders an identical screen to a real refetch when `listMedia`'s
    // second answer agrees with what the filter would have produced anyway
    // (as it does here, both being "the photo is gone").
    listMedia.mockResolvedValueOnce([photoRow('med_a')])
    await renderRecorded()
    await settle()

    listMedia.mockResolvedValueOnce([])
    await fireEvent.press(screen.getByTestId('media-remove-med_a'))
    await fireEvent.press(screen.getByTestId('media-remove-confirm'))
    await settle()

    expect(listMedia).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('media-tile-med_a')).toBeNull()
    // And the count on the affordance tile agrees with it — the same two
    // channels asked of a save's own success below.
    expect(screen.getByTestId('affordance-photo-label')).toHaveTextContent('Photo')
  })

  it('keeps the attachment when the removal is declined', async () => {
    listMedia.mockResolvedValue([photoRow('med_a')])
    await renderRecorded()
    await settle()

    await fireEvent.press(screen.getByTestId('media-remove-med_a'))
    await fireEvent.press(screen.getByTestId('media-remove-cancel'))
    await settle()

    expect(softDeleteMedia).not.toHaveBeenCalled()
    expect(screen.getByTestId('media-tile-med_a')).toBeTruthy()
    expect(screen.queryByTestId('media-remove-confirm')).toBeNull()
  })

  it('says so and keeps the tile when the removal fails', async () => {
    // THE TEST THAT MATTERS MOST (task-12-brief.md). An optimistic removal
    // that hides the tile and then fails leaves her believing a photo is
    // gone when it is still attached, and the export will disagree with her.
    listMedia.mockResolvedValue([photoRow('med_a')])
    softDeleteMedia.mockRejectedValue(new Error('database locked'))
    await renderRecorded()
    await settle()

    await fireEvent.press(screen.getByTestId('media-remove-med_a'))
    await fireEvent.press(screen.getByTestId('media-remove-confirm'))
    await settle()

    expect(screen.getByTestId('media-tile-med_a')).toBeTruthy()
    expect(screen.getByTestId('media-remove-error')).toHaveTextContent(
      'The attachment was not removed: database locked. It is still attached.',
    )
  })

  it('strips trailing punctuation from the failure detail, rather than doubling it', async () => {
    // The one fixture above ("database locked") carries no trailing
    // punctuation of its own, so it cannot tell `detail.replace(/[.?!…]+$/,
    // '')` apart from a build that never called it at all — both produce the
    // same sentence. A detail that already ends in punctuation is the only
    // fixture that can: unstripped, it renders as "database locked!. It is
    // still attached." — a doubled, ungrammatical stop this sentence must
    // never show her.
    listMedia.mockResolvedValue([photoRow('med_a')])
    softDeleteMedia.mockRejectedValue(new Error('database locked!'))
    await renderRecorded()
    await settle()

    await fireEvent.press(screen.getByTestId('media-remove-med_a'))
    await fireEvent.press(screen.getByTestId('media-remove-confirm'))
    await settle()

    expect(screen.getByTestId('media-remove-error')).toHaveTextContent(
      'The attachment was not removed: database locked. It is still attached.',
    )
  })

  it('strips a run of trailing punctuation, not just a single mark', async () => {
    // The fixture above ("database locked!") carries exactly one trailing
    // mark, which `/[.?!…]+$/` and a narrower `/[.!]$/` both strip — the `+`
    // quantifier is not exercised by a single character. "database locked?!"
    // is: unstripped, or stripped by only one character, it renders as
    // "database locked?!. It is still attached." or "database locked?. It is
    // still attached." — either still a doubled, ungrammatical stop.
    listMedia.mockResolvedValue([photoRow('med_a')])
    softDeleteMedia.mockRejectedValue(new Error('database locked?!'))
    await renderRecorded()
    await settle()

    await fireEvent.press(screen.getByTestId('media-remove-med_a'))
    await fireEvent.press(screen.getByTestId('media-remove-confirm'))
    await settle()

    expect(screen.getByTestId('media-remove-error')).toHaveTextContent(
      'The attachment was not removed: database locked. It is still attached.',
    )
  })
})

/**
 * Doctrine rule 16 on this screen (`packages/ui/src/primitives/Screen.tsx`
 * renders the description on a dedicated zero-size `accessible` node).
 *
 * Nothing here used to reference `spokenDescription` at all: stripping every
 * one of the five off `capture.tsx` left this whole suite green, so the rule
 * was enforced on the two screens this branch is about by nothing but
 * memory. `voice.test.tsx` was the only file in the repository asserting one.
 *
 * The `Screen`s carry a `testID` for the same reason `voice.tsx`'s does —
 * without one, `Screen` renders the node with no `testID` of its own and
 * there is nothing to find it by.
 */
describe('the spoken description (doctrine rule 16)', () => {
  function spokenDescription(): unknown {
    return screen.getByTestId('capture-screen-spoken-description').props.accessibilityLabel
  }

  it('describes the ready state', async () => {
    await arriveWithAFix()
    expect(spokenDescription()).toEqual(
      expect.stringContaining('The live position and its accuracy'),
    )
  })

  it('describes the acquiring state', async () => {
    await arriveWithAFix()
    await tap()
    expect(spokenDescription()).toEqual(expect.stringContaining('Acquiring a fix.'))
  })

  it('describes the recorded state, and says nothing is attached when nothing is', async () => {
    listMedia.mockResolvedValue([])
    await renderRecorded()
    await settle()
    expect(spokenDescription()).toEqual(
      expect.stringContaining('A survey point has been recorded and its position is final.'),
    )
    expect(spokenDescription()).toEqual(expect.stringContaining('Nothing is attached to it yet.'))
  })

  it('says what is attached, and that it is in a strip', async () => {
    // The recorded state's sentence named the capture number, the accuracy,
    // how the wait ended and the two ways onward — and never the
    // attachments, which is exactly what this branch added to that state. A
    // screen-reader user was told about a screen that no longer exists.
    // Counted per kind, so a build reading `media.length` twice cannot pass.
    listMedia.mockResolvedValue([photoRow('med_a'), photoRow('med_b'), voiceRow('med_v')])
    await renderRecorded()
    await settle()
    expect(spokenDescription()).toEqual(
      expect.stringContaining('2 photos and 1 voice note are attached, in a strip of tiles'),
    )
  })

  it('uses the singular for a single attachment', async () => {
    listMedia.mockResolvedValue([voiceRow('med_v')])
    await renderRecorded()
    await settle()
    expect(spokenDescription()).toEqual(expect.stringContaining('1 voice note is attached'))
  })

  it('says a removal question is open, and which attachment it is about', async () => {
    // The one a screen reader most needs, and the one the marked tile cannot
    // convey: REMOVE is destructive, there is no undo, and "photo 2 of 3" is
    // the only thing that says which of three near-identical thumbnails goes.
    listMedia.mockResolvedValue([photoRow('med_a'), photoRow('med_b'), photoRow('med_c')])
    await renderRecorded()
    await settle()

    await fireEvent.press(screen.getByTestId('media-remove-med_b'))

    expect(spokenDescription()).toEqual(
      expect.stringContaining('You are being asked whether to remove photo 2 of 3'),
    )
  })

  it('takes the question back out of the description when it is declined', async () => {
    listMedia.mockResolvedValue([photoRow('med_a')])
    await renderRecorded()
    await settle()

    await fireEvent.press(screen.getByTestId('media-remove-med_a'))
    await fireEvent.press(screen.getByTestId('media-remove-cancel'))
    await settle()

    expect(spokenDescription()).toEqual(expect.not.stringContaining('asked whether to remove'))
  })

  /**
   * The editor is a new surface — so it carries a description of its own
   * rather than borrowing the capture screen's, which describes the point, its
   * attachments and the ways onward, none of which is reachable while the
   * editor is up.
   *
   * **A `Modal` made that true for free and an overlay does not.** A dialog is
   * a separate Android window and a screen reader does not read the window
   * behind it. An overlay is in the same window as the column it covers, so
   * two things have to be done by hand, and the pair of them are what the
   * `hides the whole surface behind it` block below pins: the column is put
   * out of a reader's reach, and the screen's own description is withdrawn so
   * that two surfaces are not describing themselves at once.
   */
  describe('the editor’s own, because it is a new surface', () => {
    function editorDescription(): unknown {
      return screen.getByTestId('capture-editor-spoken-description').props.accessibilityLabel
    }

    it('does not exist until the editor is opened', async () => {
      await renderRecorded()
      expect(screen.queryByTestId('capture-editor-spoken-description')).toBeNull()
    })

    describe('hides the whole surface behind it, which the Modal did by being a window', () => {
      it('takes the recorded column out of a screen reader’s reach while the editor is open', async () => {
        await renderRecorded()

        // Reachable before, so the assertion after has something to change.
        expect(screen.getByTestId('affordance-title')).toBeTruthy()
        expect(screen.getByTestId('capture-recorded-scroll').props.importantForAccessibility).toBe(
          'auto',
        )

        await fireEvent.press(screen.getByTestId('affordance-title'))

        // `no-hide-descendants` is the ANDROID mechanism, and the only one
        // that works on the device this app is for.
        // `accessibilityViewIsModal` — which the overlay also carries — is
        // genuinely iOS-only in RN 0.86.3: it is declared in
        // `BaseViewConfig.ios.js`, absent from `BaseViewConfig.android.js`,
        // and has no implementation anywhere under `ReactAndroid/`. Asserting
        // only that prop would have been asserting a no-op.
        expect(
          screen.getByTestId('capture-recorded-scroll', { includeHiddenElements: true }).props
            .importantForAccessibility,
        ).toBe('no-hide-descendants')
        expect(screen.getByTestId('capture-editor-overlay').props.accessibilityViewIsModal).toBe(
          true,
        )

        // And RNTL models that hiding the same way Android does — its queries
        // skip anything under such an ancestor — so this is the mechanism
        // working, not a prop being echoed back.
        expect(screen.queryByTestId('affordance-title')).toBeNull()
        expect(screen.queryByTestId('capture-media-strip')).toBeNull()

        // Given back when the editor closes, or BACK and the tiles are gone
        // for the rest of the session.
        await fireEvent.press(screen.getByTestId('capture-editor-cancel'))
        expect(screen.getByTestId('affordance-title')).toBeTruthy()
      })

      it('withdraws the screen’s own description, so two surfaces do not describe themselves at once', async () => {
        await renderRecorded()

        // The recorded screen describes the point, its attachments and the
        // ways onward — none of which is reachable behind the scrim.
        expect(screen.getByTestId('capture-screen-spoken-description')).toBeTruthy()

        await fireEvent.press(screen.getByTestId('affordance-title'))

        // Gone entirely, not merely hidden: it is a direct child of `Screen`,
        // a sibling of the scroll view, so `importantForAccessibility` on the
        // column above does not cover it. `Screen` drops the node when the
        // prop is `undefined`.
        expect(
          screen.queryByTestId('capture-screen-spoken-description', {
            includeHiddenElements: true,
          }),
        ).toBeNull()
        // And the editor's own is what a reader has instead.
        expect(editorDescription()).toEqual(expect.stringContaining('Naming this point.'))

        await fireEvent.press(screen.getByTestId('capture-editor-cancel'))
        expect(screen.getByTestId('capture-screen-spoken-description')).toBeTruthy()
      })
    })

    it('says which field is being written, and what is on the surface', async () => {
      await renderRecorded()
      await fireEvent.press(screen.getByTestId('affordance-title'))

      expect(editorDescription()).toEqual(expect.stringContaining('Naming this point.'))
      expect(editorDescription()).toEqual(
        expect.stringContaining('a control that saves it onto the point, and one that closes'),
      )
    })

    it('names the notes rather than the name when it is the notes being written', async () => {
      await renderRecorded()
      await fireEvent.press(screen.getByTestId('affordance-description'))

      expect(editorDescription()).toEqual(expect.stringContaining('Notes for this point.'))
    })

    it('says a write is still out, so a reader is not told a dead control is live', async () => {
      const write = deferred<FieldRecord>()
      mockRepo.renameRecord.mockImplementation(() => write.promise)

      await renderRecorded()
      await fireEvent.press(screen.getByTestId('affordance-title'))
      expect(editorDescription()).toEqual(expect.not.stringContaining('Saving.'))

      await fireEvent.changeText(screen.getByTestId('capture-title-input'), 'Frog pond outflow')
      await fireEvent.press(screen.getByTestId('capture-title-save'))
      await settle()

      expect(editorDescription()).toEqual(expect.stringContaining('Saving.'))

      await act(async () => {
        write.resolve(amendRecord('record-1', { title: 'Frog pond outflow' }))
        await Promise.resolve()
      })
      await settle()
    })

    it('carries the failure, which is the one thing on this surface a reader cannot reach by traversing controls', async () => {
      mockRepo.renameRecord.mockImplementation(() =>
        Promise.reject(new Error('database is locked')),
      )

      await renderRecorded()
      await fireEvent.press(screen.getByTestId('affordance-title'))
      await fireEvent.changeText(screen.getByTestId('capture-title-input'), 'Frog pond outflow')
      await fireEvent.press(screen.getByTestId('capture-title-save'))
      await settle()

      expect(editorDescription()).toEqual(
        expect.stringContaining('The name was not saved: database is locked.'),
      )
    })
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
