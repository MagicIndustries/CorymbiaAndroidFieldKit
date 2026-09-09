import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  BackHandler,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { useAudioPlayer } from 'expo-audio'
import {
  createExpoLocationSource,
  distanceMetres,
  gradeAccuracy,
  isProbableDuplicate,
  type Coordinate,
  type HoldVerdict,
  type LocationSource,
} from '@corymbia/geo'
import { field, radii, spacing, touch } from '@corymbia/tokens'
import {
  Button,
  CaptureDial,
  CORNER_BLOCK_MAX_W,
  HelpAffordance,
  InputAffordanceRow,
  MediaStrip,
  Screen,
  Type,
  isLocked,
  mediaStripLabel,
  radiusForMetres,
  resolveReach,
  useLayout,
  useTheme,
  type FixGradeName,
  type InputAffordanceKind,
  type MediaStripItem,
} from '@corymbia/ui'
import {
  appendEvent,
  listMedia,
  renameRecord,
  softDeleteMedia,
  type Attachment,
  type Database,
  type FieldRecord,
  type StoredFix,
} from '@corymbia/data'
import { mediaStore } from '../src/media/store'
import { ambientCache, feedingAmbientCache } from '../src/geo/ambient'
import { ambientFixOrNone } from '../src/geo/ambientFix'
import { useCapture, type Capture, type CapturePreview } from '../src/capture/useCapture'
import { useSteadyGrade } from '../src/capture/steadyGrade'
import { useDatabase, useDatabaseStatus, useDevice, useSettings } from '../src/db/provider'

/**
 * The capture screen (spec §9.1–§9.4): the one thing a field ecologist looks at
 * while standing still over a survey point.
 *
 * The state machine is `src/capture/useCapture.ts` and every part of the dial
 * is `@corymbia/ui`'s `CaptureDial`; what is decided here is what she sees, how
 * big it is, and where it sits. **The screen computes, the dial renders**: the
 * grade comes from `gradeAccuracy` and the lock from
 * `isLocked(radiusForMetres(...))`, both handed down as plain values, which is
 * what keeps `@corymbia/ui` free of any dependency on `@corymbia/geo`. Four
 * rules govern the rest of it, and none of them is a preference:
 *
 *  - **The accuracy is the largest thing on the screen** while a countdown runs
 *    (§9.4), at `hero`. It is the number she is standing still for, and it has
 *    to be legible at arm's length, in glare, without leaning in.
 *  - **The seconds remaining are no longer sized to match it.** §9.2's ring
 *    now answers "how much longer" without being read, so the numeric seconds
 *    sits with the sample count and the improvement — present, precise, and
 *    subordinate, the same size as them. Two numbers at the same size compete;
 *    one number and a moving ring do not.
 *  - **Everything that responds during a countdown sits inside the dial's own
 *    block with the button** (§9.1.2) — the accuracy, the seconds, the sample
 *    count, the improvement, the spread and the verdict sentence. This is the
 *    specific defect the whole single-control design exists to fix: on the
 *    superseded press-and-hold screen her thumb was on the button while the
 *    only part of the screen that moved was somewhere else entirely. A design
 *    that puts the countdown readout in a panel above the control has not
 *    implemented that section.
 *  - **The lock gets a word** (§9.2.1, doctrine rule 9). `CaptureDial` carries
 *    the lock in colour and motion, and exposes the same fact as plain text
 *    for a screen reader; this screen is what turns it into the word a sighted
 *    reader sees, `· LOCKED ON` beside the grade chip, so colour and motion are
 *    never the only channel carrying it — in glare, or for a colour-blind
 *    reader, the word is what survives.
 *
 * **There is exactly one control** (§9.1.4) throughout: `CAPTURE` before the
 * tap, `ACCEPT NOW` during the countdown, and it is live for every moment of
 * it.
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
export const VERDICT_SENTENCE: Record<HoldVerdict, string> = {
  improving: 'Still improving — keep standing still.',
  plateaued: 'About as sharp as it gets here — accepting now costs nothing.',
}

/**
 * The two ways a capture can *complete* (spec §9.2.1).
 *
 * Both mean the same measured thing — `holdVerdict` says the fix has stopped
 * improving, which is the plateau the countdown ends itself on — and they
 * differ in one further question: did it stop improving *on* the crosshair, or
 * short of it?
 *
 *  - `locked` — stopped improving, and reached this hardware's measured floor.
 *    The full ceremony of §9.2.1.
 *  - `settled` — stopped improving, above the floor. **The common case**, and
 *    the reason this level exists: the crosshair is pinned to 1.4 m, the best
 *    figure this receiver produced outdoors, while `gradeAccuracy` calls
 *    anything under 5 m good — so a green circle resting well outside the
 *    crosshair is what a normal capture looks like, and a design with only one
 *    completion left the normal case with none at all.
 *
 * A capture that ended any other way — the cap ran out, or she pressed
 * `ACCEPT NOW` — has not completed in this sense. It was cut short rather than
 * finished, and gets neither treatment.
 */
type Completion = 'locked' | 'settled'

/**
 * Which completion a finished capture earned, or null for one that was cut
 * short or has no position to have converged.
 *
 * `verdict` is `holdVerdict`'s, reported by the hook for the whole of the
 * `recorded` phase as it stood the instant the wait ended — this invents no
 * second convergence test of its own. The floor question is `isLocked` on the
 * same geometry the dial draws with, exactly as the acquiring state's lock is.
 */
function completionOf(capture: Capture): Completion | null {
  if (capture.verdict !== 'plateaued') return null
  const fix = capture.record?.fix
  if (fix === undefined || fix.quality === 'none') return null
  return isLocked(radiusForMetres(fix.accuracyM)) ? 'locked' : 'settled'
}

/**
 * What a settled completion says, in words (doctrine rule 9: the colour and
 * the companion ring never carry it alone).
 *
 * It names the accuracy the capture actually reached rather than claiming a
 * convergence it did not make — the sentence and the picture say the same
 * thing, which is the whole point of not moving the circle onto the crosshair.
 */
function settledSentence(accuracyM: number): string {
  return `As good as it gets here — ${formatAccuracy(accuracyM)}`
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
 * On the run the tap starts, the delta is structurally incapable of going
 * negative — inverse-variance weighting is monotonic in the sample set and the
 * tap's own reading is always a member of it — so a signed presentation would
 * advertise a worsening this number can never show. On a repeat run it can go
 * negative, and is still not shown signed: it falls into the same "no sharper
 * … yet" branch as an improvement too small to print, which is the honest
 * reading of a second attempt that did not beat the first.
 *
 * So this number is only ever "how much sharper", and the spread beside it is
 * what reports a capture that went badly.
 *
 * `tapHadPosition` is false when the tap found no fix at all, where the
 * improvement is zero for want of a baseline rather than for want of progress.
 * Saying "no sharper than the tap" there would describe a comparison against a
 * measurement that was never taken.
 */
function describeImprovement(preview: CapturePreview | null, refining: boolean): string {
  if (preview === null) return 'nothing usable to average yet'
  if (!preview.tapHadPosition) return 'from no position at all'
  // What the improvement is measured against, which is not always the tap: a
  // repeat run (`refineAgain`, offered when a capture settles short of the
  // crosshair) is measured against the accuracy the previous run left on the
  // record. Naming the tap there would name a baseline this run is not being
  // compared to — and it is also the one case the number can come back at or
  // below zero, because that baseline is not a member of this run's own
  // samples (see `CapturePreview.improvedByM`).
  const baseline = refining ? 'the last run' : 'the tap'
  if (preview.improvedByM < IMPROVEMENT_FLOOR_M) return `no sharper than ${baseline} yet`
  return `${preview.improvedByM.toFixed(1)} m sharper than ${baseline}`
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
 * The position a saved record actually holds, or null when it holds none.
 *
 * A `'none'` record is a real capture at a real time with no position (spec
 * §9.1, doctrine rule 4), and it is the reason this returns a nullable rather
 * than throwing: there is nothing to compare it against and nothing to print,
 * which is a fact about the capture, not a failure.
 */
function positionOf(fix: StoredFix): Coordinate | null {
  return fix.quality === 'none' ? null : { latitude: fix.latitude, longitude: fix.longitude }
}

/** How many readings went into the fix the record actually holds. */
function describeRecordedSamples(fix: StoredFix): string {
  if (fix.quality !== 'deliberate') return 'no readings averaged'
  return fix.sampleCount === 1
    ? '1 reading averaged'
    : `${String(fix.sampleCount)} readings averaged`
}

export default function CaptureScreen() {
  const status = useDatabaseStatus()

  // `useDatabase`, `useDevice` and `useSettings` all throw before the database
  // is open, so the guard has to come before the body that calls them — hence
  // the split into two components rather than an early return inside one
  // (`diagnostics.tsx` does the same, for the same reason).
  if (status.state !== 'ready') {
    return (
      <Screen
        testID="capture-screen"
        spokenDescription={`Capture. The database is ${status.state}.`}
      >
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
  const router = useRouter()

  /**
   * The location source, created once and never again.
   *
   * `CaptureDeps` requires this to be referentially stable: the hook lists it
   * as an effect dependency, so a new identity re-requests the permission and
   * resubscribes — and this screen re-renders four times a second for the whole
   * of a countdown. Lazily initialised through the ref rather than passed as
   * `useRef(createExpoLocationSource()).current`, so the factory is not called
   * on every render merely to have its result discarded.
   *
   * **And it is wrapped, because this screen is the app's main producer of
   * ambient positions** (spec §8.2). `feedingAmbientCache` copies every
   * reading into the one shared cache (`src/geo/ambient.ts`) on its way to
   * `useCapture`, which is what lets a photo or a voice note attached a
   * minute later carry a position at all — without it every `media_added`
   * event is stamped `{ quality: 'none' }`. The wrap goes here rather than
   * inside `useCapture` on purpose: that hook is handed its dependencies and
   * unit-tested against a scripted source, and reaching a module singleton
   * from inside it would take that away.
   */
  const sourceRef = useRef<LocationSource | null>(null)
  const source: LocationSource = (sourceRef.current ??= feedingAmbientCache(
    createExpoLocationSource(),
  ))

  /**
   * The other half of spec §8.2's "refreshes opportunistically" (see
   * `src/geo/ambient.ts`'s doc comment for the half this is not — the
   * low-frequency refresh while an activity is running, which needs Plan 5's
   * activity machinery and is not built yet).
   *
   * A cold app launch has no `watch` reading yet: the countdown has not
   * started, so `feedingAmbientCache` above has fed the cache nothing, and a
   * photo taken in the first seconds after opening the app would be stamped
   * `{ quality: 'none' }` even though the device may already know a perfectly
   * good last-known position. `void` because this must not, and cannot,
   * block or gate anything the screen does — nothing awaits it, and every
   * other read of the cache stays synchronous.
   */
  useEffect(() => {
    void ambientCache.refresh()
  }, [])

  // No activity to hand `useCapture` yet — Plan 5's launcher and its running
  // activity arrive in a later task, so every capture from this screen still
  // files to the Inbox (see `CaptureDeps.activityId`).
  const capture = useCapture({ db, device, source, activityId: null })
  const acquiring = capture.phase === 'acquiring'

  /**
   * The duplicate guard (spec §9.5), which **warns and never blocks** —
   * doctrine rule 4.
   *
   * It runs here, in the `recorded` phase, and that placement is the whole
   * meaning of the rule. By the time this can say anything the row is already
   * on disk: `useCapture` writes it on the tap, before the countdown and long
   * before any comparison is possible. So this is a warning about what just
   * happened, not a gate before it. Accidental double-capture is a real field
   * failure, but so is refusing a legitimate close-spaced pin — two soil
   * samples a metre apart are a normal thing to record, and only the ecologist
   * standing there knows which she meant.
   *
   * Do not move this earlier. A guard on the tap, or on the save, would be a
   * different feature wearing the same name, and the test named "warns about a
   * close-spaced pin and still records it" is written to fail on the record's
   * absence rather than on the warning's, precisely so that move cannot pass.
   *
   * Three refs rather than state, because none of them is rendered: the point
   * the current capture holds, the point the one before it held, and which
   * record has already been compared. They live in this component rather than
   * in the recorded state's own, because that one unmounts every time she goes
   * back to `ready` — and the point it was showing is exactly what the next
   * capture has to be compared against.
   *
   * The warning itself carries the id of the record it is about, and the
   * recorded state renders it only for that record. That is not belt and
   * braces: this effect runs *after* the first render of a new recorded state,
   * so a warning that identified only itself would flash for one frame over the
   * following capture before being recalculated. Keying it means a stale
   * warning cannot be shown at all, rather than being cleared quickly.
   */
  const currentPointRef = useRef<Coordinate | null>(null)
  const previousPointRef = useRef<Coordinate | null>(null)
  const comparedRecordRef = useRef<string | null>(null)
  const [duplicate, setDuplicate] = useState<{ recordId: string; metresApart: number } | null>(null)
  const [duplicateAccepted, setDuplicateAccepted] = useState(false)

  // Null outside the `recorded` phase, and a new object identity when a
  // refinement lands — a refinement moves the position, and the comparison has
  // to be against the position actually stored rather than the tap's.
  const recordedRecord = capture.phase === 'recorded' ? capture.record : null

  useEffect(() => {
    if (recordedRecord === null) return

    if (recordedRecord.id !== comparedRecordRef.current) {
      // A different capture has finished, so the point that was current becomes
      // the one the new capture is measured against — and her decision to keep
      // the last close-spaced pair is spent. It was a judgement about two
      // specific points; carrying it forward would silently suppress the
      // warning on every capture after the first she waved through.
      previousPointRef.current = currentPointRef.current
      comparedRecordRef.current = recordedRecord.id
      setDuplicateAccepted(false)
    }

    const point = positionOf(recordedRecord.fix)
    currentPointRef.current = point
    const previous = previousPointRef.current

    // `isProbableDuplicate` is asked rather than the distance being compared
    // here: the threshold is `@corymbia/geo`'s to own and to make configurable,
    // and a screen that reimplemented the comparison would silently stop
    // tracking it.
    setDuplicate(
      point !== null && previous !== null && isProbableDuplicate(point, previous)
        ? { recordId: recordedRecord.id, metresApart: distanceMetres(point, previous) }
        : null,
    )
  }, [recordedRecord])

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
   *
   * **Steadied, not raw** (spec §9.2, hysteresis; `steadyGrade.ts` for the
   * measurements). `gradeAccuracy`'s good/fair boundary is 5 m, and at the
   * site this app was measured on the raw live reading hovers either side of
   * it — the owner watched the ready state flip amber → green → amber → green
   * on jitter alone. `useSteadyGrade` delays a fall back across a boundary
   * until the accuracy is clearly past it, and never invents a grade the
   * accuracy has not crossed into. `gradeAccuracy` itself is untouched: it is
   * shared, it is spec'd, and the diagnostics instrument reads it raw on
   * purpose.
   *
   * ONE value, used for the word and for the colour alike (doctrine rule 9):
   * `CaptureDial` derives both from the `grade` prop, so they cannot disagree
   * at any instant.
   *
   * **Keyed to the phase, because `shownAccuracyM` above is two different
   * measurements.** While acquiring it is the preview's averaged accuracy,
   * converging toward the hardware floor; otherwise it is the live single
   * reading, which wobbles at 4–7 m and never converges (spec §9.2). Held
   * across that switch, the margin kept a `GOOD FIX` earned by a converged
   * capture over a merely fair live reading once the screen returned to
   * ready. The key drops the held grade at the boundary, so the first reading
   * of each series is graded on its own merits; within a series the
   * hysteresis is untouched. See `useSteadyGrade`'s own comment.
   */
  const grade: FixGradeName = useSteadyGrade(shownAccuracyM, acquiring ? 'preview' : 'live')

  /**
   * The accuracy `CaptureDial` draws its circle from. Unlike the readout
   * above, its `accuracyM` prop is required — there is no third "no reading"
   * state for the dial to render, only a radius — so the absent case needs an
   * honest real number rather than null. `Infinity` is that number: no
   * reading is not a fix that happens to be bad, it is the complete absence of
   * one, and `radiusForMetres`/`isLocked` already reduce `Infinity` to the
   * worst case on their own (dialGeometry.ts), the same answer `grade` above
   * gives it via its own null check. Nothing here invents a fallback accuracy
   * that was never measured.
   */
  const dialAccuracyM = shownAccuracyM ?? Number.POSITIVE_INFINITY

  /**
   * Whether the fix has converged onto the crosshair (spec §9.2.1). Computed
   * here, not by `CaptureDial` — the dial takes `locked` as a plain boolean
   * and computes no lock of its own, which is what keeps `@corymbia/ui` free
   * of any dependency on `@corymbia/geo`. `radiusForMetres`/`isLocked` are
   * `@corymbia/ui`'s own pure geometry, not `@corymbia/geo`'s, so this line is
   * the one place the screen's grading and the dial's geometry meet.
   *
   * Gated on `acquiring`. The lock means "this capture has converged as far
   * as this receiver takes it", and outside a countdown there is no capture
   * to have converged — the ready state's live reading can already sit
   * inside the crosshair before she has tapped anything, and the raw
   * distance test alone cannot tell that apart from a real lock. The dial
   * still gets the honest accuracy and radius in every phase (`dialAccuracyM`
   * above is unconditional); only the lock's *treatment* — the lit
   * crosshair, the fill-and-firm, the ripple, the word — is reserved for a
   * capture actually in progress, so the ceremony fires once, at the moment
   * it was designed to mark: the end of a wait she stood through.
   */
  const locked = acquiring && isLocked(radiusForMetres(dialAccuracyM))

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
   * The live position, in monospace, above the dial (spec §9.2, §9.4).
   *
   * Deliberately OUTSIDE the dial's own block: these are context about the
   * receiver rather than about the convergence in hand, and they are the
   * receiver's current reading rather than the fix under construction. Nothing
   * subordinate belongs inside the dial during a countdown — that space is for
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
   * The capture block.
   *
   * The wrapper exists to carry the reach anchoring resolved above; that is
   * the whole of its job. It carried a second one — being the handle a test
   * scoped its §9.1.2 containment assertions to — and with it an instruction
   * to keep this a single-child container. Both are gone: those assertions
   * now scope to `CaptureDial`'s own `capture-dial` testID, which is the
   * dial's actual rendering rather than a container named after it, and is
   * immune to whatever is later placed beside it. `capture-frame` stays only
   * as an inspection handle, and nothing depends on what sits inside it.
   */
  const block = (
    <View testID="capture-frame" style={blockStyle}>
      <CaptureDial
        grade={grade}
        accuracyM={dialAccuracyM}
        // The ring is the countdown's honest progress, so it is drawn only
        // while there is a countdown to be honest about — and it is fed the
        // hook's continuous fraction rather than the whole-seconds readout
        // beside it, which only moves once a second and would otherwise step
        // the ring in fifteen discrete jumps that never reach empty (see
        // `Capture.remainingFraction`).
        remaining={acquiring ? capture.remainingFraction : undefined}
        locked={locked}
      >
        {/*
          THE LOCK'S WORD (spec §9.2.1, doctrine rule 9). `CaptureDial` draws
          the grade word itself (`GOOD FIX` etc.) but knows nothing about the
          lock beyond the boolean it was handed and the colour/motion it
          already carries — the words that survive in glare or for a
          colour-blind reader are this screen's to add. Rendered once, ahead
          of the phase-specific content below, so it sits beside the grade
          word regardless of phase — but `locked` above is itself gated on
          `acquiring`, so in practice this only ever renders during a
          countdown. The dial is live at all times and a live reading can
          already sit inside the crosshair before she has tapped anything,
          but that is not a capture that has converged, only an idle reading
          that happens to be sharp — the lock's ceremony is reserved for the
          capture the ceremony is about.
        */}
        {locked ? (
          <Type variant="label" testID="capture-lock-label">
            {'· LOCKED ON'}
          </Type>
        ) : null}

        {acquiring ? (
          <>
            {/*
              THE ACCURACY (spec §9.4): the largest thing on the screen while a
              countdown runs, at `hero`. The seconds remaining are no longer
              sized to match it — §9.2's ring answers "how much longer" without
              being read, so the numeric seconds moves down to sit with the
              sample count and the improvement below, all at the same
              subordinate size. Two numbers at the same size compete; one
              number and a moving ring do not.
            */}
            <Type variant="label" dim>
              ACCURACY
            </Type>
            <Type variant="hero" testID="capture-accuracy">
              {formatAccuracy(shownAccuracyM)}
            </Type>

            {/*
              Everything below here is subordinate to the accuracy above, and
              all of it is inside the dial's own block with the button
              (§9.1.2) because all of it responds while she stands still.
            */}
            <Type variant="label" dim>
              TIME LEFT
            </Type>
            <Type variant="small" dim testID="capture-seconds">
              {`${String(capture.secondsRemaining)}s`}
            </Type>
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
                {describeImprovement(capture.preview, capture.refining)}
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
              // One appearance, because there is only ever one moment to
              // appear in. §9.1.5 was corrected on this branch so that a
              // plateau finishes the wait rather than announcing one first,
              // and on this screen auto-finish is unconditional: the render
              // that first reports `plateaued` is the same one that ends the
              // countdown, so a button that changed its prominence there would
              // be solid for about a frame and never be seen. The instrument
              // keeps that line, and is right to — its auto-finish can be
              // switched off, so its plateau really is a state she sits in.
              kind="accurate"
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
      </CaptureDial>
    </View>
  )

  if (capture.phase === 'recorded') {
    return (
      <RecordedState
        capture={capture}
        db={db}
        deviceId={device.id}
        message={message}
        // Shown only for the record it is actually about — see the guard above
        // — and only until she has said she meant both points.
        duplicate={
          duplicateAccepted || duplicate === null || duplicate.recordId !== capture.record?.id
            ? null
            : duplicate
        }
        onAcceptDuplicate={() => {
          setDuplicateAccepted(true)
        }}
        onLeave={() => {
          // Plan 5 builds the launcher; until it exists `/` is the gallery, and
          // it is the only route this screen knows. `replace` rather than
          // `push`: leaving a finished capture is going back to where she came
          // from, and pushing would stack a second gallery on top of the one
          // already underneath.
          router.replace('/')
        }}
      />
    )
  }

  if (acquiring) {
    return (
      <Screen
        testID="capture-screen"
        spokenDescription="Acquiring a fix. The reading is already saved and is being refined while you stand still. The accuracy and the seconds remaining, how much sharper the fix is than the tap, how far apart the readings are, and a control that accepts what has accumulated and ends the wait."
      >
        {/*
          The acquiring state scrolls. Rotation is unlocked and a phone in
          landscape has roughly 360dp of height, where non-scrolling content
          taller than the viewport clips and takes the override off the bottom
          with it. `flexGrow: 1` is what fixes that: when the children are
          taller than the viewport the container grows to fit them, there is no
          free space left, and `justifyContent` is a no-op either way.

          So `justifyContent: 'flex-end'` here has identical overflow behaviour
          to centring, and is what §5.4 actually asks for: controls live in the
          bottom third by default, bottom-anchored on every screen, which
          `flex-end` states directly instead of relying on a coincidence of
          overflow to keep the block low. It also means `resolveReach`'s
          `bottomBand` — `alignSelf: 'stretch'` — has an observable effect here:
          without it the block was always vertically centred regardless of what
          the reach zone resolved to.
        */}
        <ScrollView
          testID="capture-scroll"
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}
        >
          <View style={{ gap: spacing.md }}>
            {/*
              Coordinates above the dial (spec §9.2, §9.4) — the same order
              the ready state below already uses — so the receiver's context
              sits where she reads it first and the dial, with the button,
              stays closest to the bottom of a bottom-anchored layout.
            */}
            {coordinates}
            {block}
            {message}
          </View>
        </ScrollView>
      </Screen>
    )
  }

  return (
    <Screen
      testID="capture-screen"
      spokenDescription="Capture. The live position and its accuracy, and one control that records the fix immediately and then counts down while you stand still and sharpens the record."
    >
      {/*
        Ready is bottom-anchored, which is what `bottomBand` means: the control
        sits where the thumb already is, with the context above it.

        And it scrolls, for the same reason the acquiring and recorded states
        do. It was the one state without a scroll container, on the reasoning
        that `flex-end` keeps the button visible — which is true, and is not
        the risk. What `flex: 1` loses is everything above the fold: the help
        row, the message, the live coordinates. This state carries a help row,
        a message line, two coordinate rows, a 300dp dial (`field.dialMax`),
        the grade word, the accuracy, a paragraph and a 72dp control — over
        340dp before any spacing, against roughly 360dp of height on a phone
        in landscape, and rotation is unlocked. Clipped, the first thing off
        the top is doctrine rule 7's required help affordance, with no way to
        reach it.

        `flexGrow: 1` is what fixes that: when the children are taller than
        the viewport the container grows to fit them and `justifyContent`
        becomes a no-op, so bottom-anchoring costs nothing in the overflowing
        case and still states §5.4's requirement in the ordinary one.
      */}
      <ScrollView
        testID="capture-ready-scroll"
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', gap: spacing.md }}
      >
        {/*
          Doctrine rule 7: a tappable help affordance per screen, never a hover
          — there is no hover in a paddock. `acquiring` is the one state with
          none, and it is exempt by rule 17, which requires that nothing else
          is on screen while she stands still. `recorded` used to be exempt
          too, on the reasoning that the one thing it asked for — a name —
          asked it with a labelled text box whose placeholder says what to
          type. That exemption came with a written pre-commitment, in this
          comment and in `docs/ui-doctrine.md`: it held only until the state
          asked for something whose meaning is not on its face, and named
          attaching media as such a thing. It now does, so it now carries its
          own affordance (`capture-media-help`, in `RecordedAffordances`) and
          the exemption is gone rather than quietly outlived.
        */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <Type variant="label" dim>
            WHAT ONE TAP DOES
          </Type>
          <HelpAffordance
            testID="capture-help"
            title="Capturing a point"
            // Plain language for the process, technical language only where it
            // is the science (doctrine rule 6). She is an ecologist, not a
            // surveyor of GNSS receivers: "inverse-variance weighting" is the
            // mechanism, not the explanation.
            body={
              'One tap saves the point straight away, so it is on the phone before anything ' +
              'else happens. The screen then counts down while you stand still, taking a ' +
              'fresh reading about once a second and combining them into one better position ' +
              'for the point it already saved.\n\n' +
              'Standing still is what makes those readings agree with each other. If you walk ' +
              'about, they disagree, and the point ends up less certain than a single reading ' +
              'would have been.\n\n' +
              'You never have to wait. Tapping ACCEPT NOW keeps whatever it has so far, and ' +
              'walking away keeps it too — the point was saved by the tap.'
            }
          />
        </View>
        {message}
        {coordinates}
        {block}
      </ScrollView>
    </Screen>
  )
}

/**
 * The recorded state, said out loud (doctrine rule 16).
 *
 * Everything before the media clause is what this sentence has always said.
 * What follows it is what this branch added to the state and what the
 * sentence did not previously mention at all: how many of each kind are
 * attached, that they sit in a strip that can be played back and removed
 * from, and — the one that matters most to say — that a destructive question
 * is open and which attachment it is about. A screen-reader user who cannot
 * see the marked tile has nothing else to tell her which of ten photos REMOVE
 * would take.
 */
function describeRecordedScreen(media: RecordMedia): string {
  const total = media.photoCount + media.voiceCount
  const kinds: string[] = []
  if (media.photoCount > 0) {
    kinds.push(media.photoCount === 1 ? '1 photo' : `${String(media.photoCount)} photos`)
  }
  if (media.voiceCount > 0) {
    kinds.push(media.voiceCount === 1 ? '1 voice note' : `${String(media.voiceCount)} voice notes`)
  }
  const attached =
    total === 0
      ? 'Nothing is attached to it yet.'
      : `${kinds.join(' and ')} ${total === 1 ? 'is' : 'are'} attached, in a strip of tiles you ` +
        'can play back or remove.'
  const question =
    media.removalLabel === null
      ? ''
      : ` You are being asked whether to remove ${media.removalLabel.toLowerCase()}, with one ` +
        'control that removes it and one that keeps it.'
  return (
    'A survey point has been recorded and its position is final. Where the capture got to, ' +
    'its capture number, final accuracy and how the wait ended, a name you can give it, and ' +
    `the ways onward: take another reading, or leave. ${attached}${question}`
  )
}

/**
 * The `recorded` phase (spec §9.6, doctrine rule 17): the point that was saved,
 * what it is worth, what can still be attached to it, and the two ways onward.
 *
 * **It has to read as finished, not as a countdown that stopped.** Four facts
 * carry that: the capture number (the thing that may already be written on a
 * tube), the final accuracy, how many readings made it, and how the wait
 * ended. The last of those has become load-bearing since spec §9.1.5 was
 * corrected: a plateau no longer announces itself live, because the render
 * that first reports it is the same one that ends the countdown, so on a
 * device the announcement would last about a frame. **This state is the only
 * place that fact ever reaches her**, and `useCapture`'s `message` is where it
 * arrives — `FINISH_WORDS` there names all three endings plainly, and a
 * refinement that failed replaces it with the reason, which is the more
 * important sentence when there is one.
 */
function RecordedState({
  capture,
  db,
  deviceId,
  message,
  duplicate,
  onAcceptDuplicate,
  onLeave,
}: {
  capture: Capture
  db: Database
  deviceId: string
  message: React.ReactNode
  duplicate: { metresApart: number } | null
  onAcceptDuplicate: () => void
  onLeave: () => void
}) {
  const { theme } = useTheme()
  const record = capture.record
  /**
   * How this capture finished, if it finished rather than being cut short.
   *
   * **The completion is shown here and not in the acquiring state, and that
   * is forced rather than chosen.** A plateau ends the countdown in the same
   * render that first reports it (spec §9.1.5, and `useCapture`'s plateau
   * effect), so a completion drawn during the wait would exist for about one
   * frame on a device — the same reason §9.3's plateau sentence is not shown
   * live. This state is where a finished capture is actually looked at, so it
   * is where the moment belongs.
   */
  const completion = completionOf(capture)
  /**
   * The fix the record actually holds, when it holds one. A `'none'` record is
   * a real capture with no position (doctrine rule 4), and there is no radius
   * to draw for it — so it gets the summary and no dial at all rather than a
   * dial drawn from an accuracy nobody measured.
   */
  const finalFix = record !== null && record.fix.quality !== 'none' ? record.fix : null

  /**
   * What is attached, and the removal question a tile can open — owned here
   * rather than inside `RecordedAffordances` because the spoken description
   * two lines below has to say both. See `useRecordMedia`.
   */
  const media = useRecordMedia(db, record?.id ?? null, deviceId)

  /**
   * The title and the notes, and the editor that writes them — owned here
   * rather than inside `RecordedAffordances` because the editor has to be
   * rendered outside `capture-recorded-scroll`, and the tiles inside it. See
   * `useFieldEditing`.
   */
  const editor = useFieldEditing(db, record, deviceId)
  const editing = editor.open !== null

  return (
    <Screen
      testID="capture-screen"
      /*
        Doctrine rule 16. This sentence used to name the capture number, the
        accuracy, how the wait ended and the two ways onward — and stopped
        there, which was a complete description of this state before this
        branch and an incomplete one after it. Attaching media is the thing
        this branch added to this state, and a spoken description that never
        mentions the attachments, the strip they sit in, or an open
        destructive question describes a screen that no longer exists.
        Asserted in all three of those states by `capture.test.tsx`.

        AND WITHDRAWN WHILE THE EDITOR IS OPEN, which is doctrine rule 16
        rather than an optimisation. The editor used to be a `Modal` — a
        separate Android window, which a screen reader does not read behind —
        so it replaced this sentence for free. An overlay is in this same
        window, so nothing withdraws this sentence unless it is withdrawn
        here, and two descriptions of two different surfaces both announcing
        themselves is exactly the inaccuracy rule 16 forbids. The editor
        carries its own (`describeEditor`), and the column behind it is taken
        out of a reader's reach by `importantForAccessibility` on the scroll
        view below.
      */
      spokenDescription={editing ? undefined : describeRecordedScreen(media)}
    >
      {/*
        This state scrolls for the same reason the acquiring one does: rotation
        is unlocked, a phone in landscape has roughly 360dp of height, and this
        state carries considerably more than the acquiring one — a state that
        put its two ways onward below the fold would be a dead end on a device
        in a paddock.
      */}
      <ScrollView
        testID="capture-recorded-scroll"
        /*
          THE FIRST TAP ON SAVE, AS IT WAS DIAGNOSED — and no longer the line
          that fixes it. Field-reported: "I try to tap save but it just closes
          the keyboard as the focus changes, then i hit save again".

          `ScrollView`'s `_handleStartShouldSetResponderCapture` (`ScrollView.js`,
          RN 0.86.3) returns `true` — taking the responder and blurring the
          input instead of letting the press through — when
          `keyboardShouldPersistTaps` is unset or `'never'`, a dismissible soft
          keyboard is up, and the target is not a text input. Its own comment
          in RN says so: "the first tap should be sent to the scroll view and
          dismiss the keyboard, then the second tap goes to the actual interior
          view". The editor's SAVE was a DESCENDANT of this scroll view at the
          time, because React Native's responder system builds its propagation
          path from the React tree rather than the native one — so even though
          the editor's card was in a separate Android window, this prop
          governed the tap on it.

          THE EDITOR IS NO LONGER A DESCENDANT. It renders below, as a sibling
          of this scroll view, which is what actually holds the fix: the
          capture path for a touch on SAVE no longer passes through here at
          all. This prop is therefore no longer load-bearing for that tap, and
          it is kept rather than removed for the case it always also covered —
          a control inside THIS column pressed while some future keyboard is
          up. `'handled'` and not `'always'`: a tap on nothing in particular
          should still put a keyboard away; `'handled'` only spares the taps a
          control actually handles.
        */
        keyboardShouldPersistTaps="handled"
        /*
          Doctrine rule 16, the half a `Modal` used to give for free. A dialog
          is a separate Android window and a screen reader does not read the
          window behind it; an overlay is in this same window, so this column
          stays traversable — a reader could wander out of the editor, through
          the tiles and the strip, and be told about controls the scrim is
          covering. `accessibilityViewIsModal` is the iOS mechanism for this
          and is genuinely iOS-only in RN 0.86.3 (it appears in
          `BaseViewConfig.ios.js`, is absent from `BaseViewConfig.android.js`,
          and has no implementation anywhere under `ReactAndroid/`), so on the
          device this app is for it would be a silent no-op. This is the
          Android mechanism, implemented in `BaseViewManager.java` and
          `ReactAccessibilityDelegate.kt`.
        */
        importantForAccessibility={editing ? 'no-hide-descendants' : 'auto'}
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}
      >
        <View style={{ gap: spacing.md }}>
          {/*
            WHERE THE CAPTURE GOT TO (spec §9.2.1).

            The same dial, drawn from the fix that was actually stored, so the
            picture she watched converging is the picture of the result. On a
            settled completion the circle stays exactly where its accuracy puts
            it and a companion ring marks that radius, with the crosshair still
            visible inside it: the gap between the two is how far this spot fell
            short of what the device can do. On a locked one the crosshair is
            lit and the circle is on it.

            The circle is never moved onto the crosshair to make a completion
            look better. "The radius always means metres" (spec §9.2) is the
            invariant the whole dial rests on — that alternative was considered
            for the settled level and rejected, because a circle snapped to a
            radius its accuracy has not earned makes the picture lie.
          */}
          {finalFix === null ? null : (
            <CaptureDial
              grade={gradeAccuracy(finalFix.accuracyM)}
              accuracyM={finalFix.accuracyM}
              settled={completion === 'settled'}
              locked={completion === 'locked'}
            >
              {completion === 'locked' ? (
                <Type variant="label" testID="capture-lock-label">
                  {'· LOCKED ON'}
                </Type>
              ) : null}
              {completion === 'settled' ? (
                <Type variant="body" testID="capture-settled-label">
                  {settledSentence(finalFix.accuracyM)}
                </Type>
              ) : null}
            </CaptureDial>
          )}

          {record === null ? (
            <Type variant="title" testID="capture-recorded">
              POINT RECORDED
            </Type>
          ) : (
            <RecordedSummary record={record} />
          )}

          {capture.message === null ? null : (
            <View style={{ gap: spacing.xs }}>
              <Type variant="label" dim>
                HOW THE WAIT ENDED
              </Type>
              {message}
            </View>
          )}

          {duplicate === null ? null : (
            <View
              testID="capture-duplicate"
              style={{
                gap: spacing.sm,
                padding: spacing.md,
                borderRadius: radii.md,
                borderWidth: 2,
                // Doctrine rule 9 again: amber, plus a dashed border, plus the
                // word — never the colour on its own.
                borderStyle: 'dashed',
                borderColor: theme.colors.statusFair,
                backgroundColor: theme.colors.surfaceRaised,
              }}
            >
              <Type variant="label" dim>
                CLOSE TO THE LAST POINT
              </Type>
              <Type>{`This point is ${duplicate.metresApart.toFixed(1)} m from the one before it.`}</Type>
              {/*
                No promise of deletion. `softDeleteRecord` exists in
                `@corymbia/data` and has no caller anywhere under `apps/`, so
                "you can delete this one later" offered a capability the
                application does not have — the worst kind of reassurance to
                give someone who has just double-tapped over a survey point.
                What she can actually do is name them apart, which the tiles
                below this warning offer, so that is what it says.
              */}
              <Type variant="small" dim>
                Both are saved. If that was a double tap, naming them apart will tell them apart
                later. If you meant two samples this close together, carry on — nothing has been
                refused.
              </Type>
              <Button
                testID="capture-duplicate-dismiss"
                label="Keep both"
                spokenLabel="Keep both points and dismiss this warning"
                kind="secondary"
                onPress={onAcceptDuplicate}
              />
            </View>
          )}

          {record === null ? null : (
            <RecordedAffordances record={record} media={media} editor={editor} />
          )}

          {/*
            ANOTHER GO, WHEN THE CAPTURE SETTLED SHORT (spec §9.2.1).

            Offered only for a settled completion: a locked one has reached
            what this receiver can do, and a capture she cut short with ACCEPT
            NOW ended on her own decision rather than on a measurement that ran
            out of improvement.

            It keeps the record. The capture number may already be written on a
            sample tube, and a real measurement is not discarded for a second
            attempt that might be no better — `refineAgain` runs the same
            in-place refinement over the same row, and both runs appear in its
            event log.
          */}
          {completion === 'settled' ? (
            <View style={{ gap: spacing.xs }}>
              <Button
                testID="capture-try-again"
                label="TRY AGAIN"
                spokenLabel="Stand still and measure this same point again"
                kind="accurate"
                size="field"
                onPress={capture.refineAgain}
              />
              <Type variant="small" dim testID="capture-try-again-note">
                Another go measures this same point again and writes what it finds onto this same
                capture — the number does not change, and both runs stay in its history.
              </Type>
            </View>
          ) : null}

          <Button
            testID="capture-button"
            label="TAKE ANOTHER READING"
            spokenLabel="Finish with this point and capture another"
            kind="fast"
            size="field"
            onPress={capture.again}
          />
          <Button
            testID="capture-leave"
            label="DONE FOR NOW"
            spokenLabel="Finish capturing and go back"
            kind="secondary"
            onPress={onLeave}
          />
        </View>
      </ScrollView>

      {/*
        THE EDITING SURFACE, HERE AND NOT IN THE COLUMN ABOVE.

        Two things follow from this position and neither is cosmetic. It is a
        SIBLING of `capture-recorded-scroll`, so a touch on its SAVE never
        runs that scroll view's `onStartShouldSetResponderCapture` — the first
        tap is the tap. And it is a child of `Screen`, which is inside the
        `SafeAreaView` that `_layout.tsx` wraps every route in, so the insets
        a `Modal` had to ask for again are already applied.

        It fills `Screen` completely despite `Screen`'s own `spacing.lg`
        padding: an absolutely positioned child with all four insets set is
        measured against its containing block's PADDING box, not its content
        box (Yoga `AbsoluteLayout.cpp` — `positionAbsoluteChild` adds the
        parent's border and not its padding, and `layoutAbsoluteChild` sizes
        it as `measuredDimension - borders - insets`). So the scrim reaches the
        edge of the screen rather than stopping a gutter short of it.
      */}
      {editor.open === null ? null : (
        <FieldEditor
          kind={editor.open.kind}
          draft={editor.open.draft}
          saving={editor.saving}
          // Only a failure belonging to the editor that is open. The two
          // cannot disagree today (`openEditor` clears the error and the write
          // re-sets it for the kind being written), but the editor renders the
          // message and must not render one addressed to the other field if
          // that ever stops being true.
          error={
            editor.error !== null && editor.error.kind === editor.open.kind
              ? editor.error.message
              : null
          }
          onChangeDraft={editor.changeDraft}
          onSave={editor.save}
          onCancel={editor.closeEditor}
        />
      )}
    </Screen>
  )
}

/** What was saved, in the four facts that make it read as finished. */
function RecordedSummary({ record }: { record: FieldRecord }) {
  const point = positionOf(record.fix)
  return (
    <View style={{ gap: spacing.xs }}>
      <Type variant="label" dim>
        POINT RECORDED
      </Type>
      <Type variant="title" testID="capture-recorded">
        {`CAPTURE ${String(record.captureNumber)}`}
      </Type>
      <Type variant="title" testID="capture-recorded-accuracy">
        {formatAccuracy(record.fix.quality === 'none' ? null : record.fix.accuracyM)}
      </Type>
      <Type variant="small" dim testID="capture-recorded-samples">
        {describeRecordedSamples(record.fix)}
      </Type>
      <Type variant="small" dim>
        This position is final. Nothing after this will change it.
      </Type>
      {/*
        WHERE IT WENT. `useCapture` files every capture to the Inbox — it is
        handed a database, a device and a source and has no activity to file
        to — and that is a supported destination rather than an error state
        (§10.2): capturing without context is a legitimate way to work, and
        the Inbox is somewhere she works with and files from later.
        Somewhere is not nowhere, though, and a recorded state that named no
        destination at all left her to guess. This is also the line Plan 5
        grows when activities exist: the name §9.6 asks for goes here, in
        place of "the Inbox".
      */}
      <Type variant="small" dim testID="capture-recorded-destination">
        Saved to the Inbox. You can file it from there later.
      </Type>

      {/*
        The SAVED point's coordinates, not the receiver's live ones. The
        acquiring state shows the live reading because that is what is still
        moving; here the whole claim is that nothing is moving any more, and
        digits that went on ticking under the word "final" would contradict it.
      */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Type variant="mono" dim>
          lat
        </Type>
        <Type variant="mono" testID="capture-recorded-latitude">
          {point === null ? '—' : formatDegrees(point.latitude)}
        </Type>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Type variant="mono" dim>
          lon
        </Type>
        <Type variant="mono" testID="capture-recorded-longitude">
          {point === null ? '—' : formatDegrees(point.longitude)}
        </Type>
      </View>
    </View>
  )
}

/**
 * What is attached to a recorded point, and the removal question one of its
 * tiles can open.
 *
 * **A hook, rather than state inside `RecordedAffordances`, and that is
 * forced rather than tidy.** Doctrine rule 16 asks the recorded state's
 * spoken description to describe that state, and since this branch the state
 * includes what is attached, that there is a strip of it, and whether a
 * destructive question is currently open. That description is a prop on
 * `Screen`, which `RecordedState` renders — one level above the affordances
 * that used to own the media. Two components cannot each own the same fact
 * without one of them going stale, so the fact lives here and both read it.
 *
 * `recordId` is nullable because `RecordedState` renders before a record
 * exists (a capture whose insert has not come back yet, which it draws as
 * POINT RECORDED with no summary) and a hook cannot be called conditionally.
 * With no record there is nothing to read and every operation below is a
 * no-op.
 */
type RecordMedia = {
  items: MediaStripItem[]
  photoCount: number
  voiceCount: number
  /** The attachment a confirmation is open for, `null` when none is. */
  pendingRemovalId: string | null
  /**
   * How that attachment is named — `Photo 3 of 10` — from `@corymbia/ui`'s
   * own strip labelling, so the question and the tile it marks cannot drift
   * apart. `null` when no removal is pending, and also when the pending id
   * no longer names anything in `items` (a refresh that landed underneath
   * the question), which the screen renders as no question at all rather
   * than as a question about nothing.
   */
  removalLabel: string | null
  removing: boolean
  removeError: string | null
  onTilePress: (id: string) => void
  onRequestRemoval: (id: string) => void
  onCancelRemoval: () => void
  onConfirmRemoval: () => void
}

function useRecordMedia(db: Database, recordId: string | null, deviceId: string): RecordMedia {
  const [media, setMedia] = useState<Attachment[]>([])

  /**
   * The removal confirmation (spec, this task; doctrine rule 4).
   *
   * `pendingRemoval` is the id of the attachment a `media-remove-*` tile has
   * been pressed for, and nothing more — it is not itself the confirmation
   * being shown, it is what the confirmation would be shown *for*. Rendered
   * inline, on this screen, rather than as an `Alert` (the same reason
   * `camera.tsx`'s own error is inline): a modal that dismisses takes the
   * question, and the answer, with it.
   *
   * `removeError` is kept separate from the title/notes save failure rather
   * than sharing one slot with it — the two are shown in different places on
   * the screen, next to what they are about, and clearing one must never
   * clear the other. That is also why the save failure stayed in
   * `RecordedAffordances` when the media state moved up here.
   */
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  /**
   * The one player this screen ever plays a voice note through.
   *
   * A single instance, not one per tile: `useAudioPlayer` starts loading
   * whatever source it is given immediately, and a strip can hold several
   * voice notes she may never tap. `null` here means "nothing loaded yet" —
   * `playVoiceNote` below calls `player.replace(uri)` before `player.play()`
   * on every press, which is what lets the same player stand in for whichever
   * tile she actually taps.
   */
  const player = useAudioPlayer(null)

  /**
   * Guards the `setState`s that follow an await: she can leave the screen, or
   * take another reading, while `listMedia` is still reading or
   * `softDeleteMedia` is still in a transaction.
   */
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  /**
   * Which `listMedia` call the state currently belongs to.
   *
   * `mounted` alone is not enough here. Camera → back → voice → back happens
   * in a couple of seconds in the field, and each return starts a fetch
   * without cancelling the one before it; two in-flight reads can resolve in
   * either order, and the older one resolving last would overwrite the newer
   * answer with a list that is one attachment short. Every fetch takes a
   * ticket and only the holder of the current one is allowed to write, which
   * is last-request-wins rather than last-response-wins.
   */
  const generation = useRef(0)

  /**
   * What is already attached, re-read every time this screen becomes the
   * focused route — not once on mount.
   *
   * Nothing on this screen writes a photo or a voice note: pressing the tile
   * pushes to `/camera` or `/voice`, and `useAttachMedia` writes the file and
   * the row over there. So the only moment this component can learn that an
   * attachment now exists is the moment she comes back, and a mount-only
   * fetch never sees it — the screen was already mounted when she left.
   * `useFocusEffect` fires on first focus too, so this REPLACES the mount
   * fetch rather than sitting beside it; keeping both would double-fetch on
   * every entry.
   *
   * This depends on the root layout being a `Stack` and not a `Slot` (see
   * `_layout.tsx`): under `Slot` there is nothing left to refocus, because
   * the push unmounted this screen and everything the capture is.
   *
   * **`refresh` is also what a successful removal calls**, below — not a
   * second, independent fetch. A removal and a return from `/camera` can in
   * principle race (she declines a removal, backgrounds the app onto the
   * camera, and comes back), and routing both through the one ticketed
   * function is what keeps them last-request-wins instead of two competing
   * writers into `media`.
   */
  const refresh = useCallback((): Promise<void> => {
    if (recordId === null) return Promise.resolve()
    generation.current += 1
    const ticket = generation.current
    return listMedia(db, recordId)
      .then((rows) => {
        if (mounted.current && ticket === generation.current) setMedia(rows)
      })
      .catch(() => {
        // The record itself is unaffected by a read that fails; the tiles
        // simply carry on showing no count until the next successful fetch,
        // which is honester than inventing a number that was never read.
      })
  }, [db, recordId])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )

  const photoCount = media.filter((item) => item.kind === 'photo').length
  const voiceCount = media.filter((item) => item.kind === 'voice').length
  const mediaItems: MediaStripItem[] = media.map((item) => ({
    id: item.id,
    kind: item.kind,
    uri: mediaStore.uriFor(item.fileName),
    durationMs: item.durationMs,
  }))

  /**
   * How the attachment a removal is pending for is named in the strip —
   * `Photo 3 of 10`. `mediaStripLabel` is `MediaStrip`'s own labelling,
   * imported rather than restated: the confirmation names the tile the strip
   * marks, and two independent numbering schemes drifting apart would point
   * her at the wrong thumbnail on a strip of near-identical thumbnails with
   * no undo behind it.
   */
  const removalLabel = pendingRemoval === null ? null : mediaStripLabel(mediaItems, pendingRemoval)

  /**
   * A voice tile's press (this task). `MediaStrip` takes one `onPress` for
   * the whole strip, not one per kind, so a photo tile presses this too —
   * see `handleMediaPress` below for what it does there.
   *
   * `replace` before `play`, on the one player this screen owns: see its own
   * doc comment above for why there is only one. Both calls are synchronous
   * (`AudioPlayer.replace`/`.play`, `expo-audio` v57 —
   * `node_modules/expo-audio/build/AudioModule.types.d.ts`), so a decoder or
   * source failure surfaces as a synchronous throw here, not a rejected
   * promise — which is exactly what the `try` below is written to catch.
   *
   * **The event is appended only once `play()` has returned without
   * throwing** — never before it, and never from a `.catch` on a promise
   * that was never produced. `'played'` is a permitted `EventAction`
   * (migration 003) precisely for this (spec §8.5): who listened to a field
   * note and when is part of chain of custody, and an event log that cannot
   * be edited or removed must never record a play that never started.
   */
  function playVoiceNote(uri: string): void {
    try {
      player.replace(uri)
      player.play()
    } catch {
      // A voice note that will not play is not a fact about the record
      // itself being wrong, and this screen has nowhere pinned to say so —
      // the one thing that must not happen is logging a play that did not
      // happen, which the early return here guarantees.
      return
    }
    if (recordId === null) return
    void appendEvent(db, {
      recordId,
      action: 'played',
      deviceId,
      fix: ambientFixOrNone(ambientCache),
    })
  }

  /**
   * A tile's press, dispatched by kind. A photo tile opens nothing: a
   * full-screen viewer belongs with the browsing views Plan 5 builds, and
   * `MediaStrip` has no per-item `onPress` to withhold from just the photo
   * tiles — passing one at all makes every tile a `Pressable` (its own
   * doctrine: never a `Pressable` around a handler with nothing to do), so
   * the photo case is a deliberate no-op rather than an absent handler.
   */
  function handleMediaPress(id: string): void {
    const item = mediaItems.find((entry) => entry.id === id)
    if (item === undefined || item.kind !== 'voice') return
    playVoiceNote(item.uri)
  }

  /** Opens the inline confirmation for one attachment (doctrine rule 4). */
  function requestRemoval(id: string): void {
    setRemoveError(null)
    setPendingRemoval(id)
  }

  function cancelRemoval(): void {
    setPendingRemoval(null)
    setRemoveError(null)
  }

  /**
   * Removes the pending attachment, once she has confirmed it.
   *
   * **Never optimistic.** `softDeleteMedia` is awaited before anything about
   * `media` changes — no filtering the strip ahead of the result — so a
   * refusal leaves the tile exactly as it was, with nothing to undo. Only
   * once the removal has actually committed does this refetch through
   * `refresh()` (the same ticketed fetch a focus return uses) and let what
   * `listMedia` says replace `media` outright, rather than computing the new
   * list itself by filtering the id out locally: the row is soft-deleted,
   * not gone, and `listMedia`'s own `deleted_at IS NULL` filter is the one
   * true statement of what she should still see — this screen does not
   * restate it.
   */
  async function confirmRemoval(): Promise<void> {
    if (pendingRemoval === null) return
    const id = pendingRemoval
    setRemoving(true)
    setRemoveError(null)
    try {
      await softDeleteMedia(db, id, deviceId, ambientFixOrNone(ambientCache))
      if (!mounted.current) return
      setPendingRemoval(null)
      await refresh()
    } catch (caught) {
      if (!mounted.current) return
      const detail = caught instanceof Error ? caught.message : String(caught)
      setRemoveError(
        `The attachment was not removed: ${detail.replace(/[.?!…]+$/, '')}. It is still attached.`,
      )
    } finally {
      if (mounted.current) setRemoving(false)
    }
  }

  return {
    items: mediaItems,
    photoCount,
    voiceCount,
    pendingRemovalId: pendingRemoval,
    removalLabel,
    removing,
    removeError,
    onTilePress: handleMediaPress,
    onRequestRemoval: requestRemoval,
    onCancelRemoval: cancelRemoval,
    onConfirmRemoval: () => {
      void confirmRemoval()
    },
  }
}

/**
 * The title and the notes: what is stored, what is being typed, and what the
 * last write did.
 *
 * **A hook rather than state inside `RecordedAffordances`, and — like
 * `useRecordMedia` above — that is forced rather than tidy.** The editor is
 * no longer a `Modal`; it is an overlay drawn inside this Activity's own
 * window (see `FieldEditor`), and it has to sit OUTSIDE
 * `capture-recorded-scroll` in the React tree, because a `ScrollView`
 * ancestor takes the first touch on a control while a dismissible keyboard is
 * up. That is the whole of the two-taps-to-save fault, and moving the editor
 * into the Activity's window without also moving it out of the scroll view
 * would reproduce it exactly. The tiles, the confirmation sentence and the
 * stored values all belong in that scrolling column; the editor does not. Two
 * components cannot each own the same fact without one of them going stale,
 * so the fact lives here and both read it.
 *
 * `record` is nullable for the same reason `useRecordMedia`'s `recordId` is:
 * `RecordedState` renders before the insert comes back, and a hook cannot be
 * called conditionally.
 */
type FieldEditing = {
  /**
   * The field the editor is open on and the text currently in its box, or
   * `null` when it is closed. The draft is held here rather than inside the
   * editor so that closing discards it — a cancel must not leave a half-typed
   * name behind to reappear the next time the box is opened.
   */
  open: { kind: 'title' | 'description'; draft: string } | null
  /** The stored name, as the last write left it. */
  title: string | null
  /** The stored notes, as the last write left them. */
  description: string | null
  saving: boolean
  /** A failure and the field it belongs to; `null` when the last write landed. */
  error: { kind: 'title' | 'description'; message: string } | null
  /** The last save that actually landed, and what it wrote. */
  saved: { kind: 'title' | 'description'; value: string | null } | null
  openEditor: (kind: 'title' | 'description') => void
  closeEditor: () => void
  changeDraft: (text: string) => void
  save: () => void
}

function useFieldEditing(db: Database, record: FieldRecord | null, deviceId: string): FieldEditing {
  const [open, setOpen] = useState<{ kind: 'title' | 'description'; draft: string } | null>(null)
  /**
   * What the last write returned, or `null` while nothing has been written
   * from this screen yet — in which case the record's own columns are read
   * through live.
   *
   * Derived rather than seeded into `useState` from `record` at mount, which
   * is what this was when it lived one level down inside `RecordedAffordances`.
   * The seed had to go: this hook is called from `RecordedState`, which
   * renders once BEFORE the record exists (a capture whose insert has not come
   * back yet, drawn as POINT RECORDED with no summary), so a mount-time seed
   * would capture `null` for both fields and never look again. Reading through
   * until the first write is the same value in every case, and one fewer
   * effect to keep in step.
   */
  const [written, setWritten] = useState<{
    title: string | null
    description: string | null
  } | null>(null)
  const title = written === null ? (record?.title ?? null) : written.title
  const description = written === null ? (record?.description ?? null) : written.description

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<{ kind: 'title' | 'description'; message: string } | null>(
    null,
  )
  /**
   * The last save that actually landed, and what it wrote — the whole of the
   * answer to "not sure they're being saved".
   *
   * **The editor closing is not the confirmation, and must never be made
   * into one.** A cancel closes it identically, and the saved value itself
   * lands further down the recorded column past the strip, which is the
   * position she never saw it in. So this is the confirmation: a sentence
   * rendered directly beneath the tile she pressed, naming which field was
   * written and quoting the value back — built from what `renameRecord`
   * returned rather than from her draft, so a repository that stored
   * something other than what was typed cannot be confirmed as having stored
   * what was typed. It is a `polite` live region so a screen reader says it
   * at the moment the editor's own surface disappears from under the reader.
   *
   * Two channels, not colour (doctrine rule 9): this sentence, and the tile's
   * own label turning `Title ✓` beside it.
   *
   * It persists rather than fading on a timer. A timed acknowledgement is one
   * she can miss by looking up at the paddock for three seconds, which is the
   * failure that produced this ticket in the first place; it is cleared by
   * the next thing she does to a field, in `openEditor`.
   */
  const [saved, setSaved] = useState<{
    kind: 'title' | 'description'
    value: string | null
  } | null>(null)
  /**
   * Guards the `setState`s that follow an await. She can leave the screen, or
   * take another reading, while `renameRecord` is still in a transaction, and
   * nothing may write into a component that has gone. (`useRecordMedia` keeps
   * its own, for the reads and the removal it owns.)
   */
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  function openEditor(kind: 'title' | 'description'): void {
    // The previous failure goes with the editor that produced it. Without
    // this, a failed title save leaves "The name was not saved…" sitting under
    // a freshly opened notes box, where it reads as a refusal of the notes she
    // has not typed yet.
    setError(null)
    // And the previous success goes with it, for the same reason: "Name
    // saved: Frog pond outflow" standing under a freshly opened notes box
    // reads as a confirmation of the notes she has not typed yet.
    setSaved(null)
    setOpen({ kind, draft: (kind === 'title' ? title : description) ?? '' })
  }

  /**
   * Leaves the editor without writing anything — the overlay's own CANCEL,
   * and the Android back button through `FieldEditor`'s `BackHandler`.
   *
   * The failure message goes with it, because the failure message lives on
   * the editing surface (see `FieldEditor`) and there is nowhere else on this
   * screen for it to be. Nothing is lost by that: what a failed save leaves
   * behind is a record with no name on it, and the tile still reading `Title`
   * with no value beneath it says exactly that, permanently, without a
   * sentence.
   */
  function closeEditor(): void {
    setOpen(null)
    setError(null)
  }

  async function write(): Promise<void> {
    if (open === null || record === null) return
    const { kind, draft } = open
    const trimmed = draft.trim()
    // An empty box is a cleared value, which `renameRecord` models explicitly
    // as `null` — not as an empty string, which would be text made of no
    // characters.
    const next = trimmed.length === 0 ? null : trimmed
    setSaving(true)
    setError(null)
    try {
      const renamed = await renameRecord(
        db,
        kind === 'title'
          ? // No `description` key at all, which is the whole of how
            // `renameRecord` (`records.ts`: `'description' in input`) is told
            // to leave the notes alone. Passing `description: undefined` would
            // NOT be the same thing — the key would be present, and the notes
            // would be cleared.
            { recordId: record.id, title: next, deviceId }
          : // A notes save must still carry a title, because `renameRecord`
            // takes `title` unconditionally and would otherwise read this as
            // "clear the title". `title` here is this screen's own state,
            // which is correct for as long as this screen is the only thing
            // that can rename this record — it is, today. The cost is that
            // every notes save appends an `'edited'` event restating a title
            // that did not change, and the moment anything else can rename a
            // record (Plan 5's list, or a sync) this becomes a lost update:
            // the notes save would overwrite the other rename with whatever
            // title this screen last saw. Fixing it properly means either a
            // notes-only input on `renameRecord` or a read-modify-write inside
            // its transaction, not a change here.
            { recordId: record.id, title, description: next, deviceId },
      )
      if (!mounted.current) return
      setWritten({ title: renamed.title, description: renamed.description })
      // From the record that came back out of the transaction, not from
      // `next`: the confirmation quotes what was actually written, so a
      // repository that stored something other than what was typed cannot be
      // confirmed as having stored what was typed.
      setSaved({ kind, value: kind === 'title' ? renamed.title : renamed.description })
      setOpen(null)
    } catch (caught) {
      if (!mounted.current) return
      const detail = caught instanceof Error ? caught.message : String(caught)
      const subject = kind === 'title' ? 'name' : 'notes'
      const verb = kind === 'title' ? 'was' : 'were'
      setError({
        kind,
        // The trailing stop is stripped off `detail` for the same reason
        // the removal failure beside it does so, and `camera.tsx` and
        // `voice.tsx` do: a cause that already ends in punctuation
        // ("database is locked!") otherwise renders "…was not saved:
        // database is locked!. The point itself is safe." This was the one
        // error sentence on the branch still interpolating a raw `${detail}.`
        message: `The ${subject} ${verb} not saved: ${detail.replace(/[.?!…]+$/, '')}. The point itself is safe.`,
      })
    } finally {
      if (mounted.current) setSaving(false)
    }
  }

  return {
    open,
    title,
    description,
    saving,
    error,
    saved,
    openEditor,
    closeEditor,
    changeDraft: (text: string) => {
      // Keyed off the field that is open rather than taking a `kind`: there is
      // only ever one box on the surface, and letting a caller name a
      // different one would let a stale editor write into the live draft.
      if (open === null) return
      setOpen({ kind: open.kind, draft: text })
    },
    save: () => {
      void write()
    },
  }
}

/**
 * What can still be attached to a recorded point (spec §9.6), and what is
 * already there.
 *
 * `InputAffordanceRow` (`@corymbia/ui`, Task 6) renders the four tiles this
 * used to hand-roll one at a time: title, notes, voice, photo — none of them
 * disabled, because none of them is unbuilt any more. Location is not among
 * them: it is not an input on this screen, it is the fix the capture just
 * made (spec §9.6), and that is shown by the dial and the accuracy readout
 * above, not by a fifth tile that would do nothing when pressed.
 *
 * Title and notes are neither written nor held here any more. Both live in
 * `useFieldEditing`, owned by `RecordedState`, because the editor itself has
 * to render outside the scrolling column this component sits in — see the
 * note at the foot of this component. What stays here is everything that does
 * belong in the column: the four tiles, the confirmation sentence directly
 * beneath them, the strip, and the two stored values. Photo and voice are not
 * written here either: pressing either tile pushes to `/camera` or `/voice`
 * with this record's id, and `useAttachMedia` — called from those screens,
 * not this one — is the whole of what writes the file and the row (Task 10).
 * This component's part with them is narrower: fetch what is already
 * attached, through `listMedia`, so the tiles can say how many and
 * `MediaStrip` can show them.
 */
function RecordedAffordances({
  record,
  media,
  editor,
}: {
  record: FieldRecord
  /**
   * Owned by `RecordedState` (see `useRecordMedia`), not by this component,
   * because `Screen`'s `spokenDescription` up there has to say what is
   * attached and whether a removal question is open — doctrine rule 16.
   */
  media: RecordMedia
  /**
   * Owned by `RecordedState` too (see `useFieldEditing`), for a related
   * reason: the editor these tiles open is rendered up there, as a sibling of
   * `capture-recorded-scroll` rather than a descendant of it.
   */
  editor: FieldEditing
}) {
  const router = useRouter()
  const { theme } = useTheme()

  const { title, description, saved } = editor

  const completed: InputAffordanceKind[] = [
    ...(title !== null ? (['title'] as const) : []),
    ...(description !== null ? (['description'] as const) : []),
  ]

  // Only the tile whose edit is actually in flight is busy — not both, and
  // not the ones that only navigate, which never enter a saving state on
  // this screen at all.
  const busy: InputAffordanceKind[] =
    editor.saving && editor.open !== null ? [editor.open.kind] : []

  function handlePress(kind: InputAffordanceKind): void {
    if (kind === 'title' || kind === 'description') {
      editor.openEditor(kind)
      return
    }
    // `camera.tsx` and `voice.tsx` both read `recordId` off the route params
    // this way (`useLocalSearchParams<{ recordId?: string }>()`), and both
    // are what actually attach the file — nothing here writes media.
    router.push({
      pathname: kind === 'photo' ? '/camera' : '/voice',
      params: { recordId: record.id },
    })
  }

  return (
    <View style={{ gap: spacing.sm }}>
      {/*
        Doctrine rule 7, and the pre-commitment that rule's own row in
        `docs/ui-doctrine.md` made: the recorded state's help exemption held
        only for as long as everything it asked for explained itself, and
        that row named "attaching media" in advance as the change that would
        end it. This branch made that change, so this is the affordance it
        said would come with it. What a `?` has to say here that the tiles
        cannot: that an attachment belongs to this point rather than to the
        trip, and — the one thing she cannot see anywhere — that removing an
        attachment does not give the storage back.
      */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Type variant="label" dim>
          ADD TO THIS POINT
        </Type>
        <HelpAffordance
          testID="capture-media-help"
          title="Photos and voice notes"
          // Plain language for the process (doctrine rule 6). No "purge",
          // no "soft delete", no "orphan" — and no promise of a clean-up
          // this application cannot perform.
          body={
            'A photo or a voice note belongs to this one point, not to the trip. It carries ' +
            'where and when it was taken, and it travels with the point wherever the point is ' +
            'filed later.\n\n' +
            'Photo and Voice open the camera and the recorder. What you take comes back here as ' +
            'a small tile below these four buttons, and tapping a voice tile plays it back.\n\n' +
            'Removing a tile takes the attachment off this point, and asks first, because ' +
            'nothing here can put it back. The file itself stays on the device: this app has ' +
            'nothing that deletes it, so removing an attachment does not free up any space.'
          }
        />
      </View>

      <InputAffordanceRow
        testID="capture-affordances"
        onPress={handlePress}
        completed={completed}
        counts={{ photo: media.photoCount, voice: media.voiceCount }}
        busy={busy}
      />

      {/*
        THE SAVE CONFIRMATION — directly under the tile she pressed, which is
        where her eye returns the instant the editor goes away. Not further
        down beside the stored value: that is past the media strip, and being
        below the strip is the exact reason she never saw the value and asked
        whether anything had been saved at all.

        AND THE EDITOR CLOSING IS NOT THIS. A cancel closes it identically, so
        the surface going away says nothing about whether anything was
        written. This sentence and the tile's own `Title ✓` are what say it,
        and they are built from what `renameRecord` returned.

        `accessibilityLiveRegion` is the screen-reader half of the same
        moment. The editor carries its own spoken description, so a reader is
        focused inside a surface that is about to be removed from the tree;
        without a live region the removal is silent and the reader lands back
        on the tiles with no statement that anything happened.
      */}
      {saved === null ? null : (
        <Type variant="body" testID="capture-save-confirmation" accessibilityLiveRegion="polite">
          {savedSentence(saved.kind, saved.value)}
        </Type>
      )}

      <MediaStrip
        testID="capture-media-strip"
        items={media.items}
        onPress={media.onTilePress}
        onRemove={media.onRequestRemoval}
        pendingRemovalId={media.pendingRemovalId}
      />

      {media.removalLabel === null ? null : (
        <View
          style={{
            gap: spacing.sm,
            padding: spacing.md,
            borderRadius: radii.md,
            borderWidth: 2,
            // Amber, the same warn-never-block colour the duplicate-pin
            // guard uses above — this is a question, not a refusal.
            borderColor: theme.colors.statusFair,
            backgroundColor: theme.colors.surfaceRaised,
          }}
        >
          {/*
            NAMED, not "this photo". Ten photos in a horizontal strip of
            near-identical 64dp thumbnails, roughly five of them visible, the
            strip back at offset 0 after every refresh, and no undo anywhere
            in the app: "Remove this photo?" leaves her to guess which one is
            about to go. The ordinal is the strip's own
            (`mediaStripLabel`), and the tile it names is marked in the strip
            at the same time, so the question and its subject are visibly one
            thing.

            And NO promise of a purge. There is no purge — no settings
            route, no reconciliation, nothing anywhere in this application
            that deletes a media file (see `docs/media-storage.md` §5). The
            duplicate-pin warning above this panel is careful in exactly the
            same way, and for the same reason: it stopped offering a deletion
            the app cannot perform. "The file stays on the device" is the
            whole of what is true, and it stops there.
          */}
          <Type variant="body">
            {`Remove ${media.removalLabel.toLowerCase()}? It comes off this point. The file stays on the device.`}
          </Type>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {/*
              `danger` here, `secondary` below (doctrine rule 9): the action
              that cannot be undone from this screen and the one that costs
              nothing must not read identically in glare. Two channels, not
              one — a label difference alone ("REMOVE" vs. "KEEP IT") is
              exactly what a colour-blind reader or a bright paddock erodes
              first.
            */}
            <Button
              testID="media-remove-confirm"
              label={media.removing ? 'REMOVING…' : 'REMOVE'}
              spokenLabel={`Remove ${media.removalLabel.toLowerCase()}`}
              kind="danger"
              disabled={media.removing}
              onPress={media.onConfirmRemoval}
            />
            <Button
              testID="media-remove-cancel"
              label="KEEP IT"
              spokenLabel="Keep this attachment"
              kind="secondary"
              disabled={media.removing}
              onPress={media.onCancelRemoval}
            />
          </View>
        </View>
      )}

      {media.removeError === null ? null : (
        <Type variant="small" testID="media-remove-error">
          {media.removeError}
        </Type>
      )}

      {title === null ? null : (
        <Type variant="body" testID="capture-title-value">
          {title}
        </Type>
      )}

      {description === null ? null : (
        <Type variant="body" testID="capture-description-value">
          {description}
        </Type>
      )}

      {/*
        AND NO EDITOR HERE ANY MORE — it is rendered by `RecordedState`, as a
        SIBLING of `capture-recorded-scroll` rather than a descendant of it.

        That is the fix for the first tap on SAVE. A `ScrollView` ancestor
        takes the responder for the first touch on a control while a
        dismissible soft keyboard is up (`ScrollView.js`,
        `_handleStartShouldSetResponderCapture`), blurring the input instead
        of letting the press through — which was the reported "I try to tap
        save but it just closes the keyboard as the focus changes, then i hit
        save again". Putting the editor back into this column would
        reintroduce that fault, and no prop on the scroll view can be trusted
        to keep holding it off once the editor is a descendant again.
      */}
    </View>
  )
}

/** The confirmation sentence for a save that landed. */
function savedSentence(kind: 'title' | 'description', value: string | null): string {
  const subject = kind === 'title' ? 'Name' : 'Notes'
  // An empty box is a deliberate clearing, not a save of nothing — the same
  // distinction `renameRecord` models as `null` rather than `''` — and it has
  // to read as one, or she is told "Notes saved:" followed by a blank.
  return value === null ? `${subject} cleared` : `${subject} saved: ${value}`
}

/**
 * What a screen reader hears when the editor opens (doctrine rule 16).
 *
 * The editor is a new surface, so it carries its own description rather than
 * borrowing the capture screen's — `describeRecordedScreen` above describes
 * the point, its attachments and the ways onward, none of which is reachable
 * while this is up.
 *
 * A `Modal` used to make that true on its own, by being a separate Android
 * window that a reader does not read behind. An overlay is in the same window
 * as the column, so the other half is done by hand: `RecordedState` withdraws
 * the screen's own description while this one exists, and the recorded column
 * carries `importantForAccessibility="no-hide-descendants"`. All three move
 * together or a reader hears two surfaces at once.
 *
 * State-dependent for the same reason that one is: a save in flight and a
 * save that failed are the two moments where the surface and the sentence
 * would otherwise disagree, and the failure text is the one thing on this
 * surface a reader cannot get to by traversing controls.
 */
function describeEditor(kind: 'title' | 'description', saving: boolean, error: string | null) {
  const heading =
    kind === 'title'
      ? 'Naming this point. A box for the name, a control that saves it onto the point, and one that closes without saving.'
      : 'Notes for this point. A box for the notes, a control that saves them onto the point, and one that closes without saving.'
  const state = saving ? ' Saving.' : ''
  const failure = error === null ? '' : ` ${error}`
  return `${heading}${state}${failure}`
}

/**
 * The title/notes editor, as a surface of its own rather than a box appended
 * to the bottom of the recorded state's column.
 *
 * **This is a field-reported blocker, not a preference.** Inline, the box
 * rendered after everything else in that column — the tiles, the strip, the
 * saved values — which is exactly the strip of screen the Android soft
 * keyboard occupies. She typed blind. A surface of its own takes the input
 * out of that column entirely, so the keyboard rises into empty space beneath
 * it rather than over it.
 *
 * **AN OVERLAY, AND NOT A `Modal`, AND THAT IS THE KEYBOARD FIX.** The modal
 * itself was judged right — "modal works well" — and nothing about the shape
 * of this surface has changed. What changed is which Android window it lives
 * in, because two faults came out of that one fact and one of them survived
 * two attempts at it.
 *
 * The mechanism, read out of RN 0.86.3 rather than guessed at. It is NOT that
 * a dialog fails to inherit `MainActivity`'s `android:windowSoftInputMode`:
 * `ReactModalHostView.kt` sets `SOFT_INPUT_ADJUST_RESIZE` on the dialog's
 * window itself, so the resize behaviour is the same either way. It is the
 * focus flag. The dialog's window is created with `FLAG_NOT_FOCUSABLE` set,
 * and that flag is cleared only AFTER `newDialog.show()` returns:
 *
 *     window.setFlags(FLAG_NOT_FOCUSABLE, FLAG_NOT_FOCUSABLE)   // on create
 *     ...
 *     newDialog.show()
 *     updateSystemAppearance()
 *     window.clearFlags(FLAG_NOT_FOCUSABLE)                     // after show
 *
 * A window carrying `FLAG_NOT_FOCUSABLE` cannot hold IME focus, and clearing
 * the flag does not grant it synchronously — it schedules a relayout, and the
 * window manager grants input focus across a process boundary some frames
 * later. `InputMethodManager.showSoftInput` on a window that does not yet
 * hold IME focus is dropped, silently and successfully. `onShow` is dispatched
 * from the dialog's own `OnShowListener`, which `Dialog.show()` posts, and a
 * `requestAnimationFrame` after it is one frame later; both can land inside
 * that window of time. That is why the cursor appeared with no keyboard, why
 * the two previous attempts each half-worked, and why the title behaved
 * differently from the notes on the same build — it was a race, not a
 * difference between single-line and multiline.
 *
 * In THIS Activity's window there is no grant to wait for: the window already
 * holds input focus before the editor renders into it. So the plain, ordinary
 * mechanism works, and that is what is used below.
 *
 * Six things about the way it is built are load-bearing:
 *
 * - **It is rendered outside `capture-recorded-scroll`**, by `RecordedState`
 *   rather than by `RecordedAffordances`. That is the whole of the fix for
 *   the first tap on SAVE — see the comments at both ends. Moving the editor
 *   into this window without moving it out of that scroll view would have
 *   kept the two-tap fault and made it harder to see.
 *
 * - **No `SafeAreaView` of its own, deliberately.** It needed one as a
 *   `Modal`, whose window sits outside the `SafeAreaView` `_layout.tsx` wraps
 *   every route in. An overlay is a child of `Screen`, inside that same safe
 *   area, so a second one would inset the scrim twice. One cosmetic
 *   consequence, recorded rather than worked around: a transparent `Modal`
 *   dimmed the display edge to edge, and this dims the safe area only, so the
 *   status- and navigation-bar strips stay undimmed. Nothing of the record is
 *   behind those strips — `_layout.tsx`'s `SafeAreaView` paints them
 *   `surface` — so nothing shows through and nothing there is pressable;
 *   covering them as well would mean hoisting this above that `SafeAreaView`,
 *   which is a change to every route and belongs to the design pass (#11),
 *   not to a keyboard fix.
 *
 * - **`autoFocus`, which is now the simplest thing that works.** Reported:
 *   "when the screen opens, the keyboard should already be open and the text
 *   box focused". In RN 0.86.3 `autoFocus` is a native prop and not a JS
 *   effect: `ReactEditText.onAttachedToWindow` calls
 *   `requestFocusProgrammatically()`, which is `requestFocus()` followed by an
 *   explicit `showSoftKeyboard()` — `inputMethodManager.showSoftInput(this, 0)`
 *   — rather than a focus that hopes to imply a keyboard. Attached into the
 *   Activity's already-focused window, that is exactly the right call at
 *   exactly the right moment. There is no imperative `focus()` here and no
 *   retry, because there is nothing left to retry against.
 *
 * - **Centred in the space the keyboard leaves, not pinned to the top.** The
 *   first shipped version anchored the card to the top, on the reasoning that
 *   a keyboard rising from the bottom could then never reach it. That was
 *   reported back: "it's a pain to shift from bottom of screen to top". She is
 *   holding the phone one-handed over a survey point, and the journey from the
 *   keys at the bottom to a box at the very top and back is the complaint. So
 *   the card is centred inside `KeyboardAvoidingView`'s content box, which is
 *   the region *above* the keyboard: with `behavior="padding"` that view
 *   carries a `paddingBottom` equal to the keyboard's height
 *   (`KeyboardAvoidingView.js`, the `'padding'` case), so the flexed child
 *   below it measures only the visible band. Where Android has resized the
 *   window instead — `adjustResize`, which `AndroidManifest.xml` sets on
 *   `MainActivity` and which now genuinely applies to this surface — that
 *   padding computes to zero (`frame.y + frame.height - keyboardY`, floored at
 *   0) and the centring lands in the same band anyway. Either way the input
 *   and its two controls travel together as one block; they are one flex
 *   child, never split across the fold.
 *
 * - **A bounded box.** `field.control` caps the height of the notes box, so a
 *   long note scrolls inside it rather than growing the card downwards into
 *   the keyboard — the inline layout's failure reproduced inside the fix.
 *
 * - **It claims the touch, so nothing behind it is pressable.** A `Modal` gave
 *   that for free by being a window. `onStartShouldSetResponder` on the scrim
 *   is the equivalent here: it is the BUBBLE phase, so the input and the two
 *   buttons inside still take their own touches first (only a `*Capture`
 *   handler would steal from them), and anything that reaches the scrim stops
 *   there rather than falling through to the column underneath.
 *
 * The scrim is what answers "the record's content should not be competing for
 * attention behind it": the same `overlay` token, at the same opacity, that
 * `HelpAffordance` already dims this application's screens with.
 */
function FieldEditor({
  kind,
  draft,
  saving,
  error,
  onChangeDraft,
  onSave,
  onCancel,
}: {
  kind: 'title' | 'description'
  draft: string
  saving: boolean
  error: string | null
  onChangeDraft: (text: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  const { theme } = useTheme()
  const label = kind === 'title' ? 'A name for this point' : 'Notes about this point'

  /**
   * The Android back button, which a `Modal` used to give for free through
   * `onRequestClose`. An overlay is not a window, so nothing intercepts BACK
   * unless this does — and without it BACK would pop the route, taking her off
   * the recorded point entirely while an editor was open over it.
   *
   * It returns `true` in both branches, which is the same shape `Modal` had:
   * BACK is consumed for as long as this surface is up, whether or not the
   * press is allowed to close it.
   *
   * The guard is the same one CANCEL carries, and for the same reason —
   * closing the editor takes the failure message with it, so a dismissal
   * accepted while `renameRecord` is still out could land a failure on a
   * surface that no longer exists. It is a guard and not a disabled control:
   * doctrine rule 3 is about something that LOOKS pressable and does nothing,
   * and a hardware key renders nothing to look at.
   *
   * `saving` and `onCancel` are in the dependency list rather than read
   * through a ref: a listener registered while `saving` was `false` would
   * otherwise go on believing that after the write started.
   */
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!saving) onCancel()
      return true
    })
    return () => {
      subscription.remove()
    }
  }, [saving, onCancel])

  return (
    /*
      THE SCRIM, AND THE SURFACE BOUNDARY.

      `StyleSheet.absoluteFill` rather than `flex: 1`: this is a sibling of the
      recorded column, not a replacement for it, so it has to be lifted out of
      that column's flow and laid over the top of it.

      `onStartShouldSetResponder` is what makes it a surface rather than a
      tint. Returning `true` claims any touch that reaches the scrim, so a tap
      on the dimmed column below does nothing at all — React Native does not
      re-hit-test siblings underneath once a node has been hit, and a node that
      claims nothing would simply drop the touch, which is the same outcome by
      accident rather than on purpose. Stating it is what makes it assertable.
      It is the bubble phase, so the box and the two buttons inside claim their
      own touches first.

      `accessibilityViewIsModal` is the iOS half of hiding what is behind, and
      is honestly iOS-only here — it is in `BaseViewConfig.ios.js`, absent from
      `BaseViewConfig.android.js`, and unimplemented anywhere under
      `ReactAndroid/` in RN 0.86.3. The Android half is
      `importantForAccessibility="no-hide-descendants"` on the scroll view, plus
      `RecordedState` withdrawing the screen's own spoken description; both are
      commented where they are.
    */
    <View
      testID="capture-editor-overlay"
      accessibilityViewIsModal
      onStartShouldSetResponder={() => true}
      style={[StyleSheet.absoluteFill, { backgroundColor: `${theme.colors.overlay}CC` }]}
    >
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        {/*
          `flex: 1` so this fills whatever height `KeyboardAvoidingView`
          leaves once the keyboard is accounted for, and `justifyContent:
          'center'` so the card sits in the middle of it rather than at
          either edge. Both are required: without the flex there is no box
          to centre in, and the card collapses back to the top.
        */}
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg }}>
          <View
            testID="capture-editor"
            style={{
              gap: spacing.md,
              padding: spacing.lg,
              borderRadius: radii.xl,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surfaceRaised,
            }}
          >
            {/*
                Doctrine rule 16, the same shape `Screen` uses for a route:
                present for a screen reader, invisible and out of flow for
                everyone else. `Screen` itself is not reused here — it is a
                flex-grown, padded page container, and this is a card.
              */}
            <View
              testID="capture-editor-spoken-description"
              accessible
              accessibilityRole="header"
              accessibilityLabel={describeEditor(kind, saving, error)}
              style={styles.spokenDescription}
            />

            <Type variant="heading">
              {kind === 'title' ? 'Name this point' : 'Notes for this point'}
            </Type>

            {/*
                `autoFocus`, AND IT IS THE WHOLE OF THE FOCUS MECHANISM — no
                imperative `focus()`, no retry a frame later. Both of those
                were attempts to beat a race that only existed because the
                editor was in a dialog window that did not yet hold IME focus
                (see the note on this component). In the Activity's own window
                there is no race: `ReactEditText.onAttachedToWindow` calls
                `requestFocusProgrammatically()`, which is `requestFocus()`
                followed by an explicit `showSoftKeyboard()`, and the window it
                attaches into already holds input focus.

                Adding an imperative `focus()` back alongside this would be
                worse than useless: the native focus event sets
                `TextInputState.currentlyFocusedInputRef`, and `focusTextInput`
                returns early for a field that is already the current one — so
                the second call would be the no-op, not this.
              */}
            <TextInput
              autoFocus
              testID={kind === 'title' ? 'capture-title-input' : 'capture-description-input'}
              accessibilityLabel={label}
              value={draft}
              onChangeText={onChangeDraft}
              placeholder={label}
              placeholderTextColor={theme.colors.textDim}
              multiline={kind === 'description'}
              style={{
                minHeight: kind === 'description' ? field.control : touch.min,
                // See the note on the component: bounded so a long note
                // scrolls rather than growing the card into the keyboard.
                maxHeight: field.control,
                borderRadius: radii.md,
                borderWidth: 2,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface,
                color: theme.colors.textPrimary,
                paddingHorizontal: spacing.md,
              }}
            />

            {/*
                THE FAILURE, ON THE EDITING SURFACE. It used to render at the
                foot of the recorded column; left there it would be behind the
                scrim, unreadable, while the surface she is actually looking
                at said nothing at all. A failed save keeps the editor open
                with her text still in it, so this is both where she is
                looking and where the retry is.
              */}
            {error === null ? null : (
              <Type variant="small" testID={`capture-${kind}-error`}>
                {error}
              </Type>
            )}

            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button
                testID={kind === 'title' ? 'capture-title-save' : 'capture-description-save'}
                label={saving ? 'SAVING…' : kind === 'title' ? 'SAVE NAME' : 'SAVE NOTES'}
                spokenLabel={
                  kind === 'title'
                    ? 'Save this name onto the point'
                    : 'Save these notes onto the point'
                }
                disabled={saving}
                onPress={onSave}
              />
              {/*
                  Genuinely disabled mid-write, not inert (doctrine rule 3).
                  It is disabled at all — rather than left live — because
                  closing the editor takes the failure message with it, and a
                  cancel accepted while the write is still out could land that
                  failure on a surface that no longer exists.
                */}
              <Button
                testID="capture-editor-cancel"
                label="CANCEL"
                spokenLabel="Close without saving"
                kind="secondary"
                disabled={saving}
                onPress={onCancel}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  )
}

const styles = StyleSheet.create({
  // Mirrors `Screen`'s own hidden description node: 1x1 rather than 0x0
  // because some accessibility services skip zero-size nodes entirely.
  spokenDescription: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
})
