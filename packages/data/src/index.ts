export type { Database, SqlValue } from './db/port'
export { migrate, readAppliedMigrationIds } from './db/migrate'
export type { Migration } from './db/migrate'
export { openDatabase } from './db/expo'

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
export { getClient } from './repositories/clients'
export type { Client } from './repositories/clients'
export {
  createActivity,
  getActivity,
  listActivities,
  mostRecentActivity,
} from './repositories/activities'
export type { Activity, ActivityKind } from './repositories/activities'

export { setCurrentActivity, readCurrentContext } from './repositories/context'
export type { CurrentContext } from './repositories/context'

export {
  createRecord,
  getRecord,
  listRecords,
  listUnfiledRecords,
  fileRecord,
  moveRecord,
  refileRecord,
  refineRecordFix,
  renameRecord,
  softDeleteRecord,
  sampleEvidence,
} from './repositories/records'
export type {
  Fix,
  StoredFix,
  FieldRecord,
  Datum,
  PositionConditions,
  SampleEvidence,
  AltitudeEvidence,
  AccuracyConvention,
  AltitudeReference,
  FixRefinement,
} from './repositories/records'
export { appendEvent, listEvents } from './repositories/events'
export type { EventAction, EventEntry } from './repositories/events'

export {
  attachMedia,
  listMedia,
  softDeleteMedia,
  newMediaId,
  AttachmentPersistError,
} from './repositories/media'
export type { Attachment } from './repositories/media'

export { readSettings, writeSetting, DEFAULT_SETTINGS } from './repositories/settings'
export type {
  Settings,
  Handedness,
  CapturePrimary,
  ThemePreference,
  Density,
} from './repositories/settings'

export { newId } from './ids'
export { nowIso } from './time'
export { validateAttributes, serialiseAttributes } from './kinds'
export type { RecordKind, PinAttributes } from './kinds'

// Note: openTestDatabase is not re-exported here. It remains available for tests
// that import directly from './db/better-sqlite3', but is kept out of the public
// barrel to prevent Metro from pulling the native 'better-sqlite3' module into
// the React Native bundle, which would fail the Android build.
