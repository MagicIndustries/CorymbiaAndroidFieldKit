export type { Database, SqlValue } from './db/port'
export { migrate } from './db/migrate'
export type { Migration } from './db/migrate'

export { registerDevice, getDevice, listDevices } from './repositories/devices'
export type { Device, DeviceFacts, DeviceType } from './repositories/devices'

export {
  createProject,
  getProject,
  listProjects,
  DEFAULT_CLIENT_ID,
  DEFAULT_LOCATION_ID,
} from './repositories/projects'
export type { Project } from './repositories/projects'
export { createActivity, listActivities, mostRecentActivity } from './repositories/activities'
export type { Activity, ActivityKind } from './repositories/activities'

export {
  createRecord,
  listRecords,
  listUnfiledRecords,
  softDeleteRecord,
} from './repositories/records'
export type {
  Fix,
  FieldRecord,
  Datum,
  PositionConditions,
  SampleEvidence,
  AltitudeEvidence,
  AccuracyConvention,
  AltitudeReference,
} from './repositories/records'
export { appendEvent, listEvents } from './repositories/events'
export type { EventAction, EventEntry } from './repositories/events'

export { newId } from './ids'
export { nowIso } from './time'
export { validateAttributes, serialiseAttributes } from './kinds'
export type { RecordKind, PinAttributes } from './kinds'

// Note: openTestDatabase is not re-exported here. It remains available for tests
// that import directly from './db/better-sqlite3', but is kept out of the public
// barrel to prevent Metro from pulling the native 'better-sqlite3' module into
// the React Native bundle, which would fail the Android build.
