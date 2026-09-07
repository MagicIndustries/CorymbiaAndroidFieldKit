import type { Database, SqlValue } from '../db/port'
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
export type PositionConditions<Mocked = boolean> = {
  verticalAccuracyM: number | null
  accuracyConvention: AccuracyConvention
  /**
   * Whether the platform reported this position as mocked.
   *
   * The type parameter exists for the read path alone. Every writer must state
   * this — `record_mocked_known_when_positioned` refuses a positioned row whose
   * `is_mocked` is NULL — so `Fix`, the thing you construct, pins it to
   * `boolean`. `StoredFix`, the thing that comes back out, widens it to
   * `boolean | null`, because a row this build did not write (a restored
   * backup, a sync peer, a database predating migration 003) can still carry
   * NULL. Reading that as `false` would have the app assert "not spoofed" about
   * a position it knows nothing about, on the one path that reaches an export —
   * which is the exact claim the nullable, undefaulted column exists to prevent.
   */
  isMocked: Mocked
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
 * readings, so it exists exactly when there was more than one reading: the
 * initial tap saves a single reading and has no spread to report; a countdown
 * that runs afterward accumulates several and must report theirs. Modelled as
 * its own union so a one-reading capture cannot
 * be forced to fabricate a spread of 0 (asserting agreement between readings
 * that were never compared), and a many-reading capture cannot omit one.
 *
 * TypeScript cannot express "any integer except 1" without a branded type, so
 * `{ sampleCount: number; spreadM: number }` is technically still satisfiable
 * with `sampleCount: 1`. Build these with `sampleEvidence()`, which names that
 * residual case as an error rather than leaving migration 003's CHECK to raise
 * it as a `SQLITE_CONSTRAINT` message mid-capture.
 */
export type SampleEvidence =
  { sampleCount: 1; spreadM: null } | { sampleCount: number; spreadM: number }

/**
 * Builds the averaging evidence for a deliberate fix.
 *
 * The averaging engine produces a reading count and a spread that is null when
 * there was nothing to compare, which is not yet either branch of the union.
 * Narrowing that pair by hand means `count === 1 ? … : …` at every capture-screen
 * call site plus a non-null assertion the type cannot discharge — so the check
 * lives here instead, once, and the invalid combination arrives as a sentence
 * rather than as `CHECK constraint failed: record_spread_matches_sample_count`
 * halfway through a capture.
 *
 * The union is still the right type: it is what stops the mistake being written
 * at all in the cases TypeScript can see. This closes the one case it cannot.
 */
export function sampleEvidence(sampleCount: number, spreadM: number | null): SampleEvidence {
  if (!Number.isInteger(sampleCount) || sampleCount < 1) {
    throw new Error(
      `A fix is averaged from a whole number of readings, at least one; got ${String(sampleCount)}.`,
    )
  }
  if (sampleCount === 1) {
    if (spreadM !== null) {
      throw new Error(
        `A one-reading fix has no spread to report, but got ${String(spreadM)}. Spread is the ` +
          'disagreement between readings; with a single reading it is undefined, not zero. ' +
          'Pass null.',
      )
    }
    return { sampleCount: 1, spreadM: null }
  }
  if (spreadM === null) {
    throw new Error(
      `A fix averaged from ${String(sampleCount)} readings must report their spread, or the ` +
        'sample count is evidence with nothing behind it; got null.',
    )
  }
  if (!(spreadM >= 0)) {
    throw new Error(
      `A spread is a distance between readings and cannot be negative; got ${String(spreadM)}.`,
    )
  }
  return { sampleCount, spreadM }
}

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
export type Fix<Mocked = boolean> =
  | ({
      quality: 'deliberate'
      holdMs: number
      accuracyConvention: Exclude<AccuracyConvention, 'unknown'>
    } & PositionCore &
      Omit<PositionConditions<Mocked>, 'accuracyConvention'> &
      AltitudeEvidence &
      SampleEvidence)
  | ({
      quality: 'ambient'
      ageSeconds: number
    } & PositionCore &
      PositionConditions<Mocked> &
      AltitudeEvidence)
  | { quality: 'none' }

/**
 * A fix as it comes back out of the database, which is `Fix` with one thing
 * relaxed: the mocked flag may be unknown.
 *
 * Writers still cannot produce that — `Fix` is what `createRecord` and
 * `appendEvent` accept, and the schema refuses a positioned row without the
 * flag. But a reader that meets one anyway must say "unknown", not "not
 * spoofed". `Fix` is assignable to `StoredFix`, so anything you wrote still
 * compares equal to what you read.
 */
export type StoredFix = Fix<boolean | null>

export type FieldRecord = {
  id: string
  /** What it is filed to. Null is the Inbox — a supported destination, not an error state. */
  activityId: string | null
  /** Which activity was running when it was captured, stamped automatically (spec §8.3). */
  contextActivityId: string | null
  kind: RecordKind
  /**
   * The number that is safe to write on a sample tube (spec §7.2).
   *
   * Assigned the moment the record is created, unique across the database, and
   * never changed by filing, reordering or deletion. When she is only taking
   * coordinates and notes it is simply an identity she can say out loud; when
   * she is taking a physical sample it is the label, and a label that stops
   * matching its record is worse than no label at all.
   */
  captureNumber: number
  /**
   * The ordinal within the activity — "Pin 023" in the survey she is running.
   *
   * Null exactly when the record is in no activity: the Inbox is a supported
   * destination, not an error state, and a record in no activity has no
   * position in one. Explicitly NOT stable: filing a record into the middle of
   * an activity renumbers everything at and after that position. Anything that
   * has to keep matching uses `captureNumber`.
   */
  sequence: number | null
  /**
   * When this record was placed into the activity it is in *now* by a filing
   * decision, or null when it has been there since capture (or is still
   * unfiled).
   *
   * "Now" is the load-bearing word once records can be refiled between
   * activities. `fileRecord` sets it when a record leaves the Inbox;
   * `refileRecord` overwrites it when a record is moved to a different
   * activity, because the record did not arrive in that activity at capture
   * either — it arrived by a filing decision, at that moment. Keeping the older
   * timestamp would have the column answer a question about an activity the
   * record is no longer in. `moveRecord` never touches it: a reorder does not
   * change which activity the record arrived in, or when.
   *
   * A column rather than a question asked of the event log, because the Inbox
   * and activity lists show this per row and a hundred records must not cost a
   * hundred queries. It is written in the same transaction as the filing and by
   * nothing else, so it cannot drift; the `'filed'` events remain the source of
   * truth for where, on which device, and out of which activity each filing
   * happened.
   */
  filedAt: string | null
  title: string | null
  description: string | null
  /**
   * The position and its provenance. GPS time lives in here rather than beside
   * it: it belongs to the fix, and a positionless record has none.
   */
  fix: StoredFix
  capturedAt: string
  deviceId: string
  attributes: Record<string, unknown>
}

type RecordRow = {
  id: string
  activity_id: string | null
  context_activity_id: string | null
  kind: RecordKind
  capture_number: number
  sequence: number | null
  filed_at: string | null
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

function toFix(row: RecordRow): StoredFix {
  if (row.fix_quality === 'none') return { quality: 'none' }

  const shared = {
    latitude: row.latitude as number,
    longitude: row.longitude as number,
    accuracyM: row.accuracy_m as number,
    datum: row.datum as Datum,
    verticalAccuracyM: row.vertical_accuracy_m,
    // `row.is_mocked === 1` alone reads NULL as `false` — the app asserting a
    // position was not spoofed when it does not know. The column is nullable and
    // undefaulted precisely so unknown stays unknown; the read path has to say
    // so too, and this is the path that reaches an export.
    isMocked: row.is_mocked === null ? null : row.is_mocked === 1,
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
    captureNumber: row.capture_number,
    sequence: row.sequence,
    filedAt: row.filed_at,
    title: row.title,
    description: row.description,
    fix: toFix(row),
    capturedAt: row.captured_at,
    deviceId: row.device_id,
    attributes: JSON.parse(row.attributes) as Record<string, unknown>,
  }
}

const SELECT = `SELECT id, activity_id, context_activity_id, kind, capture_number, sequence,
                       filed_at, title, description,
                       latitude, longitude, accuracy_m, altitude_m, datum,
                       fix_quality, fix_age_seconds, fix_sample_count, fix_spread_m, fix_hold_ms,
                       vertical_accuracy_m, is_mocked, location_provider,
                       accuracy_convention, altitude_reference,
                       captured_at, gps_time, device_id, attributes
                FROM record WHERE deleted_at IS NULL`

/**
 * Every column that carries the fix, named once, because two statements now
 * write them: `createRecord` at capture, and `refineRecordFix` when a countdown
 * over the same spot produces a sharper answer.
 *
 * One list rather than two, because the failure mode of two is silent. A column
 * added to the insert and forgotten in the update would leave a refined record
 * wearing half of its old position and half of its new one — a row every CHECK
 * constraint in migration 003 accepts, because each half is individually legal,
 * and which nothing downstream could tell from a real measurement.
 */
const FIX_COLUMNS = [
  'latitude',
  'longitude',
  'accuracy_m',
  'altitude_m',
  'datum',
  'fix_quality',
  'fix_age_seconds',
  'fix_sample_count',
  'fix_spread_m',
  'fix_hold_ms',
  'vertical_accuracy_m',
  'is_mocked',
  'location_provider',
  'accuracy_convention',
  'altitude_reference',
  'gps_time',
] as const

/**
 * The values for `FIX_COLUMNS`, in that order.
 *
 * The class discriminant does all the work: an ambient fix has an age and no
 * averaging evidence, a deliberate fix the reverse, and `'none'` carries none of
 * either and no position at all — which is what
 * `record_ambient_carries_age`, `record_deliberate_is_survey_grade` and
 * `record_none_has_no_position` each independently insist on.
 */
function fixColumnValues(fix: Fix): SqlValue[] {
  const positioned = fix.quality !== 'none' ? fix : null
  return [
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
    // GPS time is provenance of the fix, so it arrives with the fix. A
    // positionless record has no satellite clock reading, which is what
    // record_none_has_no_position insists on.
    positioned?.gpsTime ?? null,
  ]
}

/**
 * The next tube label: one more than the highest ever issued, across the whole
 * database (spec §7.2).
 *
 * Queries the bare `record` table rather than the filtered `SELECT` constant,
 * for the same reason `nextSequence` does and one more besides.
 * `idx_record_capture_number` has no partial predicate, so a tombstone still
 * holds its number and reusing it is a UNIQUE collision — but the stronger
 * reason is that a capture number is a promise never to be reused. Two tubes
 * labelled 41, one of which is in the bin, is exactly the confusion the number
 * exists to prevent.
 */
async function nextCaptureNumber(db: Database): Promise<number> {
  const row = await db.first<{ next: number }>(
    'SELECT COALESCE(MAX(capture_number), 0) + 1 AS next FROM record',
  )
  return row?.next ?? 1
}

/**
 * The next ordinal in an activity (spec §7.2), so "Pin 023" means something in
 * the survey she is running.
 *
 * `activityId` is a `string`, not `string | null`, and the predicate is `= ?`
 * rather than the `IS ?` it used to be. That is the direct consequence of
 * `sequence` now meaning the activity ordinal and nothing else: an unfiled
 * record has no ordinal, so every unfiled row's `sequence` is NULL and
 * `MAX(sequence) WHERE activity_id IS NULL` is NULL forever. Under the old
 * `IS ?` this function would have gone on answering 1 for every Inbox capture —
 * a number that is not wrong so much as meaningless, and one that
 * `record_sequence_tracks_activity` now refuses to store anyway. Making the
 * parameter non-nullable moves that from a runtime surprise to a compile error
 * at the call site, which is where the decision "is this record going into an
 * activity?" is actually made.
 *
 * Still queries the bare `record` table: `idx_record_sequence` has no partial
 * predicate on `deleted_at`, so a tombstone keeps its number and handing it to
 * a new record is a UNIQUE collision and a lost capture.
 */
async function nextSequence(db: Database, activityId: string): Promise<number> {
  const row = await db.first<{ next: number }>(
    'SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM record WHERE activity_id = ?',
    [activityId],
  )
  return row?.next ?? 1
}

/** The highest ordinal in an activity, or 0 when it holds no records at all. */
async function maxSequence(db: Database, activityId: string): Promise<number> {
  return (await nextSequence(db, activityId)) - 1
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
    /**
     * Why this capture looks the way it does, written into the `'created'`
     * event rather than onto the record.
     *
     * The case this exists for is a `'none'` fix. `record_none_has_no_position`
     * forces latitude, longitude, accuracy and GPS time all to NULL, so the row
     * itself can only ever say *that* there is no position, never *why* — and
     * "she tapped before the receiver had a lock" and "this platform never
     * reports whether a position is mocked, so no position could be asserted"
     * are entirely different facts about the same NULLs. One is a moment in a
     * survey; the other is a property of the hardware that applies to every
     * capture on that device.
     *
     * It goes in the event log rather than in `description` because the event
     * log is append-only chain of custody (spec §8.5): `description` is the
     * observer's own free text about the observation, is editable, and leaves
     * the app in exports, so an instrument's explanation of a NULL written
     * there would be indistinguishable from something she typed and would
     * survive only until she typed over it.
     */
    detail?: string
  },
): Promise<FieldRecord> {
  const attributes = serialiseAttributes(input.kind, input.attributes ?? {})
  const id = newId('rec')
  const at = nowIso()
  const fix = input.fix
  const contextActivityId = input.contextActivityId ?? null

  await db.transaction(async () => {
    // The tube label is assigned always; the activity ordinal only when the
    // record is being captured directly into an activity. A capture that lands
    // in the Inbox gets its ordinal later, from fileRecord, and until then has
    // none — record_sequence_tracks_activity insists on exactly that.
    const captureNumber = await nextCaptureNumber(db)
    const sequence = input.activityId === null ? null : await nextSequence(db, input.activityId)
    await db.execute(
      `INSERT INTO record (id, activity_id, context_activity_id, kind,
                           capture_number, sequence, title,
                           short_label, description,
                           ${FIX_COLUMNS.join(', ')},
                           captured_at, device_id, attributes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?,
               ${FIX_COLUMNS.map(() => '?').join(', ')},
               ?, ?, ?, ?, ?)`,
      [
        id,
        input.activityId,
        contextActivityId,
        input.kind,
        captureNumber,
        sequence,
        input.title ?? null,
        input.description ?? null,
        ...fixColumnValues(fix),
        at,
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
      detail: input.detail,
    })
  })

  const record = await getRecord(db, id)
  if (!record) throw new Error(`Record ${id} vanished immediately after being created.`)
  return record
}

/**
 * One record by id, or null when there is no live record under it.
 *
 * The detail view and the post-save confirmation both need exactly this, and
 * without it the only route back to a single record was `listRecords` plus a
 * `.find()` — which reads a whole activity to answer a one-row question and
 * cannot answer it at all for an Inbox record.
 *
 * A soft-deleted record reads as absent, the same as an unknown id: `SELECT`
 * filters tombstones, and a caller asking for a record it can show should not
 * have to know the difference. Callers that need the tombstone itself (an
 * undo path, an audit view) should query with their own predicate.
 */
export async function getRecord(db: Database, id: string): Promise<FieldRecord | null> {
  const row = await db.first<RecordRow>(`${SELECT} AND id = ?`, [id])
  return row ? toRecord(row) : null
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

/** The row filing and reordering need, tombstones included. */
type PlacementRow = {
  activity_id: string | null
  sequence: number | null
  deleted_at: string | null
}

async function placementOf(db: Database, id: string, verb: string): Promise<PlacementRow> {
  const row = await db.first<PlacementRow>(
    'SELECT activity_id, sequence, deleted_at FROM record WHERE id = ?',
    [id],
  )
  if (!row) throw new Error(`Record ${id} does not exist, so there is nothing to ${verb}.`)
  if (row.deleted_at !== null) {
    throw new Error(
      `Record ${id} has been deleted, so it cannot be ${verb}d. Its tombstone keeps whatever ` +
        'number it had, which is what stops a live record being handed a dead one’s ordinal.',
    )
  }
  return row
}

/**
 * Refuses a filing or refiling destination that cannot actually receive a
 * record: one that does not exist, or one that has been soft-deleted.
 *
 * Without this, `fileRecord` and `refileRecord` passed `activityId` straight
 * through to the `UPDATE`. A nonexistent id failed on the foreign key with a
 * raw `FOREIGN KEY constraint failed` — the one refusal in this file that did
 * not say what to do instead. A soft-deleted activity was worse: it satisfies
 * the foreign key (the row still exists; only `deleted_at` is set), so the
 * record was filed successfully and then vanished from every list that
 * filters deleted activities. There is no route back — `refileRecord` refuses
 * an Inbox record, `fileRecord` refuses one already filed, there is no
 * un-file operation, and `record_filed_at_needs_activity` blocks clearing
 * `activity_id` by hand — so a record filed into a dead activity was stuck
 * there permanently.
 *
 * Called before either function reads `maxSequence` or writes anything, so a
 * bad destination is refused before the record's own placement — or the
 * destination's numbering — has been touched at all.
 */
async function requireLiveActivity(db: Database, activityId: string, verb: string): Promise<void> {
  const row = await db.first<{ deleted_at: string | null }>(
    'SELECT deleted_at FROM activity WHERE id = ?',
    [activityId],
  )
  if (!row) {
    throw new Error(
      `Activity ${activityId} does not exist, so there is no activity to ${verb} a record into.`,
    )
  }
  if (row.deleted_at !== null) {
    throw new Error(
      `Activity ${activityId} has been deleted, so a record cannot be ${verb}d into it. A ` +
        'record filed there would drop out of every list that filters deleted activities, ' +
        'with no way back: there is no un-file operation.',
    )
  }
}

/**
 * Checks a requested 1-based position, and says what the range is when it is wrong.
 *
 * Positions are 1-based because they are the numbers she reads on screen —
 * "put it in at 3" means the record becomes Pin 003 — so an off-by-one here is
 * a wrong label in the field rather than an array index nobody sees.
 */
function checkPosition(position: number, highest: number, what: string): void {
  if (!Number.isInteger(position) || position < 1 || position > highest) {
    throw new Error(
      `A position is a whole number from 1 to ${String(highest)} ${what}; got ${String(position)}.`,
    )
  }
}

/**
 * Moves every record whose ordinal lies in `[from, to]` by `delta`, one row at
 * a time, in the order that leaves each destination free at the moment it is
 * written: highest first when shifting up, lowest first when shifting down.
 *
 * The order is the entire point of this function. The obvious statement —
 * `UPDATE record SET sequence = sequence + 1 WHERE activity_id = ? AND sequence >= ?`
 * — is wrong. SQLite checks `idx_record_sequence` as each row of an UPDATE is
 * written, not at the end of the statement, and UPDATE takes no ORDER BY; the
 * planner walks that predicate through the index in ascending order, so the row
 * at 3 is rewritten to 4 while 4 is still occupied and the whole thing fails
 * with `UNIQUE constraint failed: record.activity_id, record.sequence`. Walking
 * the rows ourselves in the vacating direction makes every intermediate state
 * legal under the same index the finished state has to satisfy.
 *
 * There is deliberately no `deleted_at IS NULL` filter. `idx_record_sequence`
 * has no partial predicate, so a tombstone still holds its number; skipping
 * tombstones would leave one sitting on an ordinal a live record is about to be
 * given, and the collision would surface as a failed filing rather than as the
 * schema bug it is.
 */
async function shiftRange(
  db: Database,
  activityId: string,
  from: number,
  to: number,
  delta: 1 | -1,
  at: string,
): Promise<void> {
  if (from > to) return
  const rows = await db.all<{ id: string; sequence: number }>(
    `SELECT id, sequence FROM record
      WHERE activity_id = ? AND sequence BETWEEN ? AND ?
      ORDER BY sequence ${delta === 1 ? 'DESC' : 'ASC'}`,
    [activityId, from, to],
  )
  for (const row of rows) {
    await db.execute('UPDATE record SET sequence = ?, updated_at = ? WHERE id = ?', [
      row.sequence + delta,
      at,
      row.id,
    ])
  }
}

/**
 * Files an unfiled record into an activity, appending it by default or
 * inserting it at a chosen position.
 *
 * This is the second half of spec §10.2's Inbox: capturing without a context is
 * a supported way to work, and this is how those records reach the survey they
 * belong to. Inserting at a position renumbers every record at or after it —
 * the activity ordinal is a position in a list, and a list you can insert into
 * is a list whose later numbers move. The tube label (`captureNumber`) does not
 * move, which is what makes that acceptable.
 *
 * All of it happens in one transaction. A half-renumbered activity is a
 * corrupted one: it either violates the unique index or, worse, it does not,
 * and two records quietly share a label.
 *
 * Refuses a record that is already in an activity, naming `moveRecord` or
 * `refileRecord` instead. The three share every line of their renumbering and
 * none of their meaning — this one puts a record into an activity for the first
 * time, `moveRecord` changes where it sits inside the one it is in, and
 * `refileRecord` corrects which activity it is in at all — and a single
 * function that silently did whichever the record's current state implied would
 * give a caller no way to say which one it meant. A stale Inbox screen holding
 * a record id that has since been filed would then quietly refile it instead of
 * reporting that the world moved on.
 *
 * Also refuses a destination activity that does not exist, or that has been
 * soft-deleted — see `requireLiveActivity` — before any write. A nonexistent
 * id used to fail on the foreign key with a raw, unexplained message; a
 * soft-deleted one used to succeed silently, filing the record into an
 * activity every list filters out, with no way back: there is no un-file
 * operation.
 *
 * `fix` stamps the filing event with where it happened, the way creation and
 * deletion are stamped (spec §8.5), and is optional for the same reason: bulk
 * filing from the Inbox list has no single position to report.
 */
export async function fileRecord(
  db: Database,
  input: {
    recordId: string
    activityId: string
    deviceId: string
    /** 1-based. Omitted appends to the end of the activity. */
    position?: number
    fix?: Fix
  },
): Promise<FieldRecord> {
  await db.transaction(async () => {
    const existing = await placementOf(db, input.recordId, 'file')
    if (existing.activity_id !== null) {
      throw new Error(
        `Record ${input.recordId} is already filed into activity ${existing.activity_id}. ` +
          'Use moveRecord to change its position within that activity, or refileRecord to ' +
          'move it into a different one.',
      )
    }
    await requireLiveActivity(db, input.activityId, 'file')

    const highest = await maxSequence(db, input.activityId)
    // Appending is position `highest + 1`, which is why the bound here is one
    // past the last existing record rather than the last existing record.
    const position = input.position ?? highest + 1
    checkPosition(position, highest + 1, `in activity ${input.activityId}`)

    const at = nowIso()
    await shiftRange(db, input.activityId, position, highest, 1, at)
    await db.execute(
      `UPDATE record SET activity_id = ?, sequence = ?, filed_at = ?, updated_at = ?
       WHERE id = ?`,
      [input.activityId, position, at, at, input.recordId],
    )
    await appendEvent(db, {
      recordId: input.recordId,
      action: 'filed',
      deviceId: input.deviceId,
      fix: input.fix,
      activityId: input.activityId,
      detail: `sequence ${String(position)}`,
    })
  })

  const record = await getRecord(db, input.recordId)
  if (!record) throw new Error(`Record ${input.recordId} vanished immediately after being filed.`)
  return record
}

/**
 * Moves an already-filed record to a different position within its activity.
 *
 * The same renumbering as `fileRecord`'s insert path, with one extra step: the
 * record being moved is already holding an ordinal inside the range that has to
 * shift, so it is parked one past the end of the activity first. That slot is
 * free by construction, and it is a real positive ordinal, so the row stays
 * legal under `record_sequence_positive` and `record_sequence_tracks_activity`
 * for the whole of the transaction rather than being smuggled through a state
 * the schema forbids.
 *
 * Logged as `'edited'`, not `'filed'`. The record did not change where it
 * lives; `'filed'` in this log means a record reached an activity, and writing
 * it for a reorder would make the history say something that did not happen.
 * `filed_at` is likewise left exactly as it was — reordering a record that was
 * captured in place does not turn it into one that was filed later.
 *
 * Asking for the position it already has is a no-op, matching
 * `softDeleteRecord`: the caller is asking for a state the record is already
 * in, and the log is append-only, so a spurious entry could never be retracted.
 */
export async function moveRecord(
  db: Database,
  input: {
    recordId: string
    /** 1-based, within the record's current activity. */
    position: number
    deviceId: string
    fix?: Fix
  },
): Promise<FieldRecord> {
  await db.transaction(async () => {
    const existing = await placementOf(db, input.recordId, 'move')
    const activityId = existing.activity_id
    const from = existing.sequence
    if (activityId === null || from === null) {
      throw new Error(
        `Record ${input.recordId} is in the Inbox, so it has no position to move within. ` +
          'Use fileRecord to put it into an activity.',
      )
    }

    const highest = await maxSequence(db, activityId)
    checkPosition(input.position, highest, `in activity ${activityId}`)
    const to = input.position
    if (to === from) return

    const at = nowIso()
    // One past the end: free by construction, since `highest` is the largest
    // ordinal in the activity. This vacates `from` so the shift below has
    // somewhere to land.
    await db.execute('UPDATE record SET sequence = ?, updated_at = ? WHERE id = ?', [
      highest + 1,
      at,
      input.recordId,
    ])
    if (to < from) await shiftRange(db, activityId, to, from - 1, 1, at)
    else await shiftRange(db, activityId, from + 1, to, -1, at)
    await db.execute('UPDATE record SET sequence = ?, updated_at = ? WHERE id = ?', [
      to,
      at,
      input.recordId,
    ])

    await appendEvent(db, {
      recordId: input.recordId,
      action: 'edited',
      deviceId: input.deviceId,
      fix: input.fix,
      activityId,
      detail: `sequence ${String(from)} to ${String(to)}`,
    })
  })

  const record = await getRecord(db, input.recordId)
  if (!record) throw new Error(`Record ${input.recordId} vanished immediately after being moved.`)
  return record
}

/**
 * Moves a record from the activity it is in into a different one, appending to
 * the end of the destination by default or inserting at a chosen position.
 *
 * This is the correction path: a record filed into the wrong survey, or
 * captured into the survey that happened to be running rather than the one it
 * belongs to. Spec §7.2 already makes the activity ordinal a position in a list
 * rather than an identity, so both activities renumber:
 *
 *  - the **destination** opens a slot at `position`, exactly as `fileRecord`'s
 *    insert path does;
 *  - the **source closes the gap** the departing record leaves, so a survey
 *    never shows a hole where a record used to be. This is the decision the
 *    owner made, and it is the one consistent with insertion: a list you can
 *    insert into is a list whose later numbers move, and a list you can remove
 *    from is a list whose later numbers move back.
 *
 * The capture number — the number written in marker on the tube — is untouched
 * by all of it, which is the whole reason ordinals are allowed to move.
 *
 * ## The order of the three steps, and why it needs no parking slot
 *
 * `moveRecord` has to park its record at `highest + 1` because the record it is
 * moving is inside the range it has to shift. Here it is not, because the
 * record leaves the source before the source is renumbered:
 *
 *  1. shift the destination's `[position, targetHighest]` **up** by one, highest
 *     first, opening the slot;
 *  2. write the record into the destination at `position` — the slot is free,
 *     and the source now has a hole at the ordinal it vacated;
 *  3. shift the source's `[from + 1, sourceHighest]` **down** by one, lowest
 *     first, closing that hole.
 *
 * The two shifts run in opposite directions because they are opposite
 * operations — one makes room, the other takes it back — and `shiftRange`
 * already orders each one the way that leaves every destination free at the
 * moment it is written. Step 2 sits between them so the record is in exactly
 * one activity at every point: it is never in both, and never in neither.
 * Doing the source first would leave the row at `from + 1` renumbering onto an
 * ordinal the departing record still holds.
 *
 * Both `maxSequence` reads happen before anything is written, so a rejected
 * position throws before the first `UPDATE` rather than midway through.
 *
 * All three steps and the event are one transaction. A record taken out of one
 * activity but not landed in the other, or a source closed up while the
 * destination never opened, is corrupted data of the worst kind — it does not
 * necessarily violate the unique index, so it can sit there quietly with two
 * records wearing the same label.
 *
 * ## What it refuses
 *
 * A record in the Inbox has no activity to be refiled *out of*; that is
 * `fileRecord`. A "refile" into the activity the record is already in is
 * refused rather than delegated to `moveRecord`, even though `moveRecord` would
 * handle it: this function writes a `'filed'` event and overwrites `filed_at`,
 * and `moveRecord` deliberately does neither, so delegating would make the
 * postcondition depend on the data rather than on the call — the exact thing
 * `fileRecord` and `moveRecord` were split apart to avoid. It would also have
 * to invent a meaning for the appending default, silently reordering an
 * activity that nobody asked to reorder.
 *
 * A destination that does not exist, or that has been soft-deleted, is also
 * refused, before any write — see `requireLiveActivity`. A missing id used to
 * fail on the foreign key with a raw, unexplained message; a soft-deleted one
 * used to succeed silently and strand the record where no list would ever
 * show it again.
 *
 * Logged as `'filed'`: the record did reach an activity, and `filed_at` moves
 * with it. The event's `activity_id` is the destination, so `detail` carries
 * the source activity and the ordinal it held there — a log entry that cannot
 * say where something came from is not an audit trail.
 */
export async function refileRecord(
  db: Database,
  input: {
    recordId: string
    /** The destination. Must not be the activity the record is already in. */
    activityId: string
    deviceId: string
    /** 1-based, in the destination. Omitted appends to its end. */
    position?: number
    fix?: Fix
  },
): Promise<FieldRecord> {
  await db.transaction(async () => {
    const existing = await placementOf(db, input.recordId, 'refile')
    const sourceActivityId = existing.activity_id
    const from = existing.sequence
    if (sourceActivityId === null || from === null) {
      throw new Error(
        `Record ${input.recordId} is in the Inbox, so there is no activity to refile it out of. ` +
          'Use fileRecord to put it into one.',
      )
    }
    if (sourceActivityId === input.activityId) {
      throw new Error(
        `Record ${input.recordId} is already in activity ${input.activityId}, so refiling it ` +
          'there would move it nowhere. Use moveRecord to change its position within an ' +
          'activity: that writes an ‘edited’ event and leaves filed_at alone, which is what a ' +
          'reorder is and what refiling is not.',
      )
    }
    await requireLiveActivity(db, input.activityId, 'refile')

    const sourceHighest = await maxSequence(db, sourceActivityId)
    const targetHighest = await maxSequence(db, input.activityId)
    // Appending is position `targetHighest + 1`, the same extra slot fileRecord
    // allows, and the reason the bound is one past the last existing record.
    const position = input.position ?? targetHighest + 1
    checkPosition(position, targetHighest + 1, `in activity ${input.activityId}`)

    const at = nowIso()
    await shiftRange(db, input.activityId, position, targetHighest, 1, at)
    await db.execute(
      `UPDATE record SET activity_id = ?, sequence = ?, filed_at = ?, updated_at = ?
       WHERE id = ?`,
      [input.activityId, position, at, at, input.recordId],
    )
    await shiftRange(db, sourceActivityId, from + 1, sourceHighest, -1, at)

    await appendEvent(db, {
      recordId: input.recordId,
      action: 'filed',
      deviceId: input.deviceId,
      fix: input.fix,
      activityId: input.activityId,
      detail:
        `refiled from activity ${sourceActivityId} sequence ${String(from)} ` +
        `to sequence ${String(position)}`,
    })
  })

  const record = await getRecord(db, input.recordId)
  if (!record) throw new Error(`Record ${input.recordId} vanished immediately after being refiled.`)
  return record
}

/**
 * An accuracy as it reads in a refinement's audit line: a figure to one decimal,
 * or the plain statement that there was no position to be accurate about.
 *
 * Prose for a person reading a record's history, not a number anything computes
 * from — the exact figures are in the record's own columns and in the event's
 * `accuracy_m`. Rounding here keeps the sentence readable without pretending to
 * a precision GNSS does not have.
 */
function describeAccuracy(accuracyM: number | null): string {
  return accuracyM === null ? 'no position' : `±${accuracyM.toFixed(1)} m`
}

/**
 * Replaces a record's fix with a better measurement of the same capture.
 *
 * This is the second half of the capture interaction (spec §9.1). One tap saves
 * whatever fix exists at that instant — a real row on disk, which survives the
 * app being killed, the battery going, or her simply walking away — and the
 * screen then counts down while she stands still. When the countdown completes,
 * or she accepts what has accumulated, the averaged fix lands here and refines
 * the row that is already there. Nothing waits in memory to be saved, because a
 * capture that exists only in memory is a capture that can be lost by walking
 * away from it.
 *
 * ## Why the event is `'edited'`
 *
 * `'edited'` is the existing action for a change to a record that already
 * exists, and `moveRecord` already uses it for exactly that. `'created'` would
 * be a lie — the record was created at the tap, and the log says so one row
 * above. A new `'refined'` action would mean a migration to widen
 * `event_action_known`, and a whole new verb in the audit vocabulary, for a
 * distinction the detail line already draws.
 *
 * ## Why the detail carries both accuracies
 *
 * The event's own position columns hold one position, and they hold the new
 * one. With only that, the history would show a fix that was always ±3 m. What
 * actually happened is that a ±6 m fix was stood over for twenty seconds and
 * refined to ±3 m — and which of those two happened is precisely the question
 * an audit of a biodiversity record asks. So the previous accuracy goes into
 * `detail`, where it is the only place it survives.
 *
 * ## The detail prefix is a contract, not prose
 *
 * The detail is written as `fix refined from <before> to <after>`, and the
 * leading `fix refined from ` is the only thing that distinguishes a refinement
 * from a manual edit in the event log: both are `'edited'` events on the same
 * record, carrying the same columns, and `moveRecord` writes `'edited'` too.
 * Any reader that has to tell "the countdown sharpened this" from "someone
 * retyped the coordinates" — an export, a detail view, an audit — has that
 * prefix and nothing else to go on.
 *
 * So the wording of that prefix is API. It may gain text after it; it must not
 * be reworded, re-cased or have anything inserted before it without changing
 * every reader that matches on it. `records.test.ts` asserts the exact string
 * for that reason, so a rewrite here fails there rather than silently making
 * every past refinement indistinguishable from a hand edit.
 *
 * ## What it does not touch
 *
 * `captured_at` and `capture_number`. The capture happened at the tap, not at
 * the end of the countdown, and the tube label was written then; a refinement
 * that renumbered the tube would be worse than no refinement at all.
 * `record_capture_number_is_immutable` enforces the second of those at the
 * database, and this function additionally never names either column.
 *
 * ## What it refuses
 *
 * A record that does not exist, and a soft-deleted one — a refinement improves
 * a capture she is still standing over, and a tombstone is not that. Also a
 * `'none'` fix: every other quality replaces a measurement with a measurement,
 * while `'none'` is the absence of one, and writing it through a function whose
 * name promises an improvement would blank a stored position. A record that
 * should have no position is one that was captured without one.
 *
 * Refining *from* `'none'` is allowed and is a real field case: she taps before
 * the receiver has a lock, gets a row with no position, and the countdown that
 * follows gives it one.
 *
 * The update and the event are one transaction, for the same reason every other
 * write in this file is: a record whose columns say ±3 m with no event saying
 * how it got there is a record whose provenance quietly stopped being true.
 */
export async function refineRecordFix(
  db: Database,
  input: { recordId: string; fix: Fix; deviceId: string },
): Promise<FieldRecord> {
  // Checked before the transaction opens: it is a fact about the argument, not
  // about the database, so there is nothing to read first and nothing to roll
  // back after.
  if (input.fix.quality === 'none') {
    throw new Error(
      `Record ${input.recordId} cannot be refined to no position at all. A refinement replaces ` +
        'a measurement with a better one; ‘none’ is the absence of a measurement, and storing ' +
        'it here would erase a position under the name of improving it. A record that should ' +
        'have no position is one that was captured without one.',
    )
  }
  const fix = input.fix

  await db.transaction(async () => {
    const existing = await db.first<{
      deleted_at: string | null
      accuracy_m: number | null
      activity_id: string | null
    }>('SELECT deleted_at, accuracy_m, activity_id FROM record WHERE id = ?', [input.recordId])
    if (!existing) {
      throw new Error(`Record ${input.recordId} does not exist, so there is no fix to refine.`)
    }
    if (existing.deleted_at !== null) {
      throw new Error(
        `Record ${input.recordId} has been deleted, so its fix cannot be refined. A refinement ` +
          'sharpens a capture she is still standing over; a tombstone is not that, and moving ' +
          'the position of a deleted record would rewrite history rather than record it.',
      )
    }

    const at = nowIso()
    await db.execute(
      `UPDATE record SET ${FIX_COLUMNS.map((column) => `${column} = ?`).join(', ')},
                         updated_at = ?
       WHERE id = ?`,
      [...fixColumnValues(fix), at, input.recordId],
    )
    await appendEvent(db, {
      recordId: input.recordId,
      action: 'edited',
      deviceId: input.deviceId,
      fix,
      // The activity the record is in now. `createRecord` stamps its event with
      // the context activity because at capture the two can differ; by the time
      // a refinement happens the record is wherever it is, and that is the
      // activity this change happened inside.
      activityId: existing.activity_id,
      detail:
        `fix refined from ${describeAccuracy(existing.accuracy_m)} ` +
        `to ${describeAccuracy(fix.accuracyM)}`,
    })
  })

  const record = await getRecord(db, input.recordId)
  if (!record) throw new Error(`Record ${input.recordId} vanished immediately after being refined.`)
  return record
}

/**
 * Soft, per spec §12.1 — the row is flagged and the history keeps the deletion.
 *
 * `fix` is optional and stamps the deletion event with where it happened, the
 * way creation, editing, filing and playback are stamped (spec §8.5). A
 * deletion is exactly the event whose location you would later want to know:
 * "she removed it standing at the site" and "she removed it in the car park
 * that evening" are different stories about the same record. Optional rather
 * than required because a bulk tidy-up from a list has no single position to
 * report, and inventing one would be worse than leaving it absent.
 *
 * Two edge cases, both of which previously misbehaved:
 *
 *  - Deleting an id that does not exist used to update nothing and then append
 *    an event whose `record_id` had no referent, so the caller saw a FOREIGN KEY
 *    error that read as though the delete had failed for some database reason.
 *    It now throws a sentence that says what actually happened. Deleting
 *    something that is not there is a stale screen or a bug upstream, and
 *    swallowing it hides both.
 *
 *  - Deleting an already-deleted record used to overwrite `deleted_at` and
 *    append a second `deleted` event, so the log said it was deleted twice and
 *    the history lost the moment it was actually deleted. It is now a no-op:
 *    deletion is a state, the second request asks for a state the record is
 *    already in, and the first deletion is the true one. The event log is
 *    append-only, so a spurious entry could never have been taken back.
 */
export async function softDeleteRecord(
  db: Database,
  id: string,
  deviceId: string,
  fix?: Fix,
): Promise<void> {
  await db.transaction(async () => {
    const existing = await db.first<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM record WHERE id = ?',
      [id],
    )
    if (!existing) {
      throw new Error(`Record ${id} does not exist, so there is nothing to delete.`)
    }
    if (existing.deleted_at !== null) return

    const at = nowIso()
    await db.execute('UPDATE record SET deleted_at = ?, updated_at = ? WHERE id = ?', [at, at, id])
    await appendEvent(db, { recordId: id, action: 'deleted', deviceId, fix })
  })
}
