import { useEffect, useRef, useState } from 'react'
import {
  averageReadings,
  holdVerdict,
  type HoldVerdict,
  type LocationSource,
  type PermissionState,
  type Reading,
} from '@corymbia/geo'
import {
  createRecord,
  nowIso,
  refineRecordFix,
  sampleEvidence,
  type AltitudeEvidence,
  type Database,
  type Device,
  type FieldRecord,
  type Fix,
} from '@corymbia/data'

/**
 * The capture interaction, as a hook — one tap records a point, and a countdown
 * then sharpens the row that is already on disk (spec §9.1).
 *
 * **This is a lift, not a design.** Every rule below was found the hard way on
 * `app/diagnostics.tsx`, which ran this behaviour outdoors on real hardware and
 * is the source it was taken from. The instrument keeps its own copy — its
 * countdown chooser, its transcript and its reading log have no place on a
 * field screen — and the two converge in a later plan. Where the two differ,
 * `diagnostics.tsx` is the one that has been outdoors; read it before changing
 * anything here.
 *
 * What the screen gets out of the split is that the state machine can be tested
 * without rendering a tree: the number of records one tap writes, the number of
 * refinements one countdown performs, and what happens to the timers when it
 * goes away are all assertable directly. The diagnostics tests have to drive a
 * whole component to reach the same guards.
 */

/**
 * The three states a capture screen is ever in (doctrine rule 1: one job per
 * screen, one obvious primary action).
 *
 *  - `ready` — nothing has been captured, or the last one has been dismissed.
 *  - `acquiring` — from the tap until the countdown ends. The row exists on
 *    disk for all of it.
 *  - `recorded` — the point is final; nothing will change its position again.
 */
export type CapturePhase = 'ready' | 'acquiring' | 'recorded'

/**
 * What the countdown would store if it were accepted right now.
 *
 * The screen shows this rather than the latest single reading, because it is
 * the number the override would actually write: watching a live reading bounce
 * between 4 m and 9 m says nothing about whether the accumulated average is
 * getting better, which is the only question the countdown asks.
 */
export type CapturePreview = {
  accuracyM: number
  sampleCount: number
  /**
   * How much sharper the accumulated fix is than the one the tap wrote, in
   * metres.
   *
   * **Signed on purpose.** A countdown that made the fix *worse* is one of the
   * more useful things this interaction can report, and a number that only ever
   * grew would hide it. Zero when the tap found no position at all: there is no
   * baseline to have improved on, and inventing one would be a claim about a
   * measurement that was never taken.
   *
   * **In practice this never goes negative against the current
   * `averageReadings`.** The tap's own reading is always sample one of the
   * countdown's buffer, and inverse-variance weighting is monotonic in the
   * number of samples — adding a reading can only raise the combined weight
   * (never lower it) and can only lower `best` (never raise it), so the
   * combined accuracy this preview reports cannot exceed what the tap alone
   * produced, however poor the readings that follow are (verified directly
   * against `averageReadings`, not assumed). The field is still signed rather
   * than clamped: it is the honest shape for a number defined as a
   * difference, and clamping it would assert a floor that is a property of
   * today's averaging strategy rather than of what this field means.
   */
  improvedByM: number
  /**
   * How far apart the readings are — the greatest distance from any collected
   * reading to the averaged position, in metres. Null for a single reading,
   * which has no disagreement to report.
   *
   * **This is the honesty check on `improvedByM`, and the screen shows the two
   * together (spec §9.3).** The improvement can only ever improve, so a
   * capture that went badly and one that went well produce the same shape of
   * number. The spread does not: it genuinely worsens when she moved, the sky
   * closed in, or the receiver wandered between readings. A tight spread with
   * a good accuracy is a fix to trust; a good accuracy with a wide spread is
   * the case the accuracy alone would quietly hide.
   *
   * Null rather than zero at one sample, for the same reason
   * `buildDeliberateFix` nulls it on the stored record (migration 003's
   * `record_spread_matches_sample_count`): a single reading has nothing to
   * disagree with, which is not the same claim as perfect agreement.
   */
  spreadM: number | null
}

export type CaptureDeps = {
  db: Database
  device: Device
  /**
   * **Must be referentially stable across renders** — a `useRef(...).current`
   * or module-level singleton, never an object literal constructed inline in
   * the caller's render. It is listed as an effect dependency (see the
   * permission/subscription effect below), so a new identity on every render
   * re-requests permission and resubscribes on every render: four times a
   * second during a countdown, since a reading arrives roughly that often and
   * every one re-renders the caller. `diagnostics.tsx`, the instrument this
   * hook was lifted from, carries the same requirement on its own `source`.
   */
  source: LocationSource
  /**
   * The countdown length, in seconds. **A cap, not an expected duration** — the
   * normal way a countdown ends is the plateau signal, which on the measured
   * Samsung S25 run lands about twelve seconds after the tap. This is the
   * safety net for a run where the signal never settles.
   */
  capSeconds?: number
}

export type Capture = {
  phase: CapturePhase
  /** The live reading, or null before the receiver has produced one. */
  latest: Reading | null
  /** What the override would store, or null when no countdown is running. */
  preview: CapturePreview | null
  secondsRemaining: number
  secondsTotal: number
  verdict: HoldVerdict
  /** The row on disk: the tap's, then the refinement's. Null before the first tap. */
  record: FieldRecord | null
  /** The one sentence explaining something the numbers cannot. Null when there is nothing to say. */
  message: string | null
  /** One tap: record the fix now, and start the countdown. */
  capture(): void
  /** End the countdown early and keep what has accumulated. */
  acceptNow(): void
  /** Dismiss a finished capture and go back to ready. */
  again(): void
}

/**
 * The default cap. Fifteen seconds is generous enough that the plateau signal,
 * not the timer, ends almost every capture on the hardware this was measured
 * on, while still being a wait she will tolerate if the signal never settles.
 * See `diagnostics.tsx`'s `COUNTDOWN_CHOICES` for the stored records that
 * settled it.
 */
const DEFAULT_CAP_S = 15

/** How often the countdown readout re-renders. Four times a second reads as smooth without busying the thread. */
const TICK_MS = 250

/**
 * Conditions that apply to every position this device reports (spec §7.5).
 * `accuracyConvention` is stored because it cannot be recovered from the number
 * alone: Android's accuracy is the 68% confidence radius rather than a maximum
 * error. `provider` is left null — expo-location does not expose which provider
 * produced a reading.
 */
const CONDITIONS = { accuracyConvention: 'radius68', provider: null } as const

/**
 * Pairs an altitude with the frame it was measured against, or nulls both
 * together (spec §7.5; migration 003's `record_altitude_has_reference`).
 * Android reports height above the WGS84 ellipsoid, several metres different
 * from mean sea level in Victoria, so the reference cannot be recovered from
 * the number alone.
 */
function altitudeEvidence(altitudeM: number | null): AltitudeEvidence {
  return altitudeM === null
    ? { altitudeM: null, altitudeReference: null }
    : { altitudeM, altitudeReference: 'wgs84Ellipsoid' }
}

/** Turns any thrown value into the one sentence the message area can show. */
function describeFailure(what: string, error: unknown): string {
  return `${what}: ${error instanceof Error ? error.message : String(error)}`
}

/**
 * The result of trying to turn a set of readings into a storable fix: either
 * the fix, or the one sentence explaining why there is not one. A union rather
 * than a nullable return, because every failure here has a different cause and
 * "it did nothing" is the outcome this shape exists to make impossible.
 */
type FixAttempt = { ok: true; fix: Fix } | { ok: false; message: string }

/**
 * Averages readings into a deliberate fix, or says why it cannot.
 *
 * Both halves of the capture use this: the tap averages the single reading on
 * screen, and the countdown averages everything collected since. A single
 * reading through `averageReadings` is a no-op on the numbers — with one
 * reading the inverse-variance combination is exactly that reading's own
 * accuracy — so the two paths cannot drift on provenance, the mocked verdict,
 * or the accuracy floor merely because one of them took a short cut.
 */
function buildDeliberateFix(samples: Reading[]): FixAttempt {
  if (samples.length === 0) {
    return { ok: false, message: 'No readings to average — is the GPS permission granted?' }
  }

  // `averageReadings` throws when every sample carries an unusable accuracy
  // (the device adapter maps a missing platform accuracy to Infinity, so a
  // device that declines to report accuracy hits exactly this). Unguarded that
  // is an unhandled rejection and a screen that silently does nothing.
  let averaged: ReturnType<typeof averageReadings>
  try {
    averaged = averageReadings(samples)
  } catch (error) {
    return { ok: false, message: describeFailure('Could not average the readings', error) }
  }

  // A fix that cannot show it was not spoofed is not evidence (spec §7.5).
  // Rather than defaulting an unreported mock status to "false" — the exact
  // claim nobody made — refuse to store a position and say so.
  if (averaged.isMocked === 'notReported') {
    return {
      ok: false,
      message: 'Cannot store a position — this platform never reported whether it is mocked.',
    }
  }

  // Indexed access under `noUncheckedIndexedAccess`, discharged by a check
  // rather than by a cast: `samples.length > 0` is known above, but the type
  // system cannot carry that to the subscript, and the honest way to satisfy it
  // is to handle the case it is worried about.
  const first = samples[0]
  const last = samples[samples.length - 1]
  if (!first || !last) {
    return { ok: false, message: 'The reading buffer emptied mid-save; nothing was written.' }
  }

  // `averageReadings` always returns a `spreadM` number (0 for a single
  // reading), but migration 003's `record_spread_matches_sample_count` requires
  // it to be NULL exactly when `sampleCount` is 1 — a single reading has no
  // disagreement to report, not a disagreement of zero. `sampleEvidence()` is
  // what turns that mismatch into a message here rather than a SQLITE_CONSTRAINT
  // failure mid-save.
  const evidence = sampleEvidence(
    averaged.sampleCount,
    averaged.sampleCount === 1 ? null : averaged.spreadM,
  )

  return {
    ok: true,
    fix: {
      quality: 'deliberate',
      latitude: averaged.latitude,
      longitude: averaged.longitude,
      accuracyM: averaged.accuracyM,
      datum: 'WGS84',
      verticalAccuracyM: averaged.verticalAccuracyM,
      isMocked: averaged.isMocked === 'mocked',
      // The satellite clock reading of this fix (spec §7.4), taken from the
      // last sample that went into the average.
      gpsTime: nowIso(new Date(last.timestampMs)),
      ...CONDITIONS,
      ...altitudeEvidence(averaged.altitudeM),
      ...evidence,
      holdMs: samples.length > 1 ? last.timestampMs - first.timestampMs : 0,
    },
  }
}

/**
 * A capture that has already been saved and is now being sharpened.
 *
 * `recordId` is the row on disk. That is the whole point of the model: the
 * record exists from the tap onward, so the app dying, the battery going or her
 * walking away costs the refinement, never the capture.
 */
type Countdown = {
  recordId: string
  /**
   * The accuracy the tap wrote, or null when it found no position — the
   * baseline `improvedByM` is measured against.
   */
  startAccuracyM: number | null
  endsAtMs: number
}

/** Why a countdown ended. All three write the same refinement; only the words differ. */
type FinishReason = 'countdown' | 'override' | 'plateau'

const FINISH_WORDS: Record<FinishReason, string> = {
  countdown: 'The countdown ran out.',
  override: 'You accepted it early.',
  plateau: 'The fix stopped improving, so the countdown finished itself.',
}

export function useCapture(deps: CaptureDeps): Capture {
  const { db, device, source } = deps
  const secondsTotal = deps.capSeconds ?? DEFAULT_CAP_S

  const [phase, setPhase] = useState<CapturePhase>('ready')
  const [latest, setLatest] = useState<Reading | null>(null)
  const [countdown, setCountdownState] = useState<Countdown | null>(null)
  const [record, setRecord] = useState<FieldRecord | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  // Re-render clock. `collected` is a ref, so the readout would otherwise only
  // move when a new reading happened to arrive; the seconds remaining have to
  // fall whether or not the receiver is talking.
  const [tickMs, setTickMs] = useState(() => Date.now())

  /**
   * The samples this countdown will average. A ref rather than state: a reading
   * arrives roughly every second and the buffer is read at render time, so
   * making it state would add a second re-render per reading and buy nothing.
   */
  const collected = useRef<Reading[]>([])
  /**
   * Whether readings should be collected. Mirrors the countdown for the
   * subscription callback's benefit: that callback is created once, when the
   * subscription effect runs, so it closes over whatever the state was AT THAT
   * MOMENT — permanently the initial value — rather than the current one.
   * Reading a ref reads the live value on every reading, which is the entire
   * point of a countdown.
   */
  const collecting = useRef(false)

  /**
   * Guards every `setState` that follows an `await`. The hook can be unmounted
   * while an insert or an update is in flight, and nothing may write into a
   * hook that no longer exists.
   */
  const mounted = useRef(true)

  /**
   * Mirrors `countdown`, and is what actually decides whether one is still
   * running. Three things can finish a countdown — the timer, her hand on the
   * override, and the plateau signal — and `setCountdownState(null)` does not
   * take effect until the next render, so a state read would let two of them
   * run and refine the same record twice. Claiming the ref is synchronous, so
   * exactly one of them wins.
   */
  const countdownRef = useRef<Countdown | null>(null)

  /**
   * Whether a write is already in flight.
   *
   * **This is the guard, and it must be claimed synchronously.** `countdownRef`
   * cannot do this job: it is not set until after the insert has resolved, and
   * over that whole window — which on the diagnostics screen also spanned
   * creating a project and an activity — a second tap passed every guard and
   * ran a whole second capture. Both reached the countdown and the later one
   * won, leaving the first record on disk with one sample, no spread and a
   * zero-length hold: a row indistinguishable from "the countdown produced no
   * improvement", which is the exact measurement this interaction exists to
   * make. It would have been believed.
   *
   * Claimed before the first `await` exists, and released on every exit path
   * including the ones that throw.
   */
  const writeInFlight = useRef(false)

  /**
   * Bumped by anything that makes an in-flight write's result stale, and
   * checked by every `setState` that follows an `await`.
   *
   * The reachable case is `again()` during a slow refinement: the phase is back
   * at `ready` and the previous capture has been dismissed, and the update
   * resolving afterwards must not put its record and its sentence back on a
   * screen that has moved on. `mounted` does not cover that — the hook is very
   * much still mounted.
   */
  const generation = useRef(0)

  /**
   * The verdict as it stood at the instant the last countdown ended, so the
   * `recorded` phase can report it honestly instead of the render-time
   * default (see `verdict` below). Set once, in `finishCountdown`, from
   * whatever `collected` held right before it was cleared; irrelevant outside
   * the `recorded` phase, where `verdict` never reads it.
   */
  const finishedVerdict = useRef<HoldVerdict>('improving')

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // A write in flight when the hook goes away must not leave the claim set,
      // and a subscription that outlives this teardown (the source belongs to
      // the caller) must not go on filling a buffer nobody is watching.
      writeInFlight.current = false
      countdownRef.current = null
      collecting.current = false
      collected.current = []
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let stop: (() => void) | undefined

    void (async () => {
      let state: PermissionState
      try {
        state = await source.requestPermission()
      } catch (error) {
        if (!cancelled && mounted.current) {
          setMessage(describeFailure('Could not ask for the location permission', error))
        }
        return
      }
      if (cancelled) return
      if (state !== 'granted') {
        if (mounted.current) {
          setMessage('Location permission is not granted, so there is no position to record.')
        }
        return
      }

      // A rejecting `watch` is as real as a rejecting `requestPermission` —
      // both are calls onto the platform location API — and un-guarded it is
      // an unhandled rejection plus a screen where `latest` stays null
      // forever with nothing on screen to say why. Capture still writes a
      // `'none'` row on a tap (doctrine rule 4), so nothing is lost; she is
      // just owed the reason no position ever shows up.
      let unsubscribe: () => void
      try {
        unsubscribe = await source.watch((reading) => {
          if (collecting.current) collected.current.push(reading)
          setLatest(reading)
        })
      } catch (error) {
        if (!cancelled && mounted.current) {
          setMessage(describeFailure('Could not start watching the position', error))
        }
        return
      }

      // The hook could have been unmounted while `requestPermission`/`watch`
      // was still in flight — `stop` would not exist yet for the cleanup below
      // to call, and this subscription would keep running against a dead hook.
      if (cancelled) {
        unsubscribe()
        return
      }
      stop = unsubscribe
    })()

    return () => {
      cancelled = true
      stop?.()
    }
  }, [source])

  function beginCountdown(next: Countdown) {
    countdownRef.current = next
    setCountdownState(next)
  }

  /**
   * One tap. The fix on screen becomes a record on disk immediately, and the
   * countdown starts.
   *
   * The record is real from this moment — not a draft held in memory waiting
   * for a hold to end. If the app dies, the battery goes, or she simply walks
   * away, the capture survives with the fix it had; only the sharpening is
   * lost.
   *
   * Collection begins before the first `await`, so the samples the countdown
   * averages start at the tap rather than at whenever the insert happened to
   * finish.
   */
  async function captureNow(): Promise<void> {
    // The in-flight claim first, and it is the guard that matters — see
    // `writeInFlight` for why a countdown test alone let a double-tap through
    // and what the phantom record it produced looked like. Claimed
    // synchronously, before the first `await` exists, so a second tap anywhere
    // in the window returns here.
    if (writeInFlight.current || countdownRef.current !== null) return
    writeInFlight.current = true

    const startedAtMs = Date.now()
    const endsAtMs = startedAtMs + secondsTotal * 1000
    const generationAtTap = ++generation.current

    // The previous capture belongs to the previous capture, and the screen
    // enters its single-focus acquiring view from the tap itself rather than
    // from whenever the insert comes back.
    setRecord(null)
    setMessage(null)
    setPhase('acquiring')

    const tapReading = latest
    collected.current = tapReading ? [tapReading] : []
    collecting.current = true

    // Doctrine rule 4: nothing blocks capture, including the absence of a
    // storable fix. The tap ALWAYS writes a row — a real capture, at a real
    // time — and where the reading on screen cannot become a position the row
    // says `'none'` and the message says why. The countdown that follows may
    // still give the record a real fix once the receiver starts reporting one.
    //
    // `buildDeliberateFix` is asked even when there is no reading at all,
    // rather than the empty case being short-circuited: it is the one place
    // that knows the sentence for each way a fix can fail to exist, so EVERY
    // `'none'` row leaves here with a reason attached.
    //
    // Called inside this try, not before it: `buildDeliberateFix` can itself
    // throw synchronously (`sampleEvidence`'s preconditions, `nowIso` on an
    // out-of-range timestamp from a misbehaving provider), and `writeInFlight`
    // is claimed above with no other release path on this line. Outside the
    // try that throw left the claim set for the rest of the session — every
    // later tap refused, silently, with `countdownRef` still null so there was
    // no way out short of leaving the screen.
    let created: FieldRecord
    let unstorable: string | null
    try {
      const attempt = buildDeliberateFix(tapReading ? [tapReading] : [])
      const fix: Fix = attempt.ok ? attempt.fix : { quality: 'none' }
      unstorable = attempt.ok ? null : attempt.message

      created = await createRecord(db, {
        // The Inbox. This hook is handed a database, a device and a source and
        // nothing else, so it has no activity to file to and does not invent
        // one — filing is a supported destination, not an error state, and the
        // activity plumbing arrives with the screen that has one.
        activityId: null,
        kind: 'pin',
        fix,
        deviceId: device.id,
        // Why a `'none'` row has no position, written into the append-only
        // `'created'` event. The row itself cannot carry it —
        // `record_none_has_no_position` NULLs every positional column — and the
        // on-screen sentence is transient.
        detail: unstorable ?? undefined,
      })
    } catch (error) {
      abandonCapture(describeFailure('Save failed', error))
      return
    }

    // The hook may have gone away, or the capture been dismissed, while the
    // write was in flight. The teardown has already cleared the collection
    // state; only the in-flight claim is this function's to give back.
    if (!mounted.current || generationAtTap !== generation.current) {
      writeInFlight.current = false
      return
    }

    // The record is on disk from here, so the countdown starts from here.
    // Read the fix back off `created` rather than off the local `fix` above:
    // that variable is scoped to the try block that built and saved it, so it
    // cannot leak a stale value into this read the way a hoisted `let` could.
    beginCountdown({
      recordId: created.id,
      startAccuracyM: created.fix.quality === 'none' ? null : created.fix.accuracyM,
      endsAtMs,
    })
    setRecord(created)
    setTickMs(Date.now())
    if (unstorable !== null) {
      setMessage(`${unstorable} Standing still — the countdown can still give it a position.`)
    }
    writeInFlight.current = false
  }

  /**
   * Gives up a capture that failed before its countdown could start: the
   * collection stops, the claim is released, and the reason is said out loud.
   * Back to `ready`, not to `recorded` — nothing was recorded.
   */
  function abandonCapture(reason: string): void {
    collected.current = []
    collecting.current = false
    writeInFlight.current = false
    if (!mounted.current) return
    setPhase('ready')
    setMessage(reason)
  }

  /**
   * Ends the wait and writes the averaged fix over the record that is already
   * there — because the countdown ran out, because she accepted what had
   * accumulated, or because the fix stopped improving.
   *
   * All three are the same operation and differ only in the sentence reported,
   * which is the point: neither the override nor the plateau is an escape hatch
   * from the model, each is the model finishing early.
   */
  async function finishCountdown(reason: FinishReason): Promise<void> {
    const active = countdownRef.current
    if (active === null) return
    // The verdict as it stood the instant the wait ended — read before
    // `collected` is cleared below, and reported for the rest of the
    // `recorded` phase instead of the render-time default (see `verdict`
    // near the bottom of this hook). Without it a plateau finish reported
    // `'improving'` the moment `countdown` went null, contradicting the very
    // sentence `message` was about to carry.
    finishedVerdict.current = holdVerdict(collected.current)
    // Claimed synchronously, so the timer, the override and the plateau cannot
    // refine the same record more than once between them.
    countdownRef.current = null
    setCountdownState(null)
    collecting.current = false
    // The refinement is a write like the tap, so it takes the same claim.
    writeInFlight.current = true
    // The countdown is over from this instant, whatever the write does next:
    // nothing after this point will change the record's position again, and the
    // screen has to stop claiming otherwise even if the refinement fails.
    setPhase('recorded')
    try {
      await refineCapture(reason, active)
    } finally {
      writeInFlight.current = false
    }
  }

  /**
   * The refinement itself, split out only so `finishCountdown` can hold the
   * write claim across every one of the exits below with a single `finally`
   * rather than repeating the release at each `return`.
   *
   * A failure here leaves the record exactly as the tap saved it, and says so.
   * Averaging genuinely can fail, and "the capture is still there, just not
   * sharpened" is a materially different message from "the capture was lost".
   */
  async function refineCapture(reason: FinishReason, active: Countdown): Promise<void> {
    const generationAtFinish = generation.current
    const samples = [...collected.current]
    collected.current = []

    const attempt = buildDeliberateFix(samples)
    if (!attempt.ok) {
      if (!mounted.current || generationAtFinish !== generation.current) return
      setMessage(`${attempt.message} The record is saved with the fix it already had.`)
      return
    }

    let refined: FieldRecord
    try {
      refined = await refineRecordFix(db, {
        recordId: active.recordId,
        fix: attempt.fix,
        deviceId: device.id,
      })
    } catch (error) {
      if (!mounted.current || generationAtFinish !== generation.current) return
      setMessage(
        describeFailure('Refinement failed — the record keeps the fix it was saved with', error),
      )
      return
    }
    if (!mounted.current || generationAtFinish !== generation.current) return

    setRecord(refined)
    setMessage(FINISH_WORDS[reason])
  }

  // The latest `finishCountdown`, so the timer and the plateau effect below can
  // reach it without listing it as a dependency. It is redefined on every
  // render, and a timer that restarted whenever that happened would never fire:
  // a reading arrives roughly every second, and each one re-renders.
  const finishRef = useRef<(reason: FinishReason) => void>(() => undefined)
  useEffect(() => {
    finishRef.current = (reason) => {
      void finishCountdown(reason)
    }
  })

  // One timer for the completion, one for the readout. The completion is a
  // timeout rather than a comparison inside the tick, so a slow render or a
  // dropped tick cannot leave a finished countdown running. Both are torn down
  // by the cleanup, so no timer outlives the hook or the countdown that owns it.
  useEffect(() => {
    if (countdown === null) return
    const remainingMs = Math.max(0, countdown.endsAtMs - Date.now())
    const completion = setTimeout(() => {
      finishRef.current('countdown')
    }, remainingMs)
    const ticker = setInterval(() => {
      if (mounted.current) setTickMs(Date.now())
    }, TICK_MS)
    return () => {
      clearTimeout(completion)
      clearInterval(ticker)
    }
  }, [countdown])

  /**
   * What the override would store right now, and how much better it is than
   * what the tap wrote. Read from the ref at render time, like the verdict
   * below: the ticker and the arriving readings are what re-render, and this
   * reads whatever has been pushed by then.
   *
   * Null when there is nothing defensible to show — no countdown, no samples
   * yet, or none of them carrying a usable accuracy. That is a display, not a
   * save, so it reports absence rather than raising; the save path calls
   * `buildDeliberateFix` and gets the sentence.
   */
  let preview: CapturePreview | null = null
  if (countdown !== null && collected.current.length > 0) {
    try {
      const averaged = averageReadings(collected.current)
      preview = {
        accuracyM: averaged.accuracyM,
        sampleCount: averaged.sampleCount,
        improvedByM:
          countdown.startAccuracyM === null ? 0 : countdown.startAccuracyM - averaged.accuracyM,
        spreadM: averaged.sampleCount === 1 ? null : averaged.spreadM,
      }
    } catch {
      preview = null
    }
  }

  /**
   * Whether the fix has stopped getting better.
   *
   * `holdVerdict` is called, never reimplemented or second-guessed. Its
   * minimum-sample rule is what stops a capture ending 0.6 s after the tap with
   * a fix four times worse than waiting reaches — on the measured hardware it
   * fired at n=2, at ±5.2 m, where the wait reaches ±1.4 m. Its constants are
   * measured against that hardware; this hook has no opinion about them.
   *
   * In the `recorded` phase this reports `finishedVerdict.current` — the
   * verdict as it stood the instant the countdown ended — rather than
   * defaulting to `'improving'` purely because `countdown` is null once idle.
   * Without that, a capture that ended on a genuine plateau reported a verdict
   * that flatly contradicted `message`'s "the fix stopped improving" the
   * moment the countdown finished. Outside `recorded` (`ready`, or the brief
   * window between a tap and `beginCountdown`), `'improving'` is still the
   * honest answer: nothing has been judged yet.
   */
  const verdict: HoldVerdict =
    countdown !== null
      ? holdVerdict(collected.current)
      : phase === 'recorded'
        ? finishedVerdict.current
        : 'improving'

  /**
   * The countdown ends itself when the fix stops improving, which is the normal
   * way a capture finishes: she waits as long as the fix needs and no longer.
   *
   * Declared after the effect that refreshes `finishRef` (effects fire in
   * declaration order), so the function it calls is this render's rather than a
   * stale one. `finishCountdown` claims `countdownRef` synchronously, so this
   * cannot race the expiry timer or the override into a second refinement —
   * whichever arrives first wins and the others return at the top.
   */
  useEffect(() => {
    if (countdown === null || verdict !== 'plateaued') return
    finishRef.current('plateau')
  }, [countdown, verdict])

  const secondsRemaining =
    countdown === null ? 0 : Math.max(0, Math.ceil((countdown.endsAtMs - tickMs) / 1000))

  return {
    phase,
    latest,
    preview,
    secondsRemaining,
    secondsTotal,
    verdict,
    record,
    message,
    capture: () => {
      void captureNow()
    },
    acceptNow: () => {
      finishRef.current('override')
    },
    again: () => {
      // Refused while a countdown is running: dismissing a capture that is
      // still being sharpened would strand the refinement rather than cancel
      // it. A refinement already in flight is a different matter — the
      // generation bump is what stops its late result landing on a screen that
      // has moved on.
      if (countdownRef.current !== null) return
      generation.current += 1
      setPhase('ready')
      setRecord(null)
      setMessage(null)
    },
  }
}
