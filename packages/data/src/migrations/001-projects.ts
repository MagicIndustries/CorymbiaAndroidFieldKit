import type { Migration } from '../db/migrate'

/**
 * Client → Project → Activity, with locations attached to projects (spec §7.1).
 *
 * Two rows are seeded because §7.3 requires every project to have a client and a
 * location structurally, while never asking the user for either. A skipped client
 * becomes "Corymbia (internal)" and a skipped location "Office / Lab", so the data
 * stays well-formed when she types a name and moves on.
 *
 * Soft deletion throughout: `deleted_at` is set, rows are never removed.
 */
export const migration001: Migration = {
  id: '001-projects',
  up: [
    `CREATE TABLE client (
       id          TEXT PRIMARY KEY,
       name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
       contact     TEXT,
       created_at  TEXT NOT NULL,
       updated_at  TEXT NOT NULL,
       deleted_at  TEXT
     )`,

    `CREATE TABLE location (
       id          TEXT PRIMARY KEY,
       name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
       latitude    REAL,
       longitude   REAL,
       datum       TEXT CHECK (datum IN ('WGS84', 'GDA94', 'AGD66')),
       created_at  TEXT NOT NULL,
       updated_at  TEXT NOT NULL,
       deleted_at  TEXT
     )`,

    `CREATE TABLE project (
       id           TEXT PRIMARY KEY,
       name         TEXT NOT NULL CHECK (length(trim(name)) > 0),
       short_label  TEXT,
       description  TEXT,
       client_id    TEXT NOT NULL REFERENCES client(id),
       status       TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'archived')),
       created_at   TEXT NOT NULL,
       updated_at   TEXT NOT NULL,
       deleted_at   TEXT
     )`,

    `CREATE TABLE project_location (
       project_id   TEXT NOT NULL REFERENCES project(id),
       location_id  TEXT NOT NULL REFERENCES location(id),
       PRIMARY KEY (project_id, location_id)
     )`,

    `CREATE TABLE activity (
       id           TEXT PRIMARY KEY,
       project_id   TEXT NOT NULL REFERENCES project(id),
       kind         TEXT NOT NULL
                    CHECK (kind IN ('survey', 'sampling', 'collection', 'workshop', 'meeting')),
       name         TEXT NOT NULL CHECK (length(trim(name)) > 0),
       short_label  TEXT,
       started_at   TEXT NOT NULL,
       ended_at     TEXT,
       created_at   TEXT NOT NULL,
       updated_at   TEXT NOT NULL,
       deleted_at   TEXT
     )`,

    `CREATE INDEX idx_activity_project ON activity(project_id, started_at DESC)`,
    `CREATE INDEX idx_project_status ON project(status, updated_at DESC)`,

    `INSERT INTO client (id, name, created_at, updated_at)
     VALUES ('client-internal', 'Corymbia (internal)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,

    `INSERT INTO location (id, name, created_at, updated_at)
     VALUES ('location-office', 'Office / Lab', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
  ],
}
