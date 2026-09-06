import type { Database } from '../db/port'
import { newId } from '../ids'
import { nowIso } from '../time'
import type { AccuracyConvention, Datum, Fix } from './records'

export type EventAction =
  'created' | 'edited' | 'media_added' | 'filed' | 'played' | 'deleted' | 'restored'

export type EventEntry = {
  id: string
  recordId: string | null
  action: EventAction
  deviceId: string
  occurredAt: string
  latitude: number | null
  longitude: number | null
  accuracyM: number | null
  accuracyConvention: AccuracyConvention | null
  datum: Datum | null
  fixQuality: Fix['quality'] | null
  /** Null exactly when there is no position to have been spoofed. */
  isMocked: boolean | null
  activityId: string | null
  detail: string | null
}

type EventRow = {
  id: string
  record_id: string | null
  action: EventAction
  device_id: string
  occurred_at: string
  latitude: number | null
  longitude: number | null
  accuracy_m: number | null
  accuracy_convention: AccuracyConvention | null
  datum: Datum | null
  fix_quality: Fix['quality'] | null
  is_mocked: number | null
  activity_id: string | null
  detail: string | null
}

function toEvent(row: EventRow): EventEntry {
  return {
    id: row.id,
    recordId: row.record_id,
    action: row.action,
    deviceId: row.device_id,
    occurredAt: row.occurred_at,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracyM: row.accuracy_m,
    accuracyConvention: row.accuracy_convention,
    datum: row.datum,
    fixQuality: row.fix_quality,
    isMocked: row.is_mocked === null ? null : row.is_mocked === 1,
    activityId: row.activity_id,
    detail: row.detail,
  }
}

const SELECT = `SELECT id, record_id, action, device_id, occurred_at, latitude, longitude,
                       accuracy_m, accuracy_convention, datum, fix_quality, is_mocked,
                       activity_id, detail
                FROM event`

/**
 * Append-only (spec §8.5). This is what makes chain-of-custody real rather than
 * aspirational: creation, edits, filing, playback and deletion each carry their
 * own context stamp, so a record's history says where and on which device every
 * change happened.
 *
 * There is deliberately no update or delete for events — migration 003 enforces
 * that in the schema with two triggers, not only here.
 *
 * The event table (migration 003) has a narrower position than a record: only
 * latitude, longitude, accuracy, its convention, the datum, the fix class and
 * whether it was mocked. Altitude, vertical accuracy, provider and the
 * deliberate-fix averaging evidence have no columns here — a record carries
 * those, an event stamp only needs enough to say where and how well.
 *
 * Every one of the columns this table does have must travel together or the
 * CHECK constraints refuse the insert: a stored accuracy with no convention, or
 * a position with no stated datum or mocked-flag, is exactly the meaningless
 * number spec §7.5 forbids. Writing only latitude/longitude/accuracy and
 * dropping the convention/datum/mocked flag — as an earlier draft of this
 * function did — passes for a 'none' stamp and fails the CHECK for every
 * positioned one.
 */
export async function appendEvent(
  db: Database,
  input: {
    recordId: string | null
    action: EventAction
    deviceId: string
    fix?: Fix
    activityId?: string | null
    detail?: string
  },
): Promise<void> {
  const positioned = input.fix && input.fix.quality !== 'none' ? input.fix : null
  await db.execute(
    `INSERT INTO event (id, record_id, action, device_id, occurred_at,
                        latitude, longitude, accuracy_m, accuracy_convention, datum,
                        fix_quality, is_mocked, activity_id, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId('evt'),
      input.recordId,
      input.action,
      input.deviceId,
      nowIso(),
      positioned?.latitude ?? null,
      positioned?.longitude ?? null,
      positioned?.accuracyM ?? null,
      positioned?.accuracyConvention ?? null,
      positioned?.datum ?? null,
      input.fix?.quality ?? null,
      positioned ? (positioned.isMocked ? 1 : 0) : null,
      input.activityId ?? null,
      input.detail ?? null,
    ],
  )
}

export async function listEvents(db: Database, recordId: string | null): Promise<EventEntry[]> {
  const rows = await db.all<EventRow>(
    `${SELECT} WHERE record_id IS ? ORDER BY occurred_at ASC, id ASC`,
    [recordId],
  )
  return rows.map(toEvent)
}
