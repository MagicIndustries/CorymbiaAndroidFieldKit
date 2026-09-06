import React, { useEffect, useRef, useState } from 'react'
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
  sampleEvidence,
  type AltitudeEvidence,
  type Database,
  type Fix,
  type FieldRecord,
  type StoredFix,
} from '@corymbia/data'
import { spacing } from '@corymbia/tokens'
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
  const parts = [`n=${fix.sampleCount}`]
  if (fix.spreadM !== null) parts.push(`spread=±${fix.spreadM.toFixed(1)}m`)
  parts.push(`hold=${(fix.holdMs / 1000).toFixed(1)}s`)
  return parts.join(' ')
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
    `${row.elapsedS}s`.padStart(LOG_ELAPSED_W),
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
  const [holding, setHoldingState] = useState(false)
  const [records, setRecords] = useState<FieldRecord[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [mocked, setMocked] = useState<boolean | undefined>(undefined)

  const source = useRef(createExpoLocationSource()).current
  const ambient = useRef(createAmbientCache(source)).current
  const held = useRef<Reading[]>([])
  // The anchor for the reading log's "elapsed seconds" column below. Set once,
  // from the first reading this screen ever sees, and never from `readings[0]`
  // — that buffer is trimmed to the most recent 20 (see `setReadings` below),
  // so after a long session `readings[0]` is not the first reading of the
  // session at all, it is just the oldest one still on hand. Elapsed time has
  // to be anchored to a fixed point or the log's shape would shift under it
  // every time the buffer trims.
  const sessionStartMs = useRef<number | null>(null)
  // Mirrors `holding`. The subscription callback below is created once, when
  // this effect runs with an empty dependency array, so it closes over
  // whatever `holding` was AT THAT MOMENT — permanently `false` — rather than
  // the current value on every reading. Reading `holdingRef.current` instead
  // reads the live value each time, which is the entire point of a hold: the
  // brief this screen was built from read `holding` directly here and so
  // never collected a single sample.
  const holdingRef = useRef(false)

  // The only place `holding` is toggled, so this is the only place that needs
  // to keep the ref and the state in step. The state stays too, because the
  // UI (the button's label, the held-sample count) renders from it.
  const setHolding = (value: boolean) => {
    holdingRef.current = value
    setHoldingState(value)
  }

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
        if (holdingRef.current) held.current.push(reading)
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
      holding={holding}
      setHolding={setHolding}
      held={held}
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
  holding: boolean
  setHolding: (v: boolean) => void
  held: React.MutableRefObject<Reading[]>
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
  const { latest, readings, holding, held, sessionStartMs, ambient, setRecords } = props

  // Guards every `setState` call below that follows an `await`. Directed
  // deviation 5 covered the location subscription; the save handlers and the
  // on-arrival load are equally capable of resolving after the screen has
  // navigated away, and an update to an unmounted component is exactly what
  // that deviation exists to prevent everywhere else.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Every `listRecords`-backed refresh (the on-arrival load below, and the
  // two save handlers) takes this token before its awaits and only applies
  // its result if no newer refresh has since been started. Without it, the
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

  /**
   * Conditions that apply to every position this device reports (spec §7.5).
   * `accuracyConvention` is stored because it cannot be recovered from the
   * number alone: Android's accuracy is the 68% confidence radius rather than
   * a maximum error. `provider` is left null — expo-location does not expose
   * which provider (gps/fused/network) produced a reading. Altitude's own
   * reference frame is the same kind of fact but is not included here: it
   * must travel with the altitude value itself, present only when a height
   * is, so it comes from `altitudeEvidence()` above instead of being a
   * constant.
   */
  const conditions = { accuracyConvention: 'radius68', provider: null } as const

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
   * Turns any thrown value into the one sentence the message area can show.
   *
   * This screen is carried outdoors with no console attached, and the field
   * checklist lists "a save reporting an error rather than a record" as a
   * result to capture — so a failure has to be legible on the screen itself.
   * The realistic one is a CHECK constraint: `record_altitude_range` refuses a
   * GNSS altitude glitch, and SQLite names the constraint in the message,
   * which is exactly what makes the report worth writing down.
   */
  function describeFailure(what: string, error: unknown): string {
    return `${what}: ${error instanceof Error ? error.message : String(error)}`
  }

  async function saveDeliberate(samples: Reading[]) {
    if (samples.length === 0) {
      props.setMessage('No readings to save — is the GPS permission granted?')
      return
    }

    // averageReadings throws when every sample carries an unusable accuracy
    // (the device adapter maps a missing platform accuracy to Infinity, so a
    // device that declines to report accuracy hits exactly this). This is an
    // instrument with no console attached in the field, so the failure has to
    // land in the message area, not as an unhandled rejection that blanks the
    // screen.
    let averaged: ReturnType<typeof averageReadings>
    try {
      averaged = averageReadings(samples)
    } catch (error) {
      props.setMessage(describeFailure('Could not average the held readings', error))
      return
    }

    // A fix that cannot show it was not spoofed is not evidence (spec §7.5).
    // Rather than defaulting an unreported mock status to "false" — the exact
    // claim nobody made — refuse to save and say so.
    //
    // The verdict comes from the readings that were actually averaged, not
    // from `props.mocked`, which is whatever the LATEST LIVE reading said. A
    // hold ends when she releases the control; the live stream carries on, so
    // the two are readings from different moments and stamping one onto a fix
    // built from the others is provenance about the wrong thing.
    if (averaged.isMocked === 'notReported') {
      props.setMessage(
        'Cannot save — this platform never reported whether the position is mocked.',
      )
      return
    }

    // Taken before the first await so a slower refresh in flight elsewhere
    // (the on-arrival load, or an earlier save) can never win a race against
    // this one — see `refreshToken` above.
    const token = ++refreshToken.current
    let activityId: string
    try {
      activityId = await ensureActivity()
    } catch (error) {
      props.setMessage(describeFailure('Could not open the diagnostics activity', error))
      return
    }
    const previous = props.records[0]
    const duplicate =
      previous && previous.fix.quality !== 'none'
        ? isProbableDuplicate(averaged, {
            latitude: previous.fix.latitude,
            longitude: previous.fix.longitude,
          })
        : false

    const lastSample = samples[samples.length - 1] as Reading // samples.length > 0, checked above
    // `averageReadings` always returns a spreadM number (0 for a single
    // reading), but migration 003's record_spread_matches_sample_count
    // requires spreadM to be NULL exactly when sampleCount is 1 — a single
    // reading has no disagreement to report, not a disagreement of zero.
    // sampleEvidence() is what turns that mismatch into a message here
    // instead of a SQLITE_CONSTRAINT failure mid-save.
    const evidence = sampleEvidence(
      averaged.sampleCount,
      averaged.sampleCount === 1 ? null : averaged.spreadM,
    )

    const fix: Fix = {
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
      gpsTime: nowIso(new Date(lastSample.timestampMs)),
      ...conditions,
      ...altitudeEvidence(averaged.altitudeM),
      ...evidence,
      holdMs:
        samples.length > 1 ? lastSample.timestampMs - (samples[0] as Reading).timestampMs : 0,
    }

    // `createRecord` can genuinely fail on real hardware: migration 003's
    // CHECK constraints refuse a malformed row, and `record_altitude_range` on
    // a GNSS altitude glitch is the one to expect. Unguarded, that became an
    // unhandled rejection and the screen simply did nothing — the instrument
    // silently failing to report the failure it was carried outdoors to catch.
    let loaded: FieldRecord[]
    try {
      await createRecord(db, {
        activityId,
        kind: 'pin',
        fix,
        deviceId: device.id,
      })
      loaded = await listRecords(db, activityId)
    } catch (error) {
      if (!mountedRef.current) return
      props.setMessage(describeFailure('Save failed', error))
      return
    }
    // The screen may have navigated away, or a newer save/load may already
    // have refreshed the list, while the two awaits above were in flight.
    if (!mountedRef.current || token !== refreshToken.current) return
    props.setRecords(loaded)
    props.setMessage(duplicate ? 'Saved — but within 5 m of the last one' : 'Saved')
  }

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
          ...conditions,
          ...altitudeEvidence(fixNow.altitudeM),
        }
      : { quality: 'none' }
    // Guarded for the same reason as the deliberate path above: this one had
    // no guard at all, so a refused insert vanished as an unhandled rejection.
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
    props.setRecords(loaded)
    props.setMessage(fixNow ? `Saved ambient, ${fixNow.ageSeconds}s old` : 'Saved with no position')
  }

  return (
    // Doctrine rule 16: every screen carries a spoken description. This one is
    // a development instrument rather than a designed screen, but it ships in
    // the release APK and is reachable from the launcher, so it is a screen
    // like any other — and a one-line prop is cheaper than an exemption the
    // next instrument would inherit.
    <Screen spokenDescription="Diagnostics. A development instrument for proving the GPS and database engine on real hardware. Live GPS readings, device facts, and controls for saving test fixes into a dedicated diagnostics activity.">
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
          {row('dominant control', settings.capturePrimary)}
          <View style={{ height: spacing.sm }} />
          <Button
            label={`Swap to ${settings.capturePrimary === 'saveNow' ? 'SHARPEN' : 'SAVE NOW'} on the dominant side`}
            kind="secondary"
            onPress={() =>
              void updateSetting(
                'capturePrimary',
                settings.capturePrimary === 'saveNow' ? 'sharpen' : 'saveNow',
              )
            }
          />
          <View style={{ height: spacing.xs }} />
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
          {row('ambient age', `${ambient.read()?.ageSeconds ?? '—'} s`)}
          {row('held samples', String(held.current.length))}
        </Card>

        <View style={{ height: spacing.md }} />
        <Button
          label={holding ? 'Release to save averaged fix' : 'Hold to average'}
          kind="accurate"
          size="field"
          onPress={() => {
            if (holding) {
              const samples = [...held.current]
              held.current = []
              props.setHolding(false)
              void saveDeliberate(samples)
            } else {
              held.current = latest ? [latest] : []
              props.setHolding(true)
            }
          }}
        />
        <Type variant="small" dim>
          Sample count includes the reading already on screen when the hold began.
        </Type>
        <View style={{ height: spacing.sm }} />
        <Button label="Save single deliberate fix" kind="fast" size="field"
          onPress={() => void saveDeliberate(latest ? [latest] : [])} />
        <View style={{ height: spacing.sm }} />
        <Button label="Save ambient fix" kind="secondary" onPress={() => void saveAmbient()} />

        {props.message ? (
          <>
            <View style={{ height: spacing.sm }} />
            <Type style={{ color: props.theme.colors.accent }}>{props.message}</Type>
          </>
        ) : null}

        {/*
          Below the hold/save controls, not beside the live GPS card above,
          so this addition cannot push those controls further down the
          scroll — they are being replaced in a separate change right after
          this one and need to stay exactly where they are.
        */}
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
