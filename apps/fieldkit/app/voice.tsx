import React, { useCallback, useEffect, useRef, useState } from 'react'
import { View, type ViewStyle } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { File } from 'expo-file-system'
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type PermissionResponse,
  type RecordingStatus,
} from 'expo-audio'
import { spacing } from '@corymbia/tokens'
import { Button, CORNER_BLOCK_MAX_W, Screen, Type, resolveReach, useLayout, useTheme } from '@corymbia/ui'
import { useDatabaseStatus, useSettings } from '../src/db/provider'
import { useAttachMedia } from '../src/media/useAttachMedia'

/**
 * The voice note screen (Plan 4, Task 9): one toggle that starts and stops a
 * recording and attaches it to a record, the sibling of `camera.tsx` (Task
 * 8). `useAttachMedia` (`src/media`) is the pipeline that writes the file and
 * the row; this screen only calls and awaits it once a recording has been
 * stopped to a temporary file.
 *
 * `RecordingPresets.HIGH_QUALITY` writes `.m4a` on Android (SDK 57 docs,
 * https://docs.expo.dev/versions/v57.0.0/sdk/audio/) — `mediaFileName`
 * (`@corymbia/media`) is where that extension is decided, since this screen
 * never needs to know it itself.
 *
 * **THE RECORDER IS THE TRUTH; `useAudioRecorderState` IS A POLLER.** The
 * hook runs `setInterval(..., 500)` and commits a new object once
 * `canRecord`, `isRecording`, `mediaServicesDidReset`, `url` or `metering`
 * changes, OR `durationMillis` moves by more than 50 ms
 * (`node_modules/expo-audio/build/utils/useAudioRecorderState.js`), so every
 * value it returns is up to half a second old. That is fine for a ticking
 * readout and wrong for everything else, and it cost real speech: a decision
 * taken on `state.isRecording` sends a second tap inside the poll window
 * down the *start* branch against an already-running recorder, and a
 * duration taken from `state.durationMillis` reports a note stopped at 1.4 s
 * as 900 ms — under `MINIMUM_NOTE_MS`, discarded, gone, with no way for her
 * to know. So: the branch, the labels and the length come from the recorder
 * itself (`recorder.isRecording`, `recorder.getStatus().durationMillis` —
 * both on `AudioRecorder` in the installed typings,
 * `expo-audio/build/AudioModule.types.d.ts:243,280`, the latter in
 * milliseconds, the same field the poller reads); `state.durationMillis`
 * drives the ticking display and nothing else.
 *
 * **AND THE POLLER CANNOT SEE A RECORDING THAT DIES.** An earlier pass tried
 * to notice an unasked-for stop by watching `state.isRecording` /
 * `state.mediaServicesDidReset`. On Android that watches nothing. In
 * `node_modules/expo-audio/android/src/main/java/expo/modules/audio/AudioRecorder.kt`
 * the Kotlin `isRecording` field goes false in exactly two places —
 * `pauseRecording()` and `reset()` — and `reset()` is only reached from
 * `stopRecording()`, from the max-filesize branch of `onInfo`, and from
 * `sharedObjectDidRelease()`; all of those are this app's own calls or a cap
 * this screen never sets. `onError` — the media-server-died case — emits an
 * event and returns *without* resetting anything, so the polled flag stays
 * true. `AudioModule.kt`'s audio-focus listener handles focus loss by
 * iterating `allPlayables` (players and playlists); recorders are never
 * touched, so an incoming call moves nothing the poller reads either. And
 * `getAudioRecorderStatus()` never writes a `mediaServicesDidReset` key at
 * all — that field is `@platform ios` in `Audio.types.d.ts` and is always
 * `undefined` here.
 *
 * So the interruption is delivered, or it is not delivered at all:
 * `useAudioRecorder(options, statusListener)` subscribes to
 * `recordingStatusUpdate` (`ExpoAudio.d.ts:145`), which carries
 * `{ id, isFinished, hasError, error, url }` (`Audio.types.d.ts:252`) and is
 * emitted from `onError`, from `onInfo`, and from `stopRecording`. Push, not
 * poll: nothing has to be guessed about how long to wait for a poll that may
 * legitimately be slow, and a `record()` that never starts arrives as
 * `hasError` rather than as silence.
 *
 * **AND THE STATUS DOES NOT SAY WHICH RECORDING IT IS ABOUT.** `RecordingStatus.id`
 * is typed `string`, not `string | undefined` (`Audio.types.d.ts:252`), and it
 * lies: `stopRecording()` is the only emitter that puts an `id` in the map
 * (`AudioRecorder.kt:195-206`); `onError` (`:345`) and `onInfo` (`:374`) emit
 * maps with no `id` key at all — exactly the two paths an interruption
 * arrives on. Nothing in the payload distinguishes one recording session from
 * the next, so the arbitration has to be kept on the JS side: see
 * `pendingStopsRef` and `phaseRef` below.
 *
 * One trap in that hook, and this screen is built around it: the effect that
 * subscribes is keyed on `[recorder.id]`, so the `statusListener` closure it
 * captures is **the one from the first render** and is never replaced. A
 * listener that closed over state would go on reading the mount-time values
 * forever. `statusListenerRef` is why the function passed in is a bare
 * forwarder.
 */

/**
 * A stray tap produces a file a few hundred milliseconds long. Attaching it
 * puts a voice note on the record that says nothing, and she would only find
 * that out by playing it back — so a note shorter than this is discarded on
 * the spot instead, with a word on screen saying so. This is not a judgement
 * about how much she had to say; a deliberate one-second note is kept, which
 * is why the length it is measured against has to be the recorder's own and
 * not the poller's.
 */
const MINIMUM_NOTE_MS = 1000

/**
 * A human sentence first, the technical cause subordinate to it rather than
 * the whole message (doctrine rule 6). A failed attach surfaces whatever
 * SQLite or the file system said, and a native recorder failure is equally
 * raw — so this is what stands between that text and a field ecologist who
 * needs to know what happened and what to do, not what threw.
 *
 * Trailing sentence punctuation is stripped from the cause before this
 * sentence adds its own: a cause whose message ends in a full stop, glued
 * together uncorrected, reads "...disk full.. Try
 * recording again." A native cause is not guaranteed to end in a full stop
 * at all — "Still loading…" ends in an ellipsis, a thrown message can end
 * in "?" or "!" — and any of those left in place reads just as oddly:
 * "Still loading…. Try recording again." (`camera.tsx` strips the same set,
 * for the same reason).
 */
function withoutTrailingPunctuation(detail: string): string {
  return detail.replace(/[.?!…]+$/, '')
}

function messageFor(cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause)
  return `The voice note could not be saved: ${withoutTrailingPunctuation(detail)}. Try recording again.`
}

function formatElapsed(durationMillis: number): string {
  const totalSeconds = Math.floor(durationMillis / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`
}

/**
 * The same elapsed time as a sentence (doctrine rule 16). `0:12` is read out
 * as "zero colon twelve", which is not how anyone says a duration.
 */
function spokenElapsed(durationMillis: number): string {
  const totalSeconds = Math.floor(durationMillis / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const secondsSaid = `${String(seconds)} second${seconds === 1 ? '' : 's'}`
  if (minutes === 0) return secondsSaid
  return `${String(minutes)} minute${minutes === 1 ? '' : 's'} ${secondsSaid}`
}

/**
 * A discarded note's file belongs to nobody: `attachVoice` never saw it, so
 * nothing downstream will ever move or delete it, and it would sit in the
 * recorder's cache directory as a stray `.m4a` for the rest of the install's
 * life. One stray file is nothing; a season of stray taps on a device that
 * never sees a desktop is not.
 *
 * Best effort, and deliberately silent: the note is already discarded and
 * the screen has already said so, and a second sentence about a temporary
 * file she never knew existed would only obscure the one that matters.
 */
function discardFile(uri: string | null): void {
  if (uri === null) return
  try {
    const file = new File(uri)
    if (file.exists) file.delete()
  } catch {
    // Nothing to say and nothing to do: see above.
  }
}

/**
 * What the toggle has done, and therefore what it says. Purely presentational
 * — every decision is still taken on the recorder itself — but it is React
 * state on purpose: `recorder.isRecording` changes outside React's knowledge,
 * so a label derived from it alone does not re-render when it moves, and she
 * would go on reading "Record" until the poller happened to tick. Each
 * transition here is a state change React can see.
 */
type Phase = 'idle' | 'starting' | 'recording' | 'saving'

/**
 * The length a salvaged note is judged by: whichever of two lower bounds is
 * larger.
 *
 * `recorder.getStatus().durationMillis` is authoritative while the native
 * recorder still holds the recording — and on the `onError` path it does,
 * because that handler never calls `reset()`. It is not authoritative on the
 * other path: `onInfo`'s max-filesize branch calls `reset()` *before* it
 * emits the status, and `reset()` sets `durationAlreadyRecorded = 0` and
 * `startTime = 0`, after which `getAudioRecorderDurationMillis()` returns 0.
 * A two-minute note would arrive here reporting nothing, fall under
 * `MINIMUM_NOTE_MS`, and be deleted as a stray tap — the exact loss the
 * salvage path exists to prevent, arriving through the salvage path.
 *
 * The wall clock since `record()` returned is the bound `reset()` cannot
 * erase. It is a floor rather than a replacement: it counts wall time, and
 * this screen never pauses a recording, so for a note that ran to an
 * interruption the two agree. Taking the larger keeps the recorder's own
 * figure wherever the recorder still has one.
 *
 * **ON ANDROID WITH `HIGH_QUALITY` THE FLOOR IS CURRENTLY UNREACHABLE, AND IS
 * KEPT ANYWAY.** It is reached only from the salvage path, and it can only
 * change the answer there when native has already reset — which on this
 * preset never happens. `setMaxFileSize` is called only when the options
 * carry a `maxFileSize` (`AudioRecorder.kt` `setRecordingOptions`) and
 * `RecordingPresets.HIGH_QUALITY` carries none
 * (`expo-audio/build/RecordingConstants.js`), so `onInfo`'s max-filesize
 * branch — the one emitter that calls `reset()` before it emits — never
 * fires; and `onError`, the branch that does fire, never resets at all, so
 * `getStatus().durationMillis` is the larger of the two every time. What this
 * function protects against is a preset that does set a cap, and iOS's own
 * reset — both of which would otherwise arrive here reporting 0 ms and be
 * deleted as a stray tap by the path that exists to rescue them.
 */
function longestProvenRun(fromRecorder: number, startedAtMs: number | null): number {
  if (startedAtMs === null) return fromRecorder
  return Math.max(fromRecorder, Date.now() - startedAtMs)
}

/**
 * What became of a recording that ended without being asked to, and the
 * sentence that says so.
 *
 * `saved` is not decoration and it is not what tells her: doctrine rule 9
 * says colour never carries meaning alone, so the message states which
 * happened in words and the colour only follows it. And it states *which* —
 * an earlier wording said "It may not have been saved", which on the abandon
 * path was simply untrue (nothing called `attachVoice` and no route reached
 * the record) and left her to either hunt for a note that was never there or
 * assume one might be and not record it again.
 *
 * `durationMillis` freezes the elapsed readout at the moment the recording
 * died. Android's `onError` returns without calling `reset()`, so
 * `getAudioRecorderDurationMillis()` goes on adding `now - startTime` for as
 * long as the screen is open and the 500 ms poller goes on committing a
 * bigger number — a timer still climbing underneath a sentence saying the
 * recording stopped.
 */
type Interruption = {
  message: string
  saved: boolean
  durationMillis: number
}

const INTERRUPTED = 'The recording stopped on its own, probably an interruption such as a call'

function interruptionSaved(durationMillis: number): string {
  return `${INTERRUPTED}. What it had already recorded — ${spokenElapsed(durationMillis)} — was saved to this record.`
}

function interruptionTooShort(): string {
  return `${INTERRUPTED}. It had not caught anything yet, so it was not saved. Record it again.`
}

/**
 * The abandon path, and the one that has to be most definite: there is no
 * file, so there is nothing to attach and nothing to hunt for. On Android
 * this is the branch an interruption actually lands in — `onError` emits
 * `url: null` unconditionally, because the `.m4a` it abandoned was never
 * finalised. Handing that half-written container to `attachVoice` would put
 * a note on the record that cannot be played, which is worse than saying
 * plainly that it was lost.
 *
 * Both halves are written for the contract rather than for what Android
 * happens to send today. `onError` always sets `hasError: true` and always
 * names a cause — "The media server has crashed" or "An unknown recording
 * error occurred" (`AudioRecorder.kt:339-354`) — so on this platform the
 * cause is never `null` and never ends in punctuation. `error` is
 * `string | null` in the public type beside a `hasError` this screen does not
 * control, though, and `onInfo` already emits `error: null` with
 * `hasError: true`; a sentence that read "…was not saved: null." or
 * "…crashed.. Record it again." is not one to discover on a device.
 */
function interruptionNotSaved(cause: string | null): string {
  if (cause === null) return `${INTERRUPTED}, and it was not saved. Record it again.`
  return `The recording stopped on its own and was not saved: ${withoutTrailingPunctuation(cause)}. Record it again.`
}

export default function VoiceScreen() {
  const status = useDatabaseStatus()

  // `useAttachMedia` reads the database and the registered device out of
  // context, and `useDatabase`/`useDevice` both throw before the database is
  // open — so the guard has to come before the body that calls them, hence
  // the split into two components rather than an early return inside one
  // (`capture.tsx` and `diagnostics.tsx` do the same, for the same reason).
  // It is also what keeps the recorder from ever being started against a
  // record that has nowhere to be written.
  if (status.state !== 'ready') {
    return (
      <Screen
        testID="voice-screen"
        spokenDescription={`Voice note. The database is ${status.state}, so there is nowhere to attach a note yet.`}
      >
        <Type testID="voice-database" variant="title">
          Database {status.state}
        </Type>
        {status.error ? <Type dim>{status.error.message}</Type> : null}
      </Screen>
    )
  }

  return <VoiceBody />
}

function VoiceBody() {
  const { recordId } = useLocalSearchParams<{ recordId?: string }>()
  // A bare forwarder, deliberately. `useAudioRecorder` subscribes inside an
  // effect keyed on `[recorder.id]`, so whatever function is passed on the
  // first render is the one that stays subscribed for the life of the
  // recorder; anything closing over state would be frozen at mount. The ref
  // it forwards to is re-pointed every render, below.
  const statusListenerRef = useRef<(status: RecordingStatus) => void>(() => {
    // Replaced by the effect below before any native event can arrive.
  })
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY, (status) => {
    statusListenerRef.current(status)
  })
  const state = useAudioRecorderState(recorder)
  const [permission, setPermission] = useState<PermissionResponse | null>(null)
  const [permissionFailed, setPermissionFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tooShort, setTooShort] = useState(false)
  const [interruption, setInterruption] = useState<Interruption | null>(null)
  // Claimed synchronously, before any await — see `toggle` below, the same
  // reason `camera.tsx`'s `savingRef` exists: a claim taken after an await
  // is a claim taken too late, because a second press can land in the gap
  // between the first press starting and that await resolving.
  const busyRef = useRef(false)
  // What the toggle is doing, rather than merely that it is busy: after
  // `stop()` resolves the recorder is no longer recording, so a label
  // derived from the live flag mid-action would flip from "Saving…" to
  // "Starting…" while the attach is still in flight.
  const [phase, setPhaseState] = useState<Phase>('idle')
  // The same value the status listener can read *synchronously*. React state
  // is only current as of the last render, and the one thing the listener has
  // to know — whether the stop it is being told about is one this screen
  // asked for — is decided a microtask earlier, inside `toggle`, before any
  // await. `setPhase` writes both so the two can never disagree.
  const phaseRef = useRef<Phase>('idle')
  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next
    setPhaseState(next)
  }, [])
  // Wall-clock milliseconds at the moment `record()` returned; `null` when no
  // recording is under way. See `longestProvenRun`.
  const recordingStartedAtRef = useRef<number | null>(null)
  /**
   * How many `recorder.stop()` calls this screen has issued that have not yet
   * been answered by a `recordingStatusUpdate` — the JS-side identity the
   * event itself does not carry (see the `id` note in the header comment).
   *
   * Kotlin's `stopRecording()` schedules its emit on `appContext.mainQueue`
   * (`AudioRecorder.kt:195`), decoupled from the promise the JS `stop()`
   * resolves — which resolves as soon as the Bundle comes back. So the report
   * for a stop can land arbitrarily later, in a cycle that has nothing to do
   * with it, and it lands carrying a url: `reset()` (`:211`) clears the
   * recorder and every counter but leaves `filePath` alone, so a
   * `stopRecording()` on an already-reset recorder no-ops the native stop,
   * takes `stopFailed = false`, and reports the *previous* file.
   *
   * That is the whole bug this counter exists for. She stops a 300 ms stray
   * tap; the stop branch discards the note and deletes the file and tells her
   * to record again; she does; and the first stop's report finally arrives
   * with `isFinished: true` and the deleted file's url while the new
   * recording is live. Judged on phase alone it reads as an interruption of
   * the note she is in the middle of speaking — so the handler would attach a
   * deleted file under the new note's length, tell her it was saved, and
   * force-stop the recording that was actually running.
   *
   * Incremented immediately before every `stop()` this screen makes, and
   * consumed by the first finished status that arrives while a recording is
   * live. Rolled back when the `stop()` rejects, because a stop that never
   * reached Kotlin emits nothing: the emit is scheduled inside
   * `stopRecording()` and nothing after it can throw, so a rejected promise
   * means no report is coming and a count left standing would swallow the
   * next real interruption instead.
   */
  const pendingStopsRef = useRef(0)
  const { theme } = useTheme()
  const { deviceClass, orientation } = useLayout()
  const { settings } = useSettings()
  const { attachVoice } = useAttachMedia()

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  /**
   * A recording ended without this screen asking it to: `onError` (including
   * the media-server-died case), `onInfo`'s file cap, or — on iOS — a media
   * services reset. Nothing else moves `phase` back to `'idle'` when that
   * happens. Left alone the button goes on reading "Stop" forever, the
   * header goes on reading "RECORDING", and her next tap reads the live flag
   * and takes some branch chosen by a recorder she has been told nothing
   * about.
   *
   * Four things this must get right, in order.
   *
   * **It must not take an event belonging to a stop this screen asked for —
   * this cycle's or an earlier one's.** Two guards, and they answer different
   * questions.
   *
   * `phaseRef` answers "is one of my own actions in flight right now?".
   * `toggle` writes `'saving'` synchronously, before it awaits anything, so
   * by the time any event can be delivered a deliberate stop has already left
   * `'recording'`. It has to be the ref and not the React `phase`: the emit is
   * queued on Kotlin's main queue independently of the promise `stop()`
   * resolves, so it can arrive in the microtask window after `toggle` has
   * written `'saving'` and before React has committed the render that would
   * make `phase` say so. Read through React state instead, this handler would
   * take the toggle's own note a second time — attaching a file the toggle is
   * already attaching, or force-stopping the recording it is in the middle of
   * stopping.
   *
   * `pendingStopsRef` answers "is this the late report of a stop I asked for
   * *earlier*?" — which phase cannot answer, because by then the phase has
   * moved on and may legitimately be `'recording'` again. See that ref's own
   * comment for the sequence; it is reachable from the discard branch, from a
   * failed salvage attach, and from this handler's own forced stop.
   *
   * Order matters. Phase is checked first and *clears* the count rather than
   * decrementing it: a report that arrives while nothing is live has been
   * accounted for by definition, and clearing there is what keeps the count
   * from drifting upward over a session. The count is only spent while a
   * recording is live, which is the one moment a stale report can do harm.
   *
   * **It must read the length before it stops anything.** `stop()` reaches
   * Kotlin's `reset()`, which zeroes the duration; see `longestProvenRun`.
   *
   * **It must put the recorder back into a usable state.** Android's
   * `onError` emits and returns without calling `reset()`, so `recorder`
   * stays non-null, `isPrepared` stays set and `isRecording` stays *true*.
   * Wedged that way the recorder is broken in both directions: her next tap
   * reads `recorder.isRecording === true` and takes the *stop* branch —
   * stopping a dead recorder and attaching its unfinalised file as though it
   * were a note — and had it taken the start branch instead,
   * `prepareRecording` throws `AudioRecorderAlreadyPreparedException`
   * because `recorder != null`. `stop()` is the only JS call that reaches
   * `reset()`, so this issues one, and *awaits* it: `busyRef` and `phase` are
   * the only things standing between that reset and her next
   * `prepareToRecordAsync()`, and releasing them with the reset still in
   * flight would leave the ordering to the module's own queue — a prepare
   * that got there first would throw. The cost is that the sentence below
   * waits on a native call that returns in a frame, which is the right way
   * round.
   *
   * **THE SALVAGE BRANCH IS UNREACHABLE ON ANDROID TODAY, AND IS KEPT.** It
   * is not describing something that happens here; it is describing something
   * the contract permits and one platform already does. On Android with
   * `RecordingPresets.HIGH_QUALITY` every route to a non-null `url` is
   * closed: `onError` emits `url: null` unconditionally
   * (`AudioRecorder.kt:345-353`); `onInfo`'s max-filesize branch does carry
   * the url but cannot fire, because `setMaxFileSize` is only called when the
   * options carry a `maxFileSize` and that preset carries none; and
   * `stopRecording`'s url-bearing emit belongs to a stop this screen asked
   * for, so the two guards above turn it away. What reaches this handler on
   * the shipped preset is always the `finishedUri === null` branch.
   *
   * It stays because `url` is `string | null` in the public contract, because
   * the branch is live on iOS, and because `onError` returning the path it
   * abandoned is a one-line change upstream — and because deleting a branch
   * and re-adding it later is precisely the churn that produced this file's
   * first three passes. An interruption at the end of a two-minute note is
   * not a stray tap: if the run clears `MINIMUM_NOTE_MS` the file is attached
   * exactly as the stop branch would attach it, and if it does not it is
   * deleted exactly as `discardFile` deletes a stray tap's. Either way she is
   * told which — see `Interruption`.
   */
  const handleRecordingStatus = useCallback(
    async (status: RecordingStatus) => {
      if (!status.isFinished) return
      if (phaseRef.current !== 'recording') {
        // Consume ONE claim, never clear the lot. Clearing looks like tidy
        // self-healing and is not: the two orderings diverge the moment two
        // stops are outstanding at once, which `toggle` reaches as stop →
        // start → stop with the first report still in flight. Clearing there
        // discards both claims, so the second late report lands during the
        // live recording with nothing left to turn it away, and is taken as an
        // interruption — the previous file attached under this note's duration
        // and this recording force-stopped. That is the exact defect this
        // counter exists to prevent, restored by the cleanup meant to protect
        // it. A claim left standing only wedges the display until the next
        // status; a claim dropped loses a note, and those costs are not equal.
        if (pendingStopsRef.current > 0) pendingStopsRef.current -= 1
        return
      }
      if (pendingStopsRef.current > 0) {
        pendingStopsRef.current -= 1
        return
      }
      // No `busyRef` guard here, deliberately. `busyRef` and `phase` are
      // written as a pair with no await between them in either writer, so
      // `busyRef === true` while `phaseRef === 'recording'` is not a state
      // this screen can be in and the guard could never fire. Left in place
      // it would stop being dead the moment an await appeared between those
      // two writes — and what it would do then is suppress a genuine
      // interruption arriving during a live recording, which is the failure
      // this handler exists to prevent. Re-entrancy is already covered: this
      // handler leaves `'recording'` synchronously below, so a second status
      // is turned away by the phase guard above.
      //
      // The same type-level backstop `toggle` keeps, for the same reason: an
      // `undefined` foreign key must never reach `attachVoice`.
      if (recordId === undefined) return
      busyRef.current = true
      const ranForMs = longestProvenRun(
        recorder.getStatus().durationMillis,
        recordingStartedAtRef.current,
      )
      const finishedUri = status.url
      recordingStartedAtRef.current = null
      setPhase('saving')
      setError(null)
      setTooShort(false)
      pendingStopsRef.current += 1
      try {
        await recorder.stop()
      } catch {
        // Kotlin does not make this reachable: `stopRecording()` catches its
        // own `RuntimeException` from `MediaRecorder.stop()`, resets in
        // `finally`, and returns a Bundle either way, so the promise
        // resolves. The guard is for the case above that: the module never
        // reaching `stopRecording()` at all — a recorder released underneath
        // this screen, or RECORD_AUDIO revoked mid-recording. Nothing was
        // emitted then, so the count above has to come back down.
        if (pendingStopsRef.current > 0) pendingStopsRef.current -= 1
      }
      try {
        if (finishedUri === null) {
          setInterruption({
            message: interruptionNotSaved(status.hasError ? status.error : null),
            saved: false,
            durationMillis: ranForMs,
          })
        } else if (ranForMs < MINIMUM_NOTE_MS) {
          discardFile(finishedUri)
          setInterruption({
            message: interruptionTooShort(),
            saved: false,
            durationMillis: ranForMs,
          })
        } else {
          await attachVoice({ recordId, sourceUri: finishedUri, durationMs: ranForMs })
          // Deliberately no `router.back()`, unlike the stop branch. She did
          // not ask for this stop and does not know it happened; navigating
          // away would take the only sentence that tells her with it
          // (doctrine rule 3, the same reason nothing here is an Alert).
          setInterruption({
            message: interruptionSaved(ranForMs),
            saved: true,
            durationMillis: ranForMs,
          })
        }
        setPhase('idle')
      } catch (cause) {
        // The attach is the only thing that can throw in here, and it has:
        // the message below tells her to record again, so nothing will ever
        // come back for this file. Safe whatever `attachVoice` did
        // with the source, because `discardFile` targets `sourceUri` and is
        // guarded on the file still existing: `MediaStore.save` MOVES, so
        // after a successful move there is nothing left at `sourceUri` and
        // this is a no-op; before the move the source is still there and
        // deleting it is exactly right. Source and destination are never the
        // same path. This leaves the temporary file
        // the caller's to clean up on both outcomes — and on this one nobody
        // else knows it exists. Same best-effort silence as `discardFile`
        // everywhere else: the sentence that matters is the error.
        discardFile(finishedUri)
        setError(messageFor(cause))
        setPhase('idle')
      } finally {
        busyRef.current = false
      }
    },
    [attachVoice, recorder, recordId, setPhase],
  )

  // Re-pointed every render, because the subscription itself cannot be: see
  // the frozen-closure note in this file's header comment.
  useEffect(() => {
    statusListenerRef.current = (status: RecordingStatus) => {
      void handleRecordingStatus(status)
    }
  }, [handleRecordingStatus])

  /**
   * Asked on mount and again from the "Allow microphone access" button. A
   * rejection is a state of its own: without it the screen sat at
   * `permission === null` forever, and that branch rendered nothing at all —
   * a blank screen with a spoken description and no way out.
   */
  const askForMicrophone = useCallback(async () => {
    try {
      const response = await AudioModule.requestRecordingPermissionsAsync()
      if (!mountedRef.current) return
      setPermission(response)
      setPermissionFailed(false)
    } catch {
      if (mountedRef.current) setPermissionFailed(true)
    }
  }, [])

  useEffect(() => {
    void askForMicrophone()
  }, [askForMicrophone])

  // A live recorder holds the microphone, and the wake it implies, for the
  // rest of the session. `recorder.isRecording` is read here rather than
  // `state.isRecording`: it lives on the recorder instance itself, kept
  // current outside React's render cycle, so this cleanup sees the real
  // answer at the moment the screen goes away rather than whatever value the
  // poller last committed.
  //
  // WRAPPED IN try/catch, NOT MERELY `.catch` — and that distinction is a
  // hard crash, observed on an S25 running a release build: saving a voice
  // note killed the app to the desktop every time, with
  //
  //   Error: The 1st argument cannot be cast to type
  //   class expo.modules.audio.AudioRecorder (received class java.lang.Integer)
  //   → Caused by: Cannot use shared object that was already released
  //
  // `useAudioRecorder` registers its own release effect BEFORE this one, and
  // React runs unmount cleanups in registration order — so by the time this
  // runs the native recorder is already released. The earlier version guarded
  // `stop()`'s promise with `.catch`, which cannot help: `recorder.isRecording`
  // is a PROPERTY READ on the released object and throws SYNCHRONOUSLY, before
  // there is any promise to attach a handler to. A throw from an effect
  // cleanup is not caught by anything in React and reaches the app as fatal.
  //
  // A review predicted this exact ordering and marked it unverifiable without
  // a device. The device verified it.
  //
  // No `pendingStopsRef` claim for this one: `useAudioRecorder` unsubscribes
  // its `recordingStatusUpdate` listener in the same unmount, so the report
  // this stop queues has nowhere to be delivered and no later cycle to
  // confuse — this screen's refs die with it.
  useEffect(() => {
    return () => {
      try {
        if (recorder.isRecording) {
          void recorder.stop().catch(() => {
            // Already unmounting; there is no screen left to say it on.
          })
        }
      } catch {
        // The recorder was released before this cleanup ran, so there is
        // nothing left to stop and nobody left to tell. Reading any property
        // on it throws; that is the whole reason this is a try/catch.
      }
    }
  }, [recorder])

  const toggle = useCallback(async () => {
    if (busyRef.current) return
    // Unreachable behind the render guard below — which never shows a toggle
    // without a `recordId` — but this closure outlives a render, nothing
    // validates the param, and an `undefined` foreign key must never reach
    // `attachVoice`. The type-level backstop, kept for the same reason
    // `camera.tsx` keeps its own.
    if (recordId === undefined) return
    // THE LIVE FLAG, not `state.isRecording`: the poller's copy is up to
    // 500 ms old, so a second tap inside that window reads `false` and takes
    // the start branch — `prepareToRecordAsync()` and `record()` against an
    // already-running recorder.
    const wasRecording = recorder.isRecording
    busyRef.current = true
    setPhase(wasRecording ? 'saving' : 'starting')
    setError(null)
    setTooShort(false)
    setInterruption(null)
    // The stop branch's finished file, hoisted so the catch below can clean
    // it up: an attach that failed leaves a temporary file nothing
    // downstream has ever heard of, under a message telling her to record
    // again. `null` on every path that never got as far as a file.
    let finishedUri: string | null = null
    try {
      if (!wasRecording) {
        await recorder.prepareToRecordAsync()
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true })
        recorder.record()
        recordingStartedAtRef.current = Date.now()
        setPhase('recording')
      } else {
        // Read from the recorder, at the press, before `stop()` — the
        // poller's last commit can be nearly half a second short, which is
        // the difference between a 1.4 s note kept and the same note
        // reported as 900 ms and silently discarded.
        const ranForMs = recorder.getStatus().durationMillis
        recordingStartedAtRef.current = null
        // Claimed before the call, not after: the report for this stop is
        // queued on Kotlin's main queue and is not tied to the promise below,
        // so it can outlive this whole cycle. See `pendingStopsRef`.
        pendingStopsRef.current += 1
        // `stop()` must resolve before `recorder.uri` means anything —
        // reading it earlier attaches the previous recording, or nothing,
        // with a straight face.
        try {
          await recorder.stop()
        } catch (cause) {
          // Nothing was emitted for a stop that never reached Kotlin; the
          // claim above has to come back down before this rethrows into the
          // screen's own error handling. See the same rollback in
          // `handleRecordingStatus`.
          if (pendingStopsRef.current > 0) pendingStopsRef.current -= 1
          throw cause
        }
        finishedUri = recorder.uri
        if (ranForMs < MINIMUM_NOTE_MS) {
          setTooShort(true)
          discardFile(finishedUri)
        } else if (finishedUri === null) {
          throw new Error('The recorder produced no file.')
        } else {
          await attachVoice({ recordId, sourceUri: finishedUri, durationMs: ranForMs })
          router.back()
        }
        setPhase('idle')
      }
    } catch (cause) {
      // Whatever the attach did or did not manage, the message below sends
      // her back to record again — so this file is nobody's from here on.
      // See the same cleanup in `handleRecordingStatus`.
      discardFile(finishedUri)
      // On screen, not an Alert (doctrine rule 3): a modal that dismisses
      // takes the message with it, and a voice screen that closes on
      // failure loses the note and the explanation together.
      setError(messageFor(cause))
      setPhase('idle')
    } finally {
      busyRef.current = false
    }
  }, [attachVoice, recorder, recordId, setPhase])

  // No route navigates here without a `recordId` yet, but nothing
  // validates the param, and `useLocalSearchParams` yields `undefined` in
  // practice however the type is spelled. Render something honest rather
  // than a toggle with nowhere to attach its recording.
  if (recordId === undefined) {
    return (
      <Screen
        testID="voice-screen"
        spokenDescription="Voice note. This screen was opened without a record to attach a note to, so there is nothing to record into."
      >
        <Type testID="voice-no-record">
          This voice note was not opened from a survey record, so there is nowhere to attach
          it. Go back and open it from the record you want to add it to.
        </Type>
      </Screen>
    )
  }

  if (permissionFailed) {
    return (
      <Screen
        testID="voice-screen"
        spokenDescription="The microphone request could not be completed. A button to ask again."
      >
        <Type testID="voice-permission-error" style={{ color: theme.colors.statusPoor }}>
          Corymbia Field Kit could not ask for the microphone just then. Try asking again.
        </Type>
        <View style={{ height: spacing.lg }} />
        <Button
          label="Allow microphone access"
          onPress={() => {
            void askForMicrophone()
          }}
          testID="voice-request"
        />
      </Screen>
    )
  }

  // `permission` is `null` until the request resolves, and `null` is not
  // `denied` — rendering the refusal here would flash "no microphone
  // access" before the request has even been asked. It is not nothing,
  // either: an empty screen is indistinguishable from one that has hung.
  if (permission === null) {
    return (
      <Screen
        testID="voice-screen"
        spokenDescription="Voice note. Checking whether Corymbia Field Kit has permission to use the microphone."
      >
        <Type testID="voice-checking" dim>
          Checking whether Corymbia Field Kit can use the microphone…
        </Type>
      </Screen>
    )
  }

  // Three states, not two. The common Android refusal is deny-once, which
  // leaves `canAskAgain` true — sending her to Settings for a permission a
  // button can still ask for is a detour she does not need in a paddock.
  if (!permission.granted && permission.canAskAgain) {
    return (
      <Screen
        testID="voice-screen"
        spokenDescription="Microphone access needed. Corymbia Field Kit needs the microphone to attach a voice note to this survey record. A button to allow it."
      >
        <Type testID="voice-needs-permission">
          Corymbia Field Kit needs the microphone to attach a voice note to this survey
          record.
        </Type>
        <View style={{ height: spacing.lg }} />
        <Button
          label="Allow microphone access"
          onPress={() => {
            void askForMicrophone()
          }}
          testID="voice-request"
        />
      </Screen>
    )
  }

  if (!permission.granted) {
    return (
      <Screen
        testID="voice-screen"
        spokenDescription="Microphone access refused. Open Settings to allow Corymbia Field Kit to use the microphone, then come back to record a voice note."
      >
        <Type testID="voice-denied">
          Microphone access was refused. Open Settings to allow Corymbia Field Kit to use the
          microphone, then come back to record a voice note.
        </Type>
      </Screen>
    )
  }

  const reach = resolveReach({ deviceClass, orientation, handedness: settings.handedness })
  const controlsStyle: ViewStyle =
    reach.anchor === 'bottomCorners'
      ? {
          alignSelf: reach.primarySide === 'right' ? 'flex-end' : 'flex-start',
          maxWidth: CORNER_BLOCK_MAX_W,
          width: '100%',
        }
      : { alignSelf: 'stretch' }

  // Never the poller's flag: the label is the only thing that tells her the
  // tap registered, and "Record" still showing half a second after she
  // pressed Record is the same as no feedback at all.
  const isRecording = phase === 'recording'
  // Frozen at the moment an interrupted recording died. On Android the poller
  // goes on climbing after `onError`, because that handler never resets the
  // native recorder — a readout still counting up under a sentence that says
  // the recording has stopped. See `Interruption`.
  const elapsedMillis = interruption === null ? state.durationMillis : interruption.durationMillis
  const toggleLabel =
    phase === 'saving'
      ? 'Saving…'
      : phase === 'starting'
        ? 'Starting…'
        : isRecording
          ? 'Stop'
          : 'Record'

  // The one transition this screen exists for, announced. A description
  // fixed at "the elapsed time and one control" says the same thing whether
  // she is recording, has just lost a note to a stray tap, or has just been
  // told the save failed.
  const spokenDescription =
    error !== null
      ? `Voice note. ${error}`
      : interruption !== null
        ? `Voice note. ${interruption.message}`
        : tooShort
        ? 'Voice note. That recording was too short to carry anything, so it was not saved. Record again and say what you need before you stop it.'
        : isRecording
          ? 'Voice note. Recording. The elapsed time, and one control that stops the recording and attaches it to this record.'
          : 'Voice note. Not recording. The elapsed time, and one control that starts recording.'

  return (
    <Screen testID="voice-screen" spokenDescription={spokenDescription}>
      <View style={{ alignItems: 'center', gap: spacing.md }}>
        <Type variant="label" dim>
          {isRecording ? 'RECORDING' : 'ELAPSED'}
        </Type>
        {/*
          The elapsed time is the only evidence anything is happening: a
          recorder with no visible timer is indistinguishable from one that
          silently failed to start, and she will not find out until playback.
          This is the one place the poller's `durationMillis` is the right
          source — a display that ticks is exactly what a 500 ms poll is for.
        */}
        <Type
          variant="hero"
          testID="voice-elapsed"
          accessibilityLabel={spokenElapsed(elapsedMillis)}
        >
          {formatElapsed(elapsedMillis)}
        </Type>
      </View>
      {/*
        `flexGrow: 1` with `justifyContent: 'flex-end'`, the same way
        `capture.tsx` does it: `resolveReach`'s anchors are both about the
        BOTTOM of the screen, and `alignSelf`/`maxWidth` alone only decide
        which side of the top the block sits on. Without these two the
        ergonomic computation was half applied — the toggle sat under the
        timer, out of thumb reach, mirrored left and right for no benefit.
      */}
      <View
        testID="voice-controls"
        style={[
          controlsStyle,
          { flexGrow: 1, justifyContent: 'flex-end', padding: spacing.lg, gap: spacing.md },
        ]}
      >
        {error !== null ? (
          <Type testID="voice-error" style={{ color: theme.colors.statusPoor }}>
            {error}
          </Type>
        ) : null}
        {interruption !== null ? (
          // Coloured only when something was lost, and never load-bearing:
          // the sentence itself says "was saved" or "was not saved"
          // (doctrine rule 9).
          <Type
            testID="voice-interrupted"
            style={interruption.saved ? undefined : { color: theme.colors.statusPoor }}
          >
            {interruption.message}
          </Type>
        ) : null}
        {tooShort ? (
          <Type testID="voice-too-short">
            That recording was too short to carry anything, so it was not saved. Record again
            and say what you need before you stop it.
          </Type>
        ) : null}
        <Button
          label={toggleLabel}
          onPress={() => {
            void toggle()
          }}
          size="field"
          testID="voice-toggle"
        />
      </View>
    </Screen>
  )
}
