import React, { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, TextInput, View, type ViewStyle } from 'react-native'
import { useRouter } from 'expo-router'
import {
  createExpoLocationSource,
  distanceMetres,
  gradeAccuracy,
  isProbableDuplicate,
  type Coordinate,
  type HoldVerdict,
  type LocationSource,
} from '@corymbia/geo'
import { radii, spacing, touch } from '@corymbia/tokens'
import {
  Button,
  CaptureDial,
  CORNER_BLOCK_MAX_W,
  HelpAffordance,
  INPUT_AFFORDANCE_ORDER,
  Screen,
  Type,
  isLocked,
  radiusForMetres,
  resolveReach,
  useLayout,
  useTheme,
  type FixGradeName,
  type InputAffordanceKind,
} from '@corymbia/ui'
import { renameRecord, type Database, type FieldRecord, type StoredFix } from '@corymbia/data'
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
  return fix.sampleCount === 1 ? '1 reading averaged' : `${String(fix.sampleCount)} readings averaged`
}

/**
 * The four affordances of spec §9.6 — location (already complete), title, voice
 * note, photo — in the order that section pins them.
 *
 * The last three come from `INPUT_AFFORDANCE_ORDER`, the constant
 * `InputAffordanceRow` itself renders from, rather than being written out
 * again here. Doctrine rule 5's "identically everywhere, in the same order" is
 * a claim about the whole application, and a second literal list is precisely
 * how such a claim stops being true.
 *
 * `'description'` is filtered out because §9.6 does not count it among the
 * four: the row's fourth entry is notes, and this screen's is the location —
 * which is not an input at all here but the fix the capture has already made,
 * shown complete. That divergence is real and is worth knowing about before
 * changing either list.
 */
type RecordedAffordanceKind = 'location' | Exclude<InputAffordanceKind, 'description'>

function offeredHere(kind: InputAffordanceKind): kind is Exclude<InputAffordanceKind, 'description'> {
  return kind !== 'description'
}

const RECORDED_AFFORDANCES: RecordedAffordanceKind[] = [
  'location',
  ...INPUT_AFFORDANCE_ORDER.filter(offeredHere),
]

/** The glyph and the words for each, matching `InputAffordanceRow`'s exactly. */
const AFFORDANCE_FACE: Record<RecordedAffordanceKind, { glyph: string; label: string }> = {
  location: { glyph: '◎', label: 'Location' },
  title: { glyph: '✏️', label: 'Title' },
  voice: { glyph: '🎙️', label: 'Voice' },
  photo: { glyph: '📷', label: 'Photo' },
}

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
   */
  const sourceRef = useRef<LocationSource | null>(null)
  const source: LocationSource = (sourceRef.current ??= createExpoLocationSource())

  const capture = useCapture({ db, device, source })
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
      <Screen spokenDescription="Acquiring a fix. The reading is already saved and is being refined while you stand still. The accuracy and the seconds remaining, how much sharper the fix is than the tap, how far apart the readings are, and a control that accepts what has accumulated and ends the wait.">
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
    <Screen spokenDescription="Capture. The live position and its accuracy, and one control that records the fix immediately and then counts down while you stand still and sharpens the record.">
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
          — there is no hover in a paddock. It lives in the ready state and only
          there. `acquiring` is exempt by rule 17, which requires that nothing
          else is on screen while she stands still. `recorded` does ask one
          thing of her — a name — but asks it with a labelled text box whose
          placeholder says what to type, so there is nothing a `?` beside it
          would explain; the moment that state asks for something whose meaning
          is not on its face, filing to an activity or attaching media, it
          takes a help affordance with it. Both exemptions are written down in
          `docs/ui-doctrine.md` so their absence reads as a decision rather than
          as an oversight.
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
 * One of the four affordances of spec §9.6, in three states.
 *
 * ## Why this is not `InputAffordanceRow`
 *
 * It should be, and it will be. `InputAffordanceRow` (`@corymbia/ui`) is the
 * component that owns doctrine rule 5 — one visual signature per input kind,
 * used identically everywhere — and this screen deliberately borrows its
 * glyphs, its wording, its dashed-versus-solid border and its `affordance-*`
 * test handles rather than inventing a second look.
 *
 * What it does not yet have is an *unavailable* state, and this screen has two
 * of them: there is no media table in `@corymbia/data`, so a voice note and a
 * photo have nowhere to be stored. Present-and-disabled is the honest way to
 * show that (doctrine rule 3: every level of disclosure is a legitimate
 * stopping point, and a level that is not built must not pretend otherwise) —
 * a tile that looked live and did nothing would be worse than no tile.
 *
 * **PLAN 4 (media) attaches here.** When photo and voice capture land, the
 * right change is to teach `InputAffordanceRow` the disabled state — or to
 * find it no longer needs one — and replace this row with that component,
 * rather than to grow a third variant of the same four tiles. `location` stays
 * this screen's own: it is not an input, it is the fix the capture already
 * made, shown complete.
 */
function AffordanceTile({
  kind,
  state,
  spokenLabel,
  onPress,
}: {
  kind: RecordedAffordanceKind
  state: 'done' | 'available' | 'unavailable'
  spokenLabel: string
  onPress?: () => void
}) {
  const { theme } = useTheme()
  const face = AFFORDANCE_FACE[kind]
  const testID = `affordance-${kind}`

  // Doctrine rule 9: the state is carried by the border style AND by the
  // words, never by colour alone — the same two channels `InputAffordanceRow`
  // uses, so a colour-vision-deficient user, or anyone in direct sunlight,
  // reads it the same way.
  const label =
    state === 'done' ? `${face.label} ✓` : state === 'unavailable' ? `${face.label} · later` : face.label

  const style: ViewStyle = {
    flex: 1,
    minHeight: touch.comfortable,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 2,
    borderStyle: state === 'done' ? 'solid' : 'dashed',
    borderColor: state === 'done' ? theme.colors.accent : theme.colors.border,
    backgroundColor: theme.colors.surfaceRaised,
    paddingVertical: spacing.sm,
    opacity: state === 'unavailable' ? 0.45 : 1,
  }

  const faceContent = (
    <>
      <Type variant="heading">{face.glyph}</Type>
      <Type variant="label" dim testID={`${testID}-label`}>
        {label}
      </Type>
    </>
  )

  // A statement rather than a control. The location is already recorded, so
  // there is nothing to press and no `accessibilityRole="button"` to claim.
  if (onPress === undefined && state === 'done') {
    return (
      <View testID={testID} accessible accessibilityLabel={spokenLabel} style={style}>
        {faceContent}
      </View>
    )
  }

  // Deliberately no `onPress` in the unavailable case — not an empty handler.
  // There is nothing for it to call, and a stub is how a screen ends up with a
  // control that silently does nothing once someone removes the `disabled`.
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={spokenLabel}
      accessibilityState={{ disabled: state === 'unavailable', selected: state === 'done' }}
      disabled={state === 'unavailable'}
      onPress={onPress}
      style={style}
    >
      {faceContent}
    </Pressable>
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

  return (
    <Screen spokenDescription="A survey point has been recorded and its position is final. Where the capture got to, its capture number, final accuracy and how the wait ended, a name you can give it, and the ways onward: take another reading, or leave.">
      {/*
        This state scrolls for the same reason the acquiring one does: rotation
        is unlocked, a phone in landscape has roughly 360dp of height, and this
        state carries considerably more than the acquiring one — a state that
        put its two ways onward below the fold would be a dead end on a device
        in a paddock.
      */}
      <ScrollView
        testID="capture-recorded-scroll"
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
            <RecordedAffordances record={record} db={db} deviceId={deviceId} />
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
 * The four affordances, and the one of them that is real.
 *
 * Spec §9.6 requires all four to be present, in the same order, everywhere in
 * the application — which is why voice and photo are rendered at all when
 * neither can do anything. `renameRecord` is the whole of what Plan 3
 * completes here: it is the only setter for a record's title, and it writes
 * the change through the same append-only event log as everything else that
 * happens to a record (spec §8.5), because a title is part of the observation
 * rather than incidental metadata.
 */
function RecordedAffordances({
  record,
  db,
  deviceId,
}: {
  record: FieldRecord
  db: Database
  deviceId: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(record.title ?? '')
  const [title, setTitle] = useState<string | null>(record.title)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { theme } = useTheme()

  /**
   * Guards the two `setState`s that follow the write. She can leave the screen,
   * or take another reading, while `renameRecord` is still in a transaction,
   * and nothing may write into a component that has gone.
   */
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  async function save(): Promise<void> {
    const trimmed = draft.trim()
    // An empty box is a cleared name, which `renameRecord` models explicitly as
    // `title: null` — not as an empty string, which would be a name made of no
    // characters.
    const next = trimmed.length === 0 ? null : trimmed
    setSaving(true)
    setError(null)
    try {
      const renamed = await renameRecord(db, { recordId: record.id, title: next, deviceId })
      if (!mounted.current) return
      setTitle(renamed.title)
      setEditing(false)
    } catch (caught) {
      if (!mounted.current) return
      setError(
        `The name was not saved: ${caught instanceof Error ? caught.message : String(caught)}. ` +
          'The point itself is safe.',
      )
    } finally {
      if (mounted.current) setSaving(false)
    }
  }

  return (
    <View style={{ gap: spacing.sm }}>
      <Type variant="label" dim>
        ADD TO THIS POINT
      </Type>

      <View testID="capture-affordances" style={{ flexDirection: 'row', gap: spacing.sm }}>
        {RECORDED_AFFORDANCES.map((kind) => {
          if (kind === 'location') {
            return (
              <AffordanceTile
                key={kind}
                kind={kind}
                state="done"
                spokenLabel="Location, already recorded"
              />
            )
          }
          if (kind === 'title') {
            return (
              <AffordanceTile
                key={kind}
                kind={kind}
                state={title === null ? 'available' : 'done'}
                spokenLabel={title === null ? 'Add a title' : 'Change the title'}
                onPress={() => {
                  setDraft(title ?? '')
                  setEditing(true)
                }}
              />
            )
          }
          return (
            <AffordanceTile
              key={kind}
              kind={kind}
              state="unavailable"
              spokenLabel={`${AFFORDANCE_FACE[kind].label} — not available until media capture is built`}
            />
          )
        })}
      </View>

      <Type variant="small" dim testID="capture-media-pending">
        Voice notes and photos arrive with media capture. The point is a complete record without
        them.
      </Type>

      {title === null ? null : (
        <Type variant="body" testID="capture-title-value">
          {title}
        </Type>
      )}

      {editing ? (
        <View style={{ gap: spacing.sm }}>
          <TextInput
            testID="capture-title-input"
            accessibilityLabel="A name for this point"
            value={draft}
            onChangeText={setDraft}
            placeholder="A name for this point"
            placeholderTextColor={theme.colors.textDim}
            autoFocus
            style={{
              minHeight: touch.min,
              borderRadius: radii.md,
              borderWidth: 2,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surfaceRaised,
              color: theme.colors.textPrimary,
              paddingHorizontal: spacing.md,
            }}
          />
          <Button
            testID="capture-title-save"
            label={saving ? 'SAVING…' : 'SAVE NAME'}
            spokenLabel="Save this name onto the point"
            disabled={saving}
            onPress={() => {
              void save()
            }}
          />
        </View>
      ) : null}

      {error === null ? null : (
        <Type variant="small" testID="capture-title-error">
          {error}
        </Type>
      )}
    </View>
  )
}
