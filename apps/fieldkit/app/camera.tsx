import React, { useCallback, useRef, useState } from 'react'
import { View, type ViewStyle } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { spacing } from '@corymbia/tokens'
import { Button, CORNER_BLOCK_MAX_W, Screen, Type, resolveReach, useLayout, useTheme } from '@corymbia/ui'
import { useDatabaseStatus, useSettings } from '../src/db/provider'
import { useAttachMedia } from '../src/media/useAttachMedia'

/**
 * The camera screen (Plan 4, Task 8): a full-screen viewfinder with our own
 * shutter, reached from a record. `useAttachMedia` (`src/media`) is the
 * pipeline that writes the file and the row; this screen only calls and
 * awaits it once a photo has been captured to a temporary file.
 *
 * `exif: true` on the capture is deliberate (spec §12.1): the image carries
 * its own timestamp and, where the OS provides it, its own coordinates —
 * independent corroboration of the record's fix, which matters for a
 * photograph that may end up as evidence of what was at a site.
 */

/**
 * A human sentence first, the technical cause subordinate to it rather than
 * the whole message (doctrine rule 6: plain language for process). A failed
 * attach surfaces whatever SQLite or the file system said, and a native
 * camera failure is equally raw — so this is what stands between that text
 * and a field ecologist who needs to know what happened and what to do, not
 * what threw.
 *
 * Trailing sentence punctuation is stripped from the cause before this
 * sentence adds its own: a cause whose message ends in a full stop, glued
 * together uncorrected, reads "...disk full.. Try the
 * shutter again." A native cause is not guaranteed to end in a full stop at
 * all — "Still loading…" ends in an ellipsis, a thrown message can end in
 * "?" or "!" — and any of those left in place reads just as oddly: "Still
 * loading…. Try the shutter again." (`voice.tsx` strips the same set, for
 * the same reason).
 */
function messageFor(cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause)
  return `The photo could not be saved: ${detail.replace(/[.?!…]+$/, '')}. Try the shutter again.`
}

export default function CameraScreen() {
  const status = useDatabaseStatus()

  // `useAttachMedia` reads the database and the registered device out of
  // context, and `useDatabase`/`useDevice` both throw before the database is
  // open — so the guard has to come before the body that calls them, hence
  // the split into two components rather than an early return inside one
  // (`capture.tsx` and `diagnostics.tsx` do the same, for the same reason).
  if (status.state !== 'ready') {
    return (
      <Screen
        testID="camera-screen"
        spokenDescription={`Camera. The database is ${status.state}, so there is nowhere to attach a photo yet.`}
      >
        <Type testID="camera-database" variant="title">
          Database {status.state}
        </Type>
        {status.error ? <Type dim>{status.error.message}</Type> : null}
      </Screen>
    )
  }

  return <CameraBody />
}

function CameraBody() {
  const { recordId } = useLocalSearchParams<{ recordId?: string }>()
  const [permission, requestPermission] = useCameraPermissions()
  const cameraRef = useRef<CameraView>(null)
  const [error, setError] = useState<string | null>(null)
  // Claimed synchronously, before any await — see `shoot` below.
  const savingRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const { theme } = useTheme()
  const { deviceClass, orientation } = useLayout()
  const { settings } = useSettings()
  const { attachPhoto } = useAttachMedia()

  /**
   * The exact failure that killed the capture button for a whole session in
   * Plan 3: a claim taken *after* an await is a claim taken too late, because
   * a second press can land in the gap between the first press starting and
   * that await resolving. `savingRef.current = true` has to be the very
   * first thing this function does — before `takePictureAsync`, before
   * anything that yields to the event loop — or a second press taken while
   * the first `takePictureAsync` is still in flight is not blocked by
   * anything at all.
   */
  const shoot = useCallback(async () => {
    if (savingRef.current) return
    // Nothing navigates to `/camera` yet (spec §12.1's affordance row lands
    // with Task 11), so this is latent rather than reachable today — but a
    // route opened without its param would otherwise hand `attachPhoto` an
    // `undefined` foreign key. The render guard below keeps the shutter from
    // ever appearing in that case; this is the type-level backstop for the
    // closure that outlives it.
    if (recordId === undefined) return
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const shot = await cameraRef.current?.takePictureAsync({ quality: 0.85, exif: true })
      if (shot === undefined) throw new Error('The camera returned no photo.')
      await attachPhoto({ recordId, sourceUri: shot.uri })
      router.back()
    } catch (cause) {
      // On screen, not an Alert — no numbered doctrine rule covers this, but
      // the reasoning is the same shape as several that do: a modal that
      // dismisses takes the message with it, and a camera screen that closes
      // on failure loses the photo and the explanation together.
      setError(messageFor(cause))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [attachPhoto, recordId])

  // No route navigates here without a `recordId` yet (latent until Task 11),
  // but nothing validates the param, and `useLocalSearchParams` yields
  // `undefined` in practice however the type is spelled. Render something
  // honest rather than a viewfinder with nowhere to attach its photo.
  if (recordId === undefined) {
    return (
      <Screen
        testID="camera-screen"
        spokenDescription="Camera. This screen was opened without a record to attach a photo to, so there is nothing to capture into."
      >
        <Type testID="camera-no-record">
          This camera was not opened from a survey record, so there is nowhere to attach a
          photo. Go back and open the camera from the record you want to add it to.
        </Type>
      </Screen>
    )
  }

  // `permission` is `null` until the hook resolves, and `null` is not
  // `denied` — rendering the refusal here would flash "no camera access" at
  // someone who granted it months ago. Three states, not two.
  if (permission === null) {
    return (
      <Screen
        testID="camera-screen"
        spokenDescription="Camera. Checking whether Corymbia Field Kit has permission to use the camera."
      >
        {null}
      </Screen>
    )
  }

  if (!permission.granted && permission.canAskAgain) {
    return (
      <Screen
        testID="camera-screen"
        spokenDescription="Camera access needed. Corymbia Field Kit needs the camera to attach a photo to this survey record. A button to allow it."
      >
        <Type>
          Corymbia Field Kit needs the camera to attach a photo to this survey record.
        </Type>
        <View style={{ height: spacing.lg }} />
        <Button
          label="Allow camera access"
          onPress={() => {
            void requestPermission()
          }}
          testID="camera-request"
        />
      </Screen>
    )
  }

  if (!permission.granted) {
    return (
      <Screen
        testID="camera-screen"
        spokenDescription="Camera access refused. Open Settings to allow Corymbia Field Kit to use the camera, then come back to attach a photo."
      >
        <Type testID="camera-denied">
          Camera access was refused. Open Settings to allow Corymbia Field Kit to use the
          camera, then come back to attach a photo.
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

  return (
    <Screen
      testID="camera-screen"
      padded={false}
      spokenDescription="Camera. The live viewfinder and one control that captures a photo and attaches it to this record."
    >
      <CameraView testID="camera-view" ref={cameraRef} style={{ flex: 1 }} />
      <View style={[controlsStyle, { padding: spacing.lg, gap: spacing.md }]}>
        {error !== null ? (
          <Type testID="camera-error" style={{ color: theme.colors.statusPoor }}>
            {error}
          </Type>
        ) : null}
        <Button
          label={saving ? 'Saving…' : 'Capture'}
          onPress={() => {
            void shoot()
          }}
          size="field"
          testID="camera-shutter"
        />
      </View>
    </Screen>
  )
}
