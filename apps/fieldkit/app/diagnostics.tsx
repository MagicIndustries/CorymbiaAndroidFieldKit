import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
import {
  createAmbientCache,
  createExpoLocationSource,
  averageReadings,
  gradeAccuracy,
  holdVerdict,
  isProbableDuplicate,
  type FixGrade,
  type HoldVerdict,
  type PermissionState,
  type Reading,
} from '@corymbia/geo'
import {
  createActivity,
  createProject,
  createRecord,
  listActivities,
  listProjects,
  listRecords,
  nowIso,
  refineRecordFix,
  sampleEvidence,
  type AltitudeEvidence,
  type Database,
  type Fix,
  type FieldRecord,
  type StoredFix,
} from '@corymbia/data'
import { field, radii, spacing } from '@corymbia/tokens'
import { Button, Card, Screen, Type, useTheme } from '@corymbia/ui'
import { useDatabase, useDatabaseStatus, useDevice, useSettings } from '../src/db/provider'

/**
 * The project and activity this screen owns, found by name.
 *
 * The screen must never write a test pin into a real survey. Deletion is soft
 * everywhere (spec §6), so a diagnostic pin planted in the activity she was
 * actually running is there permanently — it can be flagged deleted, never
 * removed, and it still carries a sequence number in her survey. Adopting
 * whatever `mostRecentActivity()` returned did exactly that from the moment
 * the first real survey existed.
 *
 * Names rather than fixed ids because ids are minted by `newId()`; a name is
 * the only handle a screen can look up in a database it did not create (a
 * reinstall, a restored backup, a device that has run this screen before).
 * Nothing else in the app creates a project called "Diagnostics", so the
 * lookup cannot collide with real data — and if the user ever does name a
 * survey that, the worst case is that this screen reuses it, which is the
 * same failure mode as typing the name into the capture screen by hand.
 */
const DIAGNOSTICS_PROJECT_NAME = 'Diagnostics'
const DIAGNOSTICS_ACTIVITY_NAME = 'Diagnostics run'

/**
 * The diagnostics activity if it already exists, and null otherwise —
 * deliberately creating nothing. An instrument that writes to the database
 * merely by being opened corrupts the very thing it is measuring, so the
 * on-arrival load uses this and shows an empty list rather than minting a
 * project for a screen that may only have been opened to read the migration
 * list.
 */
async function findDiagnosticsActivity(db: Database): Promise<string | null> {
  const project = (await listProjects(db)).find((p) => p.name === DIAGNOSTICS_PROJECT_NAME)
  if (!project) return null
  const activity = (await listActivities(db, project.id)).find(
    (a) => a.name === DIAGNOSTICS_ACTIVITY_NAME,
  )
  return activity?.id ?? null
}

/**
 * The same activity, created if this screen has never run on this database.
 *
 * Only a save calls this, so opening the screen still writes nothing. It
 * never adopts an activity it did not create: the lookup is by this screen's
 * own two names, and anything else on disk — including whatever survey she
 * was running a minute ago — is left alone.
 */
async function ensureDiagnosticsActivity(db: Database): Promise<string> {
  const existing = await findDiagnosticsActivity(db)
  if (existing !== null) return existing

  const projects = await listProjects(db)
  const project =
    projects.find((p) => p.name === DIAGNOSTICS_PROJECT_NAME) ??
    (await createProject(db, { name: DIAGNOSTICS_PROJECT_NAME }))
  const activity = await createActivity(db, {
    projectId: project.id,
    kind: 'survey',
    name: DIAGNOSTICS_ACTIVITY_NAME,
  })
  return activity.id
}

/**
 * Conditions that apply to every position this device reports (spec §7.5).
 * `accuracyConvention` is stored because it cannot be recovered from the
 * number alone: Android's accuracy is the 68% confidence radius rather than a
 * maximum error. `provider` is left null — expo-location does not expose which
 * provider (gps/fused/network) produced a reading. Altitude's own reference
 * frame is the same kind of fact but is not included here: it must travel with
 * the altitude value itself, present only when a height is, so it comes from
 * `altitudeEvidence()` below instead of being a constant.
 */
const CONDITIONS = { accuracyConvention: 'radius68', provider: null } as const

/**
 * Pairs an altitude with the frame it was measured against, or nulls both
 * together (spec §7.5; migration 003's `record_altitude_has_reference`).
 * Android reports height above the WGS84 ellipsoid, several metres different
 * from mean sea level in Victoria, so the reference cannot be recovered from
 * the number alone — it must travel with every altitude this device reports,
 * and with neither field when there is no altitude to report.
 */
function altitudeEvidence(altitudeM: number | null): AltitudeEvidence {
  return altitudeM === null
    ? { altitudeM: null, altitudeReference: null }
    : { altitudeM, altitudeReference: 'wgs84Ellipsoid' }
}

/**
 * `Reading.isMocked` (and the screen's own `mocked` state) is three-state:
 * `true`, `false`, or `undefined` when the platform never said. Collapsing
 * "never said" into "no" would write down a claim of cleanliness nobody
 * made (spec §7.5) — this is the bug Task 12 fixed on the read path, so the
 * display here keeps the three states visibly distinct.
 */
function describeMocked(mocked: boolean | undefined): string {
  if (mocked === undefined) return 'not reported'
  return mocked ? 'YES — spoofed position' : 'no'
}

/**
 * The averaging evidence for a stored record, as a short suffix — sample
 * count, spread and hold duration are what the field checklist asks the
 * tester to check a held fix against, and they otherwise exist only inside
 * the SQLite file (finding 1). Only `'deliberate'` fixes carry this evidence
 * at all; `spreadM` is additionally absent on a single-reading capture
 * (`sampleEvidence()`'s `sampleCount: 1` branch), so it is rendered only when
 * present rather than printed as a placeholder.
 */
function deliberateEvidence(fix: StoredFix): string | null {
  if (fix.quality !== 'deliberate') return null
  const parts = [`n=${String(fix.sampleCount)}`]
  if (fix.spreadM !== null) parts.push(`spread=±${fix.spreadM.toFixed(1)}m`)
  parts.push(`hold=${(fix.holdMs / 1000).toFixed(1)}s`)
  return parts.join(' ')
}

/**
 * Turns any thrown value into the one sentence the message area can show.
 *
 * This screen is carried outdoors with no console attached, and the field
 * checklist lists "a save reporting an error rather than a record" as a
 * result to capture — so a failure has to be legible on the screen itself.
 * The realistic one is a CHECK constraint: `record_altitude_range` refuses a
 * GNSS altitude glitch, and SQLite names the constraint in the message, which
 * is exactly what makes the report worth writing down.
 */
function describeFailure(what: string, error: unknown): string {
  return `${what}: ${error instanceof Error ? error.message : String(error)}`
}

/**
 * The result of trying to turn a set of readings into a storable fix: either
 * the fix, or the one sentence explaining why there is not one.
 *
 * A union rather than a nullable return, because every failure here has a
 * different cause and the screen has no console attached — "it did nothing"
 * is the outcome this shape exists to make impossible.
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

  // averageReadings throws when every sample carries an unusable accuracy (the
  // device adapter maps a missing platform accuracy to Infinity, so a device
  // that declines to report accuracy hits exactly this). This is an instrument
  // with no console attached in the field, so the failure has to land in the
  // message area, not as an unhandled rejection that blanks the screen.
  let averaged: ReturnType<typeof averageReadings>
  try {
    averaged = averageReadings(samples)
  } catch (error) {
    return { ok: false, message: describeFailure('Could not average the readings', error) }
  }

  // A fix that cannot show it was not spoofed is not evidence (spec §7.5).
  // Rather than defaulting an unreported mock status to "false" — the exact
  // claim nobody made — refuse to save and say so. The verdict comes from the
  // readings that were actually averaged, never from whatever the latest live
  // reading happens to say: those are readings from different moments, and
  // stamping one onto a fix built from the others is provenance about the
  // wrong thing.
  if (averaged.isMocked === 'notReported') {
    return {
      ok: false,
      message: 'Cannot save — this platform never reported whether the position is mocked.',
    }
  }

  // Indexed access under `noUncheckedIndexedAccess`, discharged by a check
  // rather than by a cast: `samples.length > 0` is known above, but the type
  // system cannot carry that to the subscript, and the honest way to satisfy
  // it is to handle the case it is worried about.
  const first = samples[0]
  const last = samples[samples.length - 1]
  if (!first || !last) {
    return { ok: false, message: 'The reading buffer emptied mid-save; nothing was written.' }
  }

  // `averageReadings` always returns a spreadM number (0 for a single
  // reading), but migration 003's record_spread_matches_sample_count requires
  // spreadM to be NULL exactly when sampleCount is 1 — a single reading has no
  // disagreement to report, not a disagreement of zero. sampleEvidence() is
  // what turns that mismatch into a message here instead of a SQLITE_CONSTRAINT
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
      // Measured by the platform, combined by the engine, and stored — the
      // column was permanently NULL while `expo.ts` was mapping
      // `coords.altitudeAccuracy` into every reading.
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
 * What the fix would be if the countdown were accepted right now.
 *
 * The screen shows this rather than the latest single reading, because it is
 * the number the override would actually store: watching a live reading
 * bounce between 4 m and 9 m says nothing about whether the accumulated
 * average is getting better, which is the only question the countdown asks.
 *
 * Null when there is nothing defensible to show — no samples yet, or none of
 * them carrying a usable accuracy. That is a display, not a save, so it
 * reports absence rather than raising; the save path calls
 * `buildDeliberateFix` and gets the sentence.
 */
type CapturePreview = { accuracyM: number; sampleCount: number; grade: FixGrade }
function previewOf(samples: Reading[]): CapturePreview | null {
  if (samples.length === 0) return null
  try {
    const averaged = averageReadings(samples)
    return {
      accuracyM: averaged.accuracyM,
      sampleCount: averaged.sampleCount,
      grade: gradeAccuracy(averaged.accuracyM),
    }
  } catch {
    return null
  }
}

/**
 * The countdown lengths the screen offers.
 *
 * Deliberately a choice on the screen rather than one number reasoned out at a
 * desk: nobody yet knows what a countdown should be, and this instrument
 * exists to find out. The spread is chosen to make the answer visible rather
 * than to be uniformly plausible —
 *
 *  - **5 s** is the shortest wait worth standing still for. If it buys nothing
 *    measurable, the whole idea of a countdown is wrong.
 *  - **10 s** and **20 s** are the range a person will actually tolerate at
 *    every pin across a survey day, which is the constraint that decides this.
 *  - **30 s** is far enough out that the √n improvement has usually flattened,
 *    so it is where the plateau signal can be checked against the numbers.
 *  - **60 s** is longer than anyone would want. It is here to establish what
 *    the hardware can reach at all, which is the ceiling the shorter values
 *    have to be judged against.
 */
const COUNTDOWN_CHOICES = [5, 10, 20, 30, 60] as const
const DEFAULT_COUNTDOWN_S = 20

/** How often the countdown readout re-renders. Four times a second reads as smooth without busying the thread. */
const TICK_MS = 250

/**
 * A capture that has already been saved and is now being sharpened.
 *
 * `recordId` is the row on disk. That is the whole point of the model: the
 * record exists from the tap onward, so the app dying, the battery going or
 * her walking away costs the refinement, never the capture.
 */
type Countdown = {
  recordId: string
  /** How the record reads on disk right now — null when the tap found no fix at all. */
  startAccuracyM: number | null
  endsAtMs: number
}

const GRADE_WORDS: Record<FixGrade, string> = {
  good: 'GOOD FIX',
  fair: 'FAIR FIX',
  poor: 'POOR FIX',
}

/**
 * How much sharper the fix is than it was at the tap, in words.
 *
 * Signed on purpose: a countdown that made the fix *worse* is the single most
 * useful thing this instrument could report, and a display that only ever
 * showed improvement would hide it.
 */
function describeImprovement(startM: number | null, nowM: number | null): string {
  if (nowM === null) return 'nothing usable to average yet'
  if (startM === null) return 'from no position at all'
  const delta = startM - nowM
  const was = `was ±${startM.toFixed(1)} m`
  if (delta > 0.05) return `${was}, better by ${delta.toFixed(1)} m`
  if (delta < -0.05) return `${was}, worse by ${(-delta).toFixed(1)} m`
  return `${was}, unchanged`
}

/**
 * How many rows the reading log shows.
 *
 * Enough to show the shape of a convergence — several steps of the accuracy
 * estimate settling — without growing past what fits on screen alongside the
 * panels above it (spec: fit one screenshot). `readings` itself holds up to
 * 20; this is a display window onto its tail, not a second buffer.
 */
const LOG_ROWS = 8

/** One row of the reading log: a reading, plus the verdict as it stood then. */
type LogRow = {
  timestampMs: number
  elapsedS: number
  accuracyM: number
  grade: FixGrade
  verdict: HoldVerdict
}

const LOG_ELAPSED_W = 5
const LOG_ACCURACY_W = 7
const LOG_GRADE_W = 6

/**
 * The reading log's column header, in the same fixed widths `formatLogRow`
 * uses, so it lines up with the data rows below it under the `mono` font.
 */
function formatLogHeader(): string {
  return ['s'.padStart(LOG_ELAPSED_W), 'm'.padStart(LOG_ACCURACY_W), 'grade'.padEnd(LOG_GRADE_W), 'verdict'].join(
    ' ',
  )
}

function formatLogRow(row: LogRow): string {
  return [
    `${String(row.elapsedS)}s`.padStart(LOG_ELAPSED_W),
    `${row.accuracyM.toFixed(1)}m`.padStart(LOG_ACCURACY_W),
    row.grade.padEnd(LOG_GRADE_W),
    row.verdict,
  ].join(' ')
}

/**
 * The last `LOG_ROWS` readings, newest first, each carrying the verdict as it
 * stood *at that reading* — not today's verdict replayed over old data.
 *
 * `holdVerdict` only looks at its own `WINDOW` (4) most recent readings, so
 * calling it on `readings.slice(0, i + 1)` for each `i` reproduces exactly
 * what the screen would have said at that point in the stream: readings after
 * position `i` cannot influence it, because `holdVerdict` never sees them.
 *
 * Newest first: this log exists to catch a verdict that lags what the
 * accuracy is actually doing (finding: verdict read `plateaued` for a full
 * minute while accuracy fell from 6.4 m to 4.0 m). The way to check a
 * suspicious verdict on a row is to look at the fresher rows above it — with
 * newest first, "above" is later in time, so a `plateaued` row sitting under
 * still-falling accuracy is right there without scrolling down and losing
 * the row you started from.
 */
function buildLogRows(readings: Reading[], sessionStartMs: number | null): LogRow[] {
  if (sessionStartMs === null) return []
  const oldestIndex = Math.max(0, readings.length - LOG_ROWS)
  const rows: LogRow[] = []
  for (let i = readings.length - 1; i >= oldestIndex; i--) {
    const reading = readings[i]
    if (!reading) continue
    rows.push({
      timestampMs: reading.timestampMs,
      elapsedS: Math.round((reading.timestampMs - sessionStartMs) / 1000),
      accuracyM: reading.accuracyM,
      grade: gradeAccuracy(reading.accuracyM),
      verdict: holdVerdict(readings.slice(0, i + 1)),
    })
  }
  return rows
}

export default function Diagnostics() {
  const status = useDatabaseStatus()
  const { theme } = useTheme()

  const [permission, setPermission] = useState<PermissionState | 'not requested'>('not requested')
  const [readings, setReadings] = useState<Reading[]>([])
  const [collecting, setCollectingState] = useState(false)
  const [records, setRecords] = useState<FieldRecord[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [mocked, setMocked] = useState<boolean | undefined>(undefined)

  const source = useRef(createExpoLocationSource()).current
  const ambient = useRef(createAmbientCache(source)).current
  const collected = useRef<Reading[]>([])
  // The anchor for the reading log's "elapsed seconds" column below. Set once,
  // from the first reading this screen ever sees, and never from `readings[0]`
  // — that buffer is trimmed to the most recent 20 (see `setReadings` below),
  // so after a long session `readings[0]` is not the first reading of the
  // session at all, it is just the oldest one still on hand. Elapsed time has
  // to be anchored to a fixed point or the log's shape would shift under it
  // every time the buffer trims.
  const sessionStartMs = useRef<number | null>(null)
  // Mirrors `collecting`. The subscription callback below is created once, when
  // this effect runs with an empty dependency array, so it closes over whatever
  // `collecting` was AT THAT MOMENT — permanently `false` — rather than the
  // current value on every reading. Reading `collectingRef.current` instead
  // reads the live value each time, which is the entire point of a countdown:
  // the brief this screen was built from read the state directly here and so
  // never collected a single sample.
  const collectingRef = useRef(false)

  // The only place `collecting` is toggled, so this is the only place that
  // needs to keep the ref and the state in step. The state stays too, because
  // the readout renders from it. `useCallback` with no dependencies because the
  // body's unmount cleanup lists it: a fresh identity every render would make
  // that cleanup run — and stop the collection — on every render.
  const setCollecting = useCallback((value: boolean) => {
    collectingRef.current = value
    setCollectingState(value)
  }, [])

  useEffect(() => {
    let cancelled = false
    let stop: (() => void) | undefined

    void (async () => {
      const state = await source.requestPermission()
      if (cancelled) return
      setPermission(state)
      if (state !== 'granted') return

      const unsubscribe = await source.watch((reading) => {
        if (sessionStartMs.current === null) sessionStartMs.current = reading.timestampMs
        ambient.record(reading)
        // expo-location reports whether a position came from a mock provider
        // only on some platforms; `reading.isMocked` stays `undefined` rather
        // than being defaulted here (spec §7.5 — see `describeMocked` above).
        setMocked(reading.isMocked)
        setReadings((previous) => [...previous.slice(-19), reading])
        if (collectingRef.current) collected.current.push(reading)
      })

      // The screen could have unmounted while `requestPermission`/`watch` was
      // still in flight — `stop` would not exist yet for the cleanup below to
      // call, and this subscription would keep running against a dead screen.
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
    // `source` and `ambient` are each a `useRef(...).current` established once
    // above, so their identity never changes across renders — listing them
    // satisfies exhaustive-deps without causing a resubscribe on every render.
  }, [ambient, source])

  const latest = readings[readings.length - 1] ?? null

  if (status.state !== 'ready') {
    return (
      <Screen spokenDescription={`Diagnostics. The database is ${status.state}.`}>
        <Type variant="title">Database {status.state}</Type>
        {status.error ? <Type dim>{status.error.message}</Type> : null}
      </Screen>
    )
  }

  return (
    <DiagnosticsBody
      theme={theme}
      permission={permission}
      latest={latest}
      readings={readings}
      collecting={collecting}
      setCollecting={setCollecting}
      collected={collected}
      sessionStartMs={sessionStartMs}
      ambient={ambient}
      records={records}
      setRecords={setRecords}
      message={message}
      setMessage={setMessage}
      mocked={mocked}
      applied={status.applied}
    />
  )
}

type BodyProps = {
  theme: ReturnType<typeof useTheme>['theme']
  permission: PermissionState | 'not requested'
  latest: Reading | null
  readings: Reading[]
  collecting: boolean
  setCollecting: (v: boolean) => void
  collected: React.MutableRefObject<Reading[]>
  sessionStartMs: React.MutableRefObject<number | null>
  ambient: ReturnType<typeof createAmbientCache>
  records: FieldRecord[]
  setRecords: (r: FieldRecord[]) => void
  message: string | null
  setMessage: (m: string | null) => void
  mocked: boolean | undefined
  applied: string[]
}

function DiagnosticsBody(props: BodyProps) {
  const db = useDatabase()
  const device = useDevice()
  const { settings, updateSetting } = useSettings()
  const { latest, readings, collected, sessionStartMs, ambient, setCollecting, setRecords } = props

  const [countdown, setCountdownState] = useState<Countdown | null>(null)
  const [countdownSeconds, setCountdownSeconds] = useState<number>(DEFAULT_COUNTDOWN_S)
  // Re-render clock. `collected` is a ref, so the readout beside the control
  // would otherwise only move when a new reading happened to arrive; the
  // seconds remaining have to fall whether or not the receiver is talking.
  const [tickMs, setTickMs] = useState(() => Date.now())

  // Guards every `setState` call below that follows an `await`. Directed
  // deviation 5 covered the location subscription; the save handlers and the
  // on-arrival load are equally capable of resolving after the screen has
  // navigated away, and an update to an unmounted component is exactly what
  // that deviation exists to prevent everywhere else.
  const mountedRef = useRef(true)

  // Mirrors `countdown`, and is what actually decides whether a countdown is
  // still running. Two things can finish one — the timer firing and her hand
  // on the override — and `setCountdownState(null)` does not take effect until
  // the next render, so a state read would let both run and refine the record
  // twice. Claiming the ref is synchronous, so exactly one of them wins.
  const countdownRef = useRef<Countdown | null>(null)
  const beginCountdown = (next: Countdown) => {
    countdownRef.current = next
    setCountdownState(next)
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      // The location subscription lives in the parent, which outlives this body
      // whenever the database status flips away from `ready`. Leaving the
      // collection flag set would go on pushing readings into a buffer for a
      // countdown nobody is watching, for the life of the app.
      countdownRef.current = null
      collected.current = []
      setCollecting(false)
    }
  }, [collected, setCollecting])

  // Every `listRecords`-backed refresh (the on-arrival load below, and the
  // save handlers) takes this token before its awaits and only applies its
  // result if no newer refresh has since been started. Without it, the
  // on-arrival load — kicked off once on mount, reading whatever activity
  // already exists — could still be in flight when a save completes, and a
  // slower load resolving after a faster save would silently erase the
  // just-saved record from view (it stays on disk; only the display would
  // regress) simply because its query happened to finish last.
  const refreshToken = useRef(0)

  // Finding 2: load whatever is already on disk when the screen becomes
  // ready, so a force-stop-and-relaunch check does not read as data loss
  // just because nothing has been saved yet in this session. This must not
  // create anything — an instrument that writes to the database merely by
  // being opened corrupts the very thing it is measuring — so it looks for
  // this screen's OWN activity and shows nothing when there is none, rather
  // than calling `ensureActivity()`.
  //
  // It reads the diagnostics activity, not the most recent one: the list
  // below has to show the pins this screen saved, and reading her live survey
  // instead would put real records under a heading of test results — the same
  // confusion of the instrument with the thing measured that the save path
  // was fixed for.
  useEffect(() => {
    const token = ++refreshToken.current
    void (async () => {
      const existing = await findDiagnosticsActivity(db)
      if (!mountedRef.current || token !== refreshToken.current || existing === null) return
      const loaded = await listRecords(db, existing)
      if (!mountedRef.current || token !== refreshToken.current) return
      setRecords(loaded)
    })()
  }, [db, setRecords])

  const logRows = buildLogRows(readings, sessionStartMs.current)

  const row = (label: string, value: string) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
      <Type variant="small" dim>{label}</Type>
      <Type variant="mono">{value}</Type>
    </View>
  )

  /**
   * The diagnostics activity, created at most once per screen.
   *
   * The promise itself is cached, not the id: two saves in quick succession
   * both call this before either has finished writing, and two independent
   * `ensureDiagnosticsActivity()` walks would each find nothing and each
   * create an activity — two "Diagnostics run" rows, with the pins split
   * between them and only one of them ever displayed. A rejected attempt
   * clears the cache so the next save tries again rather than replaying the
   * same failure for the life of the screen.
   */
  const activityPromise = useRef<Promise<string> | null>(null)
  function ensureActivity(): Promise<string> {
    if (activityPromise.current === null) {
      activityPromise.current = ensureDiagnosticsActivity(db).catch((error: unknown) => {
        activityPromise.current = null
        throw error
      })
    }
    return activityPromise.current
  }

  /**
   * One tap. The fix on screen becomes a record on disk immediately, and the
   * countdown starts.
   *
   * The record is real from this moment — not a draft held in memory waiting
   * for a hold to end. If the app dies, the battery goes, or she simply walks
   * away, the capture survives with the fix it had; only the sharpening is
   * lost. That is the whole reason this replaced press-and-hold, alongside the
   * more physical one: holding a button moves the device, which is precisely
   * the movement the averaging exists to remove.
   *
   * Collection begins before the first `await`, so the samples the countdown
   * averages start at the tap rather than at whenever the insert happened to
   * finish.
   */
  async function captureNow() {
    if (countdownRef.current !== null) return

    const startedAtMs = Date.now()
    const endsAtMs = startedAtMs + countdownSeconds * 1000
    collected.current = latest ? [latest] : []
    setCollecting(true)

    // Doctrine rule 4: nothing blocks capture, including the absence of a
    // storable fix. The tap ALWAYS writes a row — a real capture, at a real
    // time — and where the reading on screen cannot become a position the row
    // says `'none'` and the message says why.
    //
    // Two things reach that branch: no reading at all yet, and a reading whose
    // accuracy the platform never usably reported (`averageReadings` throws,
    // and migration 003 would refuse the row anyway — a position with no
    // accuracy is not storable as a position here). Neither is a reason to
    // discard the capture, and the countdown that follows may still give the
    // record a real fix once the receiver starts reporting one.
    let fix: Fix = { quality: 'none' }
    let unstorable: string | null = null
    if (latest !== null) {
      const attempt = buildDeliberateFix([latest])
      if (attempt.ok) fix = attempt.fix
      else unstorable = attempt.message
    }

    // Taken before the first await so a slower refresh in flight elsewhere
    // (the on-arrival load, or an earlier save) can never win a race against
    // this one — see `refreshToken` above.
    const token = ++refreshToken.current
    let activityId: string
    try {
      activityId = await ensureActivity()
    } catch (error) {
      if (!mountedRef.current) return
      setCollecting(false)
      collected.current = []
      props.setMessage(describeFailure('Could not open the diagnostics activity', error))
      return
    }

    const previous = props.records[0]
    const duplicate =
      previous && previous.fix.quality !== 'none' && fix.quality !== 'none'
        ? isProbableDuplicate(fix, {
            latitude: previous.fix.latitude,
            longitude: previous.fix.longitude,
          })
        : false

    // `createRecord` can genuinely fail on real hardware: migration 003's
    // CHECK constraints refuse a malformed row, and `record_altitude_range` on
    // a GNSS altitude glitch is the one to expect. Unguarded, that became an
    // unhandled rejection and the screen simply did nothing — the instrument
    // silently failing to report the failure it was carried outdoors to catch.
    let record: FieldRecord
    let loaded: FieldRecord[]
    try {
      record = await createRecord(db, { activityId, kind: 'pin', fix, deviceId: device.id })
      loaded = await listRecords(db, activityId)
    } catch (error) {
      if (!mountedRef.current) return
      setCollecting(false)
      collected.current = []
      props.setMessage(describeFailure('Save failed', error))
      return
    }
    // The screen may have navigated away while the two awaits were in flight.
    if (!mountedRef.current) return
    // A newer save or load may already have refreshed the list. The countdown
    // still starts either way — it is about this capture, not about the list.
    if (token === refreshToken.current) setRecords(loaded)

    beginCountdown({
      recordId: record.id,
      startAccuracyM: fix.quality === 'none' ? null : fix.accuracyM,
      endsAtMs,
    })
    setTickMs(Date.now())
    props.setMessage(
      unstorable === null
        ? `Saved ${describeRecord(record)}${duplicate ? ' — within 5 m of the last one' : ''}. ` +
          'Stand still.'
        : `Saved ${describeRecord(record)} with no position. ${unstorable} Standing still — ` +
          'the countdown can still give it one.',
    )
  }

  /**
   * Ends the wait and writes the averaged fix over the record that is already
   * there — either because the countdown ran out, or because she accepted what
   * had accumulated.
   *
   * The two are the same operation and differ only in the sentence reported,
   * which is the point: the override is not an escape hatch from the model, it
   * is the model finishing early.
   *
   * A failure here leaves the record exactly as the tap saved it, and says so.
   * Averaging genuinely can fail — `averageReadings` throws when no sample
   * carries a usable accuracy — and "the capture is still there, just not
   * sharpened" is a materially different message from "the capture was lost".
   */
  async function finishCountdown(reason: 'countdown' | 'override') {
    const active = countdownRef.current
    if (active === null) return
    // Claimed synchronously, so the timer and the override cannot both refine
    // the same record.
    countdownRef.current = null
    setCountdownState(null)
    setCollecting(false)
    const samples = [...collected.current]
    collected.current = []

    const attempt = buildDeliberateFix(samples)
    if (!attempt.ok) {
      if (!mountedRef.current) return
      props.setMessage(`${attempt.message} The record is saved with the fix it already had.`)
      return
    }

    const token = ++refreshToken.current
    let refined: FieldRecord
    let loaded: FieldRecord[]
    try {
      refined = await refineRecordFix(db, {
        recordId: active.recordId,
        fix: attempt.fix,
        deviceId: device.id,
      })
      loaded = await listRecords(db, await ensureActivity())
    } catch (error) {
      if (!mountedRef.current) return
      props.setMessage(
        describeFailure('Refinement failed — the record keeps the fix it was saved with', error),
      )
      return
    }
    if (!mountedRef.current) return
    if (token === refreshToken.current) setRecords(loaded)

    const now = refined.fix.quality === 'none' ? null : refined.fix.accuracyM
    props.setMessage(
      `${reason === 'override' ? 'Accepted' : 'Countdown complete'} — ` +
        `${describeRecord(refined)} refined to ±${(now ?? 0).toFixed(1)} m ` +
        `from ${String(samples.length)} reading${samples.length === 1 ? '' : 's'} ` +
        `(${describeImprovement(active.startAccuracyM, now)}).`,
    )
  }

  // The latest `finishCountdown`, so the timer below can reach it without
  // being listed as a dependency. It is redefined on every render (it closes
  // over `db`, `device` and the setters), and a timer that restarted whenever
  // that happened would never fire: a reading arrives roughly every second,
  // and each one re-renders this screen.
  const finishRef = useRef<(reason: 'countdown' | 'override') => void>(() => undefined)
  useEffect(() => {
    finishRef.current = (reason) => {
      void finishCountdown(reason)
    }
  })

  // One timer for the completion, one for the readout. The completion is a
  // timeout rather than a comparison inside the tick, so a slow render or a
  // dropped tick cannot leave a finished countdown running.
  useEffect(() => {
    if (countdown === null) return
    const remainingMs = Math.max(0, countdown.endsAtMs - Date.now())
    const completion = setTimeout(() => {
      finishRef.current('countdown')
    }, remainingMs)
    const ticker = setInterval(() => {
      if (mountedRef.current) setTickMs(Date.now())
    }, TICK_MS)
    return () => {
      clearTimeout(completion)
      clearInterval(ticker)
    }
  }, [countdown])

  async function saveAmbient() {
    const fixNow = ambient.read()

    // The cached reading's own answer, not the live one — the cache holds
    // whatever reading it last accepted, which may be minutes old and is not
    // necessarily the reading on screen.
    if (fixNow && fixNow.isMocked === 'notReported') {
      props.setMessage(
        'Cannot save the cached position — this platform never reported whether it is mocked.',
      )
      return
    }

    const token = ++refreshToken.current
    let activityId: string
    try {
      activityId = await ensureActivity()
    } catch (error) {
      if (!mountedRef.current) return
      props.setMessage(describeFailure('Could not open the diagnostics activity', error))
      return
    }
    const fix: Fix = fixNow
      ? {
          quality: 'ambient',
          latitude: fixNow.latitude,
          longitude: fixNow.longitude,
          accuracyM: fixNow.accuracyM,
          datum: 'WGS84',
          ageSeconds: fixNow.ageSeconds,
          verticalAccuracyM: fixNow.verticalAccuracyM,
          // Guarded above: fixNow is truthy here, so the guard already
          // returned if the cached reading never reported a mocked flag. No
          // cast and no `?? false` — the verdict is a string union precisely
          // so this line has to state what it does about "never said".
          isMocked: fixNow.isMocked === 'mocked',
          gpsTime: null,
          ...CONDITIONS,
          ...altitudeEvidence(fixNow.altitudeM),
        }
      : { quality: 'none' }
    // Guarded for the same reason as the capture path above: this one had no
    // guard at all, so a refused insert vanished as an unhandled rejection.
    let loaded: FieldRecord[]
    try {
      await createRecord(db, { activityId, kind: 'pin', fix, deviceId: device.id })
      loaded = await listRecords(db, activityId)
    } catch (error) {
      if (!mountedRef.current) return
      props.setMessage(describeFailure('Save failed', error))
      return
    }
    if (!mountedRef.current || token !== refreshToken.current) return
    setRecords(loaded)
    props.setMessage(
      fixNow ? `Saved ambient, ${String(fixNow.ageSeconds)}s old` : 'Saved with no position',
    )
  }

  // ---- what the capture block shows -------------------------------------
  //
  // All of it computed here, immediately before the block that renders it, so
  // the readout and the control it belongs to stay one thing in the source as
  // well as on screen.

  const preview = countdown === null ? null : previewOf(collected.current)
  // During a countdown the frame grades the fix that would actually be stored;
  // idle, it grades the live reading. Those are different questions and the
  // frame answers whichever one the screen is currently asking.
  const shownAccuracyM =
    countdown === null ? (latest?.accuracyM ?? null) : (preview?.accuracyM ?? null)
  const grade: FixGrade | null = shownAccuracyM === null ? null : gradeAccuracy(shownAccuracyM)
  const frameColour =
    grade === 'good'
      ? props.theme.colors.statusGood
      : grade === 'fair'
        ? props.theme.colors.statusFair
        : grade === 'poor'
          ? props.theme.colors.statusPoor
          : props.theme.colors.border
  const secondsLeft =
    countdown === null ? 0 : Math.max(0, Math.ceil((countdown.endsAtMs - tickMs) / 1000))
  // The plateau signal SUGGESTS and never decides (spec §9.1). It has been
  // observed reading `plateaued` while accuracy fell from 6.4 m to 4.0 m, so
  // acting on it would end countdowns in the middle of genuine improvement.
  // It moves the override to a solid fill and adds a sentence; the countdown
  // runs on regardless until it expires or she ends it.
  const plateaued = countdown !== null && holdVerdict(collected.current) === 'plateaued'

  return (
    // Doctrine rule 16: every screen carries a spoken description. This one is
    // a development instrument rather than a designed screen, but it ships in
    // the release APK and is reachable from the launcher, so it is a screen
    // like any other — and a one-line prop is cheaper than an exemption the
    // next instrument would inherit.
    <Screen spokenDescription="Diagnostics. A development instrument for proving the GPS and database engine on real hardware. Live GPS readings, device facts, and a single capture control that records the current fix immediately and then sharpens it while you stand still.">
      <ScrollView showsVerticalScrollIndicator={false}>
        <Type variant="title">Diagnostics</Type>
        <Type dim>Not a design. An instrument for proving the engine on hardware.</Type>

        <View style={{ height: spacing.lg }} />
        <Card>
          <Type variant="label" dim>DATABASE</Type>
          {row('migrations', props.applied.length ? props.applied.join(', ') : 'already current')}
          {row('records shown', String(props.records.length))}
        </Card>

        <View style={{ height: spacing.md }} />
        <Card>
          <Type variant="label" dim>REACH</Type>
          {row('handedness', settings.handedness)}
          {/*
            capturePrimary chose which of two capture boxes took the dominant
            side. There is one control now, so there is nothing to choose — but
            the setting and its column stay put pending Plan 3 (spec §5.4), and
            showing the stored value keeps proving that settings persist across
            a restart, which is what this row was ever really for.
          */}
          {row('capturePrimary', `${settings.capturePrimary} (unused — one control now)`)}
          <View style={{ height: spacing.sm }} />
          <Button
            label={`Switch to ${settings.handedness === 'right' ? 'left' : 'right'}-handed`}
            kind="secondary"
            onPress={() =>
              void updateSetting('handedness', settings.handedness === 'right' ? 'left' : 'right')
            }
          />
        </Card>

        <View style={{ height: spacing.md }} />
        <Card>
          <Type variant="label" dim>DEVICE</Type>
          {row('label', device.label)}
          {row('type', device.deviceType)}
          {row('model', device.modelId ?? device.modelName ?? 'unreported')}
          {row('os', `${device.osName ?? '?'} ${device.osVersion ?? ''}`.trim())}
          {row('physical', device.isPhysical ? 'yes' : 'emulator')}
          {row('app', `${device.appVersion ?? '?'} (${device.appBuild ?? '?'})`)}
        </Card>

        <View style={{ height: spacing.md }} />
        <Card>
          <Type variant="label" dim>GPS</Type>
          {row('mocked', describeMocked(props.mocked))}
          {row('accuracy convention', 'radius68 (Android 1-sigma)')}
          {row('altitude reference', 'wgs84Ellipsoid')}
          {row('permission', props.permission)}
          {row('readings seen', String(readings.length))}
          {row('accuracy', latest ? `${latest.accuracyM.toFixed(1)} m` : '—')}
          {row('grade', latest ? gradeAccuracy(latest.accuracyM) : '—')}
          {row('verdict', holdVerdict(readings))}
          {row('lat', latest ? latest.latitude.toFixed(6) : '—')}
          {row('lon', latest ? latest.longitude.toFixed(6) : '—')}
          {row('altitude', latest?.altitudeM != null ? `${latest.altitudeM.toFixed(0)} m` : '—')}
          {row('ambient age', `${String(ambient.read()?.ageSeconds ?? '—')} s`)}
          {row('collected samples', String(collected.current.length))}
        </Card>

        {/*
          The capture block. Everything that responds to the countdown lives
          INSIDE the traffic-light frame, directly above the button that starts
          and ends it — the defect this change exists to fix was that the
          feedback sat in a panel most of a screen away from the thumb pressing
          the control, so on a tablet nothing she could see was anywhere near
          what she was touching.
        */}
        <View style={{ height: spacing.lg }} />
        <View
          style={{
            borderWidth: field.frame,
            // Colour never carries meaning alone (doctrine rule 9): the grade
            // word below says the same thing, and a fix too poor to grade —
            // or none at all — additionally dashes the frame.
            borderColor: frameColour,
            borderStyle: grade === null || grade === 'poor' ? 'dashed' : 'solid',
            borderRadius: radii.xl,
            padding: spacing.md,
            backgroundColor: props.theme.colors.surfaceRaised,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <Type variant="heading">{grade === null ? 'NO FIX YET' : GRADE_WORDS[grade]}</Type>
            <Type variant="heading">
              {shownAccuracyM === null ? '—' : `±${shownAccuracyM.toFixed(1)} m`}
            </Type>
          </View>

          <View style={{ height: spacing.xs }} />
          {countdown === null ? (
            <Type variant="small" dim>
              One tap saves this fix immediately, then the screen counts down for{' '}
              {String(countdownSeconds)}s while you stand still and sharpens the saved record.
            </Type>
          ) : (
            <>
              <Type variant="mono">
                {`${String(secondsLeft)}s left  n=${String(preview?.sampleCount ?? collected.current.length)}`}
              </Type>
              <Type variant="mono" dim>
                {describeImprovement(countdown.startAccuracyM, preview?.accuracyM ?? null)}
              </Type>
              <View style={{ height: spacing.xs }} />
              <Type variant="small" dim={!plateaued}>
                {plateaued
                  ? 'About as sharp as it gets here — accepting now costs nothing.'
                  : 'Still improving — keep standing still.'}
              </Type>
            </>
          )}

          <View style={{ height: spacing.sm }} />
          <Button
            label={
              countdown === null
                ? 'RECORD FIX'
                : plateaued
                  ? 'ACCEPT NOW — NOT IMPROVING'
                  : 'ACCEPT NOW'
            }
            spokenLabel={
              countdown === null
                ? 'Record the current fix now'
                : 'Accept the fix accumulated so far and end the countdown'
            }
            // Lime for the one-tap record, the fast action. During a countdown
            // the override is outlined until the fix stops improving, and solid
            // once it has — prominence, not a decision.
            kind={countdown === null ? 'fast' : plateaued ? 'primary' : 'accurate'}
            size="field"
            onPress={() => {
              if (countdown === null) void captureNow()
              else void finishCountdown('override')
            }}
          />
        </View>

        <View style={{ height: spacing.sm }} />
        <Type variant="label" dim>COUNTDOWN</Type>
        <View style={{ height: spacing.xs }} />
        {/*
          On the screen rather than in the source, because nobody yet knows
          what this number should be and finding out is what this instrument is
          for. Locked while a countdown runs: changing the length of a wait
          that is already underway has no honest meaning.
        */}
        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          {COUNTDOWN_CHOICES.map((seconds) => (
            <View key={seconds} style={{ flex: 1 }}>
              <Button
                label={`${String(seconds)}s`}
                spokenLabel={`Count down for ${String(seconds)} seconds`}
                kind={seconds === countdownSeconds ? 'primary' : 'secondary'}
                disabled={countdown !== null}
                onPress={() => setCountdownSeconds(seconds)}
              />
            </View>
          ))}
        </View>

        <View style={{ height: spacing.sm }} />
        {/* Kept: the ambient cache is a different path and needs its own proof. */}
        <Button label="Save ambient fix" kind="secondary" onPress={() => void saveAmbient()} />

        {props.message ? (
          <>
            <View style={{ height: spacing.sm }} />
            <Type style={{ color: props.theme.colors.accent }}>{props.message}</Type>
          </>
        ) : null}

        <View style={{ height: spacing.lg }} />
        <Card>
          <Type variant="label" dim>READING LOG</Type>
          <Type variant="small" dim>
            Newest first. Verdict is what holdVerdict said at that reading, from
            only the readings before it — not replayed with today&apos;s data.
          </Type>
          <View style={{ height: spacing.xs }} />
          <Type variant="mono" dim>{formatLogHeader()}</Type>
          {logRows.length === 0 ? (
            <Type variant="mono" dim>—</Type>
          ) : (
            logRows.map((r) => <Type key={r.timestampMs} variant="mono">{formatLogRow(r)}</Type>)
          )}
        </Card>

        <View style={{ height: spacing.lg }} />
        <Type variant="label" dim>STORED RECORDS</Type>
        {props.records.map((record) => {
          const evidence = deliberateEvidence(record.fix)
          return (
            <View key={record.id} style={{ paddingVertical: spacing.xs }}>
              <Type variant="mono">
                #{record.sequence} {record.fix.quality}
                {record.fix.quality !== 'none' ? ` ±${record.fix.accuracyM.toFixed(1)}m` : ''}
                {evidence ? ` ${evidence}` : ''}
              </Type>
            </View>
          )
        })}
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </Screen>
  )
}

/**
 * How a record is named in the message area.
 *
 * The activity ordinal when it has one, because that is what the stored-records
 * list below shows and the two have to be matchable at a glance. An unfiled
 * record has none (spec §7.2), so it falls back to the capture number — the
 * label that is always present because it is the one written on a tube.
 */
function describeRecord(record: FieldRecord): string {
  return record.sequence === null
    ? `capture ${String(record.captureNumber)}`
    : `#${String(record.sequence)}`
}
