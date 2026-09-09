import type { Migration } from '../db/migrate'

/**
 * Photos and voice notes attached to a record (spec §7.1, §12.1).
 *
 * This table holds the ROWS; `@corymbia/media` holds the bytes. The split is
 * deliberate and the invariant between them is one-directional: a row without
 * its file is a broken record, a file without its row is garbage. So a file is
 * written before its row is inserted, and the file is removed if the insert
 * fails — never the other way round.
 *
 * `media_kind_known`'s list is one of THREE statements of the same fact, and
 * all three change together: this CHECK, `MediaKind` in `@corymbia/media`, and
 * the `EXTENSION` map beside it that says what each kind is written as. A kind
 * added here alone is a row nothing can name a file for; a kind added there
 * alone fails this constraint mid-capture on a field device.
 *
 * `file_name` is derived from the media id, not from the record and an index
 * (spec §12.1). Two consequences show up here: the name can be UNIQUE across
 * the whole table for the life of the database, and `ordinal` is free to be
 * display order alone — reusable once an attachment is soft-deleted, because
 * no file's name depends on it.
 *
 * **Deletion is soft, and that is load-bearing.** The row is flagged and the
 * file stays on disk. `media_is_never_hard_deleted` is what makes that true
 * rather than conventional: a hard DELETE would lose the only record that a
 * file on disk was ever attached to anything, and nothing could then find
 * that file by anything but its bare name in a directory listing. That
 * matters most for a purge — and the purge spec §12.1 puts in settings is
 * **not yet built**, so for now the flagged row is what keeps a removed
 * attachment's bytes accounted for at all, while nothing ever clears them
 * (see `docs/media-storage.md` §5). Both triggers here need
 * `PRAGMA recursive_triggers = ON` for the same reason migration 003's do —
 * with it off, `INSERT OR REPLACE` deletes the conflicting row and SQLite
 * SKIPS the BEFORE DELETE trigger for that deletion.
 */
export const migration005: Migration = {
  id: '005-media',
  up: [
    `CREATE TABLE media (
       id           TEXT PRIMARY KEY,

       record_id    TEXT NOT NULL REFERENCES record(id),

       kind         TEXT NOT NULL
                    CONSTRAINT media_kind_known CHECK (kind IN ('photo', 'voice')),

       -- The name in the media directory, derived from the id at capture. Never
       -- rewritten: see media_file_name_is_immutable below.
       file_name    TEXT NOT NULL,

       -- What the file actually took on disk, measured after the write. Zero
       -- means the capture failed and reported success, which must not be
       -- storable — it would show as a photo she does not have.
       byte_size    INTEGER NOT NULL
                    CONSTRAINT media_byte_size_positive CHECK (byte_size > 0),

       -- Voice notes carry a length; photos carry none. One constraint states
       -- both halves so the two cannot drift apart.
       duration_ms  INTEGER
                    CONSTRAINT media_duration_matches_kind
                    CHECK ((kind = 'voice' AND duration_ms IS NOT NULL AND duration_ms > 0)
                        OR (kind = 'photo' AND duration_ms IS NULL)),

       -- Display order within the record, from 1. Not part of any filename.
       ordinal      INTEGER NOT NULL
                    CONSTRAINT media_ordinal_positive CHECK (ordinal > 0),

       captured_at  TEXT NOT NULL,
       deleted_at   TEXT,
       created_at   TEXT NOT NULL,
       updated_at   TEXT NOT NULL
     )`,

    // Across every row, deleted included: a soft-deleted attachment's file is
    // still on disk, so its name must never be handed to a new one.
    `CREATE UNIQUE INDEX idx_media_file_name ON media(file_name)`,

    // Live rows only. Removing the second of three photos must not leave a
    // permanent hole at position 2.
    `CREATE UNIQUE INDEX idx_media_record_ordinal
       ON media(record_id, ordinal) WHERE deleted_at IS NULL`,

    `CREATE INDEX idx_media_record ON media(record_id) WHERE deleted_at IS NULL`,

    `CREATE TRIGGER media_file_name_is_immutable
       BEFORE UPDATE OF file_name ON media
       WHEN OLD.file_name IS NOT NEW.file_name
       BEGIN
         SELECT RAISE(ABORT, 'media_file_name_is_immutable');
       END`,

    `CREATE TRIGGER media_is_never_hard_deleted
       BEFORE DELETE ON media
       BEGIN
         SELECT RAISE(ABORT, 'media_is_never_hard_deleted');
       END`,
  ],
}
