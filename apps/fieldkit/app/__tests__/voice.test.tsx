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
 * only once `durationMillis` has moved more than 50 ms
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
const mockUri = jest.fn()
const mockRequestRecordingPermissionsAsync = jest.fn()
const mockSetAudioModeAsync = jest.fn()

type MockRecorderState = {
  canRecord: boolean
  isRecording: boolean
  durationMillis: number
  mediaServicesDidReset: boolean
}

const idleState: MockRecorderState = {
  canRecord: true,
  isRecording: false,
  durationMillis: 0,
  mediaServicesDidReset: false,
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
  stop: (...args: unknown[]) => mockStop(...args) as Promise<void>,
  getStatus: () => ({ ...mockLiveState }),
  get isRecording() {
    return mockLiveState.isRecording
  },
  get uri() {
    return mockUri() as string | null
  },
}

jest.mock('expo-audio', () => ({
  useAudioRecorder: () => mockRecorderInstance,
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
  return render(
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

  it('stops rather than starting again when the second tap lands inside the poll window', async () => {
    // `useAudioRecorderState` polls every 500 ms. She taps Record and taps
    // again inside that window: the poller still says "not recording", and a
    // screen that believed it would call `prepareToRecordAsync()` and
    // `record()` against a recorder that is already running.
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
    // The poller has not caught up with the stop yet.
    setPolled({ isRecording: true })
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

  it('clears the discarded and failed messages on the next attempt', async () => {
    // A message that survives the next press describes something that is no
    // longer happening.
    setRecorderState({ isRecording: true, durationMillis: 300 })
    uri.mockReturnValue('file:///tmp/note.m4a')
    await renderScreen()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(screen.getByTestId('voice-too-short')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(screen.queryByTestId('voice-too-short')).toBeNull()
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
    setRecorderState({ isRecording: true, durationMillis: 4000 })
    stop.mockRejectedValue(new Error('recorder already released'))
    const view = await renderScreen()
    await view.unmount()
    await act(async () => {})
    expect(stop).toHaveBeenCalled()
  })

  it('ignores a second toggle press while the first action is still starting', async () => {
    // The same hazard `camera.tsx`'s shutter guards against: a claim taken
    // after an await is a claim taken too late. Both presses are fired from
    // the SAME rendered element, inside one outer `act`, with no `await`
    // between them — an awaited `fireEvent.press` in between would let
    // `setPending(...)` from the first press flush and re-render before the
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
