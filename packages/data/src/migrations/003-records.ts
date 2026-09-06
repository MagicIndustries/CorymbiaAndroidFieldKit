import type { Migration } from '../db/migrate'

/**
 * The record spine (spec §7.2) and the append-only event log (spec §8.5).
 *
 * The CHECK constraints on fix_quality are the point of this migration. Spec §8.2
 * makes the deliberate/ambient/none distinction load-bearing for scientific
 * integrity, and `ContextStamp` already models it as a discriminated union so an
 * accuracy-less fix cannot be constructed in the UI. The database enforces the
 * same thing, so a corrupt record cannot be written by code that has forgotten
 * the rule — a wrong coordinate that reaches a biodiversity dataset is far more
 * expensive than a failed insert.
 *
 * Kind-specific fields live in `attributes` as JSON, validated per kind in
 * TypeScript (spec §7.2). Promote one to a real column the moment it must be
 * filtered on.
 */
export const migration003: Migration = {
  id: '003-records',
  up: [
    `CREATE TABLE record (
       id                TEXT PRIMARY KEY,
       activity_id       TEXT REFERENCES activity(id),
       kind              TEXT NOT NULL CHECK (kind IN ('pin')),
       sequence          INTEGER NOT NULL,

       title             TEXT,
       short_label       TEXT,
       description       TEXT,

       latitude          REAL,
       longitude         REAL,
       accuracy_m        REAL,
       altitude_m        REAL,
       datum             TEXT CHECK (datum IS NULL OR datum IN ('WGS84', 'GDA94', 'AGD66')),

       fix_quality       TEXT NOT NULL CHECK (fix_quality IN ('deliberate', 'ambient', 'none')),
       fix_age_seconds   INTEGER,
       fix_sample_count  INTEGER,
       fix_spread_m      REAL,
       fix_hold_ms       INTEGER,

       -- Per-fix conditions (spec §7.5). These change from capture to capture;
       -- the device's fixed characteristics live in the device table.
       vertical_accuracy_m  REAL,
       is_mocked            INTEGER NOT NULL DEFAULT 0 CHECK (is_mocked IN (0, 1)),
       location_provider    TEXT,

       -- Conventions stored explicitly, because neither can be recovered from the
       -- number alone. Android's accuracy is the 68% confidence radius, not a
       -- maximum error; its altitude is above the WGS84 ellipsoid, several metres
       -- from mean sea level in Victoria.
       accuracy_convention  TEXT CHECK (accuracy_convention IS NULL OR
                                        accuracy_convention IN ('radius68', 'radius95', 'unknown')),
       altitude_reference   TEXT CHECK (altitude_reference IS NULL OR
                                        altitude_reference IN ('wgs84Ellipsoid', 'meanSeaLevel')),

       captured_at       TEXT NOT NULL,
       gps_time          TEXT,
       device_id         TEXT NOT NULL REFERENCES device(id),

       attributes        TEXT NOT NULL DEFAULT '{}',

       created_at        TEXT NOT NULL,
       updated_at        TEXT NOT NULL,
       deleted_at        TEXT,

       -- A deliberate fix was taken deliberately: it has an accuracy, and it has
       -- no age because it was taken just now.
       CHECK (fix_quality <> 'deliberate' OR
              (latitude IS NOT NULL AND longitude IS NOT NULL
               AND accuracy_m IS NOT NULL AND datum IS NOT NULL
               AND fix_age_seconds IS NULL)),

       -- An ambient fix has an accuracy and an age; a fix from four minutes ago
       -- is a different claim from one taken now.
       CHECK (fix_quality <> 'ambient' OR
              (latitude IS NOT NULL AND longitude IS NOT NULL
               AND accuracy_m IS NOT NULL AND datum IS NOT NULL
               AND fix_age_seconds IS NOT NULL)),

       -- No position means no position. Absent, never guessed.
       CHECK (fix_quality <> 'none' OR
              (latitude IS NULL AND longitude IS NULL
               AND accuracy_m IS NULL AND altitude_m IS NULL AND datum IS NULL
               AND fix_age_seconds IS NULL AND fix_sample_count IS NULL
               AND fix_spread_m IS NULL AND fix_hold_ms IS NULL
               AND vertical_accuracy_m IS NULL AND accuracy_convention IS NULL
               AND altitude_reference IS NULL)),

       -- A stored accuracy without its convention is a number whose meaning was lost.
       CHECK (accuracy_m IS NULL OR accuracy_convention IS NOT NULL)
     )`,

    // Spec §7.2: sequence numbers restart with each activity, so "Pin 023" means
    // something in the survey she is running.
    `CREATE UNIQUE INDEX idx_record_sequence ON record(activity_id, sequence)`,
    `CREATE INDEX idx_record_activity ON record(activity_id, captured_at DESC)`,
    // Spec §10.2: records with no activity are the Inbox, a supported destination.
    `CREATE INDEX idx_record_unfiled ON record(captured_at DESC) WHERE activity_id IS NULL`,

    `CREATE TABLE event (
       id            TEXT PRIMARY KEY,
       record_id     TEXT REFERENCES record(id),
       action        TEXT NOT NULL
                     CHECK (action IN ('created', 'edited', 'media_added', 'filed',
                                       'played', 'deleted', 'restored')),
       device_id     TEXT NOT NULL REFERENCES device(id),
       occurred_at   TEXT NOT NULL,
       latitude      REAL,
       longitude     REAL,
       accuracy_m    REAL,
       fix_quality   TEXT CHECK (fix_quality IS NULL OR
                                 fix_quality IN ('deliberate', 'ambient', 'none')),
       activity_id   TEXT REFERENCES activity(id),
       detail        TEXT
     )`,

    `CREATE INDEX idx_event_record ON event(record_id, occurred_at)`,
  ],
}
