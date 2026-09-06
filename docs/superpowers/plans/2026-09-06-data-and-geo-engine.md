# Data and Geo Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the two packages the whole application rests on — `@corymbia/data` (SQLite schema, migrations, repositories, the append-only event log) and `@corymbia/geo` (fix acquisition, hold-averaging, the ambient position cache, proximity and duplicate detection) — and prove them against a real GPS on the Samsung S25 with a deliberately plain diagnostic screen.

**Architecture:** Both packages keep their logic away from their I/O. `data` talks to SQLite through a small `Database` port, with an `expo-sqlite` adapter on device and a `better-sqlite3` adapter in tests, so every migration, constraint and query is exercised by real SQL in CI rather than mocked. `geo` splits pure mathematics — averaging, trend, distance, classification — from a thin `expo-location` wrapper, so the parts that decide whether a coordinate is scientifically defensible are unit-testable without a device.

**Tech Stack:** TypeScript (strict), `expo-sqlite`, `expo-location`, `better-sqlite3` (test-only), Jest with `jest-expo`, existing pnpm/Turborepo workspace.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-09-05-corymbia-field-kit-design.md`, §7 and §8. Every requirement below traces to it.
- **This is Plan 2 of 7.** Plan 1 (foundation and design system) is merged. Plan 3 builds the capture screen on top of this.
- **Exactly one ESLint config, at the repo root** (`eslint.config.mjs`). ESLint 9 resolves `eslint.config.js` ahead of `.mjs`; a second config silently disables the first. This has happened once already.
- **Three architectural lint rules are live** and `pnpm run lint:verify-rules` proves they fire: no raw hex or `ramp` import outside the token layer; no window-dimension reads outside `packages/ui/src/layout/useLayout.ts`; no cross-tool imports. Run it after any config change.
- **Every package needs `lint`, `test` and `typecheck` scripts** or `pnpm turbo run` silently skips it — a package running zero checks looks identical to one that passes.
- **Resolved dependency pins**, matching the app: expo SDK `~57.0.20`, react `19.2.3`, react-native `0.86.3`, jest-expo `~57.0.0`, `@testing-library/react-native` `^14.0.1`, `test-renderer` `^1.2.0`. Never `*` or `latest` — a mismatched React causes a duplicate-React runtime failure that is miserable to diagnose.
- **`@testing-library/react-native` is v14:** `render` and `fireEvent` are async; `toHaveTextContent` defaults to exact whole-string matching.
- **TypeScript `~6.0.3`, strict, with `noUncheckedIndexedAccess`.** No `any`.
- **`expo run:android` never exits** — it keeps Metro alive by design. To confirm an install landed: `adb shell dumpsys package eco.corymbia.fieldkit | grep lastUpdateTime`.
- **`app.json` changes only reach a build via `npx expo prebuild --platform android`.** Permissions are `app.json` config; skipping prebuild means the permission is not in the manifest and the request fails silently at runtime.
- **Datum is recorded explicitly, and only ever the one actually measured.** Android returns **WGS84** and the app performs no transformation, so WGS84 is what every device-derived position stores. The permitted vocabulary is `WGS84 | GDA94 | AGD66` — the three the Victorian Biodiversity Atlas accepts, so export is a lookup rather than a conversion. **GDA2020 is not accepted by the VBA** and must not appear. See `docs/research/2026-09-06-victorian-biodiversity-destinations.md` §5.3.
- **Store the fix summary, not every reading**: sample count, spread and hold duration on the record. Not one row per GPS sample.
- **Store GPS time alongside device time.** Field tablets drift; a satellite fix carries an authoritative clock.
- **Sequence numbers are per activity**, restarting with each one.
- **Deletion is soft.** Rows are flagged, never removed.
- **Only the project name is required.** A skipped client becomes `Corymbia (internal)`; a skipped location becomes `Office / Lab`.
- **Duplicate guard warns, never blocks.** Default threshold 5 m.
- Conventional-commit prefixes. Stage only the paths a task names — never `git add -A`; the repo carries unrelated pre-existing deletions under `.agents/skills/tauri/`.

---

## The distinction this plan exists to protect

Spec §8.2 draws a line the rest of the product depends on:

| Class | How it is obtained | What it means |
| --- | --- | --- |
| `deliberate` | Taken on the capture screen. Accuracy-gated, averaged if held. | Survey-grade. Exports as a real coordinate. |
| `ambient` | Whatever position is cached. Never waits, never blocks, never gates. Carries its age. | Opportunistic. Exports explicitly labelled. |
| `none` | Indoors, cold start, GPS off. | Recorded as absent, never guessed. |

`@corymbia/ui`'s `ContextStamp` already models this as a discriminated union so an accuracy-less fix cannot be constructed. **The data layer must be equally strict.** A `deliberate` row without an accuracy, or an `ambient` row without an age, is a corrupt scientific record, and the schema — not a convention — is what should prevent it.

---

## File Structure

```
packages/data/
  src/db/port.ts                 the Database interface both adapters satisfy
  src/db/expo.ts                 expo-sqlite adapter (device)
  src/db/better-sqlite3.ts       test adapter, real SQL in Node
  src/db/migrate.ts              migration runner
  src/migrations/001-projects.ts client, project, location, project_location, activity
  src/migrations/002-records.ts  record, event
  src/migrations/index.ts        ordered list
  src/ids.ts                     UUID generation
  src/time.ts                    ISO-8601 helpers, device vs GPS clock
  src/kinds.ts                   record kinds and their attribute validators
  src/repositories/projects.ts
  src/repositories/activities.ts
  src/repositories/records.ts
  src/repositories/events.ts
  src/index.ts
  src/**/__tests__/*.test.ts

packages/geo/
  src/distance.ts                haversine, bearing-free
  src/classify.ts                fix quality classification
  src/average.ts                 hold-averaging and spread
  src/trend.ts                   "still improving" vs "as good as it gets"
  src/duplicate.ts               proximity guard
  src/nearest.ts                 nearest known location
  src/location/port.ts           the LocationSource interface
  src/location/expo.ts           expo-location adapter
  src/location/fake.ts           scripted adapter for tests
  src/ambient-cache.ts           last-known position with age
  src/index.ts
  src/**/__tests__/*.test.ts

apps/fieldkit/
  app/diagnostics.tsx            the on-device proving screen
  src/db/provider.tsx            opens the database, exposes it via context
```

---

### Task 1: The `data` package and its Database port

**Files:**
- Create: `packages/data/package.json`, `tsconfig.json`, `jest.config.js`, `babel.config.js`, `src/db/port.ts`, `src/db/better-sqlite3.ts`, `src/index.ts`
- Test: `packages/data/src/db/__tests__/better-sqlite3.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type SqlValue = string | number | null`
  - `interface Database { execute(sql: string, params?: SqlValue[]): Promise<void>; all<T>(sql: string, params?: SqlValue[]): Promise<T[]>; first<T>(sql: string, params?: SqlValue[]): Promise<T | null>; transaction<T>(fn: () => Promise<T>): Promise<T>; close(): Promise<void> }`
  - `openTestDatabase(): Promise<Database>` — an in-memory SQLite database for tests.

**Why a port:** `expo-sqlite` cannot run in Node, so without this every repository test would mock the database and prove nothing about the SQL. With it, tests execute real SQLite — migrations, constraints, indexes and all — and the device adapter is a thin translation layer.

- [ ] **Step 1: Create the package manifest**

`packages/data/package.json`:

```json
{
  "name": "@corymbia/data",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "jest",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "better-sqlite3": "^11.7.0",
    "jest-expo": "~57.0.0",
    "react": "19.2.3",
    "react-native": "0.86.3"
  }
}
```

- [ ] **Step 2: Copy the shared config**

Copy `packages/ui/tsconfig.json`, `jest.config.js` and `babel.config.js` into `packages/data/`, then remove the `setupFilesAfterEach` entry from the jest config — this package has no React components and needs no testing-library setup. The final `jest.config.js`:

```js
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.ts'],
}
```

Then `pnpm install` from the repo root.

- [ ] **Step 3: Write the failing test**

`packages/data/src/db/__tests__/better-sqlite3.test.ts`:

```ts
import { openTestDatabase } from '../better-sqlite3'
import type { Database } from '../port'

describe('the test database adapter', () => {
  let db: Database

  beforeEach(async () => {
    db = await openTestDatabase()
    await db.execute('CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER NOT NULL)')
  })

  afterEach(async () => {
    await db.close()
  })

  it('executes statements and reads rows back', async () => {
    await db.execute('INSERT INTO t (id, n) VALUES (?, ?)', ['a', 1])
    await db.execute('INSERT INTO t (id, n) VALUES (?, ?)', ['b', 2])
    const rows = await db.all<{ id: string; n: number }>('SELECT id, n FROM t ORDER BY n')
    expect(rows).toEqual([
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
    ])
  })

  it('returns null rather than throwing when a single row is absent', async () => {
    expect(await db.first('SELECT id FROM t WHERE id = ?', ['missing'])).toBeNull()
  })

  it('enforces constraints, so the schema is genuinely under test', async () => {
    await db.execute('INSERT INTO t (id, n) VALUES (?, ?)', ['a', 1])
    await expect(db.execute('INSERT INTO t (id, n) VALUES (?, ?)', ['a', 9])).rejects.toThrow()
  })

  it('rolls a transaction back when the body throws', async () => {
    await expect(
      db.transaction(async () => {
        await db.execute('INSERT INTO t (id, n) VALUES (?, ?)', ['x', 1])
        throw new Error('deliberate')
      }),
    ).rejects.toThrow('deliberate')
    expect(await db.all('SELECT id FROM t')).toEqual([])
  })

  it('commits a transaction that completes', async () => {
    await db.transaction(async () => {
      await db.execute('INSERT INTO t (id, n) VALUES (?, ?)', ['x', 1])
    })
    expect(await db.all('SELECT id FROM t')).toHaveLength(1)
  })

  it('enforces foreign keys, which SQLite disables by default', async () => {
    await db.execute('CREATE TABLE child (id TEXT PRIMARY KEY, t_id TEXT NOT NULL REFERENCES t(id))')
    await expect(
      db.execute('INSERT INTO child (id, t_id) VALUES (?, ?)', ['c', 'nonexistent']),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @corymbia/data test`
Expected: FAIL — `Cannot find module '../better-sqlite3'`.

- [ ] **Step 5: Write `packages/data/src/db/port.ts`**

```ts
/** The only value types this application stores. Booleans are 0/1, dates are ISO-8601 text. */
export type SqlValue = string | number | null

/**
 * The narrow surface both SQLite adapters satisfy: `expo-sqlite` on device,
 * `better-sqlite3` in tests. Keeping it this small is what lets every
 * repository test run against real SQL rather than a mock — the schema,
 * its constraints and its indexes are then genuinely under test.
 */
export interface Database {
  execute(sql: string, params?: SqlValue[]): Promise<void>
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>
  first<T>(sql: string, params?: SqlValue[]): Promise<T | null>
  transaction<T>(fn: () => Promise<T>): Promise<T>
  close(): Promise<void>
}
```

- [ ] **Step 6: Write `packages/data/src/db/better-sqlite3.ts`**

```ts
import BetterSqlite3 from 'better-sqlite3'
import type { Database, SqlValue } from './port'

/**
 * An in-memory database for tests. `better-sqlite3` is synchronous; the async
 * signatures exist so the same repository code runs unchanged against
 * `expo-sqlite` on device.
 *
 * Foreign keys are enabled explicitly because SQLite disables them by default —
 * without this, a test would happily insert an orphaned row and the schema's
 * relationships would be decorative.
 */
export async function openTestDatabase(): Promise<Database> {
  const db = new BetterSqlite3(':memory:')
  db.pragma('foreign_keys = ON')

  return {
    async execute(sql, params = []) {
      db.prepare(sql).run(...(params as SqlValue[]))
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      return db.prepare(sql).all(...params) as T[]
    },
    async first<T>(sql: string, params: SqlValue[] = []) {
      return (db.prepare(sql).get(...params) as T | undefined) ?? null
    },
    async transaction<T>(fn: () => Promise<T>) {
      db.prepare('BEGIN').run()
      try {
        const result = await fn()
        db.prepare('COMMIT').run()
        return result
      } catch (error) {
        db.prepare('ROLLBACK').run()
        throw error
      }
    },
    async close() {
      db.close()
    },
  }
}
```

- [ ] **Step 7: Write `packages/data/src/index.ts`**

```ts
export type { Database, SqlValue } from './db/port'
export { openTestDatabase } from './db/better-sqlite3'
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm --filter @corymbia/data test`
Expected: PASS — 6 tests.

Run: `pnpm --filter @corymbia/data lint && pnpm --filter @corymbia/data typecheck`
Expected: both clean.

- [ ] **Step 9: Commit**

```bash
git add packages/data pnpm-lock.yaml
git commit -m "feat(data): add the Database port and a real-SQL test adapter"
```

---

### Task 2: Migrations and the schema for projects and activities

**Files:**
- Create: `packages/data/src/db/migrate.ts`, `src/migrations/001-projects.ts`, `src/migrations/index.ts`
- Modify: `packages/data/src/index.ts`
- Test: `packages/data/src/db/__tests__/migrate.test.ts`

**Interfaces:**
- Consumes: `Database`, `openTestDatabase`.
- Produces:
  - `type Migration = { id: string; up: string[] }`
  - `migrations: Migration[]` — ordered.
  - `migrate(db: Database): Promise<string[]>` — applies pending migrations, returns the ids applied.

**Schema, from spec §7.1 and §7.3.** Only the tables this plan uses are created; `media`, `record_link`, `batch` and `batch_item` arrive with the plans that need them, each with its own migration. Creating tables nothing writes to invites drift.

- [ ] **Step 1: Write the failing test**

`packages/data/src/db/__tests__/migrate.test.ts`:

```ts
import { openTestDatabase } from '../better-sqlite3'
import { migrate } from '../migrate'
import type { Database } from '../port'

async function tableNames(db: Database): Promise<string[]> {
  const rows = await db.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )
  return rows.map((r) => r.name)
}

describe('migrate', () => {
  let db: Database
  beforeEach(async () => {
    db = await openTestDatabase()
  })
  afterEach(async () => {
    await db.close()
  })

  it('creates the project and activity tables', async () => {
    await migrate(db)
    const names = await tableNames(db)
    expect(names).toEqual(
      expect.arrayContaining(['activity', 'client', 'location', 'project', 'project_location']),
    )
  })

  it('reports which migrations it applied', async () => {
    expect(await migrate(db)).toContain('001-projects')
  })

  it('is idempotent — running twice applies nothing the second time', async () => {
    await migrate(db)
    expect(await migrate(db)).toEqual([])
  })

  it('seeds the default client and location that §7.3 requires', async () => {
    await migrate(db)
    const client = await db.first<{ name: string }>('SELECT name FROM client WHERE id = ?', [
      'client-internal',
    ])
    const location = await db.first<{ name: string }>('SELECT name FROM location WHERE id = ?', [
      'location-office',
    ])
    expect(client?.name).toBe('Corymbia (internal)')
    expect(location?.name).toBe('Office / Lab')
  })

  it('refuses a project with no name', async () => {
    await migrate(db)
    await expect(
      db.execute(
        'INSERT INTO project (id, name, client_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ['p1', '', 'client-internal', '2026-09-06T00:00:00Z', '2026-09-06T00:00:00Z'],
      ),
    ).rejects.toThrow()
  })

  it('refuses an activity whose kind is not one of the five in the spec', async () => {
    await migrate(db)
    await db.execute(
      'INSERT INTO project (id, name, client_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['p1', 'Yarra Flats', 'client-internal', '2026-09-06T00:00:00Z', '2026-09-06T00:00:00Z'],
    )
    await expect(
      db.execute(
        'INSERT INTO activity (id, project_id, kind, name, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['a1', 'p1', 'picnic', 'Nope', '2026-09-06T00:00:00Z', '2026-09-06T00:00:00Z', '2026-09-06T00:00:00Z'],
      ),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @corymbia/data test migrate`
Expected: FAIL — `Cannot find module '../migrate'`.

- [ ] **Step 3: Write `packages/data/src/migrations/001-projects.ts`**

```ts
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
```

- [ ] **Step 4: Write `packages/data/src/migrations/index.ts`**

```ts
import type { Migration } from '../db/migrate'
import { migration001 } from './001-projects'

/** Ordered. Never reorder or edit a shipped migration — add a new one. */
export const migrations: Migration[] = [migration001]
```

- [ ] **Step 5: Write `packages/data/src/db/migrate.ts`**

```ts
import type { Database } from './port'
import { migrations } from '../migrations'

export type Migration = {
  id: string
  /** Statements applied in order, inside one transaction. */
  up: string[]
}

/**
 * Applies any migration not yet recorded in `schema_migration`, each inside its
 * own transaction so a failure leaves the database on the last good version
 * rather than half-migrated.
 *
 * Returns the ids applied, so a caller can log what happened on a device where
 * nobody is watching a console.
 */
export async function migrate(db: Database): Promise<string[]> {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS schema_migration (
       id          TEXT PRIMARY KEY,
       applied_at  TEXT NOT NULL
     )`,
  )

  const applied = await db.all<{ id: string }>('SELECT id FROM schema_migration')
  const done = new Set(applied.map((row) => row.id))
  const ran: string[] = []

  for (const migration of migrations) {
    if (done.has(migration.id)) continue
    await db.transaction(async () => {
      for (const statement of migration.up) {
        await db.execute(statement)
      }
      await db.execute('INSERT INTO schema_migration (id, applied_at) VALUES (?, ?)', [
        migration.id,
        new Date().toISOString(),
      ])
    })
    ran.push(migration.id)
  }

  return ran
}
```

- [ ] **Step 6: Re-export from `packages/data/src/index.ts`**

```ts
export type { Database, SqlValue } from './db/port'
export { openTestDatabase } from './db/better-sqlite3'
export { migrate } from './db/migrate'
export type { Migration } from './db/migrate'
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @corymbia/data test`
Expected: PASS — 12 tests.

- [ ] **Step 8: Commit**

```bash
git add packages/data
git commit -m "feat(data): add the migration runner and the project and activity schema"
```

---

### Task 3: The record and event schema

**Files:**
- Create: `packages/data/src/migrations/002-records.ts`
- Modify: `packages/data/src/migrations/index.ts`
- Test: `packages/data/src/db/__tests__/records-schema.test.ts`

**Interfaces:**
- Consumes: `Migration`, `migrate`, `openTestDatabase`.
- Produces: the `record` and `event` tables. No new TypeScript exports.

**This is the task where the spec's scientific integrity requirement becomes a database constraint.** Spec §8.2 says a deliberate fix is accuracy-gated and an ambient one carries its age. The schema enforces exactly that, so a corrupt record cannot be written even by code that has forgotten the rule.

- [ ] **Step 1: Write the failing test**

`packages/data/src/db/__tests__/records-schema.test.ts`:

```ts
import { openTestDatabase } from '../better-sqlite3'
import { migrate } from '../migrate'
import type { Database } from '../port'

const NOW = '2026-09-06T09:14:00+10:00'

async function seedActivity(db: Database): Promise<void> {
  await db.execute(
    'INSERT INTO project (id, name, client_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ['p1', 'Yarra Flats', 'client-internal', NOW, NOW],
  )
  await db.execute(
    'INSERT INTO activity (id, project_id, kind, name, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['a1', 'p1', 'survey', 'Survey 3', NOW, NOW, NOW],
  )
}

async function insertRecord(db: Database, over: Record<string, unknown> = {}): Promise<void> {
  const row = {
    id: 'r1',
    activity_id: 'a1',
    kind: 'pin',
    sequence: 1,
    title: null,
    short_label: null,
    description: null,
    latitude: -37.82141,
    longitude: 145.03318,
    accuracy_m: 4,
    altitude_m: 62,
    datum: 'WGS84',
    fix_quality: 'deliberate',
    fix_age_seconds: null,
    fix_sample_count: 7,
    fix_spread_m: 1.2,
    fix_hold_ms: 4200,
    captured_at: NOW,
    gps_time: NOW,
    device_id: 'field-s24',
    attributes: '{}',
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    ...over,
  }
  const columns = Object.keys(row)
  await db.execute(
    `INSERT INTO record (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    Object.values(row) as (string | number | null)[],
  )
}

describe('the record schema', () => {
  let db: Database
  beforeEach(async () => {
    db = await openTestDatabase()
    await migrate(db)
    await seedActivity(db)
  })
  afterEach(async () => {
    await db.close()
  })

  it('accepts a well-formed deliberate fix', async () => {
    await insertRecord(db)
    expect(await db.all('SELECT id FROM record')).toHaveLength(1)
  })

  it('refuses a deliberate fix with no accuracy — the whole point of the class', async () => {
    await expect(insertRecord(db, { accuracy_m: null })).rejects.toThrow()
  })

  it('refuses a deliberate fix that claims an age; it was taken just now', async () => {
    await expect(insertRecord(db, { fix_age_seconds: 240 })).rejects.toThrow()
  })

  it('accepts an ambient fix carrying its age', async () => {
    await insertRecord(db, {
      id: 'r2',
      fix_quality: 'ambient',
      accuracy_m: 38,
      fix_age_seconds: 240,
      fix_sample_count: null,
      fix_spread_m: null,
      fix_hold_ms: null,
    })
    expect(await db.all('SELECT id FROM record')).toHaveLength(1)
  })

  it('refuses an ambient fix with no accuracy', async () => {
    await expect(
      insertRecord(db, { id: 'r3', fix_quality: 'ambient', accuracy_m: null, fix_age_seconds: 60 }),
    ).rejects.toThrow()
  })

  it('accepts a record with no position at all, recorded as absent', async () => {
    await insertRecord(db, {
      id: 'r4',
      fix_quality: 'none',
      latitude: null,
      longitude: null,
      accuracy_m: null,
      altitude_m: null,
      datum: null,
      fix_age_seconds: null,
      fix_sample_count: null,
      fix_spread_m: null,
      fix_hold_ms: null,
    })
    expect(await db.all('SELECT id FROM record')).toHaveLength(1)
  })

  it('refuses a positionless record that nonetheless carries coordinates', async () => {
    await expect(
      insertRecord(db, { id: 'r5', fix_quality: 'none', accuracy_m: null }),
    ).rejects.toThrow()
  })

  it('refuses a datum the destination does not accept', async () => {
    // The VBA takes exactly WGS84, GDA94 and AGD66. GDA2020 is not one of them,
    // and the app never produces it — Android returns WGS84 and nothing here
    // transforms it. See docs/research/2026-09-06-victorian-biodiversity-destinations.md §5.3.
    await expect(insertRecord(db, { id: 'r6', datum: 'GDA2020' })).rejects.toThrow()
  })

  it('keeps sequence numbers unique per activity, not per project', async () => {
    await insertRecord(db)
    await expect(insertRecord(db, { id: 'r7', sequence: 1 })).rejects.toThrow()

    await db.execute(
      'INSERT INTO activity (id, project_id, kind, name, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['a2', 'p1', 'survey', 'Survey 4', NOW, NOW, NOW],
    )
    await insertRecord(db, { id: 'r8', activity_id: 'a2', sequence: 1 })
    expect(await db.all('SELECT id FROM record')).toHaveLength(2)
  })

  it('stores an event with its own context stamp', async () => {
    await insertRecord(db)
    await db.execute(
      `INSERT INTO event (id, record_id, action, device_id, occurred_at, latitude, longitude, accuracy_m, fix_quality, activity_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['e1', 'r1', 'created', 'field-s24', NOW, -37.82141, 145.03318, 4, 'deliberate', 'a1'],
    )
    const event = await db.first<{ action: string }>('SELECT action FROM event WHERE id = ?', ['e1'])
    expect(event?.action).toBe('created')
  })

  it('refuses an event action outside the known set', async () => {
    await insertRecord(db)
    await expect(
      db.execute(
        'INSERT INTO event (id, record_id, action, device_id, occurred_at) VALUES (?, ?, ?, ?, ?)',
        ['e2', 'r1', 'teleported', 'field-s24', NOW],
      ),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @corymbia/data test records-schema`
Expected: FAIL — `no such table: record`.

- [ ] **Step 3: Write `packages/data/src/migrations/002-records.ts`**

```ts
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
export const migration002: Migration = {
  id: '002-records',
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

       captured_at       TEXT NOT NULL,
       gps_time          TEXT,
       device_id         TEXT NOT NULL,

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
               AND fix_spread_m IS NULL AND fix_hold_ms IS NULL))
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
       device_id     TEXT NOT NULL,
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
```

- [ ] **Step 4: Register it in `packages/data/src/migrations/index.ts`**

```ts
import type { Migration } from '../db/migrate'
import { migration001 } from './001-projects'
import { migration002 } from './002-records'

/** Ordered. Never reorder or edit a shipped migration — add a new one. */
export const migrations: Migration[] = [migration001, migration002]
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @corymbia/data test`
Expected: PASS — 23 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/data
git commit -m "feat(data): add the record spine and event log, with fix integrity as constraints"
```

---

### Task 4: Ids, time, and record kinds

**Files:**
- Create: `packages/data/src/ids.ts`, `src/time.ts`, `src/kinds.ts`
- Modify: `packages/data/src/index.ts`
- Test: `packages/data/src/__tests__/ids.test.ts`, `src/__tests__/time.test.ts`, `src/__tests__/kinds.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `newId(prefix: string): string` — e.g. `newId('rec')` → `rec_01J...`
  - `nowIso(): string` — ISO-8601 with offset.
  - `type RecordKind = 'pin'`
  - `type PinAttributes = Record<string, never>`
  - `validateAttributes(kind: RecordKind, value: unknown): Record<string, unknown>` — throws on invalid, returns the parsed object.
  - `serialiseAttributes(kind: RecordKind, value: unknown): string`

**On not adding a validation library:** `pin` currently has no kind-specific attributes — its title, description and position are real columns. A schema library would be four dependencies to validate an empty object. Hand-rolled validators stay honest until a kind actually has fields, at which point revisit.

- [ ] **Step 1: Write the failing tests**

`packages/data/src/__tests__/ids.test.ts`:

```ts
import { newId } from '../ids'

describe('newId', () => {
  it('prefixes the id so a stray value is identifiable in a log', () => {
    expect(newId('rec')).toMatch(/^rec_[0-9a-z]+$/i)
  })

  it('does not collide across many calls', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => newId('rec')))
    expect(ids.size).toBe(5000)
  })

  it('sorts lexicographically in creation order, so ids are useful as a tiebreak', async () => {
    const first = newId('rec')
    await new Promise((r) => setTimeout(r, 5))
    const second = newId('rec')
    expect([second, first].sort()).toEqual([first, second])
  })
})
```

`packages/data/src/__tests__/time.test.ts`:

```ts
import { nowIso } from '../time'

describe('nowIso', () => {
  it('includes an offset, so a record keeps the local time it was taken at', () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$/)
  })

  it('round-trips through Date without losing the instant', () => {
    const iso = nowIso()
    expect(new Date(iso).toISOString()).toBe(new Date(iso).toISOString())
    expect(Number.isNaN(new Date(iso).getTime())).toBe(false)
  })
})
```

`packages/data/src/__tests__/kinds.test.ts`:

```ts
import { serialiseAttributes, validateAttributes } from '../kinds'

describe('record kind attributes', () => {
  it('accepts an empty object for a pin, which has no kind-specific fields yet', () => {
    expect(validateAttributes('pin', {})).toEqual({})
  })

  it('rejects a pin carrying unexpected attributes rather than silently storing them', () => {
    expect(() => validateAttributes('pin', { species: 'Eucalyptus' })).toThrow(/species/)
  })

  it('rejects a non-object', () => {
    expect(() => validateAttributes('pin', 'nope')).toThrow()
    expect(() => validateAttributes('pin', null)).toThrow()
  })

  it('serialises to JSON ready for the attributes column', () => {
    expect(serialiseAttributes('pin', {})).toBe('{}')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @corymbia/data test ids`
Expected: FAIL — `Cannot find module '../ids'`.

- [ ] **Step 3: Write `packages/data/src/ids.ts`**

```ts
/**
 * Time-ordered, prefixed identifiers.
 *
 * Lexicographic order matching creation order matters because these ids end up
 * in exported filenames and in the event log, where sorting by id should not
 * shuffle a day's captures. The timestamp is milliseconds since the epoch in
 * base 36, left-padded so the width stays constant into the year 5000, followed
 * by randomness to separate ids created in the same millisecond.
 */
const TIME_WIDTH = 9

function randomSuffix(length: number): string {
  let out = ''
  for (let i = 0; i < length; i += 1) {
    out += Math.floor(Math.random() * 36).toString(36)
  }
  return out
}

export function newId(prefix: string): string {
  const time = Date.now().toString(36).padStart(TIME_WIDTH, '0')
  return `${prefix}_${time}${randomSuffix(10)}`
}
```

- [ ] **Step 4: Write `packages/data/src/time.ts`**

```ts
/**
 * ISO-8601 with the device's UTC offset, rather than a bare `Z`.
 *
 * Spec §7.4 keeps GPS time alongside device time because field tablets drift.
 * Keeping the offset means a record also remembers the local time it was taken
 * at, which is what a field notebook would have recorded and what makes a
 * dataset readable months later.
 */
export function nowIso(date: Date = new Date()): string {
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const pad = (n: number): string => String(Math.floor(Math.abs(n))).padStart(2, '0')
  const offset =
    offsetMinutes === 0 ? 'Z' : `${sign}${pad(offsetMinutes / 60)}:${pad(offsetMinutes % 60)}`

  const local = new Date(date.getTime() + offsetMinutes * 60_000)
  return `${local.toISOString().slice(0, 19)}${offset}`
}
```

- [ ] **Step 5: Write `packages/data/src/kinds.ts`**

```ts
/**
 * Record kinds and their attribute validators (spec §7.2).
 *
 * `pin` is the only kind in this implementation. Its title, description and
 * position are real columns, so it has no kind-specific attributes at all —
 * which is why there is no schema library here. Adding one to validate an empty
 * object would be four dependencies earning nothing. When a kind gains real
 * fields, revisit that decision rather than extending these by hand forever.
 */
export type RecordKind = 'pin'

export type PinAttributes = Record<string, never>

const ALLOWED_KEYS: Record<RecordKind, readonly string[]> = {
  pin: [],
}

export function validateAttributes(kind: RecordKind, value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Attributes for a ${kind} must be an object, received ${typeof value}`)
  }
  const allowed = ALLOWED_KEYS[kind]
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unexpected.length > 0) {
    throw new Error(
      `Unexpected attribute(s) for a ${kind}: ${unexpected.join(', ')}. ` +
        `Add the field to ALLOWED_KEYS in kinds.ts, or store it in a real column.`,
    )
  }
  return value as Record<string, unknown>
}

export function serialiseAttributes(kind: RecordKind, value: unknown): string {
  return JSON.stringify(validateAttributes(kind, value))
}
```

- [ ] **Step 6: Re-export and run**

Add to `packages/data/src/index.ts`:

```ts
export { newId } from './ids'
export { nowIso } from './time'
export { validateAttributes, serialiseAttributes } from './kinds'
export type { RecordKind, PinAttributes } from './kinds'
```

Run: `pnpm --filter @corymbia/data test`
Expected: PASS — 32 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/data
git commit -m "feat(data): add ids, timestamps and record-kind attribute validation"
```

---

### Task 5: Project and activity repositories

**Files:**
- Create: `packages/data/src/repositories/projects.ts`, `src/repositories/activities.ts`
- Modify: `packages/data/src/index.ts`
- Test: `packages/data/src/repositories/__tests__/projects.test.ts`, `__tests__/activities.test.ts`

**Interfaces:**
- Consumes: `Database`, `newId`, `nowIso`, `migrate`.
- Produces:
  - `type Project = { id: string; name: string; shortLabel: string | null; description: string | null; clientId: string; status: 'active' | 'archived'; createdAt: string; updatedAt: string }`
  - `createProject(db, input: { name: string; shortLabel?: string; description?: string; clientId?: string; locationIds?: string[] }): Promise<Project>`
  - `listProjects(db): Promise<Project[]>` — active first, most recently updated first, soft-deleted excluded.
  - `getProject(db, id): Promise<Project | null>`
  - `type ActivityKind = 'survey' | 'sampling' | 'collection' | 'workshop' | 'meeting'`
  - `type Activity = { id: string; projectId: string; kind: ActivityKind; name: string; shortLabel: string | null; startedAt: string; endedAt: string | null }`
  - `createActivity(db, input: { projectId: string; kind: ActivityKind; name: string; shortLabel?: string }): Promise<Activity>`
  - `listActivities(db, projectId): Promise<Activity[]>` — most recent first.
  - `mostRecentActivity(db): Promise<Activity | null>` — what the launcher resumes.

**Spec §7.3 is the behaviour to get right:** only the name is required. A skipped client becomes the seeded `client-internal`; a skipped location list attaches the seeded `location-office`. She types a name and moves on.

- [ ] **Step 1: Write the failing tests**

`packages/data/src/repositories/__tests__/projects.test.ts`:

```ts
import { openTestDatabase } from '../../db/better-sqlite3'
import { migrate } from '../../db/migrate'
import type { Database } from '../../db/port'
import { createProject, getProject, listProjects } from '../projects'

describe('projects', () => {
  let db: Database
  beforeEach(async () => {
    db = await openTestDatabase()
    await migrate(db)
  })
  afterEach(async () => {
    await db.close()
  })

  it('creates a project from a name alone', async () => {
    const project = await createProject(db, { name: 'Yarra Flats' })
    expect(project.name).toBe('Yarra Flats')
    expect(project.status).toBe('active')
  })

  it('defaults a skipped client to Corymbia (internal), never asking for one', async () => {
    const project = await createProject(db, { name: 'Yarra Flats' })
    expect(project.clientId).toBe('client-internal')
  })

  it('attaches the Office / Lab location when none is given', async () => {
    const project = await createProject(db, { name: 'Yarra Flats' })
    const rows = await db.all<{ location_id: string }>(
      'SELECT location_id FROM project_location WHERE project_id = ?',
      [project.id],
    )
    expect(rows).toEqual([{ location_id: 'location-office' }])
  })

  it('attaches the locations given instead of the default', async () => {
    await db.execute(
      'INSERT INTO location (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      ['loc-1', 'North Reach', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'],
    )
    const project = await createProject(db, { name: 'Yarra Flats', locationIds: ['loc-1'] })
    const rows = await db.all<{ location_id: string }>(
      'SELECT location_id FROM project_location WHERE project_id = ?',
      [project.id],
    )
    expect(rows).toEqual([{ location_id: 'loc-1' }])
  })

  it('refuses a blank name, the one genuinely required field', async () => {
    await expect(createProject(db, { name: '   ' })).rejects.toThrow(/name/i)
  })

  it('reads a project back by id', async () => {
    const created = await createProject(db, { name: 'Yarra Flats', shortLabel: 'Yarra' })
    const found = await getProject(db, created.id)
    expect(found?.shortLabel).toBe('Yarra')
  })

  it('returns null for an unknown id rather than throwing', async () => {
    expect(await getProject(db, 'nope')).toBeNull()
  })

  it('lists most recently updated first', async () => {
    const first = await createProject(db, { name: 'One' })
    await new Promise((r) => setTimeout(r, 5))
    const second = await createProject(db, { name: 'Two' })
    expect((await listProjects(db)).map((p) => p.id)).toEqual([second.id, first.id])
  })

  it('excludes soft-deleted projects', async () => {
    const project = await createProject(db, { name: 'Gone' })
    await db.execute('UPDATE project SET deleted_at = ? WHERE id = ?', [
      '2026-09-06T00:00:00Z',
      project.id,
    ])
    expect(await listProjects(db)).toEqual([])
  })
})
```

`packages/data/src/repositories/__tests__/activities.test.ts`:

```ts
import { openTestDatabase } from '../../db/better-sqlite3'
import { migrate } from '../../db/migrate'
import type { Database } from '../../db/port'
import { createActivity, listActivities, mostRecentActivity } from '../activities'
import { createProject } from '../projects'

describe('activities', () => {
  let db: Database
  let projectId: string

  beforeEach(async () => {
    db = await openTestDatabase()
    await migrate(db)
    projectId = (await createProject(db, { name: 'Yarra Flats' })).id
  })
  afterEach(async () => {
    await db.close()
  })

  it('creates an activity from a project, kind and name', async () => {
    const activity = await createActivity(db, {
      projectId,
      kind: 'survey',
      name: 'Survey 3',
    })
    expect(activity.kind).toBe('survey')
    expect(activity.endedAt).toBeNull()
  })

  it('refuses a blank name', async () => {
    await expect(
      createActivity(db, { projectId, kind: 'survey', name: '  ' }),
    ).rejects.toThrow(/name/i)
  })

  it('refuses an unknown project rather than orphaning the activity', async () => {
    await expect(
      createActivity(db, { projectId: 'nope', kind: 'survey', name: 'Survey 3' }),
    ).rejects.toThrow()
  })

  it('lists most recent first', async () => {
    const first = await createActivity(db, { projectId, kind: 'survey', name: 'One' })
    await new Promise((r) => setTimeout(r, 5))
    const second = await createActivity(db, { projectId, kind: 'sampling', name: 'Two' })
    expect((await listActivities(db, projectId)).map((a) => a.id)).toEqual([second.id, first.id])
  })

  it('reports the most recent activity across all projects, for the launcher to resume', async () => {
    await createActivity(db, { projectId, kind: 'survey', name: 'One' })
    await new Promise((r) => setTimeout(r, 5))
    const latest = await createActivity(db, { projectId, kind: 'sampling', name: 'Two' })
    expect((await mostRecentActivity(db))?.id).toBe(latest.id)
  })

  it('returns null when nothing has been started yet', async () => {
    expect(await mostRecentActivity(db)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @corymbia/data test repositories`
Expected: FAIL — `Cannot find module '../projects'`.

- [ ] **Step 3: Write `packages/data/src/repositories/projects.ts`**

```ts
import type { Database } from '../db/port'
import { newId } from '../ids'
import { nowIso } from '../time'

export const DEFAULT_CLIENT_ID = 'client-internal'
export const DEFAULT_LOCATION_ID = 'location-office'

export type Project = {
  id: string
  name: string
  shortLabel: string | null
  description: string | null
  clientId: string
  status: 'active' | 'archived'
  createdAt: string
  updatedAt: string
}

type ProjectRow = {
  id: string
  name: string
  short_label: string | null
  description: string | null
  client_id: string
  status: 'active' | 'archived'
  created_at: string
  updated_at: string
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    shortLabel: row.short_label,
    description: row.description,
    clientId: row.client_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const SELECT = `SELECT id, name, short_label, description, client_id, status, created_at, updated_at
                FROM project WHERE deleted_at IS NULL`

/**
 * Spec §7.3: only the name is required. A skipped client becomes
 * "Corymbia (internal)" and a skipped location "Office / Lab", so she can type a
 * name and move on while the data stays well-formed. Neither is ever asked for
 * at creation.
 */
export async function createProject(
  db: Database,
  input: {
    name: string
    shortLabel?: string
    description?: string
    clientId?: string
    locationIds?: string[]
  },
): Promise<Project> {
  const name = input.name.trim()
  if (name.length === 0) {
    throw new Error('A project needs a name; everything else has a default.')
  }

  const id = newId('prj')
  const at = nowIso()
  const clientId = input.clientId ?? DEFAULT_CLIENT_ID
  const locationIds =
    input.locationIds && input.locationIds.length > 0 ? input.locationIds : [DEFAULT_LOCATION_ID]

  await db.transaction(async () => {
    await db.execute(
      `INSERT INTO project (id, name, short_label, description, client_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
      [id, name, input.shortLabel ?? null, input.description ?? null, clientId, at, at],
    )
    for (const locationId of locationIds) {
      await db.execute(
        'INSERT INTO project_location (project_id, location_id) VALUES (?, ?)',
        [id, locationId],
      )
    }
  })

  const created = await getProject(db, id)
  if (!created) throw new Error(`Project ${id} vanished immediately after being created.`)
  return created
}

export async function getProject(db: Database, id: string): Promise<Project | null> {
  const row = await db.first<ProjectRow>(`${SELECT} AND id = ?`, [id])
  return row ? toProject(row) : null
}

export async function listProjects(db: Database): Promise<Project[]> {
  const rows = await db.all<ProjectRow>(
    `${SELECT} ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at DESC, id DESC`,
  )
  return rows.map(toProject)
}
```

- [ ] **Step 4: Write `packages/data/src/repositories/activities.ts`**

```ts
import type { Database } from '../db/port'
import { newId } from '../ids'
import { nowIso } from '../time'

export type ActivityKind = 'survey' | 'sampling' | 'collection' | 'workshop' | 'meeting'

export type Activity = {
  id: string
  projectId: string
  kind: ActivityKind
  name: string
  shortLabel: string | null
  startedAt: string
  endedAt: string | null
}

type ActivityRow = {
  id: string
  project_id: string
  kind: ActivityKind
  name: string
  short_label: string | null
  started_at: string
  ended_at: string | null
}

function toActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    name: row.name,
    shortLabel: row.short_label,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  }
}

const SELECT = `SELECT id, project_id, kind, name, short_label, started_at, ended_at
                FROM activity WHERE deleted_at IS NULL`

export async function createActivity(
  db: Database,
  input: { projectId: string; kind: ActivityKind; name: string; shortLabel?: string },
): Promise<Activity> {
  const name = input.name.trim()
  if (name.length === 0) {
    throw new Error('An activity needs a name.')
  }

  const id = newId('act')
  const at = nowIso()
  await db.execute(
    `INSERT INTO activity (id, project_id, kind, name, short_label, started_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.projectId, input.kind, name, input.shortLabel ?? null, at, at, at],
  )

  const row = await db.first<ActivityRow>(`${SELECT} AND id = ?`, [id])
  if (!row) throw new Error(`Activity ${id} vanished immediately after being created.`)
  return toActivity(row)
}

export async function listActivities(db: Database, projectId: string): Promise<Activity[]> {
  const rows = await db.all<ActivityRow>(
    `${SELECT} AND project_id = ? ORDER BY started_at DESC, id DESC`,
    [projectId],
  )
  return rows.map(toActivity)
}

/**
 * The activity the launcher resumes (spec §10.1). The application assumes rather
 * than asks: whatever she was doing last is already selected, with capture live
 * on the screen.
 */
export async function mostRecentActivity(db: Database): Promise<Activity | null> {
  const row = await db.first<ActivityRow>(`${SELECT} ORDER BY started_at DESC, id DESC LIMIT 1`)
  return row ? toActivity(row) : null
}
```

- [ ] **Step 5: Re-export and run**

Add to `packages/data/src/index.ts`:

```ts
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
```

Run: `pnpm --filter @corymbia/data test`
Expected: PASS — 47 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/data
git commit -m "feat(data): add project and activity repositories with spec-defaulted fields"
```

---

### Task 6: The record repository and the event log

**Files:**
- Create: `packages/data/src/repositories/records.ts`, `src/repositories/events.ts`
- Modify: `packages/data/src/index.ts`
- Test: `packages/data/src/repositories/__tests__/records.test.ts`, `__tests__/events.test.ts`

**Interfaces:**
- Consumes: `Database`, `newId`, `nowIso`, `serialiseAttributes`, `RecordKind`.
- Produces:
  - `type Fix = { quality: 'deliberate'; latitude: number; longitude: number; accuracyM: number; altitudeM: number | null; datum: Datum; sampleCount: number; spreadM: number; holdMs: number } | { quality: 'ambient'; latitude: number; longitude: number; accuracyM: number; altitudeM: number | null; datum: Datum; ageSeconds: number } | { quality: 'none' }`
  - `type FieldRecord = { id: string; activityId: string | null; kind: RecordKind; sequence: number; title: string | null; description: string | null; fix: Fix; capturedAt: string; gpsTime: string | null; deviceId: string; attributes: Record<string, unknown> }`
  - `createRecord(db, input: { activityId: string | null; kind: RecordKind; fix: Fix; deviceId: string; title?: string; description?: string; gpsTime?: string; attributes?: unknown }): Promise<FieldRecord>`
  - `listRecords(db, activityId: string): Promise<FieldRecord[]>`
  - `listUnfiledRecords(db): Promise<FieldRecord[]>`
  - `softDeleteRecord(db, id, deviceId): Promise<void>`
  - `appendEvent(db, input: { recordId: string | null; action: EventAction; deviceId: string; fix?: Fix; activityId?: string | null; detail?: string }): Promise<void>`
  - `listEvents(db, recordId): Promise<EventEntry[]>`
  - `type EventAction = 'created' | 'edited' | 'media_added' | 'filed' | 'played' | 'deleted' | 'restored'`

**The `Fix` discriminated union mirrors `ContextStamp`'s** in `@corymbia/ui` and the CHECK constraints in migration 002. Three representations of the same rule, deliberately: the type stops it being written, the constraint stops it being stored, and the component stops it being displayed wrongly.

- [ ] **Step 1: Write the failing tests**

`packages/data/src/repositories/__tests__/records.test.ts`:

```ts
import { openTestDatabase } from '../../db/better-sqlite3'
import { migrate } from '../../db/migrate'
import type { Database } from '../../db/port'
import { createActivity } from '../activities'
import { createProject } from '../projects'
import { listEvents } from '../events'
import { createRecord, listRecords, listUnfiledRecords, softDeleteRecord } from '../records'
import type { Fix } from '../records'

const DELIBERATE: Fix = {
  quality: 'deliberate',
  latitude: -37.82141,
  longitude: 145.03318,
  accuracyM: 4,
  altitudeM: 62,
  datum: 'WGS84',
  sampleCount: 7,
  spreadM: 1.2,
  holdMs: 4200,
}

const AMBIENT: Fix = {
  quality: 'ambient',
  latitude: -37.82088,
  longitude: 145.03402,
  accuracyM: 38,
  altitudeM: null,
  datum: 'WGS84',
  ageSeconds: 240,
}

describe('records', () => {
  let db: Database
  let activityId: string

  beforeEach(async () => {
    db = await openTestDatabase()
    await migrate(db)
    const project = await createProject(db, { name: 'Yarra Flats' })
    activityId = (
      await createActivity(db, { projectId: project.id, kind: 'survey', name: 'Survey 3' })
    ).id
  })
  afterEach(async () => {
    await db.close()
  })

  it('stores a deliberate fix with its full provenance', async () => {
    const record = await createRecord(db, {
      activityId,
      kind: 'pin',
      fix: DELIBERATE,
      deviceId: 'field-s24',
    })
    expect(record.fix).toEqual(DELIBERATE)
  })

  it('stores an ambient fix with its age', async () => {
    const record = await createRecord(db, {
      activityId,
      kind: 'pin',
      fix: AMBIENT,
      deviceId: 'field-s24',
    })
    expect(record.fix).toEqual(AMBIENT)
  })

  it('stores a record with no position at all', async () => {
    const record = await createRecord(db, {
      activityId,
      kind: 'pin',
      fix: { quality: 'none' },
      deviceId: 'field-s24',
    })
    expect(record.fix).toEqual({ quality: 'none' })
  })

  it('numbers records per activity, starting at 1', async () => {
    const first = await createRecord(db, {
      activityId,
      kind: 'pin',
      fix: DELIBERATE,
      deviceId: 'd',
    })
    const second = await createRecord(db, {
      activityId,
      kind: 'pin',
      fix: DELIBERATE,
      deviceId: 'd',
    })
    expect([first.sequence, second.sequence]).toEqual([1, 2])
  })

  it('restarts numbering for a different activity', async () => {
    await createRecord(db, { activityId, kind: 'pin', fix: DELIBERATE, deviceId: 'd' })
    const project = await createProject(db, { name: 'Other' })
    const other = await createActivity(db, {
      projectId: project.id,
      kind: 'survey',
      name: 'Survey 1',
    })
    const record = await createRecord(db, {
      activityId: other.id,
      kind: 'pin',
      fix: DELIBERATE,
      deviceId: 'd',
    })
    expect(record.sequence).toBe(1)
  })

  it('accepts a record with no activity — the Inbox is a supported destination', async () => {
    const record = await createRecord(db, {
      activityId: null,
      kind: 'pin',
      fix: AMBIENT,
      deviceId: 'd',
    })
    expect(record.activityId).toBeNull()
    expect((await listUnfiledRecords(db)).map((r) => r.id)).toEqual([record.id])
  })

  it('writes a creation event, so provenance exists without anyone remembering to log it', async () => {
    const record = await createRecord(db, {
      activityId,
      kind: 'pin',
      fix: DELIBERATE,
      deviceId: 'field-s24',
    })
    const events = await listEvents(db, record.id)
    expect(events.map((e) => e.action)).toEqual(['created'])
    expect(events[0]?.deviceId).toBe('field-s24')
  })

  it('lists an activity’s records most recent first', async () => {
    const first = await createRecord(db, {
      activityId,
      kind: 'pin',
      fix: DELIBERATE,
      deviceId: 'd',
    })
    await new Promise((r) => setTimeout(r, 5))
    const second = await createRecord(db, {
      activityId,
      kind: 'pin',
      fix: DELIBERATE,
      deviceId: 'd',
    })
    expect((await listRecords(db, activityId)).map((r) => r.id)).toEqual([second.id, first.id])
  })

  it('soft-deletes, keeping the row and logging the deletion', async () => {
    const record = await createRecord(db, {
      activityId,
      kind: 'pin',
      fix: DELIBERATE,
      deviceId: 'd',
    })
    await softDeleteRecord(db, record.id, 'd')

    expect(await listRecords(db, activityId)).toEqual([])
    const raw = await db.first<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM record WHERE id = ?',
      [record.id],
    )
    expect(raw?.deleted_at).not.toBeNull()
    expect((await listEvents(db, record.id)).map((e) => e.action)).toEqual(['created', 'deleted'])
  })

  it('rejects attributes that are not valid for the kind', async () => {
    await expect(
      createRecord(db, {
        activityId,
        kind: 'pin',
        fix: DELIBERATE,
        deviceId: 'd',
        attributes: { species: 'Eucalyptus' },
      }),
    ).rejects.toThrow(/species/)
  })
})
```

`packages/data/src/repositories/__tests__/events.test.ts`:

```ts
import { openTestDatabase } from '../../db/better-sqlite3'
import { migrate } from '../../db/migrate'
import type { Database } from '../../db/port'
import { appendEvent, listEvents } from '../events'

describe('the event log', () => {
  let db: Database
  beforeEach(async () => {
    db = await openTestDatabase()
    await migrate(db)
  })
  afterEach(async () => {
    await db.close()
  })

  it('records an action with the device it happened on', async () => {
    await appendEvent(db, { recordId: null, action: 'created', deviceId: 'field-s24' })
    const events = await listEvents(db, null)
    expect(events[0]?.deviceId).toBe('field-s24')
  })

  it('stamps an ambient position onto the event, not just the record', async () => {
    await appendEvent(db, {
      recordId: null,
      action: 'played',
      deviceId: 'tablet',
      fix: {
        quality: 'ambient',
        latitude: -37.8,
        longitude: 145.0,
        accuracyM: 38,
        altitudeM: null,
        datum: 'WGS84',
        ageSeconds: 240,
      },
    })
    const [event] = await listEvents(db, null)
    expect(event?.fixQuality).toBe('ambient')
    expect(event?.accuracyM).toBe(38)
  })

  it('accepts an event with no position', async () => {
    await appendEvent(db, { recordId: null, action: 'edited', deviceId: 'tablet' })
    expect((await listEvents(db, null))[0]?.fixQuality).toBeNull()
  })

  it('returns events oldest first, so a history reads as a narrative', async () => {
    await appendEvent(db, { recordId: null, action: 'created', deviceId: 'd' })
    await new Promise((r) => setTimeout(r, 5))
    await appendEvent(db, { recordId: null, action: 'edited', deviceId: 'd' })
    expect((await listEvents(db, null)).map((e) => e.action)).toEqual(['created', 'edited'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @corymbia/data test records`
Expected: FAIL — `Cannot find module '../records'`.

- [ ] **Step 3: Write `packages/data/src/repositories/events.ts`**

```ts
import type { Database } from '../db/port'
import { newId } from '../ids'
import { nowIso } from '../time'
import type { Fix } from './records'

export type EventAction =
  | 'created'
  | 'edited'
  | 'media_added'
  | 'filed'
  | 'played'
  | 'deleted'
  | 'restored'

export type EventEntry = {
  id: string
  recordId: string | null
  action: EventAction
  deviceId: string
  occurredAt: string
  latitude: number | null
  longitude: number | null
  accuracyM: number | null
  fixQuality: Fix['quality'] | null
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
  fix_quality: Fix['quality'] | null
  activity_id: string | null
  detail: string | null
}

/**
 * Append-only (spec §8.5). This is what makes chain-of-custody real rather than
 * aspirational: creation, edits, filing, playback and deletion each carry their
 * own context stamp, so a record's history says where and on which device every
 * change happened.
 *
 * There is deliberately no update or delete for events.
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
                        latitude, longitude, accuracy_m, fix_quality, activity_id, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId('evt'),
      input.recordId,
      input.action,
      input.deviceId,
      nowIso(),
      positioned?.latitude ?? null,
      positioned?.longitude ?? null,
      positioned?.accuracyM ?? null,
      input.fix?.quality ?? null,
      input.activityId ?? null,
      input.detail ?? null,
    ],
  )
}

export async function listEvents(db: Database, recordId: string | null): Promise<EventEntry[]> {
  const rows = await db.all<EventRow>(
    `SELECT id, record_id, action, device_id, occurred_at, latitude, longitude,
            accuracy_m, fix_quality, activity_id, detail
     FROM event
     WHERE record_id IS ?
     ORDER BY occurred_at ASC, id ASC`,
    [recordId],
  )
  return rows.map((row) => ({
    id: row.id,
    recordId: row.record_id,
    action: row.action,
    deviceId: row.device_id,
    occurredAt: row.occurred_at,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracyM: row.accuracy_m,
    fixQuality: row.fix_quality,
    activityId: row.activity_id,
    detail: row.detail,
  }))
}
```

- [ ] **Step 4: Write `packages/data/src/repositories/records.ts`**

```ts
import type { Database } from '../db/port'
import { newId } from '../ids'
import { serialiseAttributes, type RecordKind } from '../kinds'
import { nowIso } from '../time'
import { appendEvent } from './events'

/**
 * The three datums the Victorian Biodiversity Atlas accepts. GDA2020 is not one
 * of them, and the app never produces it: Android returns WGS84 and no
 * transformation is performed, so WGS84 is what device-derived positions store.
 * GDA94 and AGD66 exist for coordinates typed in from another source.
 */
export type Datum = 'WGS84' | 'GDA94' | 'AGD66'

/**
 * The three fix classes of spec §8.2, as a discriminated union so an
 * accuracy-less deliberate fix cannot be constructed. The same rule is enforced
 * by CHECK constraints in migration 002 and by `ContextStamp` in `@corymbia/ui`.
 * Three representations on purpose: the type stops it being written, the
 * constraint stops it being stored, the component stops it being shown wrongly.
 */
export type Fix =
  | {
      quality: 'deliberate'
      latitude: number
      longitude: number
      accuracyM: number
      altitudeM: number | null
      datum: Datum
      sampleCount: number
      spreadM: number
      holdMs: number
    }
  | {
      quality: 'ambient'
      latitude: number
      longitude: number
      accuracyM: number
      altitudeM: number | null
      datum: Datum
      ageSeconds: number
    }
  | { quality: 'none' }

export type FieldRecord = {
  id: string
  activityId: string | null
  kind: RecordKind
  sequence: number
  title: string | null
  description: string | null
  fix: Fix
  capturedAt: string
  gpsTime: string | null
  deviceId: string
  attributes: Record<string, unknown>
}

type RecordRow = {
  id: string
  activity_id: string | null
  kind: RecordKind
  sequence: number
  title: string | null
  description: string | null
  latitude: number | null
  longitude: number | null
  accuracy_m: number | null
  altitude_m: number | null
  datum: Datum | null
  fix_quality: Fix['quality']
  fix_age_seconds: number | null
  fix_sample_count: number | null
  fix_spread_m: number | null
  fix_hold_ms: number | null
  captured_at: string
  gps_time: string | null
  device_id: string
  attributes: string
}

function toFix(row: RecordRow): Fix {
  if (row.fix_quality === 'none') return { quality: 'none' }
  const shared = {
    latitude: row.latitude as number,
    longitude: row.longitude as number,
    accuracyM: row.accuracy_m as number,
    altitudeM: row.altitude_m,
    datum: row.datum as Datum,
  }
  return row.fix_quality === 'deliberate'
    ? {
        quality: 'deliberate',
        ...shared,
        sampleCount: row.fix_sample_count as number,
        spreadM: row.fix_spread_m as number,
        holdMs: row.fix_hold_ms as number,
      }
    : { quality: 'ambient', ...shared, ageSeconds: row.fix_age_seconds as number }
}

function toRecord(row: RecordRow): FieldRecord {
  return {
    id: row.id,
    activityId: row.activity_id,
    kind: row.kind,
    sequence: row.sequence,
    title: row.title,
    description: row.description,
    fix: toFix(row),
    capturedAt: row.captured_at,
    gpsTime: row.gps_time,
    deviceId: row.device_id,
    attributes: JSON.parse(row.attributes) as Record<string, unknown>,
  }
}

const SELECT = `SELECT id, activity_id, kind, sequence, title, description,
                       latitude, longitude, accuracy_m, altitude_m, datum,
                       fix_quality, fix_age_seconds, fix_sample_count, fix_spread_m, fix_hold_ms,
                       captured_at, gps_time, device_id, attributes
                FROM record WHERE deleted_at IS NULL`

/**
 * Sequence numbers restart with each activity (spec §7.2), so "Pin 023" means
 * something in the survey she is running. Unfiled records — the Inbox — number
 * in their own sequence.
 */
async function nextSequence(db: Database, activityId: string | null): Promise<number> {
  const row = await db.first<{ next: number }>(
    'SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM record WHERE activity_id IS ?',
    [activityId],
  )
  return row?.next ?? 1
}

export async function createRecord(
  db: Database,
  input: {
    activityId: string | null
    kind: RecordKind
    fix: Fix
    deviceId: string
    title?: string
    description?: string
    gpsTime?: string
    attributes?: unknown
  },
): Promise<FieldRecord> {
  const attributes = serialiseAttributes(input.kind, input.attributes ?? {})
  const id = newId('rec')
  const at = nowIso()
  const fix = input.fix
  const positioned = fix.quality !== 'none' ? fix : null

  await db.transaction(async () => {
    const sequence = await nextSequence(db, input.activityId)
    await db.execute(
      `INSERT INTO record (id, activity_id, kind, sequence, title, short_label, description,
                           latitude, longitude, accuracy_m, altitude_m, datum,
                           fix_quality, fix_age_seconds, fix_sample_count, fix_spread_m, fix_hold_ms,
                           captured_at, gps_time, device_id, attributes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.activityId,
        input.kind,
        sequence,
        input.title ?? null,
        input.description ?? null,
        positioned?.latitude ?? null,
        positioned?.longitude ?? null,
        positioned?.accuracyM ?? null,
        positioned?.altitudeM ?? null,
        positioned?.datum ?? null,
        fix.quality,
        fix.quality === 'ambient' ? fix.ageSeconds : null,
        fix.quality === 'deliberate' ? fix.sampleCount : null,
        fix.quality === 'deliberate' ? fix.spreadM : null,
        fix.quality === 'deliberate' ? fix.holdMs : null,
        at,
        input.gpsTime ?? null,
        input.deviceId,
        attributes,
        at,
        at,
      ],
    )
    await appendEvent(db, {
      recordId: id,
      action: 'created',
      deviceId: input.deviceId,
      fix,
      activityId: input.activityId,
    })
  })

  const row = await db.first<RecordRow>(`${SELECT} AND id = ?`, [id])
  if (!row) throw new Error(`Record ${id} vanished immediately after being created.`)
  return toRecord(row)
}

export async function listRecords(db: Database, activityId: string): Promise<FieldRecord[]> {
  const rows = await db.all<RecordRow>(
    `${SELECT} AND activity_id = ? ORDER BY captured_at DESC, id DESC`,
    [activityId],
  )
  return rows.map(toRecord)
}

/** Spec §10.2: capturing without a context is a supported path, not an error state. */
export async function listUnfiledRecords(db: Database): Promise<FieldRecord[]> {
  const rows = await db.all<RecordRow>(
    `${SELECT} AND activity_id IS NULL ORDER BY captured_at DESC, id DESC`,
  )
  return rows.map(toRecord)
}

/** Soft, per spec §12.1 — the row is flagged and the history keeps the deletion. */
export async function softDeleteRecord(
  db: Database,
  id: string,
  deviceId: string,
): Promise<void> {
  await db.transaction(async () => {
    await db.execute('UPDATE record SET deleted_at = ?, updated_at = ? WHERE id = ?', [
      nowIso(),
      nowIso(),
      id,
    ])
    await appendEvent(db, { recordId: id, action: 'deleted', deviceId })
  })
}
```

- [ ] **Step 5: Re-export and run**

Add to `packages/data/src/index.ts`:

```ts
export {
  createRecord,
  listRecords,
  listUnfiledRecords,
  softDeleteRecord,
} from './repositories/records'
export type { Fix, FieldRecord, Datum } from './repositories/records'
export { appendEvent, listEvents } from './repositories/events'
export type { EventAction, EventEntry } from './repositories/events'
```

Run: `pnpm --filter @corymbia/data test`
Expected: PASS — 62 tests.

Run: `pnpm turbo run lint typecheck --force`
Expected: clean across all workspaces.

- [ ] **Step 6: Commit**

```bash
git add packages/data
git commit -m "feat(data): add the record repository and the append-only event log"
```

---

### Task 7: The expo-sqlite adapter

**Files:**
- Create: `packages/data/src/db/expo.ts`
- Modify: `packages/data/package.json`, `packages/data/src/index.ts`
- Test: `packages/data/src/db/__tests__/expo.test.ts`

**Interfaces:**
- Consumes: `Database`, `SqlValue`.
- Produces: `openDatabase(name?: string): Promise<Database>` — the device adapter, defaulting to `fieldkit.db`.

**What can and cannot be tested here.** `expo-sqlite` does not run in Node, so this adapter is verified two ways: a unit test that it translates calls correctly against a stubbed `expo-sqlite` module, and the on-device diagnostic screen in Task 13, which is the only thing that proves it genuinely works. Say so plainly in the report rather than implying the unit test proves more than it does.

- [ ] **Step 1: Add the dependency**

```bash
cd apps/fieldkit && npx expo install expo-sqlite && cd ../..
```

Then add the resolved version to `packages/data/package.json` under `peerDependencies` and `devDependencies`, matching what Expo pinned. Run `pnpm install` from the repo root.

- [ ] **Step 2: Write the failing test**

`packages/data/src/db/__tests__/expo.test.ts`:

```ts
const runAsync = jest.fn().mockResolvedValue(undefined)
const getAllAsync = jest.fn().mockResolvedValue([])
const getFirstAsync = jest.fn().mockResolvedValue(null)
const closeAsync = jest.fn().mockResolvedValue(undefined)
const openDatabaseAsync = jest.fn().mockResolvedValue({
  runAsync,
  getAllAsync,
  getFirstAsync,
  closeAsync,
})

jest.mock('expo-sqlite', () => ({ openDatabaseAsync }))

import { openDatabase } from '../expo'

describe('the expo-sqlite adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('opens the named database, defaulting to fieldkit.db', async () => {
    await openDatabase()
    expect(openDatabaseAsync).toHaveBeenCalledWith('fieldkit.db')
  })

  it('enables foreign keys, which SQLite disables by default', async () => {
    await openDatabase()
    expect(runAsync).toHaveBeenCalledWith('PRAGMA foreign_keys = ON')
  })

  it('passes parameters through positionally', async () => {
    const db = await openDatabase()
    await db.execute('INSERT INTO t (a) VALUES (?)', ['x'])
    expect(runAsync).toHaveBeenCalledWith('INSERT INTO t (a) VALUES (?)', ['x'])
  })

  it('returns null rather than undefined when a single row is absent', async () => {
    getFirstAsync.mockResolvedValueOnce(undefined)
    const db = await openDatabase()
    expect(await db.first('SELECT 1')).toBeNull()
  })

  it('rolls back when a transaction body throws', async () => {
    const db = await openDatabase()
    await expect(
      db.transaction(async () => {
        throw new Error('deliberate')
      }),
    ).rejects.toThrow('deliberate')
    expect(runAsync).toHaveBeenCalledWith('ROLLBACK')
    expect(runAsync).not.toHaveBeenCalledWith('COMMIT')
  })

  it('commits a transaction that completes', async () => {
    const db = await openDatabase()
    await db.transaction(async () => undefined)
    expect(runAsync).toHaveBeenCalledWith('COMMIT')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @corymbia/data test expo`
Expected: FAIL — `Cannot find module '../expo'`.

- [ ] **Step 4: Write `packages/data/src/db/expo.ts`**

```ts
import * as SQLite from 'expo-sqlite'
import type { Database, SqlValue } from './port'

/**
 * The on-device adapter. Deliberately thin: everything interesting lives in the
 * repositories, which are tested against real SQL through the better-sqlite3
 * adapter. What this file must get right is the translation, and the pragma —
 * SQLite disables foreign keys by default, so without it the schema's
 * relationships are decorative and orphaned rows insert happily.
 */
export async function openDatabase(name = 'fieldkit.db'): Promise<Database> {
  const db = await SQLite.openDatabaseAsync(name)
  await db.runAsync('PRAGMA foreign_keys = ON')

  return {
    async execute(sql, params = []) {
      await db.runAsync(sql, params as SqlValue[])
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      return (await db.getAllAsync(sql, params)) as T[]
    },
    async first<T>(sql: string, params: SqlValue[] = []) {
      return ((await db.getFirstAsync(sql, params)) as T | undefined | null) ?? null
    },
    async transaction<T>(fn: () => Promise<T>) {
      await db.runAsync('BEGIN')
      try {
        const result = await fn()
        await db.runAsync('COMMIT')
        return result
      } catch (error) {
        await db.runAsync('ROLLBACK')
        throw error
      }
    },
    async close() {
      await db.closeAsync()
    },
  }
}
```

- [ ] **Step 5: Re-export and run**

Add `export { openDatabase } from './db/expo'` to `packages/data/src/index.ts`.

Run: `pnpm --filter @corymbia/data test`
Expected: PASS — 68 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/data apps/fieldkit/package.json pnpm-lock.yaml
git commit -m "feat(data): add the expo-sqlite adapter"
```

---

### Task 8: The `geo` package — distance, nearest location, duplicate guard

**Files:**
- Create: `packages/geo/package.json`, `tsconfig.json`, `jest.config.js`, `babel.config.js`, `src/distance.ts`, `src/nearest.ts`, `src/duplicate.ts`, `src/index.ts`
- Test: `packages/geo/src/__tests__/distance.test.ts`, `__tests__/nearest.test.ts`, `__tests__/duplicate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Coordinate = { latitude: number; longitude: number }`
  - `distanceMetres(a: Coordinate, b: Coordinate): number`
  - `type NamedPlace = { id: string; name: string; latitude: number; longitude: number }`
  - `nearestPlace(position: Coordinate, places: NamedPlace[]): { place: NamedPlace; distanceM: number } | null`
  - `DUPLICATE_THRESHOLD_M = 5`
  - `isProbableDuplicate(next: Coordinate, previous: Coordinate | null, thresholdM?: number): boolean`

**Spec §8.4:** place names must work offline, derived from proximity to the project's own known locations. Reverse geocoding is an opportunistic bonus, never a dependency — so nothing here touches the network.

- [ ] **Step 1: Write the failing tests**

`packages/geo/src/__tests__/distance.test.ts`:

```ts
import { distanceMetres } from '../distance'

describe('distanceMetres', () => {
  it('is zero for the same point', () => {
    expect(distanceMetres({ latitude: -37.8, longitude: 145.0 }, { latitude: -37.8, longitude: 145.0 })).toBe(0)
  })

  it('measures a short north-south hop accurately', () => {
    // 0.001 degrees of latitude is very close to 111.32 m everywhere.
    const d = distanceMetres(
      { latitude: -37.8, longitude: 145.0 },
      { latitude: -37.801, longitude: 145.0 },
    )
    expect(d).toBeGreaterThan(110)
    expect(d).toBeLessThan(113)
  })

  it('accounts for longitude lines converging away from the equator', () => {
    const atEquator = distanceMetres(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0.001 },
    )
    const atMelbourne = distanceMetres(
      { latitude: -37.8, longitude: 145.0 },
      { latitude: -37.8, longitude: 145.001 },
    )
    expect(atMelbourne).toBeLessThan(atEquator)
    expect(atMelbourne).toBeGreaterThan(atEquator * 0.7)
  })

  it('is symmetric', () => {
    const a = { latitude: -37.8, longitude: 145.0 }
    const b = { latitude: -37.81, longitude: 145.02 }
    expect(distanceMetres(a, b)).toBeCloseTo(distanceMetres(b, a), 6)
  })

  it('handles a realistic field distance', () => {
    // Roughly 120 m, the distance used throughout the spec's examples.
    const d = distanceMetres(
      { latitude: -37.82141, longitude: 145.03318 },
      { latitude: -37.82249, longitude: 145.03318 },
    )
    expect(d).toBeGreaterThan(115)
    expect(d).toBeLessThan(125)
  })
})
```

`packages/geo/src/__tests__/nearest.test.ts`:

```ts
import { nearestPlace } from '../nearest'

const PLACES = [
  { id: 'a', name: 'North Reach', latitude: -37.82141, longitude: 145.03318 },
  { id: 'b', name: 'South Reach', latitude: -37.83, longitude: 145.04 },
]

describe('nearestPlace', () => {
  it('finds the closest known location and its distance', () => {
    const result = nearestPlace({ latitude: -37.8215, longitude: 145.0332 }, PLACES)
    expect(result?.place.name).toBe('North Reach')
    expect(result?.distanceM).toBeLessThan(20)
  })

  it('returns null when the project has no known locations', () => {
    expect(nearestPlace({ latitude: -37.8, longitude: 145.0 }, [])).toBeNull()
  })

  it('picks the genuinely nearer of two candidates', () => {
    expect(nearestPlace({ latitude: -37.8299, longitude: 145.0399 }, PLACES)?.place.id).toBe('b')
  })

  it('rounds the distance to a whole metre, which is all the UI shows', () => {
    const result = nearestPlace({ latitude: -37.8215, longitude: 145.0332 }, PLACES)
    expect(Number.isInteger(result?.distanceM)).toBe(true)
  })
})
```

`packages/geo/src/__tests__/duplicate.test.ts`:

```ts
import { DUPLICATE_THRESHOLD_M, isProbableDuplicate } from '../duplicate'

const HERE = { latitude: -37.82141, longitude: 145.03318 }

describe('isProbableDuplicate', () => {
  it('defaults to the 5 m threshold from the spec', () => {
    expect(DUPLICATE_THRESHOLD_M).toBe(5)
  })

  it('flags a second pin dropped essentially on the spot', () => {
    expect(isProbableDuplicate(HERE, HERE)).toBe(true)
  })

  it('does not flag a pin a clear distance away', () => {
    expect(isProbableDuplicate({ latitude: -37.8224, longitude: 145.03318 }, HERE)).toBe(false)
  })

  it('does not flag the first pin of a session, when there is nothing to compare with', () => {
    expect(isProbableDuplicate(HERE, null)).toBe(false)
  })

  it('honours a caller-supplied threshold', () => {
    const twentyMetresAway = { latitude: -37.82159, longitude: 145.03318 }
    expect(isProbableDuplicate(twentyMetresAway, HERE)).toBe(false)
    expect(isProbableDuplicate(twentyMetresAway, HERE, 50)).toBe(true)
  })
})
```

- [ ] **Step 2: Create the package and run the tests to verify they fail**

`packages/geo/package.json`:

```json
{
  "name": "@corymbia/geo",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "jest",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "jest-expo": "~57.0.0",
    "react": "19.2.3",
    "react-native": "0.86.3"
  }
}
```

Copy `tsconfig.json`, `jest.config.js` (with `testMatch: ['**/__tests__/**/*.test.ts']`) and `babel.config.js` from `packages/data/`. Run `pnpm install` from the repo root.

Run: `pnpm --filter @corymbia/geo test`
Expected: FAIL — `Cannot find module '../distance'`.

- [ ] **Step 3: Write `packages/geo/src/distance.ts`**

```ts
export type Coordinate = { latitude: number; longitude: number }

const EARTH_RADIUS_M = 6_371_008.8

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180

/**
 * Great-circle distance by the haversine formula.
 *
 * A spherical earth is wrong by about 0.3% at worst, which at the distances this
 * application deals with — metres to a few kilometres — is well under a metre.
 * The GPS accuracy this is compared against is rarely better than 3 m, so a
 * more elaborate ellipsoidal calculation would be precision the input does not
 * have.
 */
export function distanceMetres(a: Coordinate, b: Coordinate): number {
  const dLat = toRadians(b.latitude - a.latitude)
  const dLon = toRadians(b.longitude - a.longitude)
  const lat1 = toRadians(a.latitude)
  const lat2 = toRadians(b.latitude)

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}
```

- [ ] **Step 4: Write `packages/geo/src/nearest.ts`**

```ts
import { distanceMetres, type Coordinate } from './distance'

export type NamedPlace = {
  id: string
  name: string
  latitude: number
  longitude: number
}

/**
 * Spec §8.4: place names work offline, derived from proximity to the project's
 * own known locations rather than from a geocoding service. Nothing here touches
 * the network — reverse geocoding is an opportunistic bonus elsewhere, never a
 * dependency.
 *
 * The distance is rounded because the UI only ever shows whole metres, and a
 * chip reading "120 m from Nth Reach" should not disagree with itself between
 * renders.
 */
export function nearestPlace(
  position: Coordinate,
  places: NamedPlace[],
): { place: NamedPlace; distanceM: number } | null {
  let best: { place: NamedPlace; distanceM: number } | null = null
  for (const place of places) {
    const distanceM = distanceMetres(position, place)
    if (best === null || distanceM < best.distanceM) {
      best = { place, distanceM }
    }
  }
  return best ? { place: best.place, distanceM: Math.round(best.distanceM) } : null
}
```

- [ ] **Step 5: Write `packages/geo/src/duplicate.ts`**

```ts
import { distanceMetres, type Coordinate } from './distance'

/** Spec §9.5. Configurable; this is the default. */
export const DUPLICATE_THRESHOLD_M = 5

/**
 * Whether a new pin has landed close enough to the previous one to be worth
 * querying.
 *
 * This only ever produces a warning. Spec §9.5 and doctrine rule 4 are explicit
 * that it must not block: accidental double-capture is a real field failure, but
 * so is refusing a legitimate close-spaced pin, and only the ecologist knows
 * which she meant.
 */
export function isProbableDuplicate(
  next: Coordinate,
  previous: Coordinate | null,
  thresholdM: number = DUPLICATE_THRESHOLD_M,
): boolean {
  if (previous === null) return false
  return distanceMetres(next, previous) <= thresholdM
}
```

- [ ] **Step 6: Write `packages/geo/src/index.ts`, then run**

```ts
export { distanceMetres } from './distance'
export type { Coordinate } from './distance'
export { nearestPlace } from './nearest'
export type { NamedPlace } from './nearest'
export { isProbableDuplicate, DUPLICATE_THRESHOLD_M } from './duplicate'
```

Run: `pnpm --filter @corymbia/geo test`
Expected: PASS — 13 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/geo pnpm-lock.yaml
git commit -m "feat(geo): add distance, nearest-place and duplicate detection"
```

---

### Task 9: Fix classification, averaging and trend

**Files:**
- Create: `packages/geo/src/classify.ts`, `src/average.ts`, `src/trend.ts`
- Modify: `packages/geo/src/index.ts`
- Test: `packages/geo/src/__tests__/classify.test.ts`, `__tests__/average.test.ts`, `__tests__/trend.test.ts`

**Interfaces:**
- Consumes: `Coordinate`.
- Produces:
  - `type Reading = { latitude: number; longitude: number; accuracyM: number; altitudeM: number | null; timestampMs: number }`
  - `type FixGrade = 'good' | 'fair' | 'poor'`
  - `GRADE_THRESHOLDS = { good: 5, fair: 15 }`
  - `gradeAccuracy(accuracyM: number): FixGrade`
  - `averageReadings(readings: Reading[]): { latitude: number; longitude: number; accuracyM: number; altitudeM: number | null; spreadM: number; sampleCount: number }`
  - `type HoldVerdict = 'improving' | 'plateaued'`
  - `holdVerdict(readings: Reading[]): HoldVerdict`

**This is the heart of the capture screen's honesty.** Spec §9.3: the "keep holding" verdict must come from the observed trend, not from a guess about the hardware. `holdVerdict` is the function that decides whether the screen says "Still improving — keep holding" or "About as sharp as it gets here", and it must not claim an improvement that is not happening.

- [ ] **Step 1: Write the failing tests**

`packages/geo/src/__tests__/classify.test.ts`:

```ts
import { GRADE_THRESHOLDS, gradeAccuracy } from '../classify'

describe('gradeAccuracy', () => {
  it('uses the thresholds the traffic-light frame is built on', () => {
    expect(GRADE_THRESHOLDS).toEqual({ good: 5, fair: 15 })
  })

  it('grades a survey-quality fix as good', () => {
    expect(gradeAccuracy(3)).toBe('good')
    expect(gradeAccuracy(4.9)).toBe('good')
  })

  it('grades the boundary values on the safer side', () => {
    expect(gradeAccuracy(5)).toBe('fair')
    expect(gradeAccuracy(15)).toBe('poor')
  })

  it('grades a middling fix as fair', () => {
    expect(gradeAccuracy(9)).toBe('fair')
  })

  it('grades a bad fix as poor', () => {
    expect(gradeAccuracy(40)).toBe('poor')
  })
})
```

`packages/geo/src/__tests__/average.test.ts`:

```ts
import { averageReadings } from '../average'
import type { Reading } from '../classify'

const reading = (over: Partial<Reading> = {}): Reading => ({
  latitude: -37.82141,
  longitude: 145.03318,
  accuracyM: 4,
  altitudeM: 62,
  timestampMs: 1_000,
  ...over,
})

describe('averageReadings', () => {
  it('returns a single reading essentially unchanged', () => {
    const result = averageReadings([reading()])
    expect(result.latitude).toBeCloseTo(-37.82141, 6)
    expect(result.sampleCount).toBe(1)
    expect(result.spreadM).toBe(0)
  })

  it('averages the position of several readings', () => {
    const result = averageReadings([
      reading({ latitude: -37.8214 }),
      reading({ latitude: -37.8216 }),
    ])
    expect(result.latitude).toBeCloseTo(-37.8215, 6)
  })

  it('reports the spread, which is the honest measure of how much they disagreed', () => {
    const tight = averageReadings([reading(), reading()])
    const loose = averageReadings([reading(), reading({ latitude: -37.8224 })])
    expect(tight.spreadM).toBe(0)
    expect(loose.spreadM).toBeGreaterThan(40)
  })

  it('improves the reported accuracy as readings accumulate, but never below the best single reading', () => {
    const one = averageReadings([reading({ accuracyM: 8 })])
    const nine = averageReadings(Array.from({ length: 9 }, () => reading({ accuracyM: 8 })))
    expect(nine.accuracyM).toBeLessThan(one.accuracyM)
    expect(nine.accuracyM).toBeGreaterThanOrEqual(8 / 3)
  })

  it('counts the samples, which is the provenance stored on the record', () => {
    expect(averageReadings([reading(), reading(), reading()]).sampleCount).toBe(3)
  })

  it('averages altitude when present and reports null when no reading had one', () => {
    expect(averageReadings([reading({ altitudeM: 60 }), reading({ altitudeM: 64 })]).altitudeM).toBe(62)
    expect(averageReadings([reading({ altitudeM: null })]).altitudeM).toBeNull()
  })

  it('throws on an empty list rather than inventing a position', () => {
    expect(() => averageReadings([])).toThrow()
  })
})
```

`packages/geo/src/__tests__/trend.test.ts`:

```ts
import { holdVerdict } from '../trend'
import type { Reading } from '../classify'

const at = (accuracyM: number, timestampMs: number): Reading => ({
  latitude: -37.82141,
  longitude: 145.03318,
  accuracyM,
  altitudeM: null,
  timestampMs,
})

describe('holdVerdict', () => {
  it('says improving while accuracy is still falling', () => {
    expect(holdVerdict([at(20, 0), at(14, 1000), at(9, 2000), at(6, 3000)])).toBe('improving')
  })

  it('says plateaued once accuracy has stopped falling meaningfully', () => {
    expect(holdVerdict([at(4.2, 0), at(4.1, 1000), at(4.1, 2000), at(4.0, 3000)])).toBe('plateaued')
  })

  it('says plateaued when accuracy is getting worse', () => {
    expect(holdVerdict([at(4, 0), at(6, 1000), at(9, 2000), at(12, 3000)])).toBe('plateaued')
  })

  it('judges only recent readings, so an early improvement does not claim a current one', () => {
    const readings = [at(60, 0), at(30, 1000), at(5, 2000), at(5, 3000), at(5, 4000), at(5, 5000)]
    expect(holdVerdict(readings)).toBe('plateaued')
  })

  it('says improving on too little evidence, because the honest default is to let her wait', () => {
    expect(holdVerdict([at(9, 0)])).toBe('improving')
    expect(holdVerdict([])).toBe('improving')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @corymbia/geo test classify`
Expected: FAIL — `Cannot find module '../classify'`.

- [ ] **Step 3: Write `packages/geo/src/classify.ts`**

```ts
export type Reading = {
  latitude: number
  longitude: number
  accuracyM: number
  altitudeM: number | null
  timestampMs: number
}

export type FixGrade = 'good' | 'fair' | 'poor'

/**
 * The thresholds the capture screen's traffic-light frame is built on (spec §9.2).
 * Boundaries fall on the safer side: exactly 5 m is fair, not good, because a
 * frame that claims a good fix it does not have is worse than one that is
 * cautious.
 */
export const GRADE_THRESHOLDS = { good: 5, fair: 15 } as const

export function gradeAccuracy(accuracyM: number): FixGrade {
  if (accuracyM < GRADE_THRESHOLDS.good) return 'good'
  if (accuracyM < GRADE_THRESHOLDS.fair) return 'fair'
  return 'poor'
}
```

- [ ] **Step 4: Write `packages/geo/src/average.ts`**

```ts
import { distanceMetres } from './distance'
import type { Reading } from './classify'

/**
 * Averages the readings taken while she held the SHARPEN control.
 *
 * Two things are reported that the record then keeps as provenance (spec §7.4):
 * the **spread**, being the greatest distance between any reading and the mean,
 * which is the honest measure of how much the readings disagreed; and the
 * **sample count**.
 *
 * The reported accuracy improves with the square root of the sample count, which
 * is how averaging reduces random error — but it is floored at a third of the
 * best single reading. Beyond that the limiting factor is systematic (multipath,
 * satellite geometry, atmosphere), which averaging cannot remove, and claiming
 * otherwise would put a number on the record that the hardware never earned.
 */
export function averageReadings(readings: Reading[]): {
  latitude: number
  longitude: number
  accuracyM: number
  altitudeM: number | null
  spreadM: number
  sampleCount: number
} {
  if (readings.length === 0) {
    throw new Error('Cannot average an empty set of readings.')
  }

  const sampleCount = readings.length
  const latitude = readings.reduce((sum, r) => sum + r.latitude, 0) / sampleCount
  const longitude = readings.reduce((sum, r) => sum + r.longitude, 0) / sampleCount

  const withAltitude = readings.filter((r) => r.altitudeM !== null)
  const altitudeM =
    withAltitude.length === 0
      ? null
      : withAltitude.reduce((sum, r) => sum + (r.altitudeM as number), 0) / withAltitude.length

  const centre = { latitude, longitude }
  const spreadM = readings.reduce((max, r) => Math.max(max, distanceMetres(centre, r)), 0)

  const best = readings.reduce((min, r) => Math.min(min, r.accuracyM), Number.POSITIVE_INFINITY)
  const improved = best / Math.sqrt(sampleCount)
  const accuracyM = Math.max(improved, best / 3)

  return { latitude, longitude, accuracyM, altitudeM, spreadM, sampleCount }
}
```

- [ ] **Step 5: Write `packages/geo/src/trend.ts`**

```ts
import type { Reading } from './classify'

export type HoldVerdict = 'improving' | 'plateaued'

/** How many of the most recent readings the verdict considers. */
const WINDOW = 4
/** Below this much improvement across the window, holding is not buying anything. */
const MEANINGFUL_IMPROVEMENT_M = 0.5

/**
 * Whether continuing to hold is still worth it (spec §9.3).
 *
 * The verdict comes from the **observed trend**, never from an estimate of what
 * the hardware might achieve. The screen says "Still improving — keep holding"
 * or "About as sharp as it gets here", and both must be true when said: telling
 * her to keep waiting for an improvement that is not coming wastes the one thing
 * she has least of in the field.
 *
 * Only the most recent readings count, so an improvement that happened ten
 * seconds ago cannot claim to be happening now.
 *
 * With too little evidence the answer is "improving" — the generous default,
 * letting her wait a moment longer rather than telling her to stop early.
 */
export function holdVerdict(readings: Reading[]): HoldVerdict {
  if (readings.length < 2) return 'improving'

  const recent = readings.slice(-WINDOW)
  const first = recent[0]
  const last = recent[recent.length - 1]
  if (!first || !last) return 'improving'

  return first.accuracyM - last.accuracyM >= MEANINGFUL_IMPROVEMENT_M ? 'improving' : 'plateaued'
}
```

- [ ] **Step 6: Re-export and run**

Add to `packages/geo/src/index.ts`:

```ts
export { gradeAccuracy, GRADE_THRESHOLDS } from './classify'
export type { Reading, FixGrade } from './classify'
export { averageReadings } from './average'
export { holdVerdict } from './trend'
export type { HoldVerdict } from './trend'
```

Run: `pnpm --filter @corymbia/geo test`
Expected: PASS — 30 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/geo
git commit -m "feat(geo): add accuracy grading, hold-averaging and the hold verdict"
```

---

### Task 10: The location source and its fake

**Files:**
- Create: `packages/geo/src/location/port.ts`, `src/location/fake.ts`, `src/location/expo.ts`
- Modify: `packages/geo/package.json`, `packages/geo/src/index.ts`
- Test: `packages/geo/src/location/__tests__/fake.test.ts`

**Interfaces:**
- Consumes: `Reading`.
- Produces:
  - `type PermissionState = 'granted' | 'denied' | 'undetermined'`
  - `interface LocationSource { requestPermission(): Promise<PermissionState>; getLastKnown(): Promise<Reading | null>; watch(onReading: (r: Reading) => void): Promise<() => void> }`
  - `createFakeLocationSource(script: { permission?: PermissionState; lastKnown?: Reading | null; readings?: Reading[] }): LocationSource & { emit(r: Reading): void }`
  - `createExpoLocationSource(): LocationSource`

**Why a port again:** `expo-location` needs a device and real satellites. Everything that decides what a fix *means* is already pure and tested; this interface is what lets the ambient cache and the capture screen be tested with a scripted GPS, including the cases that are hard to produce on demand outdoors — permission denied, no fix at all, accuracy that gets worse.

- [ ] **Step 1: Add the dependency**

```bash
cd apps/fieldkit && npx expo install expo-location && cd ../..
```

Add the resolved version to `packages/geo/package.json` under `peerDependencies` and `devDependencies`. Run `pnpm install` from the repo root.

- [ ] **Step 2: Write the failing test**

`packages/geo/src/location/__tests__/fake.test.ts`:

```ts
import { createFakeLocationSource } from '../fake'
import type { Reading } from '../../classify'

const reading = (accuracyM: number): Reading => ({
  latitude: -37.82141,
  longitude: 145.03318,
  accuracyM,
  altitudeM: 62,
  timestampMs: Date.now(),
})

describe('the fake location source', () => {
  it('grants permission by default, since that is the common path', async () => {
    expect(await createFakeLocationSource({}).requestPermission()).toBe('granted')
  })

  it('can be scripted to deny permission', async () => {
    const source = createFakeLocationSource({ permission: 'denied' })
    expect(await source.requestPermission()).toBe('denied')
  })

  it('reports no last-known position when scripted with none', async () => {
    expect(await createFakeLocationSource({}).getLastKnown()).toBeNull()
  })

  it('replays scripted readings to a watcher', async () => {
    const source = createFakeLocationSource({ readings: [reading(20), reading(9)] })
    const seen: number[] = []
    await source.watch((r) => seen.push(r.accuracyM))
    expect(seen).toEqual([20, 9])
  })

  it('emits further readings on demand, for tests that drive a hold', async () => {
    const source = createFakeLocationSource({})
    const seen: number[] = []
    await source.watch((r) => seen.push(r.accuracyM))
    source.emit(reading(6))
    source.emit(reading(4))
    expect(seen).toEqual([6, 4])
  })

  it('stops delivering readings once unsubscribed', async () => {
    const source = createFakeLocationSource({})
    const seen: number[] = []
    const stop = await source.watch((r) => seen.push(r.accuracyM))
    stop()
    source.emit(reading(4))
    expect(seen).toEqual([])
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @corymbia/geo test fake`
Expected: FAIL — `Cannot find module '../fake'`.

- [ ] **Step 4: Write `packages/geo/src/location/port.ts`**

```ts
import type { Reading } from '../classify'

export type PermissionState = 'granted' | 'denied' | 'undetermined'

/**
 * The narrow surface `expo-location` is used through.
 *
 * Everything that decides what a fix *means* is pure and tested elsewhere. This
 * exists so the parts that consume a live GPS — the ambient cache, and the
 * capture screen in the next plan — can be tested against a scripted source,
 * including the situations that are tedious or impossible to produce on demand
 * outdoors: permission refused, no fix at all, accuracy that gets worse rather
 * than better.
 */
export interface LocationSource {
  requestPermission(): Promise<PermissionState>
  getLastKnown(): Promise<Reading | null>
  /** Resolves to an unsubscribe function. */
  watch(onReading: (reading: Reading) => void): Promise<() => void>
}
```

- [ ] **Step 5: Write `packages/geo/src/location/fake.ts`**

```ts
import type { Reading } from '../classify'
import type { LocationSource, PermissionState } from './port'

/**
 * A scripted GPS for tests. `readings` are delivered as soon as a watcher
 * subscribes; `emit` pushes further ones, which is how a test drives a hold and
 * watches the verdict change.
 */
export function createFakeLocationSource(script: {
  permission?: PermissionState
  lastKnown?: Reading | null
  readings?: Reading[]
}): LocationSource & { emit(reading: Reading): void } {
  let listener: ((reading: Reading) => void) | null = null

  return {
    async requestPermission() {
      return script.permission ?? 'granted'
    },
    async getLastKnown() {
      return script.lastKnown ?? null
    },
    async watch(onReading) {
      listener = onReading
      for (const reading of script.readings ?? []) {
        onReading(reading)
      }
      return () => {
        listener = null
      }
    },
    emit(reading) {
      listener?.(reading)
    },
  }
}
```

- [ ] **Step 6: Write `packages/geo/src/location/expo.ts`**

```ts
import * as Location from 'expo-location'
import type { Reading } from '../classify'
import type { LocationSource, PermissionState } from './port'

function toReading(position: Location.LocationObject): Reading {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    // Android always supplies an accuracy; the fallback keeps the type honest
    // rather than asserting a number that might not be there.
    accuracyM: position.coords.accuracy ?? Number.POSITIVE_INFINITY,
    altitudeM: position.coords.altitude,
    timestampMs: position.timestamp,
  }
}

/**
 * The device adapter.
 *
 * `BestForNavigation` accuracy with a one-second interval is what makes a hold
 * meaningful: averaging needs a stream of readings, and a slower interval would
 * make her wait for samples that never arrive. Acquisition is on demand — spec
 * §8.2 is explicit that holding a continuous GPS lock would exhaust the battery
 * over a field day, so nothing here starts watching until something asks.
 */
export function createExpoLocationSource(): LocationSource {
  return {
    async requestPermission(): Promise<PermissionState> {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status === Location.PermissionStatus.GRANTED) return 'granted'
      if (status === Location.PermissionStatus.DENIED) return 'denied'
      return 'undetermined'
    },

    async getLastKnown() {
      const position = await Location.getLastKnownPositionAsync()
      return position ? toReading(position) : null
    },

    async watch(onReading) {
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 1000,
          distanceInterval: 0,
        },
        (position) => onReading(toReading(position)),
      )
      return () => subscription.remove()
    },
  }
}
```

- [ ] **Step 7: Re-export and run**

Add to `packages/geo/src/index.ts`:

```ts
export type { LocationSource, PermissionState } from './location/port'
export { createFakeLocationSource } from './location/fake'
export { createExpoLocationSource } from './location/expo'
```

Run: `pnpm --filter @corymbia/geo test`
Expected: PASS — 36 tests.

- [ ] **Step 8: Commit**

```bash
git add packages/geo apps/fieldkit/package.json pnpm-lock.yaml
git commit -m "feat(geo): add the location source port with expo and scripted adapters"
```

---

### Task 11: The ambient position cache

**Files:**
- Create: `packages/geo/src/ambient-cache.ts`
- Modify: `packages/geo/src/index.ts`
- Test: `packages/geo/src/__tests__/ambient-cache.test.ts`

**Interfaces:**
- Consumes: `Reading`, `LocationSource`.
- Produces:
  - `type AmbientFix = { latitude: number; longitude: number; accuracyM: number; altitudeM: number | null; ageSeconds: number }`
  - `createAmbientCache(source: LocationSource, now?: () => number): { record(reading: Reading): void; read(): AmbientFix | null; refresh(): Promise<AmbientFix | null> }`

**Spec §8.2 is precise about this** and the precision matters: an ambient fix takes whatever is available immediately, never waits, never blocks, and **carries its age**, because a fix from four minutes ago is a different claim from one taken now. Firing the GPS on every write would exhaust the battery over a field day, so the cache is refreshed opportunistically by whatever is already using the GPS.

- [ ] **Step 1: Write the failing test**

`packages/geo/src/__tests__/ambient-cache.test.ts`:

```ts
import { createAmbientCache } from '../ambient-cache'
import { createFakeLocationSource } from '../location/fake'
import type { Reading } from '../classify'

const reading = (over: Partial<Reading> = {}): Reading => ({
  latitude: -37.82141,
  longitude: 145.03318,
  accuracyM: 38,
  altitudeM: 62,
  timestampMs: 1_000_000,
  ...over,
})

describe('the ambient position cache', () => {
  it('is empty before anything has been recorded', () => {
    expect(createAmbientCache(createFakeLocationSource({})).read()).toBeNull()
  })

  it('returns the last recorded position with its age', () => {
    let now = 1_000_000
    const cache = createAmbientCache(createFakeLocationSource({}), () => now)
    cache.record(reading({ timestampMs: 1_000_000 }))
    now = 1_240_000
    expect(cache.read()).toEqual({
      latitude: -37.82141,
      longitude: 145.03318,
      accuracyM: 38,
      altitudeM: 62,
      ageSeconds: 240,
    })
  })

  it('reports an age of zero for a position just recorded', () => {
    const now = 1_000_000
    const cache = createAmbientCache(createFakeLocationSource({}), () => now)
    cache.record(reading({ timestampMs: now }))
    expect(cache.read()?.ageSeconds).toBe(0)
  })

  it('keeps the most recent reading', () => {
    const now = 2_000_000
    const cache = createAmbientCache(createFakeLocationSource({}), () => now)
    cache.record(reading({ accuracyM: 38 }))
    cache.record(reading({ accuracyM: 6, timestampMs: now }))
    expect(cache.read()?.accuracyM).toBe(6)
  })

  it('refreshes from the last-known position without waiting for a new fix', async () => {
    const now = 1_060_000
    const source = createFakeLocationSource({ lastKnown: reading({ timestampMs: 1_000_000 }) })
    const cache = createAmbientCache(source, () => now)
    const fix = await cache.refresh()
    expect(fix?.ageSeconds).toBe(60)
    expect(cache.read()?.ageSeconds).toBe(60)
  })

  it('returns null from a refresh when the device has no position at all', async () => {
    const cache = createAmbientCache(createFakeLocationSource({ lastKnown: null }))
    expect(await cache.refresh()).toBeNull()
  })

  it('does not overwrite a fresher cached position with a staler last-known one', async () => {
    const now = 2_000_000
    const source = createFakeLocationSource({ lastKnown: reading({ timestampMs: 1_000_000 }) })
    const cache = createAmbientCache(source, () => now)
    cache.record(reading({ accuracyM: 6, timestampMs: 1_999_000 }))
    await cache.refresh()
    expect(cache.read()?.accuracyM).toBe(6)
  })

  it('rounds the age down to whole seconds, which is all the UI shows', () => {
    let now = 1_000_000
    const cache = createAmbientCache(createFakeLocationSource({}), () => now)
    cache.record(reading({ timestampMs: 1_000_000 }))
    now = 1_001_900
    expect(cache.read()?.ageSeconds).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @corymbia/geo test ambient`
Expected: FAIL — `Cannot find module '../ambient-cache'`.

- [ ] **Step 3: Write `packages/geo/src/ambient-cache.ts`**

```ts
import type { Reading } from './classify'
import type { LocationSource } from './location/port'

export type AmbientFix = {
  latitude: number
  longitude: number
  accuracyM: number
  altitudeM: number | null
  ageSeconds: number
}

/**
 * The last position the device knew about, and how old it is (spec §8.2).
 *
 * An ambient fix never waits and never blocks: it is whatever is already
 * available, which is why every record and every event can carry one without
 * slowing anything down. Firing the GPS on each write would exhaust the battery
 * over a field day, so the cache is fed opportunistically — by the capture
 * screen while it is watching anyway, and at low frequency while an activity is
 * running.
 *
 * The age is the whole point. A fix from four minutes ago is a different claim
 * from one taken now, and the UI shows the difference so a stale position can
 * never be mistaken for a current one.
 */
export function createAmbientCache(
  source: LocationSource,
  now: () => number = Date.now,
): {
  record(reading: Reading): void
  read(): AmbientFix | null
  refresh(): Promise<AmbientFix | null>
} {
  let cached: Reading | null = null

  const toFix = (reading: Reading): AmbientFix => ({
    latitude: reading.latitude,
    longitude: reading.longitude,
    accuracyM: reading.accuracyM,
    altitudeM: reading.altitudeM,
    ageSeconds: Math.max(0, Math.floor((now() - reading.timestampMs) / 1000)),
  })

  return {
    record(reading) {
      if (cached === null || reading.timestampMs >= cached.timestampMs) {
        cached = reading
      }
    },

    read() {
      return cached ? toFix(cached) : null
    },

    async refresh() {
      const lastKnown = await source.getLastKnown()
      // Never replace a fresher position with a staler one: the capture screen
      // feeds this cache far better readings than getLastKnown returns.
      if (lastKnown && (cached === null || lastKnown.timestampMs >= cached.timestampMs)) {
        cached = lastKnown
      }
      return cached ? toFix(cached) : null
    },
  }
}
```

- [ ] **Step 4: Re-export and run**

Add to `packages/geo/src/index.ts`:

```ts
export { createAmbientCache } from './ambient-cache'
export type { AmbientFix } from './ambient-cache'
```

Run: `pnpm --filter @corymbia/geo test`
Expected: PASS — 44 tests.

Run: `pnpm turbo run test lint typecheck --force`
Expected: clean across all six workspaces.

- [ ] **Step 5: Commit**

```bash
git add packages/geo
git commit -m "feat(geo): add the ambient position cache with fix ageing"
```

---

### Task 12: Wiring the database into the app

**Files:**
- Create: `apps/fieldkit/src/db/provider.tsx`
- Modify: `apps/fieldkit/app/_layout.tsx`, `apps/fieldkit/package.json`, `apps/fieldkit/app.json`
- Test: none — this is wiring, proved by Task 13 on the device.

**Interfaces:**
- Consumes: `openDatabase`, `migrate` from `@corymbia/data`.
- Produces:
  - `<DatabaseProvider>` — opens the database, runs migrations, renders children once ready.
  - `useDatabase(): Database` — throws outside the provider, matching `useTheme`'s contract.
  - `useDatabaseStatus(): { state: 'opening' | 'ready' | 'failed'; error: Error | null; applied: string[] }`

**Why the status is exposed rather than swallowed:** a migration failure on a field device is silent otherwise, and the first symptom would be an empty list of records with no explanation. The diagnostic screen shows this directly.

- [ ] **Step 1: Add the workspace dependencies and the location permission**

Add to `apps/fieldkit/package.json` `dependencies`:

```json
"@corymbia/data": "workspace:*",
"@corymbia/geo": "workspace:*"
```

Add to `apps/fieldkit/app.json` under `expo.android`:

```json
"permissions": ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION"]
```

Run `pnpm install` from the repo root, then `cd apps/fieldkit && npx expo prebuild --platform android`.

**The prebuild is not optional.** Permissions are `app.json` config; without prebuild they never reach the Android manifest and the permission request fails at runtime with no useful error.

- [ ] **Step 2: Write `apps/fieldkit/src/db/provider.tsx`**

```tsx
import React, { createContext, useContext, useEffect, useState } from 'react'
import { migrate, openDatabase, type Database } from '@corymbia/data'

type Status =
  | { state: 'opening'; error: null; applied: string[] }
  | { state: 'ready'; error: null; applied: string[] }
  | { state: 'failed'; error: Error; applied: string[] }

const DatabaseContext = createContext<{ db: Database | null; status: Status } | null>(null)

/**
 * Opens the database and runs migrations before rendering anything that reads
 * from it.
 *
 * The status is deliberately exposed rather than swallowed. A migration failure
 * on a field device is otherwise silent, and the first symptom would be an empty
 * list of records with no explanation — on a tablet, in a paddock, with no
 * console to check.
 */
export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<Database | null>(null)
  const [status, setStatus] = useState<Status>({ state: 'opening', error: null, applied: [] })

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const opened = await openDatabase()
        const applied = await migrate(opened)
        if (cancelled) {
          await opened.close()
          return
        }
        setDb(opened)
        setStatus({ state: 'ready', error: null, applied })
      } catch (error) {
        if (cancelled) return
        setStatus({
          state: 'failed',
          error: error instanceof Error ? error : new Error(String(error)),
          applied: [],
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <DatabaseContext.Provider value={{ db, status }}>{children}</DatabaseContext.Provider>
  )
}

export function useDatabaseStatus(): Status {
  const value = useContext(DatabaseContext)
  if (!value) throw new Error('useDatabaseStatus must be used within a DatabaseProvider')
  return value.status
}

export function useDatabase(): Database {
  const value = useContext(DatabaseContext)
  if (!value) throw new Error('useDatabase must be used within a DatabaseProvider')
  if (!value.db) throw new Error('The database is not open yet; check useDatabaseStatus first.')
  return value.db
}
```

- [ ] **Step 3: Wrap the app in `apps/fieldkit/app/_layout.tsx`**

Add `DatabaseProvider` inside `ThemeProvider` — the theme must be available to render a database error:

```tsx
import { Slot } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { ThemeProvider, useTheme } from '@corymbia/ui'
import { DatabaseProvider } from '../src/db/provider'

function Frame() {
  const { theme, name } = useTheme()
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.surface }}>
      <StatusBar style={name === 'dark' ? 'light' : 'dark'} />
      <Slot />
    </SafeAreaView>
  )
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <DatabaseProvider>
          <Frame />
        </DatabaseProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  )
}
```

- [ ] **Step 4: Verify**

Run: `pnpm turbo run lint typecheck --force`
Expected: clean.

Confirm the permission reached the manifest:

```bash
grep -c ACCESS_FINE_LOCATION apps/fieldkit/android/app/src/main/AndroidManifest.xml
```

Expected: `1` or more. If `0`, prebuild did not run — go back to Step 1.

- [ ] **Step 5: Commit**

```bash
git add apps/fieldkit pnpm-lock.yaml
git commit -m "feat(app): open the database and run migrations at startup"
```

---

### Task 13: The diagnostic screen, on hardware

**Files:**
- Create: `apps/fieldkit/app/diagnostics.tsx`
- Modify: `apps/fieldkit/src/gallery/sections.tsx` (add a link to it)

**Interfaces:**
- Consumes: everything built in this plan.
- Produces: no new exports. This is the proving surface.

**Why this task exists.** Every piece of logic in this plan is unit tested, but not one of those tests has seen a satellite. GPS on real hardware is the largest unknown in the project: how quickly the S25 acquires, what accuracy it actually reports, whether it improves while held, and whether `expo-sqlite` behaves as the adapter assumes. This screen answers those questions before Plan 3 builds a polished capture experience on top. It is deliberately plain — it is an instrument, not a design.

- [ ] **Step 1: Write `apps/fieldkit/app/diagnostics.tsx`**

```tsx
import React, { useEffect, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
import {
  createAmbientCache,
  createExpoLocationSource,
  averageReadings,
  gradeAccuracy,
  holdVerdict,
  isProbableDuplicate,
  type Reading,
} from '@corymbia/geo'
import {
  createActivity,
  createProject,
  createRecord,
  listRecords,
  mostRecentActivity,
  nowIso,
  type Fix,
  type FieldRecord,
} from '@corymbia/data'
import { spacing } from '@corymbia/tokens'
import { Button, Card, Screen, Type, useTheme } from '@corymbia/ui'
import { useDatabase, useDatabaseStatus } from '../src/db/provider'

const DEVICE_ID = 'diagnostics'

export default function Diagnostics() {
  const status = useDatabaseStatus()
  const { theme } = useTheme()

  const [permission, setPermission] = useState<string>('not requested')
  const [readings, setReadings] = useState<Reading[]>([])
  const [holding, setHolding] = useState(false)
  const [records, setRecords] = useState<FieldRecord[]>([])
  const [message, setMessage] = useState<string | null>(null)

  const source = useRef(createExpoLocationSource()).current
  const ambient = useRef(createAmbientCache(source)).current
  const held = useRef<Reading[]>([])

  useEffect(() => {
    let stop: (() => void) | undefined
    void (async () => {
      const state = await source.requestPermission()
      setPermission(state)
      if (state !== 'granted') return
      stop = await source.watch((reading) => {
        ambient.record(reading)
        setReadings((previous) => [...previous.slice(-19), reading])
        if (holding) held.current.push(reading)
      })
    })()
    return () => stop?.()
    // `holding` is read through the ref below rather than resubscribing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const latest = readings[readings.length - 1] ?? null

  if (status.state !== 'ready') {
    return (
      <Screen>
        <Type variant="title">Database {status.state}</Type>
        {status.error ? <Type dim>{status.error.message}</Type> : null}
      </Screen>
    )
  }

  return <DiagnosticsBody
    theme={theme}
    permission={permission}
    latest={latest}
    readings={readings}
    holding={holding}
    setHolding={setHolding}
    held={held}
    ambient={ambient}
    records={records}
    setRecords={setRecords}
    message={message}
    setMessage={setMessage}
    applied={status.applied}
  />
}

type BodyProps = {
  theme: ReturnType<typeof useTheme>['theme']
  permission: string
  latest: Reading | null
  readings: Reading[]
  holding: boolean
  setHolding: (v: boolean) => void
  held: React.MutableRefObject<Reading[]>
  ambient: ReturnType<typeof createAmbientCache>
  records: FieldRecord[]
  setRecords: (r: FieldRecord[]) => void
  message: string | null
  setMessage: (m: string | null) => void
  applied: string[]
}

function DiagnosticsBody(props: BodyProps) {
  const db = useDatabase()
  const { latest, readings, holding, held, ambient } = props

  const row = (label: string, value: string) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
      <Type variant="small" dim>{label}</Type>
      <Type variant="mono">{value}</Type>
    </View>
  )

  async function ensureActivity(): Promise<string> {
    const existing = await mostRecentActivity(db)
    if (existing) return existing.id
    const project = await createProject(db, { name: 'Diagnostics' })
    const activity = await createActivity(db, {
      projectId: project.id,
      kind: 'survey',
      name: 'Diagnostics run',
    })
    return activity.id
  }

  async function saveDeliberate(samples: Reading[]) {
    if (samples.length === 0) {
      props.setMessage('No readings to save — is the GPS permission granted?')
      return
    }
    const averaged = averageReadings(samples)
    const activityId = await ensureActivity()
    const previous = props.records[0]
    const duplicate =
      previous && previous.fix.quality !== 'none'
        ? isProbableDuplicate(averaged, {
            latitude: previous.fix.latitude,
            longitude: previous.fix.longitude,
          })
        : false

    const fix: Fix = {
      quality: 'deliberate',
      latitude: averaged.latitude,
      longitude: averaged.longitude,
      accuracyM: averaged.accuracyM,
      altitudeM: averaged.altitudeM,
      datum: 'WGS84',
      sampleCount: averaged.sampleCount,
      spreadM: averaged.spreadM,
      holdMs: samples.length > 1
        ? (samples[samples.length - 1] as Reading).timestampMs - (samples[0] as Reading).timestampMs
        : 0,
    }

    await createRecord(db, {
      activityId,
      kind: 'pin',
      fix,
      deviceId: DEVICE_ID,
      gpsTime: nowIso(new Date(samples[samples.length - 1]?.timestampMs ?? Date.now())),
    })
    props.setRecords(await listRecords(db, activityId))
    props.setMessage(duplicate ? 'Saved — but within 5 m of the last one' : 'Saved')
  }

  async function saveAmbient() {
    const fixNow = ambient.read()
    const activityId = await ensureActivity()
    const fix: Fix = fixNow
      ? {
          quality: 'ambient',
          latitude: fixNow.latitude,
          longitude: fixNow.longitude,
          accuracyM: fixNow.accuracyM,
          altitudeM: fixNow.altitudeM,
          datum: 'WGS84',
          ageSeconds: fixNow.ageSeconds,
        }
      : { quality: 'none' }
    await createRecord(db, { activityId, kind: 'pin', fix, deviceId: DEVICE_ID })
    props.setRecords(await listRecords(db, activityId))
    props.setMessage(fixNow ? `Saved ambient, ${fixNow.ageSeconds}s old` : 'Saved with no position')
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Type variant="title">Diagnostics</Type>
        <Type dim>Not a design. An instrument for proving the engine on hardware.</Type>

        <View style={{ height: spacing.lg }} />
        <Card>
          <Type variant="label" dim>DATABASE</Type>
          {row('migrations', props.applied.length ? props.applied.join(', ') : 'already current')}
          {row('records shown', String(props.records.length))}
        </Card>

        <View style={{ height: spacing.md }} />
        <Card>
          <Type variant="label" dim>GPS</Type>
          {row('permission', props.permission)}
          {row('readings seen', String(readings.length))}
          {row('accuracy', latest ? `${latest.accuracyM.toFixed(1)} m` : '—')}
          {row('grade', latest ? gradeAccuracy(latest.accuracyM) : '—')}
          {row('verdict', holdVerdict(readings))}
          {row('lat', latest ? latest.latitude.toFixed(6) : '—')}
          {row('lon', latest ? latest.longitude.toFixed(6) : '—')}
          {row('altitude', latest?.altitudeM != null ? `${latest.altitudeM.toFixed(0)} m` : '—')}
          {row('ambient age', `${ambient.read()?.ageSeconds ?? '—'} s`)}
          {row('held samples', String(held.current.length))}
        </Card>

        <View style={{ height: spacing.md }} />
        <Button
          label={holding ? 'Release to save averaged fix' : 'Hold to average'}
          kind="accurate"
          size="field"
          onPress={() => {
            if (holding) {
              const samples = [...held.current]
              held.current = []
              props.setHolding(false)
              void saveDeliberate(samples)
            } else {
              held.current = latest ? [latest] : []
              props.setHolding(true)
            }
          }}
        />
        <View style={{ height: spacing.sm }} />
        <Button label="Save single deliberate fix" kind="fast" size="field"
          onPress={() => void saveDeliberate(latest ? [latest] : [])} />
        <View style={{ height: spacing.sm }} />
        <Button label="Save ambient fix" kind="secondary" onPress={() => void saveAmbient()} />

        {props.message ? (
          <>
            <View style={{ height: spacing.sm }} />
            <Type style={{ color: props.theme.colors.accent }}>{props.message}</Type>
          </>
        ) : null}

        <View style={{ height: spacing.lg }} />
        <Type variant="label" dim>STORED RECORDS</Type>
        {props.records.map((record) => (
          <View key={record.id} style={{ paddingVertical: spacing.xs }}>
            <Type variant="mono">
              #{record.sequence} {record.fix.quality}
              {record.fix.quality !== 'none' ? ` ±${record.fix.accuracyM.toFixed(1)}m` : ''}
            </Type>
          </View>
        ))}
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </Screen>
  )
}
```

- [ ] **Step 2: Link to it from the gallery**

Add a section at the top of `apps/fieldkit/src/gallery/sections.tsx`, importing `useRouter` from `expo-router`:

```tsx
<Section title="Diagnostics">
  <Button
    label="Open the GPS and database diagnostics"
    kind="secondary"
    onPress={() => router.push('/diagnostics')}
  />
</Section>
```

- [ ] **Step 3: Verify the checks still pass**

Run: `pnpm turbo run test lint typecheck --force`
Expected: clean across all six workspaces.

Run: `pnpm run lint:verify-rules`
Expected: all checks pass.

- [ ] **Step 4: Build and install on the S25**

```bash
cd apps/fieldkit && npx expo run:android
```

Remember `expo run:android` never exits. Confirm the install landed with:

```bash
adb shell dumpsys package eco.corymbia.fieldkit | grep lastUpdateTime
```

- [ ] **Step 5: Prove the engine outdoors**

This is the deliverable. Work through it on the device, **outside with a clear view of the sky**, and record what actually happens rather than what should:

- [ ] The database opens and migrations report as applied on first run, and as already current on second launch.
- [ ] The location permission prompt appears, and granting it starts readings flowing.
- [ ] Accuracy is a plausible number — single-figure metres outdoors. Note how long it takes to get there from a cold start.
- [ ] The grade changes from `poor` through `fair` to `good` as the fix settles.
- [ ] The verdict reads `improving` while accuracy is falling and `plateaued` once it settles. **This is the most important observation in the task** — the capture screen's honesty depends on it, and if it never says `plateaued` outdoors the threshold is wrong.
- [ ] Holding, then releasing, saves a record whose sample count matches roughly one per second of holding, and whose spread is small.
- [ ] Saving an ambient fix records an age in seconds that grows as the fix gets older.
- [ ] Dropping a second pin on the spot reports the duplicate warning.
- [ ] Stored records appear in the list with per-activity sequence numbers starting at 1.
- [ ] Force-stop and relaunch: the records are still there.

Capture a screenshot into `docs/design-review/` and record the observations — especially the cold-start acquisition time and the accuracy the S25 actually reaches — in the report. Plan 3's thresholds depend on those numbers.

- [ ] **Step 6: Commit**

```bash
git add apps/fieldkit docs/design-review
git commit -m "feat(app): add the GPS and database diagnostic screen"
```

---

## Self-Review

**Spec coverage.** §7.1 entities → Tasks 2, 3 (the tables this plan uses; `media`, `record_link`, `batch` and `batch_item` arrive with the plans that need them). §7.2 record spine, kinds, per-activity sequence → Tasks 3, 4, 6. §7.3 required-but-defaulted → Tasks 2, 5. §7.4 fix provenance, GPS time, datum → Tasks 3, 6, 9. §8.1 context stamp → Task 6. §8.2 deliberate/ambient/none and the ambient cache → Tasks 3, 6, 11. §8.4 offline place names → Task 8. §8.5 event log → Task 6. §9.3 hold verdict → Task 9. §9.5 duplicate guard → Task 8. §10.1 resume the last activity → Task 5.

**Deliberately out of scope**, each with a home: the capture screen and its traffic-light frame (Plan 3); media capture and storage (Plan 4); the launcher, projects UI and Inbox (Plan 5); export profiles (Plan 6); tablet layouts (Plan 7); voice mode (Plan 8).

**One refinement recorded here rather than decided silently:** §7.2 says kind-specific fields are "validated by a per-kind TypeScript schema". `pin` has no kind-specific fields — its title, description and position are real columns — so Task 4 hand-rolls the validator rather than adding a schema library to validate an empty object. Revisit when a kind gains real fields.

**Type consistency.** `Fix` in `@corymbia/data` mirrors `ContextStampFix` in `@corymbia/ui` and the CHECK constraints in migration 002 — deliberately three representations of one rule. `Reading` is defined once in `packages/geo/src/classify.ts` and imported everywhere else. `Coordinate` is structurally satisfied by `Reading`, so averaging output feeds `distanceMetres` without conversion. `Database`, `LocationSource`, `Project`, `Activity`, `FieldRecord`, `EventEntry`, `AmbientFix`, `HoldVerdict` and `FixGrade` each keep one name throughout.

**A known limit, stated rather than hidden.** The `expo-sqlite` and `expo-location` adapters are verified against stubs in unit tests, which proves translation and nothing more. Only Task 13 on the device proves they work. Any report claiming otherwise is overstating its evidence.

---

## What "done" looks like

Two packages with 100-plus tests running against real SQL and a scripted GPS, a database that opens and migrates on a field device, and a screen that has been taken outside and shown to acquire a fix, improve it while held, save it with defensible provenance, and still have it after a restart. Plus a written record of what the S25's GPS actually does — cold-start time and achievable accuracy — because Plan 3's thresholds should be set from measurements, not from guesses.
