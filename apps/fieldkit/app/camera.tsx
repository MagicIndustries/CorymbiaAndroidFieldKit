import React, { useCallback, useRef, useState } from 'react'
import { View, type ViewStyle } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { spacing } from '@corymbia/tokens'
import { Button, Screen, Type, resolveReach, useLayout, useTheme } from '@corymbia/ui'
import { useSettings } from '../src/db/provider'
import { attachPhoto } from '../src/media/attachPhoto'

/**
 * The camera screen (Plan 4, Task 8): a full-screen viewfinder with our own
 * shutter, reached from a record. Task 10 fills `attachPhoto` (`src/media`)
 * in with the pipeline that writes the file and the row; this screen only
 * needs something to call and await once a photo has been captured to a
 * temporary file.
 *
 * `exif: true` on the capture is deliberate (spec §12.1): the image carries
 * its own timestamp and, where the OS provides it, its own coordinates —
 * independent corroboration of the record's fix, which matters for a
 * photograph that may end up as evidence of what was at a site.
 */

/**
 * How wide the control band may grow when the reach zone anchors it to a
 * corner — the same ergonomic reasoning `capture.tsx`'s `CORNER_BLOCK_MAX_W`
 * applies to the capture block: a tablet in landscape pulls the shutter to
 * whichever corner her dominant hand reaches, and without a cap that corner
 * block would stretch the full width of a 10-inch tablet.
 */
const CORNER_BLOCK_MAX_W = 420

function messageFor(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export default function CameraScreen() {
  const { recordId } = useLocalSearchParams<{ recordId: string }>()
  const [permission, requestPermission] = useCameraPermissions()
  const cameraRef = useRef<CameraView>(null)
  const [error, setError] = useState<string | null>(null)
  // Claimed synchronously, before any await — see `shoot` below.
  const savingRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const { theme } = useTheme()
  const { deviceClass, orientation } = useLayout()
  const { settings } = useSettings()

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
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const shot = await cameraRef.current?.takePictureAsync({ quality: 0.85, exif: true })
      if (shot === undefined) throw new Error('The camera returned no photo.')
      await attachPhoto({ recordId, sourceUri: shot.uri })
      router.back()
    } catch (cause) {
      // On screen, not an Alert (doctrine rule 3): a modal that dismisses
      // takes the message with it, and a camera screen that closes on
      // failure loses the photo and the explanation together.
      setError(messageFor(cause))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [recordId])

  // `permission` is `null` until the hook resolves, and `null` is not
  // `denied` — rendering the refusal here would flash "no camera access" at
  // someone who granted it months ago. Three states, not two.
  if (permission === null) {
    return <Screen testID="camera-screen">{null}</Screen>
  }

  if (!permission.granted && permission.canAskAgain) {
    return (
      <Screen testID="camera-screen">
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
      <Screen testID="camera-screen">
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
    <Screen testID="camera-screen" padded={false}>
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
