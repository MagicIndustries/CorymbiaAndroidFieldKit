import React, { useRef } from 'react'
import { ScrollView, View, type ViewStyle } from 'react-native'
import {
  createExpoLocationSource,
  gradeAccuracy,
  type HoldVerdict,
  type LocationSource,
} from '@corymbia/geo'
import { spacing } from '@corymbia/tokens'
import {
  Button,
  Screen,
  TrafficLightFrame,
  Type,
  resolveReach,
  useLayout,
  type FixGradeName,
} from '@corymbia/ui'
import { useCapture, type Capture, type CapturePreview } from '../src/capture/useCapture'
import { useDatabase, useDatabaseStatus, useDevice, useSettings } from '../src/db/provider'

/**
 * The capture screen (spec §9.1–§9.4): the one thing a field ecologist looks at
 * while standing still over a survey point.
 *
 * The state machine is `src/capture/useCapture.ts` and every part of the frame
 * is `@corymbia/ui`; what is decided here is what she sees, how big it is, and
 * where it sits. Three rules govern all of that, and none of them is a
 * preference:
 *
 *  - **The accuracy and the seconds remaining are the largest things on the
 *    screen** while a countdown runs (§9.4). They are the two numbers she is
 *    standing still for, and they have to be legible at arm's length, in glare,
 *    without leaning in. Everything else in that state is subordinate to them.
 *    The diagnostics prototype rendered them at the same weight as its other
 *    instrument readouts, which is right for an instrument and wrong for the
 *    field.
 *  - **Everything that responds during a countdown sits inside the frame with
 *    the button** (§9.1.2) — the accuracy, the seconds, the sample count, the
 *    improvement, the spread and the verdict sentence. This is the specific
 *    defect the whole single-control design exists to fix: on the superseded
 *    press-and-hold screen her thumb was on the button while the only part of
 *    the screen that moved was somewhere else entirely. A design that puts the
 *    countdown readout in a panel above the control has not implemented that
 *    section.
 *  - **There is exactly one control** (§9.1.4). `CAPTURE` before the tap,
 *    `ACCEPT NOW` during the countdown, and it is live for every moment of it.
 */

/**
 * Six decimal places, which is about 0.1 m at this latitude — one order finer
 * than the best fix this hardware produces, so the last digit moving is real
 * movement in the estimate rather than rounding noise. Fixed width and
 * monospaced (`Type`'s `mono` variant) so the digits do not jitter sideways
 * while she watches them settle.
 */
function formatDegrees(value: number): string {
  return value.toFixed(6)
}

/** The accuracy as it is spoken about everywhere else in the app: `±3.2 m`. */
function formatAccuracy(accuracyM: number | null): string {
  return accuracyM === null ? '—' : `±${accuracyM.toFixed(1)} m`
}

/**
 * The two sentences, verbatim from spec §9.3. They are pinned there — the
 * wording is the answer to the only question she actually has — so they are a
 * lookup rather than something composed at the call site.
 */
const VERDICT_SENTENCE: Record<HoldVerdict, string> = {
  improving: 'Still improving — keep standing still.',
  plateaued: 'About as sharp as it gets here — accepting now costs nothing.',
}

/**
 * Below this, an improvement is not worth claiming: it is a tenth of the
 * precision the readout prints, so anything smaller would render as
 * "0.0 m sharper", which is a claim of improvement dressed as none.
 */
const IMPROVEMENT_FLOOR_M = 0.05

/**
 * How much sharper the accumulated fix is than the one the tap wrote.
 *
 * **Not presented as signed, because it cannot be** (spec §9.3, corrected).
 * The delta is structurally incapable of going negative — inverse-variance
 * weighting is monotonic in the sample set and the tap's own reading is always
 * a member of it — so a signed presentation would advertise a worsening this
 * number can never show. The honest reading of it is "how much sharper", and
 * the spread beside it is what reports a capture that went badly.
 *
 * `tapHadPosition` is false when the tap found no fix at all, where the
 * improvement is zero for want of a baseline rather than for want of progress.
 * Saying "no sharper than the tap" there would describe a comparison against a
 * measurement that was never taken.
 */
function describeImprovement(preview: CapturePreview | null, tapHadPosition: boolean): string {
  if (preview === null) return 'nothing usable to average yet'
  if (!tapHadPosition) return 'from no position at all'
  if (preview.improvedByM < IMPROVEMENT_FLOOR_M) return 'no sharper than the tap yet'
  return `${preview.improvedByM.toFixed(1)} m sharper than the tap`
}

/**
 * How far apart the readings are — the honesty check on the improvement (spec
 * §9.3). A tight spread with a good accuracy is a fix to trust; a good accuracy
 * with a wide spread is the case the accuracy number alone would quietly hide.
 *
 * A single reading reports absence rather than ±0.0 m: it has nothing to
 * disagree with, which is not the same claim as perfect agreement.
 */
function describeSpread(preview: CapturePreview | null): string {
  if (preview === null) return 'nothing to compare yet'
  if (preview.spreadM === null) return 'one reading — nothing to compare yet'
  return `readings ±${preview.spreadM.toFixed(1)} m apart`
}

/** How many readings have gone into the fix the override would store. */
function describeSamples(preview: CapturePreview | null): string {
  const count = preview?.sampleCount ?? 0
  return count === 1 ? '1 reading averaged' : `${String(count)} readings averaged`
}

/**
 * How wide the capture block may grow when the reach zone anchors it to a
 * corner rather than stretching it across a band.
 *
 * A tablet in landscape is the only case that reaches this (see `resolveReach`),
 * and there the whole point is that the block sits under one thumb: allowed to
 * span a ten-inch screen it would put its own far edge further from the control
 * than the panel this design replaced. This is a fixed physical size in dp, not
 * a fraction of the window — nothing here may branch on a raw width (doctrine's
 * layout rule), and the ergonomic question is how far a thumb reaches, which is
 * a distance rather than a proportion.
 */
const CORNER_BLOCK_MAX_W = 420

export default function CaptureScreen() {
  const status = useDatabaseStatus()

  // `useDatabase`, `useDevice` and `useSettings` all throw before the database
  // is open, so the guard has to come before the body that calls them — hence
  // the split into two components rather than an early return inside one
  // (`diagnostics.tsx` does the same, for the same reason).
  if (status.state !== 'ready') {
    return (
      <Screen spokenDescription={`Capture. The database is ${status.state}.`}>
        <Type variant="title">Database {status.state}</Type>
        {status.error ? <Type dim>{status.error.message}</Type> : null}
      </Screen>
    )
  }

  return <CaptureBody />
}

function CaptureBody() {
  const db = useDatabase()
  const device = useDevice()
  const { settings } = useSettings()
  const { deviceClass, orientation } = useLayout()

  /**
   * The location source, created once and never again.
   *
   * `CaptureDeps` requires this to be referentially stable: the hook lists it
   * as an effect dependency, so a new identity re-requests the permission and
   * resubscribes — and this screen re-renders four times a second for the whole
   * of a countdown. Lazily initialised through the ref rather than passed as
   * `useRef(createExpoLocationSource()).current`, so the factory is not called
   * on every render merely to have its result discarded.
   */
  const sourceRef = useRef<LocationSource | null>(null)
  const source: LocationSource = (sourceRef.current ??= createExpoLocationSource())

  const capture = useCapture({ db, device, source })
  const acquiring = capture.phase === 'acquiring'

  /**
   * The accuracy the frame is grading and the readout is printing.
   *
   * During a countdown that is the *preview* — what the override would actually
   * store — and not the latest single reading: watching one reading bounce
   * between 4 m and 9 m says nothing about whether the accumulated average is
   * getting better, which is the only question the countdown asks. Otherwise it
   * is the live reading, which is what a tap would record.
   */
  const shownAccuracyM = acquiring
    ? (capture.preview?.accuracyM ?? null)
    : (capture.latest?.accuracyM ?? null)

  /**
   * The traffic light. There is no "no fix" colour — the frame's three grades
   * are the whole vocabulary — so an absent fix takes the worst of them, which
   * a dashed border and a `POOR FIX` word already make honest, and the readout
   * beside it prints `—` rather than a number. Nothing here blocks a capture
   * either way (doctrine rule 4).
   */
  const grade: FixGradeName = shownAccuracyM === null ? 'poor' : gradeAccuracy(shownAccuracyM)

  /**
   * Where the capture block sits, from the reach zone (spec §5.4, §9.1) and
   * never from a raw width. `bottomBand` is the phone ergonomic — a band across
   * the bottom, under the thumb of whichever hand is holding it — and
   * `bottomCorners`, which only a tablet in landscape reaches, pulls the block
   * to the corner on her dominant side, where a two-handed grip actually
   * reaches.
   */
  const reach = resolveReach({ deviceClass, orientation, handedness: settings.handedness })
  const blockStyle: ViewStyle =
    reach.anchor === 'bottomCorners'
      ? {
          alignSelf: reach.primarySide === 'right' ? 'flex-end' : 'flex-start',
          maxWidth: CORNER_BLOCK_MAX_W,
          width: '100%',
        }
      : { alignSelf: 'stretch' }

  /**
   * The live position, in monospace.
   *
   * Deliberately OUTSIDE the frame (spec §9.4): these are context about the
   * receiver rather than about the convergence in hand, and they are the
   * receiver's current reading rather than the fix under construction. Nothing
   * subordinate belongs inside the frame during a countdown — that space is for
   * the numbers that answer *how good is it* and *how much longer*.
   */
  const coordinates = (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Type variant="mono" dim>
          lat
        </Type>
        <Type variant="mono" testID="capture-latitude">
          {capture.latest === null ? '—' : formatDegrees(capture.latest.latitude)}
        </Type>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Type variant="mono" dim>
          lon
        </Type>
        <Type variant="mono" testID="capture-longitude">
          {capture.latest === null ? '—' : formatDegrees(capture.latest.longitude)}
        </Type>
      </View>
    </View>
  )

  /** The one sentence explaining something the numbers cannot, when there is one. */
  const message =
    capture.message === null ? null : (
      <Type variant="small" testID="capture-message">
        {capture.message}
      </Type>
    )

  /**
   * The capture block: the traffic-light frame, and nothing beside it.
   *
   * The wrapper exists to carry the reach anchoring above — and, because
   * `TrafficLightFrame` takes no `testID`, to give the frame a queryable handle
   * so a test can assert that the countdown readouts are *inside* it rather
   * than merely somewhere on the screen. Keep it a single-child container: the
   * moment something is placed beside the frame in here, that handle stops
   * meaning what §9.1.2 requires it to mean.
   */
  const block = (
    <View testID="capture-frame" style={blockStyle}>
      <TrafficLightFrame
        grade={grade}
        refining={acquiring}
        // The perimeter is the countdown's honest progress, so it is drawn only
        // while there is a countdown to be honest about.
        secondsRemaining={acquiring ? capture.secondsRemaining : undefined}
        secondsTotal={acquiring ? capture.secondsTotal : undefined}
      >
        {acquiring ? (
          <>
            {/*
              THE TWO NUMBERS (spec §9.4). Stacked rather than set side by side:
              at 62px a pair of them does not fit across a phone in portrait,
              and shrinking either to make it fit is the defect this sizing
              exists to correct. The labels above them are at the smallest size
              in the scale — she is not reading the words, she is reading the
              numbers, and the words are there so a screen reader and a first
              use know which is which.
            */}
            <Type variant="label" dim>
              ACCURACY
            </Type>
            <Type variant="hero" testID="capture-accuracy">
              {formatAccuracy(shownAccuracyM)}
            </Type>
            <Type variant="label" dim>
              TIME LEFT
            </Type>
            <Type variant="hero" testID="capture-seconds">
              {`${String(capture.secondsRemaining)}s`}
            </Type>

            {/*
              Everything below here is subordinate to those two, and all of it
              is inside the frame with the button (§9.1.2) because all of it
              responds while she stands still.
            */}
            <Type variant="small" dim testID="capture-samples">
              {describeSamples(capture.preview)}
            </Type>
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                columnGap: spacing.md,
              }}
            >
              <Type variant="small" dim testID="capture-improvement">
                {describeImprovement(
                  capture.preview,
                  capture.record !== null && capture.record.fix.quality !== 'none',
                )}
              </Type>
              <Type variant="small" dim testID="capture-spread">
                {describeSpread(capture.preview)}
              </Type>
            </View>

            <Type variant="body" testID="capture-verdict">
              {VERDICT_SENTENCE[capture.verdict]}
            </Type>
            <Type variant="small" dim>
              This reading is already saved. Standing still refines it; ACCEPT NOW keeps it exactly
              as measured so far.
            </Type>

            <Button
              testID="capture-button"
              label="ACCEPT NOW"
              spokenLabel="Accept the fix accumulated so far and end the wait"
              // Prominence, not a decision (§9.1.5): once the fix has stopped
              // improving the override goes solid, because there is nothing
              // left to wait for. It is the same control, doing the same thing,
              // and it is live either way.
              kind={capture.verdict === 'plateaued' ? 'primary' : 'accurate'}
              size="field"
              onPress={capture.acceptNow}
            />
          </>
        ) : (
          <>
            <Type variant="label" dim>
              ACCURACY
            </Type>
            <Type variant="title" testID="capture-accuracy">
              {formatAccuracy(shownAccuracyM)}
            </Type>
            <Type variant="small" dim>
              {shownAccuracyM === null
                ? 'No position yet — a tap still records the capture, and the countdown can give it one.'
                : `One tap records this fix now. The screen then counts down for ${String(capture.secondsTotal)}s while you stand still, and sharpens the record it already saved.`}
            </Type>

            <Button
              testID="capture-button"
              label="CAPTURE"
              spokenLabel="Record the current fix now, then stand still while it is refined"
              kind="fast"
              size="field"
              onPress={capture.capture}
            />
          </>
        )}
      </TrafficLightFrame>
    </View>
  )

  if (capture.phase === 'recorded') {
    return <RecordedPlaceholder capture={capture} coordinates={coordinates} message={message} />
  }

  if (acquiring) {
    return (
      <Screen spokenDescription="Acquiring a fix. The reading is already saved and is being refined while you stand still. The accuracy and the seconds remaining, how much sharper the fix is than the tap, how far apart the readings are, and a control that accepts what has accumulated and ends the wait.">
        {/*
          The acquiring state scrolls. Rotation is unlocked and a phone in
          landscape has roughly 360dp of height, where centred content in a
          non-scrolling container clips symmetrically and takes the override off
          the bottom with it. `flexGrow: 1` with `justifyContent: 'center'`
          renders identically to a centred container when the content fits, and
          keeps §9.1.4's "reachable at every moment" true when it does not.

          The vertical centring is this constraint's, not the reach zone's: the
          reach anchor still decides which side the block sits on and how wide
          it may grow (see `blockStyle`), but a bottom-anchored band cannot also
          be the thing that scrolls into view, and a control she cannot reach at
          all is the worse failure.
        */}
        <ScrollView
          testID="capture-scroll"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
        >
          <View style={{ gap: spacing.md }}>
            {block}
            {coordinates}
            {message}
          </View>
        </ScrollView>
      </Screen>
    )
  }

  return (
    <Screen spokenDescription="Capture. The live position and its accuracy, and one control that records the fix immediately and then counts down while you stand still and sharpens the record.">
      {/*
        Ready is bottom-anchored, which is what `bottomBand` means: the control
        sits where the thumb already is, with the context above it.
      */}
      <View style={{ flex: 1, justifyContent: 'flex-end', gap: spacing.md }}>
        {message}
        {coordinates}
        {block}
      </View>
    </Screen>
  )
}

/**
 * The `recorded` phase, as a placeholder that names itself.
 *
 * TASK 7 builds this: the saved point, the evidence it carries, and the
 * affordances that attach a title, a photo or a voice note to it (spec §9.6).
 * Deliberately not sketched here — a screen that looked like it offered those
 * and did not would be worse than one that says plainly it has not been built.
 * What it does carry is the way back to `ready`, so a finished capture is not a
 * dead end on a device in a paddock.
 */
function RecordedPlaceholder({
  capture,
  coordinates,
  message,
}: {
  capture: Capture
  coordinates: React.ReactNode
  message: React.ReactNode
}) {
  return (
    <Screen spokenDescription="A survey point has been recorded and its position is final. The recorded state itself is not built yet; there is a control to start another capture.">
      <View style={{ flex: 1, justifyContent: 'flex-end', gap: spacing.md }}>
        <Type variant="title" testID="capture-recorded">
          POINT RECORDED
        </Type>
        <Type variant="small" dim>
          The recorded phase — the saved point and what can be attached to it — is not built yet.
          The position is final and is on disk.
        </Type>
        {message}
        {coordinates}
        <Button
          testID="capture-button"
          label="CAPTURE ANOTHER"
          spokenLabel="Dismiss this point and go back to capturing"
          kind="fast"
          size="field"
          onPress={capture.again}
        />
      </View>
    </Screen>
  )
}
