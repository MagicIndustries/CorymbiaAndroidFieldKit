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
 *
 * A record carries TWO numbers, because they answer different questions
 * (spec §7.2):
 *
 *  * `capture_number` — assigned the moment anything is recorded, unique across
 *    the database, and never changed again. This is the number that is safe to
 *    write in marker on a sample tube, because nothing will ever move it.
 *  * `sequence` — the ordinal WITHIN an activity, which is what makes
 *    "Pin 023" mean something in the survey she is running. A record that is
 *    not in an activity does not have one, and filing a record into the middle
 *    of an activity renumbers the records at and after that position — as does
 *    moving it to a new position within that activity, or refiling it out of
 *    the activity altogether, which closes the gap behind it — so this number
 *    is explicitly not stable.
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

       -- The number she can write on a tube. Assigned once, at capture, unique
       -- across the whole database (idx_record_capture_number below), and never
       -- touched again by filing, reordering or deletion — a label that stops
       -- matching the thing it labels is worse than no label. NOT NULL because
       -- every record has one from the instant it exists: there is no state in
       -- which a capture has happened and this is still unknown.
       --
       -- "Never touched again" used to be true only by convention: nothing in
       -- this file stopped an UPDATE naming capture_number, and INSERT OR
       -- REPLACE INTO record against an existing id replaced the whole row,
       -- capture_number included, with no foreign-key complaint from the event
       -- rows that name it. record_capture_number_is_immutable and
       -- record_is_never_hard_deleted, below the indexes, are what make the
       -- comment true instead of aspirational — the same reasoning the event
       -- table's two triggers already state: a comment cannot refuse an UPDATE.
       capture_number    INTEGER NOT NULL
                         CONSTRAINT record_capture_number_positive
                         CHECK (capture_number > 0),

       -- The ordinal within an activity, and nothing else. Nullable because the
       -- Inbox is a supported destination (spec §10.2) and a record that is in
       -- no activity has no position in one — NOT NULL here forced unfiled
       -- records into their own run of numbers, which then collided with the
       -- target activity's the moment anything was filed.
       sequence          INTEGER
                         CONSTRAINT record_sequence_positive
                         CHECK (sequence IS NULL OR sequence > 0),

       -- When this record was placed into the activity it is in NOW by a filing
       -- decision, rather than captured straight into it. NULL means "captured
       -- in place" (or still in the Inbox), so the Inbox screen can show at a
       -- glance which records arrived by filing without asking the event log a
       -- question per row.
       --
       -- "Now" matters because a record can be refiled from one activity to
       -- another to correct a misfiling: refileRecord overwrites this, because
       -- the record did not arrive in its new activity at capture either, and
       -- keeping the older timestamp would leave the column answering a
       -- question about an activity the record is no longer in. Reordering
       -- within one activity never touches it.
       --
       -- It is written in the same transaction as the filing, and by nothing
       -- else; the 'filed' events remain the source of truth for where, on
       -- which device, and out of which activity each filing happened.
       filed_at          TEXT,

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
       -- The one magnitude with no natural sign rule, so it gets an explicit
       -- envelope instead. The Dead Sea shore (-430 m) is the lowest dry land and
       -- Everest is 8848 m; Victoria spans roughly 0 to 1986 m. A GNSS glitch
       -- reporting -3000 or 40000 is not an altitude, and an unbounded column is
       -- the one place a garbage number reaches an export unchallenged.
       altitude_m        REAL CONSTRAINT record_altitude_range
                         CHECK (altitude_m IS NULL OR (altitude_m BETWEEN -500 AND 9000)),
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

       -- Nullable and undefaulted on purpose, but NOT so that a platform which
       -- declines to report mocked status can write NULL here:
       -- record_mocked_known_when_positioned below makes NULL unreachable for
       -- any row that carries a position, so a capture whose platform never
       -- said is refused rather than stored as unknown. That refusal is the
       -- intended behaviour — a fix that cannot show it was not spoofed is not
       -- evidence (spec §7.5) — and the caller has to deal with it before the
       -- insert, not by writing a NULL.
       --
       -- Two things need the column nullable anyway:
       --
       --  * The 'none' class. record_none_has_no_position requires
       --    is_mocked IS NULL: with no position there was nothing to spoof and
       --    no question to ask, so NOT NULL here would make a positionless
       --    record unwritable.
       --  * Rows this build did not write. A restored backup, a sync peer, or a
       --    database predating this migration can carry NULL under a position,
       --    and the read path types it "boolean or null" so such a row reads as
       --    "unknown" rather than as "not spoofed".
       --
       -- A DEFAULT 0 is refused for a third reason: it would make every
       -- unexamined row assert "not spoofed", a claim the app was never in a
       -- position to make, and it would silently break the 'none' class.
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

       -- json_valid() alone admits scalars: '1234' and '"pin"' are valid JSON.
       -- A scalar here does not fail loudly — json_extract() returns NULL for
       -- every path, so the kind-specific fields arrive as silently missing
       -- rather than as an error. The object requirement costs the same.
       attributes        TEXT NOT NULL DEFAULT '{}'
                         CONSTRAINT record_attributes_are_json
                         CHECK (json_valid(attributes) AND json_type(attributes) = 'object'),

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

       -- Half a coordinate is not a coordinate. This says so on its own, because
       -- the three clauses above pair latitude and longitude only as a side
       -- effect of the fix_quality discriminant: add a fourth quality value
       -- without a fourth clause and position silently becomes unconstrained.
       -- Defined after those clauses so a wrong deliberate or ambient row still
       -- reports the class rule it actually broke.
       CONSTRAINT record_position_is_paired CHECK (
         (latitude IS NULL AND longitude IS NULL) OR
         (latitude IS NOT NULL AND longitude IS NOT NULL)),

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
         (latitude IS NOT NULL AND is_mocked IS NOT NULL)),

       -- The sequence IS the position in an activity, so the two exist together
       -- or neither does. Without this, an Inbox record could still carry a
       -- number that means nothing (the bug this migration was rewritten to
       -- remove), and a filed record could carry none at all — which
       -- idx_record_sequence would happily accept, because SQLite treats NULLs
       -- in a unique index as distinct and would let a whole activity's records
       -- sit there unnumbered.
       CONSTRAINT record_sequence_tracks_activity CHECK (
         (activity_id IS NULL AND sequence IS NULL) OR
         (activity_id IS NOT NULL AND sequence IS NOT NULL)),

       -- A record cannot have been filed into nothing. Keeps the denormalised
       -- flag from outliving the filing it records — the one way it could drift
       -- from the event log that a same-transaction write does not already
       -- close.
       CONSTRAINT record_filed_at_needs_activity CHECK (
         filed_at IS NULL OR activity_id IS NOT NULL)
     )`,

    // Spec §7.2: sequence numbers restart with each activity, so "Pin 023" means
    // something in the survey she is running.
    //
    // Deliberately not partial on deleted_at: a tombstone keeps its number, so a
    // new or newly filed record cannot be handed a dead record's ordinal. That
    // is also why the renumbering in repositories/records.ts has to shift
    // tombstones along with everything else.
    //
    // Unfiled records are all (NULL, NULL) here. SQLite treats NULLs in a unique
    // index as distinct, so the Inbox holds as many rows as it likes and this
    // index constrains exactly what it is meant to: ordering inside an activity.
    `CREATE UNIQUE INDEX idx_record_sequence ON record(activity_id, sequence)`,
    // The tube label. Unique across the database rather than per activity,
    // because the record it names may move between activities and the number
    // written on the tube may not move with it.
    `CREATE UNIQUE INDEX idx_record_capture_number ON record(capture_number)`,
    `CREATE INDEX idx_record_activity ON record(activity_id, captured_at DESC)`,
    // Spec §10.2: records with no activity are the Inbox, a supported destination.
    // Deletion is soft everywhere (spec §6), so tombstones are not Inbox rows and
    // the index that counts the Inbox must not walk them.
    `CREATE INDEX idx_record_unfiled ON record(captured_at DESC)
       WHERE activity_id IS NULL AND deleted_at IS NULL`,
    `CREATE INDEX idx_record_context_activity ON record(context_activity_id, captured_at DESC)`,

    // The tube label has the same standing as the event log below: a comment
    // saying "never touched again" is not enforcement, and a reviewer confirmed
    // against the real database that a bare `UPDATE record SET capture_number =
    // ...` succeeds silently. These two triggers are what
    // event_is_append_only_on_update / _on_delete are to the event table,
    // adapted to one immutable column on a table that is otherwise mutable.
    //
    // record_capture_number_is_immutable only fires when the value actually
    // changes (the WHEN clause). Without it, `fileRecord`, `moveRecord`,
    // `refileRecord` and the soft delete would all be refused — every one of
    // them UPDATEs the record row, and several name capture_number in their
    // column list without changing it.
    //
    // That trigger alone does NOT close `INSERT OR REPLACE INTO record` against
    // an existing id: REPLACE conflict resolution deletes the conflicting row
    // and inserts the new one, which is not an UPDATE at all, so a trigger on
    // UPDATE OF capture_number never runs on that path — confirmed by tracing
    // it with better-sqlite3 directly rather than assumed, because this is
    // exactly the kind of fix that reads as complete until someone tries the
    // other route in. record_is_never_hard_deleted closes it instead, the same
    // way event_is_append_only_on_delete closes the equivalent hole for the
    // event table: it needs `recursive_triggers = ON` to fire on the row REPLACE
    // deletes to make room, which is why every adapter that opens this database
    // sets it (src/db/better-sqlite3.ts, src/db/expo.ts). No record is ever
    // hard-deleted in this codebase — deletion is soft, via deleted_at — so this
    // also turns that into a stated invariant rather than one that merely
    // happens to hold because nothing has tried otherwise yet.
    `CREATE TRIGGER record_capture_number_is_immutable
       BEFORE UPDATE OF capture_number ON record
       WHEN NEW.capture_number <> OLD.capture_number
       BEGIN
         SELECT RAISE(ABORT, 'capture_number is immutable: it is the label written on a ' ||
                              'sample tube, assigned once at capture and never reassigned');
       END`,
    `CREATE TRIGGER record_is_never_hard_deleted
       BEFORE DELETE ON record
       BEGIN
         SELECT RAISE(ABORT, 'record rows are never hard-deleted: deletion is soft, via ' ||
                              'deleted_at, which is also what keeps INSERT OR REPLACE from ' ||
                              'rewriting an existing record — including its capture_number — ' ||
                              'by deleting the row out from under its id');
       END`,

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

       -- Spec §7.5 asks that a mocked position be distinguishable from a real
       -- one, and spec §8.5 writes a context stamp on every change. Without this
       -- column a 'filed' or 'deleted' event carrying a spoofed position records
       -- it as indistinguishable from a real one. Nullable and undefaulted for
       -- the same reason as the record column: a default would make every
       -- unexamined row assert "not spoofed".
       is_mocked     INTEGER CONSTRAINT event_is_mocked_boolean
                     CHECK (is_mocked IS NULL OR is_mocked IN (0, 1)),

       activity_id   TEXT REFERENCES activity(id),
       detail        TEXT,

       CONSTRAINT event_accuracy_has_convention CHECK (
         accuracy_m IS NULL OR accuracy_convention IS NOT NULL),
       CONSTRAINT event_position_has_datum CHECK (
         latitude IS NULL OR datum IS NOT NULL),

       -- The event table enforced its 'none' class and neither of the other two,
       -- so a stamp could claim a deliberate fix and carry no coordinates at all
       -- — a row the record table makes impossible. The stamps come from the same
       -- ContextStamp union, so the classes mean the same thing in both tables
       -- and a table that will not state its own convention teaches the next
       -- author that the rule is optional. The event table holds no age, sample
       -- count, spread or hold, so these say what this table can say.
       CONSTRAINT event_deliberate_has_position CHECK (
         fix_quality IS NULL OR fix_quality <> 'deliberate' OR
         (latitude IS NOT NULL AND longitude IS NOT NULL
          AND accuracy_m IS NOT NULL AND datum IS NOT NULL
          AND accuracy_convention IN ('radius68', 'radius95'))),
       CONSTRAINT event_ambient_has_position CHECK (
         fix_quality IS NULL OR fix_quality <> 'ambient' OR
         (latitude IS NOT NULL AND longitude IS NOT NULL
          AND accuracy_m IS NOT NULL AND datum IS NOT NULL)),
       CONSTRAINT event_none_has_no_position CHECK (
         fix_quality <> 'none' OR
         (latitude IS NULL AND longitude IS NULL AND accuracy_m IS NULL
          AND accuracy_convention IS NULL AND datum IS NULL
          AND is_mocked IS NULL)),

       -- Half a coordinate is not a coordinate, stated independently of the
       -- discriminant for the same reason as on the record table.
       CONSTRAINT event_position_is_paired CHECK (
         (latitude IS NULL AND longitude IS NULL) OR
         (latitude IS NOT NULL AND longitude IS NOT NULL)),

       -- Spoofing is knowable exactly when there is a position to spoof.
       CONSTRAINT event_mocked_known_when_positioned CHECK (
         (latitude IS NULL AND is_mocked IS NULL) OR
         (latitude IS NOT NULL AND is_mocked IS NOT NULL))
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
