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
} from 'expo-audio'
import { spacing } from '@corymbia/tokens'
import { Button, CORNER_BLOCK_MAX_W, Screen, Type, resolveReach, useLayout, useTheme } from '@corymbia/ui'
import { useSettings } from '../src/db/provider'
import { attachVoice } from '../src/media/attachVoice'

/**
 * The voice note screen (Plan 4, Task 9): one toggle that starts and stops a
 * recording and attaches it to a record, the sibling of `camera.tsx` (Task
 * 8). Task 10 fills `attachVoice` (`src/media`) in with the pipeline that
 * writes the file and the row; this screen only needs something to call and
 * await once a recording has been stopped to a temporary file.
 *
 * `RecordingPresets.HIGH_QUALITY` writes `.m4a` on Android (SDK 57 docs,
 * https://docs.expo.dev/versions/v57.0.0/sdk/audio/) — `attachVoice`'s doc
 * comment carries that fact forward for Task 10, since this screen never
 * needs to know the extension itself.
 *
 * **THE RECORDER IS THE TRUTH; `useAudioRecorderState` IS A POLLER.** The
 * hook runs `setInterval(..., 500)` and commits a new object only once
 * `durationMillis` has moved more than 50 ms
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
 * the whole message (doctrine rule 6). Until Task 10 lands, every attach
 * surfaces the seam's own placeholder message — and a native recorder
 * failure will be equally raw — so this is what stands between that text and
 * a field ecologist who needs to know what happened and what to do, not what
 * threw.
 *
 * The trailing full stop is stripped from the cause before this sentence
 * adds its own: `attachVoice`'s message ends in one, and glued together
 * uncorrected they read "...implements this seam.. Try recording again."
 * (`camera.tsx` strips it the same way, for the same message).
 */
function messageFor(cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause)
  return `The voice note could not be saved: ${detail.replace(/\.+$/, '')}. Try recording again.`
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

export default function VoiceScreen() {
  const { recordId } = useLocalSearchParams<{ recordId?: string }>()
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const state = useAudioRecorderState(recorder)
  const [permission, setPermission] = useState<PermissionResponse | null>(null)
  const [permissionFailed, setPermissionFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tooShort, setTooShort] = useState(false)
  // Claimed synchronously, before any await — see `toggle` below, the same
  // reason `camera.tsx`'s `savingRef` exists: a claim taken after an await
  // is a claim taken too late, because a second press can land in the gap
  // between the first press starting and that await resolving.
  const busyRef = useRef(false)
  // What the toggle is doing, rather than merely that it is busy: after
  // `stop()` resolves the recorder is no longer recording, so a label
  // derived from the live flag mid-action would flip from "Saving…" to
  // "Starting…" while the attach is still in flight.
  const [phase, setPhase] = useState<Phase>('idle')
  const { theme } = useTheme()
  const { deviceClass, orientation } = useLayout()
  const { settings } = useSettings()

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

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
  // `.catch` because this stop is genuinely allowed to fail and there is
  // nobody left to tell: `useAudioRecorder` registers its own release effect
  // before this one and React runs unmount cleanups in registration order,
  // so by the time this runs the native recorder may already be released and
  // reject. Unhandled, that surfaces as a crash-adjacent warning on a screen
  // that has already gone.
  useEffect(() => {
    return () => {
      if (recorder.isRecording) {
        void recorder.stop().catch(() => {
          // Already unmounting; there is no screen left to say it on.
        })
      }
    }
  }, [recorder])

  const toggle = useCallback(async () => {
    if (busyRef.current) return
    // Unreachable behind the render guard below — which never shows a toggle
    // without a `recordId` — but this closure outlives a render, the seam
    // validates nothing, and an `undefined` foreign key must never reach
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
    try {
      if (!wasRecording) {
        await recorder.prepareToRecordAsync()
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true })
        recorder.record()
        setPhase('recording')
      } else {
        // Read from the recorder, at the press, before `stop()` — the
        // poller's last commit can be nearly half a second short, which is
        // the difference between a 1.4 s note kept and the same note
        // reported as 900 ms and silently discarded.
        const ranForMs = recorder.getStatus().durationMillis
        // `stop()` must resolve before `recorder.uri` means anything —
        // reading it earlier attaches the previous recording, or nothing,
        // with a straight face.
        await recorder.stop()
        const finishedUri = recorder.uri
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
      // On screen, not an Alert (doctrine rule 3): a modal that dismisses
      // takes the message with it, and a voice screen that closes on
      // failure loses the note and the explanation together.
      setError(messageFor(cause))
      setPhase('idle')
    } finally {
      busyRef.current = false
    }
  }, [recorder, recordId])

  // No route navigates here without a `recordId` yet, but the seam
  // validates nothing, and `useLocalSearchParams` yields `undefined` in
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
          accessibilityLabel={spokenElapsed(state.durationMillis)}
        >
          {formatElapsed(state.durationMillis)}
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
