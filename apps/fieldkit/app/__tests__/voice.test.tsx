import React from 'react'
import { StyleSheet } from 'react-native'
import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { ThemeProvider } from '@corymbia/ui'
import { field } from '@corymbia/tokens'

/**
 * Tests for the voice note screen (Plan 4, Task 9): one toggle that starts
 * and stops a recording and attaches it to a record — the sibling of
 * `camera.tsx` (Task 8). See that screen's own test file for the fuller
 * account of what is and is not mocked and why; the same reasoning applies
 * here, with `expo-audio` standing in for `expo-camera`.
 *
 * Mocked: `expo-audio`. `useAudioRecorder` returns one stable fake
 * `AudioRecorder` instance for the life of a render.
 *
 * **THE MOCK KEEPS TWO STATES, AND THAT IS THE POINT.** On a device
 * `useAudioRecorderState` is a poller — `setInterval(..., 500)`, committing
 * once `canRecord`, `isRecording`, `mediaServicesDidReset`, `url` or
 * `metering` changes, OR `durationMillis` moves by more than 50 ms
 * (`node_modules/expo-audio/build/utils/useAudioRecorderState.js`) — so what
 * the hook returns is up to half a second behind what the recorder is
 * actually doing. An earlier version of this file returned the SAME object
 * from both, which made the two indistinguishable by construction and hid a
 * real bug: a note stopped at 1.4 s whose last poll landed at 0.9 s was
 * reported as 900 ms and silently discarded. `mockLiveState` is the
 * recorder's own truth (`recorder.isRecording`, `recorder.getStatus()`);
 * `mockPolledState` is the poller's last commit. `setRecorderState` moves
 * both — which is what most tests want — and `setLive`/`setPolled` move one,
 * which is what the two tests about the gap between them need.
 *
 * **AND THE STATUS LISTENER IS CAPTURED ONCE, ON PURPOSE.** The real
 * `useAudioRecorder(options, statusListener)` subscribes inside an effect
 * keyed on `[recorder.id]`, so the closure it captures is the one from the
 * FIRST render and is never replaced (`expo-audio/build/ExpoAudio.js`). A
 * mock that overwrote `mockStatusListener` on every render would quietly
 * repair a screen whose listener closed over stale state. This one keeps the
 * first listener it is given per `renderScreen()`, which is what the device
 * does — every interruption test below therefore fires through a closure
 * captured before the recording it is interrupting even started.
 *
 * **AND THE SALVAGE PATH IS NOT REACHABLE ON THE SHIPPED ANDROID PRESET.**
 * Every test below that hands the listener a non-null `url` is testing the
 * public contract and iOS, not what a Galaxy S25 will do this week: with
 * `RecordingPresets.HIGH_QUALITY`, `onError` emits `url: null`
 * unconditionally (`AudioRecorder.kt:345-353`), `onInfo`'s url-bearing branch
 * cannot fire because `setMaxFileSize` is only called when the options carry
 * a `maxFileSize` and that preset carries none
 * (`expo-audio/build/RecordingConstants.js`), and `stopRecording`'s
 * url-bearing emit belongs to a stop this screen asked for and is turned away
 * by the guards. `voice.tsx`'s own handler comment says the same, and says
 * why the branch is kept. The weight of this file therefore sits on the
 * `url: null` path, which is the one a device actually takes.
 *
 * `stop()` is a REAL promise that resolves on a later tick, not a bare
 * `jest.fn()` returning `undefined`: a synchronous mock cannot tell an
 * awaited `stop()` from an unawaited one, and unawaited is exactly the bug
 * the uri-ordering constraint exists to prevent.
 * `AudioModule.requestRecordingPermissionsAsync` is a jest mock, defaulted
 * to granted in `beforeEach`. `RecordingPresets` is present only so
 * importing the module doesn't throw.
 *
 * Mocked: `expo-file-system`'s `File`, so the deletion of a discarded
 * too-short recording is observable without a real cache directory.
 *
 * Mocked: `../../src/media/attachVoice`, the seam Task 10 fills in with the
 * real pipeline (file copy, media id, `attachMedia`). This screen's job is
 * to call it with the right arguments, handle its rejection on screen, and
 * navigate back on success — none of which needs a real file system.
 *
 * Mocked: `../../src/db/provider`'s `useSettings`, for the one field
 * (`handedness`) this screen reads to resolve the reach zone.
 *
 * Mocked: `expo-router`'s `router` singleton and `useLocalSearchParams`.
 *
 * Not mocked: `resolveReach`, `@corymbia/ui`'s `Button`/`Screen`/`Type`, and
 * `ThemeProvider` — the actual rendering this screen is answerable for.
 */

// ---------------------------------------------------------------------------
// Module mocks. As in camera.test.tsx: every mutable fixture a `jest.mock`
// factory closes over is named with a `mock` prefix, because
// babel-plugin-jest-hoist only allows a factory to reference out-of-scope
// identifiers spelled that way. Plain `const` aliases matching the brief's
// own naming are declared after every mock, never inside a factory.
// ---------------------------------------------------------------------------

const mockPrepareToRecordAsync = jest.fn()
const mockRecord = jest.fn()
const mockStop = jest.fn()
// Typed by its own implementation rather than by an `as` at the call site:
// `jest.fn()` alone infers `any`, which is what the getter below used to have
// to cast away. `mockReturnValue` is type-checked against this signature.
const mockUri = jest.fn((): string | null => null)
const mockRequestRecordingPermissionsAsync = jest.fn()
const mockSetAudioModeAsync = jest.fn()

/**
 * The two fields the screen actually reads off a recorder state: the live
 * `isRecording` it branches on, and the `durationMillis` it measures a note
 * by (live) and ticks the display from (polled). `mediaServicesDidReset` used
 * to be here and is gone: it is `@platform ios` in `Audio.types.d.ts`,
 * Android's `getAudioRecorderStatus()` never writes the key, and nothing in
 * the screen reads it any more — a fixture field no test could set
 * meaningfully and no production line consumed.
 */
type MockRecorderState = {
  isRecording: boolean
  durationMillis: number
}

const idleState: MockRecorderState = {
  isRecording: false,
  durationMillis: 0,
}

// What the recorder itself is doing right now: what `recorder.isRecording`
// and `recorder.getStatus()` report, and what the screen is required to
// decide on.
let mockLiveState: MockRecorderState = { ...idleState }
// What `useAudioRecorderState` last committed — up to 500 ms stale.
let mockPolledState: MockRecorderState = { ...idleState }

// One stable object for the life of a render, the way the real
// `useAudioRecorder` hook returns one recorder instance rather than a new
// one every render. `isRecording` and `getStatus()` both read the LIVE
// state; `uri` is a getter backed by `mockUri` so a test can both control
// what it returns (`uri.mockReturnValue(...)`) and prove *when* it was read
// (`uri.mock.invocationCallOrder`).
const mockRecorderInstance = {
  prepareToRecordAsync: (...args: unknown[]) => mockPrepareToRecordAsync(...args),
  record: (...args: unknown[]) => mockRecord(...args),
  stop: (...args: unknown[]) => mockStop(...args),
  getStatus: () => ({ ...mockLiveState }),
  get isRecording() {
    return mockLiveState.isRecording
  },
  get uri() {
    return mockUri()
  },
}

/**
 * The status payload `recordingStatusUpdate` carries
 * (`expo-audio/build/Audio.types.d.ts:252`). Spelled out here rather than
 * imported, because `expo-audio` is mocked in this file.
 */
type MockRecordingStatus = {
  id: string
  isFinished: boolean
  hasError: boolean
  error: string | null
  url: string | null
}

// The FIRST listener this render handed to `useAudioRecorder`, and only the
// first — see the header comment. Cleared by `renderScreen`.
let mockStatusListener: ((status: MockRecordingStatus) => void) | undefined

jest.mock('expo-audio', () => ({
  useAudioRecorder: (
    _options: unknown,
    statusListener?: (status: MockRecordingStatus) => void,
  ) => {
    if (mockStatusListener === undefined) mockStatusListener = statusListener
    return mockRecorderInstance
  },
  useAudioRecorderState: () => mockPolledState,
  AudioModule: {
    requestRecordingPermissionsAsync: (...args: unknown[]) =>
      mockRequestRecordingPermissionsAsync(...args),
  },
  setAudioModeAsync: (...args: unknown[]) => mockSetAudioModeAsync(...args),
  RecordingPresets: { HIGH_QUALITY: {} },
}))

const mockFileConstructed = jest.fn()
const mockFileExists = jest.fn(() => true)
const mockFileDelete = jest.fn()

jest.mock('expo-file-system', () => ({
  File: class {
    constructor(...args: unknown[]) {
      mockFileConstructed(...args)
    }
    get exists(): boolean {
      return mockFileExists()
    }
    delete(): void {
      mockFileDelete()
    }
  },
}))

const mockAttachVoice = jest.fn()

jest.mock('../../src/media/attachVoice', () => ({
  attachVoice: (...args: unknown[]) => mockAttachVoice(...args),
}))

const mockSettings = {
  theme: 'dark' as const,
  handedness: 'right' as const,
  capturePrimary: 'saveNow' as const,
  density: 'comfortable' as const,
}
const mockUseSettings = { settings: mockSettings, updateSetting: () => Promise.resolve() }

jest.mock('../../src/db/provider', () => ({
  useSettings: () => mockUseSettings,
}))

const mockRouterBack = jest.fn()

let mockRecordId: string | undefined = 'rec_a'

jest.mock('expo-router', () => ({
  router: { back: (...args: unknown[]) => mockRouterBack(...args) },
  useLocalSearchParams: () => ({ recordId: mockRecordId }),
}))

// Imported after the mocks so it picks them up.
import VoiceScreen from '../voice'

// Aliases matching the brief's own naming, declared after every mock above —
// never referenced from inside a `jest.mock` factory.
const prepareToRecordAsync = mockPrepareToRecordAsync
const record = mockRecord
const stop = mockStop
const uri = mockUri
const requestRecordingPermissionsAsync = mockRequestRecordingPermissionsAsync
const setAudioModeAsync = mockSetAudioModeAsync
const attachVoice = mockAttachVoice
const routerBack = mockRouterBack
const fileConstructed = mockFileConstructed
const fileDelete = mockFileDelete

/** The recorder's own truth. */
function setLive(patch: Partial<MockRecorderState>) {
  mockLiveState = { ...mockLiveState, ...patch }
}

/** The poller's last commit, which on a device can be up to 500 ms behind. */
function setPolled(patch: Partial<MockRecorderState>) {
  mockPolledState = { ...mockPolledState, ...patch }
}

/**
 * Both at once — the shape of the world when the poller happens to be
 * caught up, which is what most of these tests are about.
 */
function setRecorderState(patch: Partial<MockRecorderState>) {
  setLive(patch)
  setPolled(patch)
}

/**
 * A recorder that behaves the way the device does: `stop()` resolves on a
 * LATER TICK, and the finished file's uri does not exist until it has. Read
 * before that, `recorder.uri` is `null` — which is the whole reason the
 * screen has to await `stop()` before touching it.
 */
function recorderFinishesWith(finishedUri: string) {
  uri.mockReturnValue(null)
  stop.mockImplementation(async () => {
    await Promise.resolve()
    setLive({ isRecording: false })
    uri.mockReturnValue(finishedUri)
  })
}

/**
 * `noUncheckedIndexedAccess` makes `mock.invocationCallOrder[n]` a
 * `number | undefined`, and the brief's own illustrative test reaches for
 * `as number` to get past that — a cast this codebase's tests don't use.
 * This reads the same value through a runtime check instead: a call order
 * that is missing is a test bug (the mock was never called), and that is
 * exactly the sentence this throws.
 */
function callOrder(fn: jest.Mock, index = 0): number {
  const order = fn.mock.invocationCallOrder[index]
  if (order === undefined) {
    throw new Error(`expected call #${String(index)} to have been recorded`)
  }
  return order
}

function uriReadOrder(): number {
  return callOrder(uri)
}

const flatten = StyleSheet.flatten

async function renderScreen() {
  mockStatusListener = undefined
  return render(
    <ThemeProvider initial="dark">
      <VoiceScreen />
    </ThemeProvider>,
  )
}

/**
 * Delivers one `recordingStatusUpdate` through the subscription the screen
 * made on its FIRST render — the only one the real hook keeps. A screen that
 * never subscribed fails here with that sentence rather than with a silent
 * no-op that would let every interruption test below pass vacuously.
 *
 * The defaults are the shape Android's `onError` emits: finished, an error,
 * and no url, because the abandoned `.m4a` was never finalised.
 *
 * `id` is present because the type says it is — and it is the one field no
 * test may lean on. `RecordingStatus.id` is `string`, not optional, but only
 * `stopRecording()` actually puts one in the map (`AudioRecorder.kt:195-206`);
 * `onError` (`:345`) and `onInfo` (`:374`) emit no `id` key at all, which is
 * exactly the pair of paths an interruption arrives on. Every fixture below
 * spells the same `'session-1'` for that reason: it carries no information,
 * and a screen that arbitrated on it would be arbitrating on `undefined` on a
 * device.
 */
async function emitStatus(patch: Partial<MockRecordingStatus> = {}) {
  await act(async () => {
    emitStatusSync(patch)
  })
}

/**
 * The same delivery, WITHOUT its own `act` — for the one thing an awaited
 * `emitStatus` cannot reproduce: an event arriving in the microtask window
 * between the toggle writing a phase and React committing the render that
 * would show it. Called from inside a caller's `act`, alongside an unawaited
 * `fireEvent.press`, exactly the way the double-press test lands two taps in
 * one frame.
 *
 * On a device that window is not theoretical. `stopRecording()` schedules its
 * `recordingStatusUpdate` on `appContext.mainQueue`
 * (`AudioRecorder.kt:195-206`), decoupled from the Bundle it returns — so the
 * report is not sequenced against the promise `stop()` resolves, and it can
 * reach JS while `toggle` is still suspended on that promise.
 */
function emitStatusSync(patch: Partial<MockRecordingStatus> = {}) {
  const listener = mockStatusListener
  if (listener === undefined) {
    throw new Error('the screen never subscribed to recordingStatusUpdate')
  }
  listener({
    id: 'session-1',
    isFinished: true,
    hasError: true,
    error: 'The media server has crashed',
    url: null,
    ...patch,
  })
}

/**
 * Starts a recording through the real toggle, so every interruption test
 * begins from the state the screen would actually be in — `phase` at
 * `'recording'`, the wall-clock start stamped, the live flag true.
 */
async function startRecording(durationMillis: number) {
  record.mockImplementation(() => {
    setLive({ isRecording: true, durationMillis })
  })
  await fireEvent.press(screen.getByTestId('voice-toggle'))
  expect(screen.getByTestId('voice-toggle')).toHaveTextContent('Stop')
}

/**
 * Forces the tree to re-invoke `VoiceScreen` so it reads the CURRENT
 * `mockPolledState`/`mockLiveState` rather than whatever it captured on its
 * last render. Mutating those module-level variables alone does not — the
 * mock hooks are plain reads, not React state, so nothing schedules a
 * re-render on their own the way the real 500 ms poller does on a device.
 */
async function rerenderScreen(view: Awaited<ReturnType<typeof renderScreen>>) {
  await view.rerender(
    <ThemeProvider initial="dark">
      <VoiceScreen />
    </ThemeProvider>,
  )
}

function spokenDescription(): unknown {
  return screen.getByTestId('voice-screen-spoken-description').props.accessibilityLabel
}

beforeEach(() => {
  mockLiveState = { ...idleState }
  mockPolledState = { ...idleState }
  mockRecordId = 'rec_a'
  mockPrepareToRecordAsync.mockReset()
  mockRecord.mockReset()
  mockStop.mockReset()
  mockUri.mockReset()
  // `mockReset` drops the implementation with the calls, so the honest
  // default — the recorder has no file yet — has to be restored.
  mockUri.mockReturnValue(null)
  mockSetAudioModeAsync.mockReset()
  mockAttachVoice.mockReset()
  mockRouterBack.mockClear()
  mockRequestRecordingPermissionsAsync.mockReset()
  mockFileConstructed.mockReset()
  mockFileDelete.mockReset()
  mockFileExists.mockReset()
  mockFileExists.mockReturnValue(true)
  // A promise, not `undefined`: `stop()` returns `Promise<void>` on the real
  // recorder, and a synchronous mock cannot tell an awaited call from an
  // unawaited one. It also stops the recorder, the way the device does — the
  // screen's next decision is taken on that flag.
  mockStop.mockImplementation(async () => {
    await Promise.resolve()
    setLive({ isRecording: false })
  })
  // Granted by default, so every test that isn't specifically exercising
  // the permission flow reaches the toggle screen without asking.
  mockRequestRecordingPermissionsAsync.mockResolvedValue({
    granted: true,
    canAskAgain: true,
    status: 'granted',
    expires: 'never',
  })
})

describe('VoiceScreen', () => {
  it('asks for the microphone before offering to record', async () => {
    requestRecordingPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: false,
      status: 'denied',
      expires: 'never',
    })
    await renderScreen()
    await act(async () => {})
    // Not just present — says what to do. An empty `voice-denied` node
    // satisfies `toBeTruthy()` while telling her nothing at all.
    expect(screen.getByTestId('voice-denied')).toHaveTextContent(/settings/i)
    expect(screen.queryByTestId('voice-toggle')).toBeNull()
  })

  it('offers to ask again when access was refused but can still be asked for', async () => {
    // The common Android refusal is deny-once, which leaves `canAskAgain`
    // true. Sending her to Settings for a permission a button can still ask
    // for is a detour, and the screen used to have only two states.
    requestRecordingPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: true,
      status: 'denied',
      expires: 'never',
    })
    await renderScreen()
    await act(async () => {})
    // Not just present — says why. An empty `voice-needs-permission` node
    // satisfies `toBeTruthy()` on the button beside it while telling her
    // nothing about what she is being asked to allow.
    expect(screen.getByTestId('voice-needs-permission')).toHaveTextContent(/microphone/i)
    expect(screen.getByTestId('voice-request')).toBeTruthy()
    expect(screen.queryByTestId('voice-denied')).toBeNull()
    expect(screen.queryByTestId('voice-toggle')).toBeNull()
  })

  it('asks the OS again when the allow button is pressed', async () => {
    requestRecordingPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: true,
      status: 'denied',
      expires: 'never',
    })
    await renderScreen()
    await act(async () => {})
    requestRecordingPermissionsAsync.mockResolvedValue({
      granted: true,
      canAskAgain: false,
      status: 'granted',
      expires: 'never',
    })
    await fireEvent.press(screen.getByTestId('voice-request'))
    expect(requestRecordingPermissionsAsync).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('voice-toggle')).toBeTruthy()
  })

  it('shows something while the permission request is still in flight', async () => {
    // The request is asked on mount and `permission` is null until it
    // answers. That branch used to render `{null}` — a blank screen with a
    // spoken description and nothing on it, indistinguishable from a hang.
    requestRecordingPermissionsAsync.mockReturnValue(new Promise(() => {}))
    await renderScreen()
    expect(screen.getByTestId('voice-checking')).toHaveTextContent(/microphone/i)
    expect(screen.queryByTestId('voice-toggle')).toBeNull()
    expect(screen.queryByTestId('voice-denied')).toBeNull()
    expect(screen.queryByTestId('voice-request')).toBeNull()
  })

  it('recovers when the permission request itself fails', async () => {
    // An unhandled rejection left the screen at `permission === null`
    // forever, and that branch rendered nothing: a permanently blank screen
    // with no way off it.
    requestRecordingPermissionsAsync.mockRejectedValue(new Error('no microphone service'))
    await renderScreen()
    await act(async () => {})
    expect(screen.getByTestId('voice-permission-error')).toHaveTextContent(/microphone/i)
    requestRecordingPermissionsAsync.mockResolvedValue({
      granted: true,
      canAskAgain: false,
      status: 'granted',
      expires: 'never',
    })
    await fireEvent.press(screen.getByTestId('voice-request'))
    expect(screen.getByTestId('voice-toggle')).toBeTruthy()
  })

  it('shows how long she has been talking, so she knows it is running', async () => {
    // A recorder with no visible timer is indistinguishable from one that
    // silently failed to start — and she will not find out until playback.
    setRecorderState({ isRecording: true, durationMillis: 12400 })
    await renderScreen()
    expect(screen.getByTestId('voice-elapsed')).toHaveTextContent('0:12')
  })

  it('counts past a minute, and past ten', async () => {
    // A spoken note routinely runs longer than a minute, and the minute
    // arithmetic was only ever exercised at zero minutes.
    setRecorderState({ isRecording: true, durationMillis: 72_400 })
    const view = await renderScreen()
    expect(screen.getByTestId('voice-elapsed')).toHaveTextContent('1:12')
    await view.unmount()

    setRecorderState({ isRecording: true, durationMillis: 605_000 })
    await renderScreen()
    expect(screen.getByTestId('voice-elapsed')).toHaveTextContent('10:05')
  })

  it('reads the elapsed time out as a duration, not as a pair of numbers', async () => {
    // `0:12` is announced as "zero colon twelve", which is not how anyone
    // says a length of time (doctrine rule 16).
    setRecorderState({ isRecording: true, durationMillis: 72_400 })
    await renderScreen()
    expect(screen.getByTestId('voice-elapsed').props.accessibilityLabel).toBe(
      '1 minute 12 seconds',
    )
  })

  it('says the seconds alone under a minute, and gets the singular right', async () => {
    // The only other pinned case (above) is 72.4 s — past a minute, and
    // plural throughout. Zero minutes is the common case for a field note,
    // and replacing the seconds-only return with '' leaves that test green.
    setRecorderState({ isRecording: true, durationMillis: 12_000 })
    const view = await renderScreen()
    expect(screen.getByTestId('voice-elapsed').props.accessibilityLabel).toBe('12 seconds')
    await view.unmount()

    // And the singular: a note that ran for exactly one second is "1
    // second", not "1 seconds".
    setRecorderState({ isRecording: true, durationMillis: 1000 })
    await renderScreen()
    expect(screen.getByTestId('voice-elapsed').props.accessibilityLabel).toBe('1 second')
  })

  it('prepares before recording, because record() on an unprepared recorder does nothing', async () => {
    await renderScreen()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(callOrder(prepareToRecordAsync)).toBeLessThan(callOrder(record))
  })

  it('does not record until prepare has actually resolved', async () => {
    // The order alone proves nothing: `prepareToRecordAsync` is called
    // before `record()` whether or not it is awaited, and `record()` on an
    // unprepared recorder does nothing at all. Holding the prepare promise
    // open is what tells the two apart.
    let release: () => void = () => {}
    prepareToRecordAsync.mockReturnValue(
      new Promise<void>((resolve) => {
        release = () => {
          resolve()
        }
      }),
    )
    await renderScreen()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(prepareToRecordAsync).toHaveBeenCalledTimes(1)
    expect(record).not.toHaveBeenCalled()
    await act(async () => {
      release()
    })
    expect(record).toHaveBeenCalledTimes(1)
  })

  it('puts the device into recording mode before it records', async () => {
    // Nothing else asserts this call at all: delete it and the recorder
    // still "records", silently producing nothing on a device whose audio
    // session was never told to allow it.
    await renderScreen()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(setAudioModeAsync).toHaveBeenCalledWith({
      playsInSilentMode: true,
      allowsRecording: true,
    })
    expect(callOrder(setAudioModeAsync)).toBeLessThan(callOrder(record))
  })

  it('attaches the finished recording with the length it actually ran for', async () => {
    setRecorderState({ isRecording: true, durationMillis: 8200 })
    uri.mockReturnValue('file:///tmp/note.m4a')
    await renderScreen()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(attachVoice).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: 'rec_a',
        sourceUri: 'file:///tmp/note.m4a',
        durationMs: 8200,
      }),
    )
    // A kept note's file is `attachVoice`'s from here on; deleting it would
    // take the note with it.
    expect(fileDelete).not.toHaveBeenCalled()
  })

  it('attaches to a different record when opened for a different one', async () => {
    // The companion to the test above: a screen whose handler hardcoded
    // 'rec_a' — rather than reading `useLocalSearchParams` — would pass that
    // one test just as well as real plumbing would.
    mockRecordId = 'rec_b'
    setRecorderState({ isRecording: true, durationMillis: 8200 })
    uri.mockReturnValue('file:///tmp/other.m4a')
    await renderScreen()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(attachVoice).toHaveBeenCalledWith(
      expect.objectContaining({ recordId: 'rec_b', sourceUri: 'file:///tmp/other.m4a' }),
    )
  })

  it('returns to the record once the note is attached', async () => {
    // The counterpart every `expect(routerBack).not.toHaveBeenCalled()`
    // depends on: without this, deleting `router.back()` outright satisfies
    // the negative assertions and nothing else notices.
    setRecorderState({ isRecording: true, durationMillis: 8200 })
    uri.mockReturnValue('file:///tmp/note.m4a')
    await renderScreen()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(routerBack).toHaveBeenCalledTimes(1)
  })

  it('reads the uri only after stop resolves', async () => {
    // Before stop() resolves the recorder's uri is the previous recording's,
    // or nothing. Reading it early attaches the wrong file with a straight
    // face.
    setRecorderState({ isRecording: true, durationMillis: 3000 })
    uri.mockReturnValue('file:///tmp/note.m4a')
    await renderScreen()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(callOrder(stop)).toBeLessThan(uriReadOrder())
  })

  it('attaches the file stop finished writing, not the one that was there before it', async () => {
    // The call-order test above cannot see this on its own:
    // `invocationCallOrder` records when `stop()` was CALLED, not when it
    // resolved, so dropping the `await` leaves that order unchanged. Here
    // the recorder behaves like the device — no uri at all until `stop()`
    // resolves on a later tick — so an unawaited stop reads `null` and
    // attaches nothing.
    setRecorderState({ isRecording: true, durationMillis: 3000 })
    recorderFinishesWith('file:///tmp/finished.m4a')
    await renderScreen()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(attachVoice).toHaveBeenCalledWith(
      expect.objectContaining({ sourceUri: 'file:///tmp/finished.m4a' }),
    )
    expect(screen.queryByTestId('voice-error')).toBeNull()
  })

  it('stops the already-running recording even though the poller has not caught up yet', async () => {
    // Not literally two taps: this fixes the live and polled state apart
    // and presses ONCE, which is enough on its own to show the decision is
    // taken on the live flag rather than the poller's stale copy. (A real
    // "second tap inside the poll window" scenario is two presses with
    // nothing moving the state in between; that is not what this does.)
    // `useAudioRecorderState` polls every 500 ms, and she may have started
    // recording — or the recorder may have started on its own — inside that
    // window: the poller still says "not recording", and a screen that
    // believed it would call `prepareToRecordAsync()` and `record()` against
    // a recorder that is already running.
    setLive({ isRecording: true, durationMillis: 4000 })
    setPolled({ isRecording: false, durationMillis: 0 })
    uri.mockReturnValue('file:///tmp/note.m4a')
    await renderScreen()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(stop).toHaveBeenCalledTimes(1)
    expect(record).not.toHaveBeenCalled()
    expect(prepareToRecordAsync).not.toHaveBeenCalled()
  })

  it('keeps a note whose real length clears the threshold when the last poll was below it', async () => {
    // Stopped at 1.4 s; the last poll landed at 0.9 s. Taking the length
    // from the poller reports 900 ms, which is under MINIMUM_NOTE_MS — real
    // speech discarded, silently, which is exactly what that threshold was
    // supposed to be narrow enough never to do.
    setLive({ isRecording: true, durationMillis: 1400 })
    setPolled({ isRecording: true, durationMillis: 900 })
    uri.mockReturnValue('file:///tmp/note.m4a')
    await renderScreen()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(attachVoice).toHaveBeenCalledWith(expect.objectContaining({ durationMs: 1400 }))
    expect(screen.queryByTestId('voice-too-short')).toBeNull()
  })

  it('does not re-enter the stop branch after a note was discarded', async () => {
    // The stopped recorder still holds the finished file's uri, so a second
    // tap taken on the poller's stale "recording" flag stops an already
    // stopped recorder and attaches that file a second time.
    setRecorderState({ isRecording: true, durationMillis: 300 })
    uri.mockReturnValue('file:///tmp/note.m4a')
    await renderScreen()
    const toggle = screen.getByTestId('voice-toggle')
    await fireEvent.press(toggle)
    // The poller was never told about the stop, so `mockPolledState.isRecording`
    // is still true here — nothing needs to force it; that staleness is the
    // whole scenario this test is about.
    expect(screen.getByTestId('voice-toggle')).toHaveTextContent('Record')
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(stop).toHaveBeenCalledTimes(1)
    expect(record).toHaveBeenCalledTimes(1)
    expect(attachVoice).not.toHaveBeenCalled()
  })

  it('discards a recording too short to carry anything', async () => {
    // A stray tap produces a 300 ms file. Attaching it puts a voice note on
    // the record that says nothing, and she has to play it to find that out.
    setRecorderState({ isRecording: true, durationMillis: 300 })
    uri.mockReturnValue('file:///tmp/note.m4a')
    await renderScreen()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(attachVoice).not.toHaveBeenCalled()
    // Not just present — says what happened and what to do about it.
    expect(screen.getByTestId('voice-too-short')).toHaveTextContent(/too short/i)
  })

  it('deletes the file behind a discarded note instead of leaving it in the cache', async () => {
    // Nothing downstream ever sees this file: `attachVoice` was not called,
    // so nothing will move it or delete it, and it sits in the recorder's
    // cache directory for the life of the install.
    setRecorderState({ isRecording: true, durationMillis: 300 })
    uri.mockReturnValue('file:///tmp/stray.m4a')
    await renderScreen()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(fileConstructed).toHaveBeenCalledWith('file:///tmp/stray.m4a')
    expect(fileDelete).toHaveBeenCalledTimes(1)
  })

  it('does not try to delete a discarded note that has no uri', async () => {
    // `discardFile`'s `uri === null` guard: without it, `new File(null)`
    // would be constructed and probed for a file that was never there.
    setRecorderState({ isRecording: true, durationMillis: 300 })
    uri.mockReturnValue(null)
    await renderScreen()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(fileConstructed).not.toHaveBeenCalled()
    expect(fileDelete).not.toHaveBeenCalled()
  })

  it('does not try to delete a discarded note whose file is already gone', async () => {
    // `discardFile`'s `if (file.exists)` guard: without it, `.delete()` is
    // called on a file that was never written, which is at best a wasted
    // call and on some platforms a thrown error this best-effort function
    // is specifically written not to let escape.
    mockFileExists.mockReturnValue(false)
    setRecorderState({ isRecording: true, durationMillis: 300 })
    uri.mockReturnValue('file:///tmp/gone.m4a')
    await renderScreen()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(fileConstructed).toHaveBeenCalledWith('file:///tmp/gone.m4a')
    expect(fileDelete).not.toHaveBeenCalled()
  })

  it('keeps a note exactly at the minimum and discards one just under it', async () => {
    // Pins MINIMUM_NOTE_MS itself: without a case either side of it, any
    // threshold from 300 ms to 8.2 s satisfied this file — including one
    // that would throw away five seconds of speech.
    setRecorderState({ isRecording: true, durationMillis: 999 })
    uri.mockReturnValue('file:///tmp/note.m4a')
    const view = await renderScreen()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(attachVoice).not.toHaveBeenCalled()
    await view.unmount()

    setRecorderState({ isRecording: true, durationMillis: 1000 })
    await renderScreen()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(attachVoice).toHaveBeenCalledWith(expect.objectContaining({ durationMs: 1000 }))
  })

  it('stays open and says so when saving fails', async () => {
    setRecorderState({ isRecording: true, durationMillis: 5000 })
    uri.mockReturnValue('file:///tmp/note.m4a')
    attachVoice.mockRejectedValue(new Error('disk full'))
    await renderScreen()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    // Not just present — says something. `setError('')` would leave this
    // node in the tree with nothing in it: a coloured blank line, which
    // `toBeTruthy()` alone cannot tell apart from a real message.
    expect(screen.getByTestId('voice-error')).toHaveTextContent(
      'The voice note could not be saved: disk full. Try recording again.',
    )
    expect(routerBack).not.toHaveBeenCalled()
    // The `error !== null` branch of `spokenDescription`: a screen reader
    // user gets this from the announcement, not from reading `voice-error`
    // directly, so the two have to actually agree.
    expect(spokenDescription()).toEqual(
      expect.stringContaining(
        'Voice note. The voice note could not be saved: disk full. Try recording again.',
      ),
    )
  })

  it('does not double the full stop when the cause already ends in one', async () => {
    // `attachVoice`'s own message ends in a period, and glued to this
    // sentence uncorrected it read "...implements this seam.. Try recording
    // again." — the same defect `camera.tsx` carried.
    setRecorderState({ isRecording: true, durationMillis: 5000 })
    uri.mockReturnValue('file:///tmp/note.m4a')
    attachVoice.mockRejectedValue(new Error('Task 10 implements this seam.'))
    await renderScreen()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(screen.getByTestId('voice-error')).toHaveTextContent(
      'The voice note could not be saved: Task 10 implements this seam. Try recording again.',
    )
  })

  it('strips trailing punctuation other than a full stop before adding its own', async () => {
    // `replace(/\.+$/, '')` only ever matched a run of full stops — a cause
    // ending in "?", "!" or an ellipsis went through unstripped and read
    // "Still loading…. Try recording again."
    setRecorderState({ isRecording: true, durationMillis: 5000 })
    uri.mockReturnValue('file:///tmp/note.m4a')
    attachVoice.mockRejectedValue(new Error('Still loading…'))
    await renderScreen()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(screen.getByTestId('voice-error')).toHaveTextContent(
      'The voice note could not be saved: Still loading. Try recording again.',
    )
  })

  it('clears the discarded message on the next attempt', async () => {
    // A message that survives the next press describes something that is no
    // longer happening.
    setRecorderState({ isRecording: true, durationMillis: 300 })
    uri.mockReturnValue('file:///tmp/note.m4a')
    await renderScreen()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(screen.getByTestId('voice-too-short')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(screen.queryByTestId('voice-too-short')).toBeNull()
  })

  it('clears the failed-save message on the next attempt', async () => {
    // The counterpart above proves the discard message clears for real,
    // because it is genuinely set by the first press. This one has to set a
    // REAL error the same way: `setError(null)` clearing a message that was
    // never set in the first place — `error` stays `null` throughout —
    // would pass whether or not that call is even there.
    setRecorderState({ isRecording: true, durationMillis: 5000 })
    uri.mockReturnValue('file:///tmp/note.m4a')
    attachVoice.mockRejectedValue(new Error('disk full'))
    await renderScreen()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(screen.getByTestId('voice-error')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(screen.queryByTestId('voice-error')).toBeNull()
  })

  it('moves through Record, Starting…, Stop and Saving… across one round trip', async () => {
    // Nothing else in this file presses the toggle and reads its label:
    // flatten the four-way ternary to a constant and every other test still
    // passed. This is also the only test that drives a whole record → stop
    // round trip, rather than starting already recording — a `record()` that
    // did nothing was otherwise indistinguishable from one that worked.
    let releasePrepare: () => void = () => {}
    prepareToRecordAsync.mockReturnValue(
      new Promise<void>((resolve) => {
        releasePrepare = () => {
          resolve()
        }
      }),
    )
    record.mockImplementation(() => {
      setLive({ isRecording: true, durationMillis: 4000 })
    })
    let releaseStop: () => void = () => {}
    stop.mockReturnValue(
      new Promise<void>((resolve) => {
        releaseStop = () => {
          setLive({ isRecording: false })
          resolve()
        }
      }),
    )
    uri.mockReturnValue('file:///tmp/note.m4a')

    await renderScreen()
    const toggle = screen.getByTestId('voice-toggle')
    expect(toggle).toHaveTextContent('Record')

    await fireEvent.press(toggle)
    expect(screen.getByTestId('voice-toggle')).toHaveTextContent('Starting…')

    await act(async () => {
      releasePrepare()
    })
    expect(record).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('voice-toggle')).toHaveTextContent('Stop')

    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(screen.getByTestId('voice-toggle')).toHaveTextContent('Saving…')

    await act(async () => {
      releaseStop()
    })
    expect(attachVoice).toHaveBeenCalledWith(
      expect.objectContaining({ sourceUri: 'file:///tmp/note.m4a', durationMs: 4000 }),
    )
    expect(screen.getByTestId('voice-toggle')).toHaveTextContent('Record')
  })

  it('tells her the recording stopped on its own instead of going on claiming it is still running', async () => {
    // An incoming call, a media server that died, a file cap: none of these
    // ask this screen first, and nothing else ever moves `phase` back to
    // 'idle' when they happen. Left alone the button reads "Stop" forever,
    // the header reads "RECORDING", and her next tap acts on a recorder she
    // has been told nothing about.
    //
    // The previous version of this test drove the POLLER, which on Android
    // moves for none of those causes: `AudioRecorder.kt` clears `isRecording`
    // only in `pauseRecording()` and `reset()`, `onError` calls neither, the
    // audio-focus listener iterates playables only, and
    // `getAudioRecorderStatus()` never writes `mediaServicesDidReset` at all.
    // This drives the push event the device actually emits.
    //
    // The payload is the one shape that carries no cause at all — the
    // `cause === null` arm of `interruptionNotSaved`, which nothing else
    // reaches. Android's `onError` always names a cause and `onInfo` always
    // carries a url, so on this platform and this preset that arm is
    // currently unreachable; `error` is `string | null` in the public type
    // beside a `hasError` this screen does not set, and the sentence it
    // produces has to be a sentence rather than "…was not saved: null."
    await renderScreen()
    await startRecording(4000)
    await emitStatus({ hasError: false, error: null, url: null })
    expect(screen.getByTestId('voice-toggle')).toHaveTextContent('Record')
    expect(screen.getByTestId('voice-interrupted')).toHaveTextContent(
      'The recording stopped on its own, probably an interruption such as a call, and it was not saved. Record it again.',
    )
  })

  it('says an abandoned recording was not saved, rather than that it may not have been', async () => {
    // The wording this replaced was "It may not have been saved — record it
    // again to be sure." On this path it WAS not saved: `attachVoice` is
    // never called and no route reaches the record. "May not" invites her
    // either to hunt for a note that is not there or to assume one might be
    // and not record it again. Both halves are asserted: the definite
    // sentence is present AND the hedge is gone.
    //
    // `onError`'s other message (`AudioRecorder.kt:340-343`), so this is not
    // a third copy of the media-server fixture two tests down: what is being
    // asserted here is the wording around the cause, not the cause.
    await renderScreen()
    await startRecording(4000)
    await emitStatus({ hasError: true, error: 'An unknown recording error occurred' })
    const message = screen.getByTestId('voice-interrupted')
    expect(message).toHaveTextContent(/was not saved/i)
    // A RegExp substring-matches; `toHaveTextContent` with a string is an
    // equality assertion, so the negative form needs one to mean anything.
    expect(message).not.toHaveTextContent(/may not/i)
    expect(attachVoice).not.toHaveBeenCalled()
    expect(routerBack).not.toHaveBeenCalled()
  })

  it('carries the native cause when the recorder reports one', async () => {
    // "The media server has crashed" is the one thing that distinguishes a
    // dead recorder from a phone call, and it is already in the status.
    // Dropping it leaves her with a sentence that fits every cause equally.
    await renderScreen()
    await startRecording(4000)
    await emitStatus()
    expect(screen.getByTestId('voice-interrupted')).toHaveTextContent(
      'The recording stopped on its own and was not saved: The media server has crashed. Record it again.',
    )
  })

  it('does not double the full stop when the native cause already ends in one', async () => {
    // `interruptionNotSaved` runs the cause through
    // `withoutTrailingPunctuation` before adding its own full stop, and
    // nothing exercised that: both of `onError`'s two messages end in a
    // letter, so the call could be deleted and every other test stayed
    // green. `error` is whatever the platform put in the map — iOS's own
    // wording, or a future Android string — and glued together unstripped it
    // reads "…has crashed.. Record it again."
    await renderScreen()
    await startRecording(4000)
    await emitStatus({ hasError: true, error: 'The media server has crashed.' })
    expect(screen.getByTestId('voice-interrupted')).toHaveTextContent(
      'The recording stopped on its own and was not saved: The media server has crashed. Record it again.',
    )
  })

  it('saves what an interrupted recording had already caught, rather than dropping it', async () => {
    // A note that ran for two minutes and was cut off at the end is worth
    // more than a stray tap, and the status hands over the finished file's
    // url. Dropping it — which is what this screen used to do — loses two
    // minutes of speech to an event she never asked for.
    //
    // `hasError: true, error: null, url: <path>` is the exact map
    // `onInfo`'s max-filesize branch emits (`AudioRecorder.kt:374-382`) —
    // the ONE shape a platform would really send down this branch, and until
    // this test nothing used it. See the salvage note in this file's header:
    // on Android with `HIGH_QUALITY` that branch cannot fire, so this is the
    // contract being tested, not the shipped preset.
    await renderScreen()
    await startRecording(134_000)
    await emitStatus({ hasError: true, error: null, url: 'file:///tmp/interrupted.m4a' })
    expect(attachVoice).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: 'rec_a',
        sourceUri: 'file:///tmp/interrupted.m4a',
        durationMs: 134_000,
      }),
    )
    // A kept note's file belongs to `attachVoice` from here on.
    expect(fileDelete).not.toHaveBeenCalled()
  })

  it('says a salvaged recording WAS saved, and how much of it', async () => {
    // The other half of being definite. "Stopped on its own" alone, on a
    // path that did attach the note, reads as bad news and sends her back to
    // record something she already has.
    await renderScreen()
    await startRecording(134_000)
    await emitStatus({ hasError: false, error: null, url: 'file:///tmp/interrupted.m4a' })
    const message = screen.getByTestId('voice-interrupted')
    expect(message).toHaveTextContent(
      'The recording stopped on its own, probably an interruption such as a call. What it had already recorded — 2 minutes 14 seconds — was saved to this record.',
    )
    expect(message).not.toHaveTextContent(/not saved/i)
    // Deliberately NOT `router.back()`: navigating away takes the only
    // sentence that tells her this happened with it.
    expect(routerBack).not.toHaveBeenCalled()
  })

  it('discards an interrupted recording too short to carry anything, file and all', async () => {
    // The same judgement the stop branch makes about a stray tap, and the
    // same cleanup: nothing downstream ever sees this file, so nothing else
    // will ever delete it.
    await renderScreen()
    await startRecording(300)
    await emitStatus({ hasError: false, error: null, url: 'file:///tmp/stray.m4a' })
    expect(attachVoice).not.toHaveBeenCalled()
    expect(fileConstructed).toHaveBeenCalledWith('file:///tmp/stray.m4a')
    expect(fileDelete).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('voice-interrupted')).toHaveTextContent(/was not saved/i)
  })

  it('judges an interrupted note by the longest run it can prove, not by a duration native already zeroed', async () => {
    // `onInfo`'s max-filesize branch calls `reset()` BEFORE it emits, and
    // `reset()` sets `durationAlreadyRecorded = 0` — so a long note arrives
    // reporting 0 ms, falls under MINIMUM_NOTE_MS, and would be deleted as a
    // stray tap by the very path meant to rescue it. The wall clock since
    // `record()` is the bound `reset()` cannot erase.
    const realNow = Date.now
    const startedAt = realNow.call(Date)
    const now = jest.spyOn(Date, 'now')
    try {
      now.mockReturnValue(startedAt)
      await renderScreen()
      await startRecording(90_000)
      // Native reset has already run: the recorder reports nothing at all.
      setLive({ isRecording: false, durationMillis: 0 })
      now.mockReturnValue(startedAt + 90_000)
      await emitStatus({ hasError: false, error: null, url: 'file:///tmp/capped.m4a' })
    } finally {
      now.mockRestore()
    }
    expect(attachVoice).toHaveBeenCalledWith(
      expect.objectContaining({ sourceUri: 'file:///tmp/capped.m4a', durationMs: 90_000 }),
    )
    expect(fileDelete).not.toHaveBeenCalled()
  })

  it('puts the wedged native recorder back into a usable state after an interruption', async () => {
    // Android's `onError` emits and returns WITHOUT calling `reset()`, so
    // `recorder` stays non-null, `isPrepared` stays set and `isRecording`
    // stays true. Left that way her next tap reads the live flag as true and
    // takes the STOP branch — stopping a dead recorder and attaching its
    // unfinalised file as though it were a note. `stop()` is the only JS call
    // that reaches Kotlin's `reset()`.
    await renderScreen()
    await startRecording(4000)
    expect(stop).not.toHaveBeenCalled()
    await emitStatus()
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('survives a forced stop that rejects, and still says what happened', async () => {
    // The premise this test used to state was wrong about which layer
    // rejects. `MediaRecorder.stop()` on a recorder in an error state does
    // throw — and Kotlin catches that `RuntimeException` itself, resets in
    // its own `finally`, and returns a Bundle regardless
    // (`AudioRecorder.kt:174-208`), so the JS promise RESOLVES. What can
    // actually reject is the module never reaching `stopRecording()` at all:
    // a recorder released underneath this screen, or RECORD_AUDIO revoked
    // mid-recording. The guard is right; the reason had to be.
    //
    // Two things are asserted because two things break. An unhandled
    // rejection surfaces on a screen that is still open; and a rejection
    // swallowed too eagerly would abandon the sentence that tells her the
    // note is gone, which is the only thing she has to go on.
    const rejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => {
      rejections.push(reason)
    }
    process.on('unhandledRejection', onUnhandledRejection)
    try {
      await renderScreen()
      await startRecording(4000)
      stop.mockRejectedValue(new Error('recorder is in an error state'))
      await emitStatus()
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }
    expect(stop).toHaveBeenCalledTimes(1)
    expect(rejections).toHaveLength(0)
    expect(screen.getByTestId('voice-interrupted')).toHaveTextContent(/was not saved/i)
  })

  it('ignores the status the deliberate stop path emits, so a note is not attached twice', async () => {
    // `stopRecording()` emits `recordingStatusUpdate` with the same
    // `isFinished: true` a crash does. Without the phase guard the listener
    // would take the toggle's own note a second time — a duplicate voice note
    // on the record, or a second attach of a file the first one already
    // moved. This is the easy half of that: the report arrives after the stop
    // branch has finished, so the phase says 'idle' and no arbitration is
    // subtle. The two halves that are — the report arriving before React has
    // committed, and the report arriving a whole cycle late — are the two
    // tests below.
    setRecorderState({ isRecording: true, durationMillis: 8200 })
    uri.mockReturnValue('file:///tmp/note.m4a')
    await renderScreen()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(attachVoice).toHaveBeenCalledTimes(1)
    await emitStatus({ hasError: false, error: null, url: 'file:///tmp/note.m4a' })
    expect(attachVoice).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('voice-interrupted')).toBeNull()
  })

  it('decides on the phase ref, not on a phase React has not committed yet', async () => {
    // The test above fires its status AFTER `await fireEvent.press` has run
    // the stop branch to completion, when React has already committed
    // 'idle'. That is not the window the ref exists for, and it is not a
    // window React state would get wrong: swap `phaseRef.current` for the
    // React `phase` and that test stays green.
    //
    // The real window is narrower. `toggle` writes 'saving' synchronously and
    // then suspends on `recorder.stop()`; Kotlin's report for that stop is
    // queued on `appContext.mainQueue` independently of the promise
    // (`AudioRecorder.kt:195-206`), so it can arrive while React still has
    // 'recording' committed and the listener's closure still reads
    // 'recording'. Both statuses are therefore delivered inside the SAME
    // `act` as the press, with no await between them — the same technique the
    // double-press test uses to land two taps in one frame.
    //
    // Two statuses, because the arbitration has two guards and this is about
    // the second one. The first — an interruption landing in the same turn as
    // the stop she asked for — accounts for the pending stop; the second is
    // that stop's own report, arriving with nothing left to account for it.
    // At that point `phaseRef` is the only thing that knows the toggle still
    // owns this note. Read through React state instead, the handler takes it:
    // attaches the same file a second time and force-stops on top of the stop
    // already in flight.
    await renderScreen()
    await startRecording(8200)
    let releaseStop: () => void = () => {}
    stop.mockReturnValue(
      new Promise<void>((resolve) => {
        releaseStop = () => {
          setLive({ isRecording: false })
          resolve()
        }
      }),
    )
    uri.mockReturnValue('file:///tmp/note.m4a')
    const toggle = screen.getByTestId('voice-toggle')
    await act(async () => {
      fireEvent.press(toggle)
      emitStatusSync({ hasError: true, error: 'The media server has crashed', url: null })
      emitStatusSync({ hasError: false, error: null, url: 'file:///tmp/note.m4a' })
    })
    await act(async () => {
      releaseStop()
    })
    expect(attachVoice).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('voice-interrupted')).toBeNull()
  })

  it('does not hand the next recording a file the last stop already deleted', async () => {
    // The sequence, all of it reachable on a device. She stops a 300 ms
    // stray tap; the stop branch discards the note, DELETES the file, and
    // tells her to record again. `stopRecording()`'s report for that stop is
    // still in flight — queued on Kotlin's main queue, decoupled from the
    // promise `stop()` resolved — and it carries a non-null url, because
    // `reset()` (`AudioRecorder.kt:211-222`) clears everything about the
    // recorder EXCEPT `filePath`. She records again, as instructed. The
    // report lands: finished, a url, and a screen that is recording.
    //
    // Judged on phase alone that reads as an interruption of the note she is
    // in the middle of speaking, and the handler attaches a deleted file
    // under the NEW recording's length, tells her it was saved, and
    // force-stops the recording that was actually running. Nothing in the
    // payload can tell the two apart — `id` is absent on the paths that
    // matter — so the count of outstanding stops is kept on this side.
    uri.mockReturnValue('file:///tmp/stray.m4a')
    await renderScreen()
    await startRecording(300)
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(screen.getByTestId('voice-too-short')).toBeTruthy()
    expect(fileDelete).toHaveBeenCalledTimes(1)

    await startRecording(45_000)
    await emitStatus({ hasError: false, error: null, url: 'file:///tmp/stray.m4a' })
    expect(attachVoice).not.toHaveBeenCalled()
    expect(screen.queryByTestId('voice-interrupted')).toBeNull()
    // Still recording, and still the recording she started.
    expect(screen.getByTestId('voice-toggle')).toHaveTextContent('Stop')
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('does not hand the next recording a file whose salvage already failed', async () => {
    // The same shape, reached the other way. A salvage whose attach fails
    // leaves the handler's own forced `stop()` unreported: it says so, sets
    // the phase back to 'idle', and the queued report arrives after she has
    // started the next note — carrying the previous file's url for exactly
    // the reason above.
    attachVoice.mockRejectedValue(new Error('disk full'))
    await renderScreen()
    await startRecording(134_000)
    await emitStatus({ hasError: true, error: null, url: 'file:///tmp/interrupted.m4a' })
    expect(screen.getByTestId('voice-error')).toBeTruthy()
    expect(stop).toHaveBeenCalledTimes(1)

    attachVoice.mockReset()
    await startRecording(30_000)
    await emitStatus({ hasError: false, error: null, url: 'file:///tmp/interrupted.m4a' })
    expect(attachVoice).not.toHaveBeenCalled()
    expect(screen.queryByTestId('voice-interrupted')).toBeNull()
    expect(screen.getByTestId('voice-toggle')).toHaveTextContent('Stop')
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('holds the screen until the forced stop has actually reset the recorder', async () => {
    // The forced stop used to be fired and forgotten, which released
    // `busyRef` and the phase while Kotlin's `reset()` was still in flight.
    // Her next tap would then race it: `prepareRecording` throws
    // `AudioRecorderAlreadyPreparedException` while `recorder != null`
    // (`AudioRecorder.kt:83-86`), and whether it got there first was left to
    // the module's own queue ordering. Awaiting it makes the ordering this
    // screen's decision rather than the module's, and the cost — the
    // sentence below waiting on a native call — is what this pins.
    let releaseStop: () => void = () => {}
    stop.mockReturnValue(
      new Promise<void>((resolve) => {
        releaseStop = () => {
          setLive({ isRecording: false })
          resolve()
        }
      }),
    )
    await renderScreen()
    await startRecording(4000)
    await emitStatus()
    expect(stop).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('voice-interrupted')).toBeNull()
    expect(screen.getByTestId('voice-toggle')).toHaveTextContent('Saving…')
    // And the toggle is genuinely shut while that reset runs — this is what
    // the await is for, not the message ordering.
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(prepareToRecordAsync).toHaveBeenCalledTimes(1)

    await act(async () => {
      releaseStop()
    })
    expect(screen.getByTestId('voice-interrupted')).toHaveTextContent(/was not saved/i)
    expect(screen.getByTestId('voice-toggle')).toHaveTextContent('Record')
  })

  it('deletes the file behind a salvage whose attach failed, instead of orphaning it', async () => {
    // The message says "Try recording again", so nothing will ever come back
    // for this file: `attachVoice` copies from `sourceUri` rather than moving
    // it, and on this path it did not finish even that. Left alone it sits in
    // the recorder's cache directory for the life of the install, the same
    // way a discarded stray tap's used to.
    attachVoice.mockRejectedValue(new Error('disk full'))
    await renderScreen()
    await startRecording(134_000)
    await emitStatus({ hasError: true, error: null, url: 'file:///tmp/interrupted.m4a' })
    expect(fileConstructed).toHaveBeenCalledWith('file:///tmp/interrupted.m4a')
    expect(fileDelete).toHaveBeenCalledTimes(1)
  })

  it('deletes the file behind a stopped note whose attach failed', async () => {
    // The stop branch had the same gap, for the same reason.
    setRecorderState({ isRecording: true, durationMillis: 5000 })
    uri.mockReturnValue('file:///tmp/note.m4a')
    attachVoice.mockRejectedValue(new Error('disk full'))
    await renderScreen()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(screen.getByTestId('voice-error')).toBeTruthy()
    expect(fileConstructed).toHaveBeenCalledWith('file:///tmp/note.m4a')
    expect(fileDelete).toHaveBeenCalledTimes(1)
  })

  it('ignores a status that is not final, so a mid-recording update does not end the note', async () => {
    // `isFinished` is the whole signal. Acting on any status at all would
    // tear down a live recording on the first routine update the module sent.
    await renderScreen()
    await startRecording(4000)
    await emitStatus({ isFinished: false })
    expect(screen.getByTestId('voice-toggle')).toHaveTextContent('Stop')
    expect(screen.queryByTestId('voice-interrupted')).toBeNull()
    expect(stop).not.toHaveBeenCalled()
  })

  it('stops the elapsed readout climbing after the recording has died', async () => {
    // Android's `onError` never resets the native recorder, so
    // `getAudioRecorderDurationMillis()` goes on adding `now - startTime` and
    // the 500 ms poller goes on committing a bigger number — a timer still
    // counting up underneath a sentence saying the recording stopped.
    //
    // Driven on the `url: null` path deliberately: `onError` is the emitter
    // that leaves the native duration climbing, and `url: null` is what
    // `onError` sends. The url-bearing version of this test was exercising
    // the freeze through a branch that emitter cannot reach.
    const view = await renderScreen()
    await startRecording(65_000)
    await emitStatus()
    expect(screen.getByTestId('voice-elapsed')).toHaveTextContent('1:05')
    setPolled({ durationMillis: 130_000 })
    await rerenderScreen(view)
    expect(screen.getByTestId('voice-elapsed')).toHaveTextContent('1:05')
  })

  it('says so when saving a salvaged recording fails', async () => {
    // The salvage path awaits `attachVoice` like the stop branch does, and
    // like the stop branch it has to stay open and say what happened rather
    // than reporting a rescue that did not occur.
    attachVoice.mockRejectedValue(new Error('disk full'))
    await renderScreen()
    await startRecording(134_000)
    await emitStatus({ hasError: false, error: null, url: 'file:///tmp/interrupted.m4a' })
    expect(screen.getByTestId('voice-error')).toHaveTextContent(
      'The voice note could not be saved: disk full. Try recording again.',
    )
    expect(screen.getByTestId('voice-toggle')).toHaveTextContent('Record')
  })

  it('announces the interruption, not just the elapsed time', async () => {
    // A screen reader user gets this from the announcement, not by reading
    // `voice-interrupted` directly, so the two have to agree (doctrine rule
    // 16) — and colour cannot be what tells her either (rule 9).
    //
    // On the `url: null` path, which is the one a device takes: the
    // announcement is built from `interruption.message` whichever branch set
    // it, so this pins the same production line while testing the outcome she
    // will actually get — and the outcome she most needs announced, because
    // this is the one where the note is gone.
    await renderScreen()
    await startRecording(134_000)
    await emitStatus()
    expect(spokenDescription()).toEqual(
      expect.stringContaining('Voice note. The recording stopped on its own'),
    )
    expect(spokenDescription()).toEqual(expect.stringContaining('was not saved'))
  })

  it('acts on what the screen knows now, not on what it knew when it subscribed', async () => {
    // `useAudioRecorder` subscribes in an effect keyed on `[recorder.id]`, so
    // the closure it captures is the FIRST render's and is never replaced.
    // Handing it a listener that closed over state would freeze that state at
    // mount — here, the record the note belongs to. The screen passes a bare
    // forwarder to a ref that IS re-pointed every render, and this is what
    // tells the two apart: the mock deliberately keeps only the first
    // listener, so a frozen closure would attach the salvaged note to 'rec_a'
    // — a voice note filed against the wrong survey point.
    const view = await renderScreen()
    await startRecording(134_000)
    mockRecordId = 'rec_b'
    await rerenderScreen(view)
    await emitStatus({ hasError: false, error: null, url: 'file:///tmp/interrupted.m4a' })
    expect(attachVoice).toHaveBeenCalledWith(expect.objectContaining({ recordId: 'rec_b' }))
  })

  it('clears the interruption message on the next attempt', async () => {
    // A message that survives the next press describes something that is no
    // longer happening.
    await renderScreen()
    await startRecording(4000)
    await emitStatus()
    expect(screen.getByTestId('voice-interrupted')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(screen.queryByTestId('voice-interrupted')).toBeNull()
  })

  it('gives the toggle a field-sized target', async () => {
    // She is holding the device one-handed over a plot, possibly gloved.
    // Same reason the capture control is `field.control` and not `touch.min`.
    await renderScreen()
    const style = flatten(screen.getByTestId('voice-toggle').props.style)
    expect(style.minHeight).toBeGreaterThanOrEqual(field.control)
  })

  it('puts the control block at the bottom, where the reach zone says it goes', async () => {
    // `resolveReach`'s two anchors are both about the BOTTOM of the screen.
    // `alignSelf`/`maxWidth` alone only choose a side, so the block sat
    // under the timer at the top and the ergonomic computation was half
    // applied. `capture.tsx` reaches the bottom the same way.
    await renderScreen()
    const style = flatten(screen.getByTestId('voice-controls').props.style)
    expect(style.flexGrow).toBe(1)
    expect(style.justifyContent).toBe('flex-end')
    expect(style.alignSelf).toBe('stretch')
  })

  it('announces what the screen is doing, not just what it contains', async () => {
    // The one transition this screen exists for. A description fixed at "the
    // elapsed time and one control" says the same thing whether she is
    // recording, has just lost a note to a stray tap, or has just been told
    // the save failed (doctrine rule 16).
    setRecorderState({ isRecording: false, durationMillis: 0 })
    record.mockImplementation(() => {
      setLive({ isRecording: true, durationMillis: 300 })
    })
    uri.mockReturnValue('file:///tmp/note.m4a')
    await renderScreen()
    expect(spokenDescription()).toEqual(expect.stringContaining('Voice note. Not recording.'))

    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(spokenDescription()).toEqual(expect.stringContaining('Voice note. Recording.'))

    // And the discard, which is the transition she is least able to see
    // coming: the screen said nothing about it at all.
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(spokenDescription()).toEqual(expect.stringContaining('too short'))
  })

  it('stops the recorder when the screen goes away mid-recording', async () => {
    // Leaving a recorder running holds the microphone and the wake it
    // implies for the rest of the session.
    setRecorderState({ isRecording: true, durationMillis: 4000 })
    const view = await renderScreen()
    await view.unmount()
    expect(stop).toHaveBeenCalled()
  })

  it('does not stop a recorder that was never recording', async () => {
    // The other half: without this, removing the `if (recorder.isRecording)`
    // guard passes, and every idle screen closes by calling `stop()` on a
    // recorder that has nothing to stop.
    setRecorderState({ isRecording: false, durationMillis: 0 })
    const view = await renderScreen()
    await view.unmount()
    expect(stop).not.toHaveBeenCalled()
  })

  it('survives a stop that rejects while the screen is going away', async () => {
    // `useAudioRecorder` registers its own release effect before this
    // screen's, and React runs unmount cleanups in registration order — so
    // the recorder may already be released by the time this stop runs. An
    // unhandled rejection there surfaces on a screen that has already gone.
    //
    // `expect(stop).toHaveBeenCalled()` alone does not pin the `.catch` —
    // the test above it already asserts a call, and whether an unhandled
    // rejection here turns THIS test red depends on Jest's own reporting,
    // which nothing here mutates to check. Listening for Node's
    // `unhandledRejection` event directly is deterministic regardless of
    // how (or whether) the test runner surfaces one: the event fires
    // exactly when a rejected promise reaches the end of a microtask turn
    // with no handler attached, which is precisely what `.catch` prevents.
    const rejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => {
      rejections.push(reason)
    }
    process.on('unhandledRejection', onUnhandledRejection)
    try {
      setRecorderState({ isRecording: true, durationMillis: 4000 })
      stop.mockRejectedValue(new Error('recorder already released'))
      const view = await renderScreen()
      await view.unmount()
      await act(async () => {})
      // One more real turn of the event loop: Node reports an unhandled
      // rejection a tick after the promise settles, which `act`'s own
      // microtask flushing does not necessarily wait out.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }
    expect(stop).toHaveBeenCalled()
    expect(rejections).toHaveLength(0)
  })

  it('ignores a second toggle press while the first action is still starting', async () => {
    // The same hazard `camera.tsx`'s shutter guards against: a claim taken
    // after an await is a claim taken too late. Both presses are fired from
    // the SAME rendered element, inside one outer `act`, with no `await`
    // between them — an awaited `fireEvent.press` in between would let
    // `setPhase(...)` from the first press flush and re-render before the
    // second press is even dispatched, at which point a state guard would
    // block correctly too and this test would no longer be able to tell a
    // state guard from the ref guard this screen actually uses. Not
    // awaiting between them reproduces the real hazard: two taps landing in
    // the same frame, before React has re-rendered, which only the ref
    // guard survives.
    let release: (value: unknown) => void = () => {}
    mockPrepareToRecordAsync.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    await renderScreen()
    const toggle = screen.getByTestId('voice-toggle')
    await act(async () => {
      fireEvent.press(toggle)
      fireEvent.press(toggle)
    })
    release(undefined)
    await act(async () => {})
    expect(prepareToRecordAsync).toHaveBeenCalledTimes(1)
  })

  it('renders something honest when opened without a record to attach to', async () => {
    mockRecordId = undefined
    await renderScreen()
    expect(screen.getByTestId('voice-no-record')).toHaveTextContent(/record/i)
    expect(screen.queryByTestId('voice-toggle')).toBeNull()
  })
})
