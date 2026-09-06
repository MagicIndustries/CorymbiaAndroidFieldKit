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
 * Every CHECK is named. SQLite reports the name in the error ("CHECK constraint
 * failed: record_none_has_no_position"), which is what lets a test assert that a
 * specific rule fired rather than that something, somewhere, threw.
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

       -- Spec §8.3: two links to an activity. The filed link is a deliberate
       -- decision and starts empty; the context link is where she was when the
       -- capture happened, written automatically. The Inbox's one-tap filing
       -- suggestion is the context link, so an unfiled record still knows which
       -- activity was running.
       activity_id          TEXT REFERENCES activity(id),
       context_activity_id  TEXT REFERENCES activity(id),

       kind              TEXT NOT NULL
                         CONSTRAINT record_kind_known CHECK (kind IN ('pin')),
       sequence          INTEGER NOT NULL
                         CONSTRAINT record_sequence_positive CHECK (sequence > 0),

       title             TEXT,
       short_label       TEXT,
       description       TEXT,

       -- A transposed pair passes every semantic rule and exports as a real
       -- coordinate, so the magnitudes are bounded too.
       latitude          REAL CONSTRAINT record_latitude_range
                         CHECK (latitude IS NULL OR (latitude BETWEEN -90 AND 90)),
       longitude         REAL CONSTRAINT record_longitude_range
                         CHECK (longitude IS NULL OR (longitude BETWEEN -180 AND 180)),
       accuracy_m        REAL CONSTRAINT record_accuracy_positive
                         CHECK (accuracy_m IS NULL OR accuracy_m > 0),
       altitude_m        REAL,
       datum             TEXT CONSTRAINT record_datum_known
                         CHECK (datum IS NULL OR datum IN ('WGS84', 'GDA94', 'AGD66')),

       fix_quality       TEXT NOT NULL CONSTRAINT record_fix_quality_known
                         CHECK (fix_quality IN ('deliberate', 'ambient', 'none')),
       fix_age_seconds   INTEGER CONSTRAINT record_fix_age_non_negative
                         CHECK (fix_age_seconds IS NULL OR fix_age_seconds >= 0),
       fix_sample_count  INTEGER CONSTRAINT record_fix_sample_count_positive
                         CHECK (fix_sample_count IS NULL OR fix_sample_count > 0),
       fix_spread_m      REAL CONSTRAINT record_fix_spread_non_negative
                         CHECK (fix_spread_m IS NULL OR fix_spread_m >= 0),
       fix_hold_ms       INTEGER CONSTRAINT record_fix_hold_non_negative
                         CHECK (fix_hold_ms IS NULL OR fix_hold_ms >= 0),

       -- Per-fix conditions (spec §7.5). These change from capture to capture;
       -- the device's fixed characteristics live in the device table.
       vertical_accuracy_m  REAL CONSTRAINT record_vertical_accuracy_positive
                            CHECK (vertical_accuracy_m IS NULL OR vertical_accuracy_m > 0),

       -- Nullable and undefaulted on purpose. Spec §7.5: what the platform does
       -- not expose is recorded as unknown, never guessed. A DEFAULT 0 would make
       -- every unexamined row assert "not spoofed", which is a claim the app was
       -- never in a position to make.
       is_mocked            INTEGER CONSTRAINT record_is_mocked_boolean
                            CHECK (is_mocked IS NULL OR is_mocked IN (0, 1)),
       location_provider    TEXT,

       -- Conventions stored explicitly, because neither can be recovered from the
       -- number alone. Android's accuracy is the 68% confidence radius, not a
       -- maximum error; its altitude is above the WGS84 ellipsoid, several metres
       -- from mean sea level in Victoria.
       accuracy_convention  TEXT CONSTRAINT record_accuracy_convention_known
                            CHECK (accuracy_convention IS NULL OR
                                   accuracy_convention IN ('radius68', 'radius95', 'unknown')),
       altitude_reference   TEXT CONSTRAINT record_altitude_reference_known
                            CHECK (altitude_reference IS NULL OR
                                   altitude_reference IN ('wgs84Ellipsoid', 'meanSeaLevel')),

       captured_at       TEXT NOT NULL,
       gps_time          TEXT,
       device_id         TEXT NOT NULL REFERENCES device(id),

       attributes        TEXT NOT NULL DEFAULT '{}'
                         CONSTRAINT record_attributes_are_json CHECK (json_valid(attributes)),

       created_at        TEXT NOT NULL,
       updated_at        TEXT NOT NULL,
       deleted_at        TEXT,

       -- A deliberate fix was taken deliberately: it has an accuracy whose
       -- confidence level is stated, it has no age because it was taken just now,
       -- and it says how many readings it came from. A deliberate fix with no
       -- sample count is asserting survey grade on nothing.
       --
       -- The spread is NOT required here. The capture screen has two controls:
       -- SHARPEN averages readings while held, SAVE NOW is a single tap. A
       -- one-reading capture forced to supply a spread can only write 0, which
       -- asserts perfect agreement between readings that were never compared —
       -- exactly the plausible guess recorded as data this table exists to stop.
       -- The spread's real rule is record_spread_matches_sample_count below.
       --
       -- fix_hold_ms stays required and may be 0: she genuinely did not hold, and
       -- that is a true statement about a real capture rather than a guess.
       CONSTRAINT record_deliberate_is_survey_grade CHECK (
         fix_quality <> 'deliberate' OR
         (latitude IS NOT NULL AND longitude IS NOT NULL
          AND accuracy_m IS NOT NULL AND datum IS NOT NULL
          AND fix_age_seconds IS NULL
          AND fix_sample_count IS NOT NULL
          AND fix_hold_ms IS NOT NULL
          AND accuracy_convention IN ('radius68', 'radius95'))),

       -- An ambient fix has an accuracy and an age; a fix from four minutes ago
       -- is a different claim from one taken now. It has no averaging evidence,
       -- because nothing was averaged: an ambient fix wearing a held capture's
       -- sample count is exactly the blurring §8.2 forbids.
       CONSTRAINT record_ambient_carries_age CHECK (
         fix_quality <> 'ambient' OR
         (latitude IS NOT NULL AND longitude IS NOT NULL
          AND accuracy_m IS NOT NULL AND datum IS NOT NULL
          AND fix_age_seconds IS NOT NULL
          AND fix_sample_count IS NULL AND fix_spread_m IS NULL
          AND fix_hold_ms IS NULL)),

       -- No position means no position. Absent, never guessed — including the
       -- provenance of the position that does not exist: its provider, its
       -- satellite clock reading, and whether it was spoofed.
       CONSTRAINT record_none_has_no_position CHECK (
         fix_quality <> 'none' OR
         (latitude IS NULL AND longitude IS NULL
          AND accuracy_m IS NULL AND altitude_m IS NULL AND datum IS NULL
          AND fix_age_seconds IS NULL AND fix_sample_count IS NULL
          AND fix_spread_m IS NULL AND fix_hold_ms IS NULL
          AND vertical_accuracy_m IS NULL AND accuracy_convention IS NULL
          AND altitude_reference IS NULL
          AND location_provider IS NULL AND gps_time IS NULL
          AND is_mocked IS NULL)),

       -- Spread is the disagreement between readings, so it exists exactly when
       -- there were readings to disagree. With one sample it is not a small
       -- number, it is undefined, and NULL is how this schema says so. With more
       -- than one it was computed and must be stored, or the averaging evidence
       -- is a sample count with nothing behind it.
       --
       -- Defined after the three class clauses so an ambient or positionless row
       -- wearing a sample count still reports the class rule it actually broke.
       CONSTRAINT record_spread_matches_sample_count CHECK (
         fix_sample_count IS NULL OR
         (fix_sample_count = 1 AND fix_spread_m IS NULL) OR
         (fix_sample_count > 1 AND fix_spread_m IS NOT NULL)),

       -- A stored accuracy without its convention is a number whose meaning was lost.
       CONSTRAINT record_accuracy_has_convention CHECK (
         accuracy_m IS NULL OR accuracy_convention IS NOT NULL),

       -- The same rule one dimension up. The ellipsoid-to-geoid separation in
       -- Victoria is several metres, so an altitude with no stated reference is
       -- not a measurement (spec §7.5).
       CONSTRAINT record_altitude_has_reference CHECK (
         altitude_m IS NULL OR altitude_reference IS NOT NULL),

       -- Spoofing is knowable exactly when there is a position to spoof. With a
       -- position, the platform answered and the answer is stored; with none,
       -- there was no question to ask.
       CONSTRAINT record_mocked_known_when_positioned CHECK (
         (latitude IS NULL AND is_mocked IS NULL) OR
         (latitude IS NOT NULL AND is_mocked IS NOT NULL))
     )`,

    // Spec §7.2: sequence numbers restart with each activity, so "Pin 023" means
    // something in the survey she is running.
    `CREATE UNIQUE INDEX idx_record_sequence ON record(activity_id, sequence)`,
    `CREATE INDEX idx_record_activity ON record(activity_id, captured_at DESC)`,
    // Spec §10.2: records with no activity are the Inbox, a supported destination.
    // Deletion is soft everywhere (spec §6), so tombstones are not Inbox rows and
    // the index that counts the Inbox must not walk them.
    `CREATE INDEX idx_record_unfiled ON record(captured_at DESC)
       WHERE activity_id IS NULL AND deleted_at IS NULL`,
    `CREATE INDEX idx_record_context_activity ON record(context_activity_id, captured_at DESC)`,

    `CREATE TABLE event (
       id            TEXT PRIMARY KEY,
       record_id     TEXT REFERENCES record(id),
       action        TEXT NOT NULL CONSTRAINT event_action_known
                     CHECK (action IN ('created', 'edited', 'media_added', 'filed',
                                       'played', 'deleted', 'restored')),
       device_id     TEXT NOT NULL REFERENCES device(id),
       occurred_at   TEXT NOT NULL,
       latitude      REAL CONSTRAINT event_latitude_range
                     CHECK (latitude IS NULL OR (latitude BETWEEN -90 AND 90)),
       longitude     REAL CONSTRAINT event_longitude_range
                     CHECK (longitude IS NULL OR (longitude BETWEEN -180 AND 180)),
       accuracy_m    REAL CONSTRAINT event_accuracy_positive
                     CHECK (accuracy_m IS NULL OR accuracy_m > 0),

       -- An event stamp is provenance rather than the exported coordinate, so the
       -- stakes are lower — but it is the same rule, and a table that cannot state
       -- its own convention or datum teaches the next author that the rule is
       -- optional.
       accuracy_convention TEXT CONSTRAINT event_accuracy_convention_known
                           CHECK (accuracy_convention IS NULL OR
                                  accuracy_convention IN ('radius68', 'radius95', 'unknown')),
       datum         TEXT CONSTRAINT event_datum_known
                     CHECK (datum IS NULL OR datum IN ('WGS84', 'GDA94', 'AGD66')),

       fix_quality   TEXT CONSTRAINT event_fix_quality_known
                     CHECK (fix_quality IS NULL OR
                            fix_quality IN ('deliberate', 'ambient', 'none')),
       activity_id   TEXT REFERENCES activity(id),
       detail        TEXT,

       CONSTRAINT event_accuracy_has_convention CHECK (
         accuracy_m IS NULL OR accuracy_convention IS NOT NULL),
       CONSTRAINT event_position_has_datum CHECK (
         latitude IS NULL OR datum IS NOT NULL),
       CONSTRAINT event_none_has_no_position CHECK (
         fix_quality <> 'none' OR
         (latitude IS NULL AND longitude IS NULL AND accuracy_m IS NULL
          AND accuracy_convention IS NULL AND datum IS NULL))
     )`,

    `CREATE INDEX idx_event_record ON event(record_id, occurred_at)`,

    // Spec §8.5 calls the event log append-only, and chain of custody is only real
    // if the database says so: a comment cannot refuse an UPDATE. Rows are written
    // once; a correction is a new event, which is what an audit trail is for.
    //
    // These triggers only close the hole when `recursive_triggers` is ON, which
    // SQLite does NOT do by default. `INSERT OR REPLACE` deletes the conflicting
    // row to make room, and with the pragma off SQLite skips the BEFORE DELETE
    // trigger for that deletion — so `INSERT OR REPLACE INTO event` silently
    // rewrote an existing event and returned success. Every adapter that opens
    // this database MUST set `recursive_triggers = ON`; see
    // src/db/better-sqlite3.ts. `DROP TABLE` does not fire the delete trigger
    // either, which is what keeps a future table rebuild possible.
    `CREATE TRIGGER event_is_append_only_on_update
       BEFORE UPDATE ON event
       BEGIN
         SELECT RAISE(ABORT, 'event is append-only: rows cannot be updated');
       END`,
    `CREATE TRIGGER event_is_append_only_on_delete
       BEFORE DELETE ON event
       BEGIN
         SELECT RAISE(ABORT, 'event is append-only: rows cannot be deleted');
       END`,
  ],
}
