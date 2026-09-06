import type { Migration } from '../db/migrate'

/**
 * One row per device installation (spec §7.5).
 *
 * Fixed characteristics live here rather than being repeated on every capture.
 * The columns for satellite counts, constellations and dual-frequency capability
 * are deliberately absent: none is reachable through the location API without
 * native work, and a column that would only ever hold a guess is worse than no
 * column. They arrive with a migration when a native module makes them real.
 */
export const migration002: Migration = {
  id: '002-devices',
  up: [
    `CREATE TABLE device (
       id             TEXT PRIMARY KEY,
       install_id     TEXT NOT NULL UNIQUE,
       label          TEXT NOT NULL CHECK (length(trim(label)) > 0),
       manufacturer   TEXT,
       brand          TEXT,
       model_name     TEXT,
       model_id       TEXT,
       device_type    TEXT NOT NULL
                      CHECK (device_type IN ('phone', 'tablet', 'desktop', 'tv', 'unknown')),
       os_name        TEXT,
       os_version     TEXT,
       is_physical    INTEGER NOT NULL CHECK (is_physical IN (0, 1)),
       app_version    TEXT,
       app_build      TEXT,
       first_seen_at  TEXT NOT NULL,
       last_seen_at   TEXT NOT NULL
     )`,
  ],
}
