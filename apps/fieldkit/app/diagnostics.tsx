import React, { useEffect, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
import {
  createAmbientCache,
  createExpoLocationSource,
  averageReadings,
  gradeAccuracy,
  holdVerdict,
  isProbableDuplicate,
  type PermissionState,
  type Reading,
} from '@corymbia/geo'
import {
  createActivity,
  createProject,
  createRecord,
  listRecords,
  mostRecentActivity,
  nowIso,
  sampleEvidence,
  type AltitudeEvidence,
  type Fix,
  type FieldRecord,
} from '@corymbia/data'
import { spacing } from '@corymbia/tokens'
import { Button, Card, Screen, Type, useTheme } from '@corymbia/ui'
import { useDatabase, useDatabaseStatus, useDevice, useSettings } from '../src/db/provider'

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
      <Screen>
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
  const { latest, readings, holding, held, ambient } = props

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

  const row = (label: string, value: string) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
      <Type variant="small" dim>{label}</Type>
      <Type variant="mono">{value}</Type>
    </View>
  )

  async function ensureActivity(): Promise<string> {
    const existing = await mostRecentActivity(db)
    if (existing) return existing.id
    const project = await createProject(db, { name: 'Diagnostics' })
    const activity = await createActivity(db, {
      projectId: project.id,
      kind: 'survey',
      name: 'Diagnostics run',
    })
    return activity.id
  }

  async function saveDeliberate(samples: Reading[]) {
    if (samples.length === 0) {
      props.setMessage('No readings to save — is the GPS permission granted?')
      return
    }

    // A fix that cannot show it was not spoofed is not evidence (spec §7.5).
    // Rather than defaulting an unreported mock status to "false" — the exact
    // claim nobody made — refuse to save and say so.
    const mocked = props.mocked
    if (mocked === undefined) {
      props.setMessage(
        'Cannot save — this platform never reported whether the position is mocked.',
      )
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
      props.setMessage(
        `Could not average the held readings: ${error instanceof Error ? error.message : String(error)}`,
      )
      return
    }

    const activityId = await ensureActivity()
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
      verticalAccuracyM: null,
      isMocked: mocked,
      // The satellite clock reading of this fix (spec §7.4), taken from the
      // last sample that went into the average.
      gpsTime: nowIso(new Date(lastSample.timestampMs)),
      ...conditions,
      ...altitudeEvidence(averaged.altitudeM),
      ...evidence,
      holdMs:
        samples.length > 1 ? lastSample.timestampMs - (samples[0] as Reading).timestampMs : 0,
    }

    await createRecord(db, {
      activityId,
      kind: 'pin',
      fix,
      deviceId: device.id,
    })
    props.setRecords(await listRecords(db, activityId))
    props.setMessage(duplicate ? 'Saved — but within 5 m of the last one' : 'Saved')
  }

  async function saveAmbient() {
    const fixNow = ambient.read()
    const mocked = props.mocked

    if (fixNow && mocked === undefined) {
      props.setMessage(
        'Cannot save the cached position — this platform never reported whether it is mocked.',
      )
      return
    }

    const activityId = await ensureActivity()
    const fix: Fix = fixNow
      ? {
          quality: 'ambient',
          latitude: fixNow.latitude,
          longitude: fixNow.longitude,
          accuracyM: fixNow.accuracyM,
          datum: 'WGS84',
          ageSeconds: fixNow.ageSeconds,
          verticalAccuracyM: null,
          // Guarded above: fixNow is truthy here, so the guard already
          // returned if `mocked` were undefined.
          isMocked: mocked as boolean,
          gpsTime: null,
          ...conditions,
          ...altitudeEvidence(fixNow.altitudeM),
        }
      : { quality: 'none' }
    await createRecord(db, { activityId, kind: 'pin', fix, deviceId: device.id })
    props.setRecords(await listRecords(db, activityId))
    props.setMessage(fixNow ? `Saved ambient, ${fixNow.ageSeconds}s old` : 'Saved with no position')
  }

  return (
    <Screen>
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

        <View style={{ height: spacing.lg }} />
        <Type variant="label" dim>STORED RECORDS</Type>
        {props.records.map((record) => (
          <View key={record.id} style={{ paddingVertical: spacing.xs }}>
            <Type variant="mono">
              #{record.sequence} {record.fix.quality}
              {record.fix.quality !== 'none' ? ` ±${record.fix.accuracyM.toFixed(1)}m` : ''}
            </Type>
          </View>
        ))}
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </Screen>
  )
}
