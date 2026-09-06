import type { Migration } from '../db/migrate'

/**
 * Preferences, not observations (spec §7.6).
 *
 * A key-value table rather than columns, so a new preference costs no migration.
 * Deliberately separate from `device`: these record what the user chose, never
 * what she measured, and they never appear in an export.
 *
 * No CHECK on `value` — vocabularies are enforced when reading, because a
 * corrupted preference must never be able to stop the application starting. A
 * device that will not open because of a colour scheme has lost a day's
 * fieldwork.
 */
export const migration004: Migration = {
  id: '004-settings',
  up: [
    `CREATE TABLE setting (
       key         TEXT PRIMARY KEY,
       value       TEXT NOT NULL,
       updated_at  TEXT NOT NULL
     )`,
  ],
}
