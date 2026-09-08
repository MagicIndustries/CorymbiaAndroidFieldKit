import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { ThemeProvider } from '@corymbia/ui'

/**
 * Tests for the voice note screen (Plan 4, Task 9): one toggle that starts
 * and stops a recording and attaches it to a record — the sibling of
 * `camera.tsx` (Task 8). See that screen's own test file for the fuller
 * account of what is and is not mocked and why; the same reasoning applies
 * here, with `expo-audio` standing in for `expo-camera`.
 *
 * Mocked: `expo-audio`. `useAudioRecorder` returns one stable fake
 * `AudioRecorder` instance for the life of a render — `prepareToRecordAsync`,
 * `record` and `stop` are plain jest mocks, and `uri`/`isRecording` are
 * getters backed by jest mocks (`uri`) or by the same mutable state object
 * `useAudioRecorderState` reads (`isRecording`), so a real property read —
 * not a function call — is what this screen actually performs.
 * `useAudioRecorderState` itself reads a mutable `mockRecorderState` set
 * through `setRecorderState`, standing in for the hook's own polling.
 * `AudioModule.requestRecordingPermissionsAsync` is a jest mock, defaulted
 * to granted in `beforeEach`. `RecordingPresets` and `setAudioModeAsync` are
 * present only so importing the module doesn't throw.
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

let mockRecorderState: MockRecorderState = {
  canRecord: true,
  isRecording: false,
  durationMillis: 0,
  mediaServicesDidReset: false,
}

// One stable object for the life of a render, the way the real
// `useAudioRecorder` hook returns one recorder instance rather than a new
// one every render. `isRecording` mirrors `mockRecorderState` directly
// (this screen's cleanup effect reads it as a live property, not through
// the state hook); `uri` is a getter backed by `mockUri` so a test can both
// control what it returns (`uri.mockReturnValue(...)`) and prove *when* it
// was read (`uri.mock.invocationCallOrder`).
const mockRecorderInstance = {
  prepareToRecordAsync: (...args: unknown[]) => mockPrepareToRecordAsync(...args),
  record: (...args: unknown[]) => mockRecord(...args),
  stop: (...args: unknown[]) => mockStop(...args),
  get isRecording() {
    return mockRecorderState.isRecording
  },
  get uri() {
    return mockUri() as string | null
  },
}

jest.mock('expo-audio', () => ({
  useAudioRecorder: () => mockRecorderInstance,
  useAudioRecorderState: () => mockRecorderState,
  AudioModule: {
    requestRecordingPermissionsAsync: (...args: unknown[]) =>
      mockRequestRecordingPermissionsAsync(...args),
  },
  setAudioModeAsync: (...args: unknown[]) => mockSetAudioModeAsync(...args),
  RecordingPresets: { HIGH_QUALITY: {} },
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
const attachVoice = mockAttachVoice
const routerBack = mockRouterBack

function setRecorderState(patch: Partial<MockRecorderState>) {
  mockRecorderState = { ...mockRecorderState, ...patch }
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

async function renderScreen() {
  return render(
    <ThemeProvider initial="dark">
      <VoiceScreen />
    </ThemeProvider>,
  )
}

beforeEach(() => {
  mockRecorderState = {
    canRecord: true,
    isRecording: false,
    durationMillis: 0,
    mediaServicesDidReset: false,
  }
  mockRecordId = 'rec_a'
  mockPrepareToRecordAsync.mockReset()
  mockRecord.mockReset()
  mockStop.mockReset()
  mockUri.mockReset()
  mockSetAudioModeAsync.mockReset()
  mockAttachVoice.mockReset()
  mockRouterBack.mockClear()
  mockRequestRecordingPermissionsAsync.mockReset()
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
    expect(screen.getByTestId('voice-denied')).toBeTruthy()
    expect(screen.queryByTestId('voice-toggle')).toBeNull()
  })

  it('shows how long she has been talking, so she knows it is running', async () => {
    // A recorder with no visible timer is indistinguishable from one that
    // silently failed to start — and she will not find out until playback.
    setRecorderState({ isRecording: true, durationMillis: 12400 })
    await renderScreen()
    expect(screen.getByTestId('voice-elapsed')).toHaveTextContent('0:12')
  })

  it('prepares before recording, because record() on an unprepared recorder does nothing', async () => {
    await renderScreen()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(callOrder(prepareToRecordAsync)).toBeLessThan(callOrder(record))
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

  it('discards a recording too short to carry anything', async () => {
    // A stray tap produces a 300 ms file. Attaching it puts a voice note on
    // the record that says nothing, and she has to play it to find that out.
    setRecorderState({ isRecording: true, durationMillis: 300 })
    uri.mockReturnValue('file:///tmp/note.m4a')
    await renderScreen()
    await fireEvent.press(screen.getByTestId('voice-toggle'))
    expect(attachVoice).not.toHaveBeenCalled()
    expect(screen.getByTestId('voice-too-short')).toBeTruthy()
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

  it('stops the recorder when the screen goes away mid-recording', async () => {
    // Leaving a recorder running holds the microphone and the wake it
    // implies for the rest of the session.
    setRecorderState({ isRecording: true, durationMillis: 4000 })
    const view = await renderScreen()
    await view.unmount()
    expect(stop).toHaveBeenCalled()
  })

  it('ignores a second toggle press while the first action is still starting', async () => {
    // The same hazard `camera.tsx`'s shutter guards against: a claim taken
    // after an await is a claim taken too late. Both presses are fired from
    // the SAME rendered element, inside one outer `act`, with no `await`
    // between them — an awaited `fireEvent.press` in between would let
    // `setBusy(true)` from the first press flush and re-render before the
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
