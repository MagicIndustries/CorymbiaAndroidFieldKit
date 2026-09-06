import type { Database } from '../db/port'
import { newId } from '../ids'
import { serialiseAttributes, type RecordKind } from '../kinds'
import { nowIso } from '../time'
import { appendEvent } from './events'

/**
 * The three datums the Victorian Biodiversity Atlas accepts. GDA2020 is not one
 * of them, and the app never produces it: Android returns WGS84 and no
 * transformation is performed, so WGS84 is what device-derived positions store.
 * GDA94 and AGD66 exist for coordinates typed in from another source.
 */
export type Datum = 'WGS84' | 'GDA94' | 'AGD66'

export type AccuracyConvention = 'radius68' | 'radius95' | 'unknown'
export type AltitudeReference = 'wgs84Ellipsoid' | 'meanSeaLevel'

/**
 * Conditions that apply to any position, whatever its class (spec §7.5).
 *
 * `accuracyConvention` is stored because it cannot be recovered from the number
 * alone: Android's accuracy is the 68% confidence radius rather than a maximum
 * error. A destination wanting 95% confidence wants a different figure, and only
 * the stored convention makes that conversion possible. `altitudeReference` is
 * the same rule one dimension up and lives in `AltitudeEvidence`, paired with the
 * height it describes.
 *
 * `isMocked` is chain-of-custody: a record that cannot show it was not spoofed
 * is not evidence, and the platform tells us.
 *
 * Every field here is positional provenance, which is why `'none'` carries none
 * of it: there is no position to have a provider, a satellite clock reading, or
 * to have been spoofed, and `record_none_has_no_position` requires every one of
 * these columns to be NULL.
 */
export type PositionConditions = {
  verticalAccuracyM: number | null
  accuracyConvention: AccuracyConvention
  isMocked: boolean
  /** Where the platform exposes it — 'gps', 'fused', 'network'. Null when it does not. */
  provider: string | null
  /**
   * The satellite clock reading *of this fix* (spec §7.4), kept alongside device
   * time because field tablets drift.
   *
   * It sits inside the position-carrying part of the union, not beside `fix`,
   * for the same reason `accuracyConvention` does: it is provenance belonging to
   * a specific position. A `'none'` fix has no satellite clock reading to
   * report, and `record_none_has_no_position` requires `gps_time IS NULL`.
   */
  gpsTime: string | null
}

type PositionCore = {
  latitude: number
  longitude: number
  accuracyM: number
  datum: Datum
}

/**
 * A height and the frame it was measured against — migration 003's
 * `record_altitude_has_reference`. The ellipsoid-to-geoid separation in Victoria
 * is several metres, so an altitude with no stated reference is not a
 * measurement (spec §7.5): the two travel together or neither is present.
 *
 * Its own union, the same technique as `SampleEvidence`, so
 * `{ altitudeM: 62, altitudeReference: null }` cannot be constructed at all
 * rather than being caught by a CHECK constraint mid-capture on a field device.
 *
 * The no-altitude branch pins the reference to null too. The schema would
 * tolerate a reference frame for a height that was never measured, but that is
 * metadata about nothing — no capture is lost by refusing it, and pinning it is
 * what makes a fix that was written read back identical.
 */
export type AltitudeEvidence =
  | { altitudeM: null; altitudeReference: null }
  | { altitudeM: number; altitudeReference: AltitudeReference }

/**
 * The averaging evidence a deliberate fix carries — migration 003's
 * `record_spread_matches_sample_count`. Spread is the disagreement between
 * readings, so it exists exactly when there was more than one reading: SAVE NOW
 * takes a single reading and has no spread to report; SHARPEN takes several and
 * must report theirs. Modelled as its own union so a one-reading capture cannot
 * be forced to fabricate a spread of 0 (asserting agreement between readings
 * that were never compared), and a many-reading capture cannot omit one.
 *
 * TypeScript cannot express "any integer except 1" without a branded type, so
 * `{ sampleCount: number; spreadM: number }` is technically still satisfiable
 * with `sampleCount: 1` — that residual gap is exactly what migration 003's
 * CHECK constraint closes at the database layer.
 */
export type SampleEvidence =
  { sampleCount: 1; spreadM: null } | { sampleCount: number; spreadM: number }

/**
 * The three fix classes of spec §8.2, as a discriminated union so an
 * accuracy-less deliberate fix cannot be constructed. The same rule is enforced
 * by CHECK constraints in migration 003 and by `ContextStamp` in `@corymbia/ui`.
 * Three representations on purpose: the type stops it being written, the
 * constraint stops it being stored, the component stops it being shown wrongly.
 *
 * This is stricter than the plan that first specified it, hardened to match
 * migration 003:
 *  - every position carries the full `PositionConditions` set, including
 *    `provider`, `isMocked`, the accuracy convention and the GPS time;
 *  - a deliberate fix's `accuracyConvention` excludes `'unknown'` — a
 *    survey-grade coordinate with an accuracy of unstated confidence is exactly
 *    what `record_deliberate_is_survey_grade` refuses to store;
 *  - a deliberate fix always carries `holdMs` (0 is a true value: she did not
 *    hold) and a `sampleCount`/`spreadM` pair via `SampleEvidence`;
 *  - every position carries an `altitudeM`/`altitudeReference` pair via
 *    `AltitudeEvidence`, so a height can never arrive without its frame;
 *  - `'none'` carries no positional data at all, including no provider, no GPS
 *    time and no mocked flag — there is no position to have a provider or to
 *    have been spoofed.
 */
export type Fix =
  | ({
      quality: 'deliberate'
      holdMs: number
      accuracyConvention: Exclude<AccuracyConvention, 'unknown'>
    } & PositionCore &
      Omit<PositionConditions, 'accuracyConvention'> &
      AltitudeEvidence &
      SampleEvidence)
  | ({
      quality: 'ambient'
      ageSeconds: number
    } & PositionCore &
      PositionConditions &
      AltitudeEvidence)
  | { quality: 'none' }

export type FieldRecord = {
  id: string
  /** What it is filed to. Null is the Inbox — a supported destination, not an error state. */
  activityId: string | null
  /** Which activity was running when it was captured, stamped automatically (spec §8.3). */
  contextActivityId: string | null
  kind: RecordKind
  sequence: number
  title: string | null
  description: string | null
  /**
   * The position and its provenance. GPS time lives in here rather than beside
   * it: it belongs to the fix, and a positionless record has none.
   */
  fix: Fix
  capturedAt: string
  deviceId: string
  attributes: Record<string, unknown>
}

type RecordRow = {
  id: string
  activity_id: string | null
  context_activity_id: string | null
  kind: RecordKind
  sequence: number
  title: string | null
  description: string | null
  latitude: number | null
  longitude: number | null
  accuracy_m: number | null
  altitude_m: number | null
  datum: Datum | null
  fix_quality: Fix['quality']
  fix_age_seconds: number | null
  fix_sample_count: number | null
  fix_spread_m: number | null
  fix_hold_ms: number | null
  vertical_accuracy_m: number | null
  is_mocked: number | null
  location_provider: string | null
  accuracy_convention: AccuracyConvention | null
  altitude_reference: AltitudeReference | null
  captured_at: string
  gps_time: string | null
  device_id: string
  attributes: string
}

/**
 * `record_altitude_has_reference` guarantees the reference is present whenever
 * the height is, which is what makes the cast below sound rather than hopeful.
 */
function toAltitude(row: RecordRow): AltitudeEvidence {
  return row.altitude_m === null
    ? { altitudeM: null, altitudeReference: null }
    : {
        altitudeM: row.altitude_m,
        altitudeReference: row.altitude_reference as AltitudeReference,
      }
}

function toFix(row: RecordRow): Fix {
  if (row.fix_quality === 'none') return { quality: 'none' }

  const shared = {
    latitude: row.latitude as number,
    longitude: row.longitude as number,
    accuracyM: row.accuracy_m as number,
    datum: row.datum as Datum,
    verticalAccuracyM: row.vertical_accuracy_m,
    isMocked: row.is_mocked === 1,
    provider: row.location_provider,
    gpsTime: row.gps_time,
    ...toAltitude(row),
  }

  if (row.fix_quality === 'deliberate') {
    const sampleCount = row.fix_sample_count as number
    const accuracyConvention = row.accuracy_convention as Exclude<AccuracyConvention, 'unknown'>
    const holdMs = row.fix_hold_ms as number
    return sampleCount === 1
      ? {
          quality: 'deliberate',
          ...shared,
          accuracyConvention,
          holdMs,
          sampleCount: 1,
          spreadM: null,
        }
      : {
          quality: 'deliberate',
          ...shared,
          accuracyConvention,
          holdMs,
          sampleCount,
          spreadM: row.fix_spread_m as number,
        }
  }

  return {
    quality: 'ambient',
    ...shared,
    accuracyConvention: row.accuracy_convention as AccuracyConvention,
    ageSeconds: row.fix_age_seconds as number,
  }
}

function toRecord(row: RecordRow): FieldRecord {
  return {
    id: row.id,
    activityId: row.activity_id,
    contextActivityId: row.context_activity_id,
    kind: row.kind,
    sequence: row.sequence,
    title: row.title,
    description: row.description,
    fix: toFix(row),
    capturedAt: row.captured_at,
    deviceId: row.device_id,
    attributes: JSON.parse(row.attributes) as Record<string, unknown>,
  }
}

const SELECT = `SELECT id, activity_id, context_activity_id, kind, sequence, title, description,
                       latitude, longitude, accuracy_m, altitude_m, datum,
                       fix_quality, fix_age_seconds, fix_sample_count, fix_spread_m, fix_hold_ms,
                       vertical_accuracy_m, is_mocked, location_provider,
                       accuracy_convention, altitude_reference,
                       captured_at, gps_time, device_id, attributes
                FROM record WHERE deleted_at IS NULL`

/**
 * Sequence numbers restart with each activity (spec §7.2), so "Pin 023" means
 * something in the survey she is running. Unfiled records — the Inbox — number
 * in their own sequence.
 */
async function nextSequence(db: Database, activityId: string | null): Promise<number> {
  const row = await db.first<{ next: number }>(
    'SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM record WHERE activity_id IS ?',
    [activityId],
  )
  return row?.next ?? 1
}

export async function createRecord(
  db: Database,
  input: {
    activityId: string | null
    kind: RecordKind
    fix: Fix
    deviceId: string
    title?: string
    description?: string
    /** Which activity was running when the capture happened; captured automatically upstream. */
    contextActivityId?: string | null
    attributes?: unknown
  },
): Promise<FieldRecord> {
  const attributes = serialiseAttributes(input.kind, input.attributes ?? {})
  const id = newId('rec')
  const at = nowIso()
  const fix = input.fix
  const positioned = fix.quality !== 'none' ? fix : null
  const contextActivityId = input.contextActivityId ?? null

  await db.transaction(async () => {
    const sequence = await nextSequence(db, input.activityId)
    await db.execute(
      `INSERT INTO record (id, activity_id, context_activity_id, kind, sequence, title,
                           short_label, description,
                           latitude, longitude, accuracy_m, altitude_m, datum,
                           fix_quality, fix_age_seconds, fix_sample_count, fix_spread_m, fix_hold_ms,
                           vertical_accuracy_m, is_mocked, location_provider,
                           accuracy_convention, altitude_reference,
                           captured_at, gps_time, device_id, attributes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.activityId,
        contextActivityId,
        input.kind,
        sequence,
        input.title ?? null,
        input.description ?? null,
        positioned?.latitude ?? null,
        positioned?.longitude ?? null,
        positioned?.accuracyM ?? null,
        positioned?.altitudeM ?? null,
        positioned?.datum ?? null,
        fix.quality,
        fix.quality === 'ambient' ? fix.ageSeconds : null,
        fix.quality === 'deliberate' ? fix.sampleCount : null,
        fix.quality === 'deliberate' ? fix.spreadM : null,
        fix.quality === 'deliberate' ? fix.holdMs : null,
        positioned?.verticalAccuracyM ?? null,
        // NOT `positioned?.isMocked ? 1 : 0` — when positioned is null that
        // expression evaluates `undefined ? 1 : 0`, which is 0, not null, and
        // trips record_none_has_no_position (is_mocked IS NULL required).
        positioned ? (positioned.isMocked ? 1 : 0) : null,
        positioned?.provider ?? null,
        positioned?.accuracyConvention ?? null,
        positioned?.altitudeReference ?? null,
        at,
        // GPS time is provenance of the fix, so it arrives with the fix. A
        // positionless record has no satellite clock reading, which is what
        // record_none_has_no_position insists on.
        positioned?.gpsTime ?? null,
        input.deviceId,
        attributes,
        at,
        at,
      ],
    )
    await appendEvent(db, {
      recordId: id,
      action: 'created',
      deviceId: input.deviceId,
      fix,
      // The event's activity stamp is what was actually happening, not
      // necessarily where the record ends up filed — the Inbox's whole point is
      // that these two can differ.
      activityId: contextActivityId ?? input.activityId,
    })
  })

  const row = await db.first<RecordRow>(`${SELECT} AND id = ?`, [id])
  if (!row) throw new Error(`Record ${id} vanished immediately after being created.`)
  return toRecord(row)
}

export async function listRecords(db: Database, activityId: string): Promise<FieldRecord[]> {
  const rows = await db.all<RecordRow>(
    `${SELECT} AND activity_id = ? ORDER BY captured_at DESC, id DESC`,
    [activityId],
  )
  return rows.map(toRecord)
}

/** Spec §10.2: capturing without a context is a supported path, not an error state. */
export async function listUnfiledRecords(db: Database): Promise<FieldRecord[]> {
  const rows = await db.all<RecordRow>(
    `${SELECT} AND activity_id IS NULL ORDER BY captured_at DESC, id DESC`,
  )
  return rows.map(toRecord)
}

/** Soft, per spec §12.1 — the row is flagged and the history keeps the deletion. */
export async function softDeleteRecord(db: Database, id: string, deviceId: string): Promise<void> {
  await db.transaction(async () => {
    await db.execute('UPDATE record SET deleted_at = ?, updated_at = ? WHERE id = ?', [
      nowIso(),
      nowIso(),
      id,
    ])
    await appendEvent(db, { recordId: id, action: 'deleted', deviceId })
  })
}
