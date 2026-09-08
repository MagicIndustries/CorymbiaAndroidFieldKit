import React, { useCallback, useEffect, useRef, useState } from 'react'
import { View, type ViewStyle } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
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
 */

/**
 * A stray tap produces a file a few hundred milliseconds long. Attaching it
 * puts a voice note on the record that says nothing, and she would only find
 * that out by playing it back — so a note shorter than this is discarded on
 * the spot instead, with a word on screen saying so. This is not a judgement
 * about how much she had to say; a deliberate one-second note is kept.
 */
const MINIMUM_NOTE_MS = 1000

/**
 * A human sentence first, the technical cause subordinate to it rather than
 * the whole message (doctrine rule 6). Until Task 10 lands, every attach
 * surfaces the seam's own placeholder message — and a native recorder
 * failure will be equally raw — so this is what stands between that text and
 * a field ecologist who needs to know what happened and what to do, not what
 * threw.
 */
function messageFor(cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause)
  return `The voice note could not be saved: ${detail}. Try recording again.`
}

function formatElapsed(durationMillis: number): string {
  const totalSeconds = Math.floor(durationMillis / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`
}

export default function VoiceScreen() {
  const { recordId } = useLocalSearchParams<{ recordId?: string }>()
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const state = useAudioRecorderState(recorder)
  const [permission, setPermission] = useState<PermissionResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tooShort, setTooShort] = useState(false)
  // Claimed synchronously, before any await — see `toggle` below, the same
  // reason `camera.tsx`'s `savingRef` exists: a claim taken after an await
  // is a claim taken too late, because a second press can land in the gap
  // between the first press starting and that await resolving.
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const { theme } = useTheme()
  const { deviceClass, orientation } = useLayout()
  const { settings } = useSettings()

  useEffect(() => {
    let cancelled = false
    void AudioModule.requestRecordingPermissionsAsync().then((response) => {
      if (!cancelled) setPermission(response)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // A live recorder holds the microphone, and the wake it implies, for the
  // rest of the session. `recorder.isRecording` is read here rather than
  // `state.isRecording`: it lives on the recorder instance itself, kept
  // current outside React's render cycle, so this cleanup sees the real
  // answer at the moment the screen goes away rather than whatever value was
  // captured the last time this effect's dependencies changed.
  useEffect(() => {
    return () => {
      if (recorder.isRecording) {
        void recorder.stop()
      }
    }
  }, [recorder])

  const toggle = useCallback(async () => {
    if (busyRef.current) return
    if (recordId === undefined) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    setTooShort(false)
    try {
      if (!state.isRecording) {
        await recorder.prepareToRecordAsync()
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true })
        recorder.record()
      } else {
        const ranForMs = state.durationMillis
        // `stop()` must resolve before `recorder.uri` means anything —
        // reading it earlier attaches the previous recording, or nothing,
        // with a straight face.
        await recorder.stop()
        const finishedUri = recorder.uri
        if (ranForMs < MINIMUM_NOTE_MS) {
          setTooShort(true)
        } else if (finishedUri === null) {
          throw new Error('The recorder produced no file.')
        } else {
          await attachVoice({ recordId, sourceUri: finishedUri, durationMs: ranForMs })
          router.back()
        }
      }
    } catch (cause) {
      // On screen, not an Alert (doctrine rule 3): a modal that dismisses
      // takes the message with it, and a voice screen that closes on
      // failure loses the note and the explanation together.
      setError(messageFor(cause))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [recorder, recordId, state.durationMillis, state.isRecording])

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

  // `permission` is `null` until the request resolves, and `null` is not
  // `denied` — rendering the refusal here would flash "no microphone
  // access" before the request has even been asked.
  if (permission === null) {
    return (
      <Screen
        testID="voice-screen"
        spokenDescription="Voice note. Checking whether Corymbia Field Kit has permission to use the microphone."
      >
        {null}
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

  // The elapsed time is the only evidence anything is happening: a recorder
  // with no visible timer is indistinguishable from one that silently
  // failed to start, and she will not find out until playback.
  const toggleLabel = busy ? (state.isRecording ? 'Saving…' : 'Starting…') : state.isRecording ? 'Stop' : 'Record'

  return (
    <Screen
      testID="voice-screen"
      spokenDescription="Voice note. The elapsed time and one control that starts and stops recording, then attaches the note to this record."
    >
      <View style={{ alignItems: 'center', gap: spacing.md }}>
        <Type variant="label" dim>
          {state.isRecording ? 'RECORDING' : 'ELAPSED'}
        </Type>
        <Type variant="hero" testID="voice-elapsed">
          {formatElapsed(state.durationMillis)}
        </Type>
      </View>
      <View style={[controlsStyle, { padding: spacing.lg, gap: spacing.md }]}>
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
