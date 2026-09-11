import type { Database } from '../db/port'
import { newId } from '../ids'
import { nowIso } from '../time'

/**
 * The five kinds, as a value rather than only a type (spec §7.4).
 *
 * A screen that offers her a choice of kind has to render one control per
 * kind, and a union type is gone by run time — so the options would have to
 * be restated as literals somewhere, and a sixth kind added here would be
 * silently missing there. This is the single list both the type and any such
 * screen are derived from: `ActivityKind` below is `(typeof
 * ACTIVITY_KINDS)[number]`, and `new-activity.tsx` maps over this array.
 *
 * It is declared a second time in SQL — `CHECK (kind IN (...))` on the
 * `activity` table, migration 001 — which no type can reach. That the two
 * agree is pinned by a test in `__tests__/activities.test.ts` rather than by
 * the compiler.
 */
export const ACTIVITY_KINDS = Object.freeze([
  'survey',
  'sampling',
  'collection',
  'workshop',
  'meeting',
] as const)

export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

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
 * One activity by id, or null when there is no live one under it.
 *
 * Mirrors `getProject`: a soft-deleted activity reads as absent, the same as
 * an unknown id, so a caller checking whether an id still names something
 * live does not have to know the difference.
 */
export async function getActivity(db: Database, id: string): Promise<Activity | null> {
  const row = await db.first<ActivityRow>(`${SELECT} AND id = ?`, [id])
  return row ? toActivity(row) : null
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
