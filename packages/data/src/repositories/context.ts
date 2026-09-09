import type { Database } from '../db/port'
import { nowIso } from '../time'
import { getActivity, mostRecentActivity, type Activity } from './activities'
import { getProject, type Project } from './projects'

/**
 * The key `currentActivityId` is stored in the generic `setting` key/value
 * table (migration 004), but this is deliberately not one of the `Settings`
 * exposed by `repositories/settings.ts`. `readSettings` merges stored rows
 * over `DEFAULT_SETTINGS` and drops anything not listed in `VOCABULARIES` for
 * its key — right for a closed vocabulary like `theme`, wrong for an id: an
 * id has no vocabulary to check membership against, and letting it through
 * `readSettings` unchecked would defeat the reason that function filters at
 * all. So this repository writes to the same table under its own key, with
 * its own existence check below, and `readSettings` goes on ignoring that key
 * for exactly the reason it ignores any key outside `VOCABULARIES`.
 */
const CURRENT_ACTIVITY_KEY = 'currentActivityId'

/**
 * What the launcher resumes into (spec §10.1): the activity she was last
 * working in, together with the project it belongs to, fetched as one pair so
 * the screen cannot show a project that disagrees with a second query of its
 * own. `null` is the genuine first-run state — no activity has ever been
 * started on this device — and is returned rather than thrown so the launcher
 * can render it honestly instead of treating "nothing yet" as a failure.
 */
export type CurrentContext = { activity: Activity; project: Project } | null

/**
 * Records which activity she is currently working in, or clears the
 * selection when passed `null`.
 *
 * Refuses an id that does not name a live activity. Storing one that does not
 * resolve to anything would look fine until the next launch, when
 * `readCurrentContext`'s fallback would silently take over and she would
 * wonder why her selection did not stick — so this refuses at the moment the
 * choice is made, when the refusal is still useful, rather than degrading
 * quietly the way a *previously valid* selection is allowed to later (see
 * `readCurrentContext`).
 *
 * `null` deletes the stored row rather than writing one: the `setting`
 * table's `value` column is `NOT NULL` (migration 004), so there is no SQL
 * NULL to write that a later read could tell apart from "never set" — the
 * row's absence is what "never set" already means.
 */
export async function setCurrentActivity(db: Database, activityId: string | null): Promise<void> {
  if (activityId === null) {
    await db.execute('DELETE FROM setting WHERE key = ?', [CURRENT_ACTIVITY_KEY])
    return
  }

  const activity = await getActivity(db, activityId)
  if (!activity) {
    throw new Error(
      `Activity ${activityId} does not exist, so it cannot become the current activity.`,
    )
  }

  await db.execute(
    `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [CURRENT_ACTIVITY_KEY, activityId, nowIso()],
  )
}

/**
 * The context the launcher resumes into (spec §10.1): the stored activity
 * when it is still live, otherwise the most recently started activity across
 * every project, otherwise `null`.
 *
 * "Live" means not soft-deleted — `getActivity` already reads a soft-deleted
 * activity as absent, the same as an unknown id — and not ended: an activity
 * she has already finished is not somewhere new capture should resume, so a
 * stored id pointing at one falls through to the fallback exactly as a
 * deleted one does.
 *
 * A stale stored id is never an error here. She may delete or end an activity
 * from another screen after choosing it; resuming degrades quietly to the
 * fallback rather than throwing. That is deliberately asymmetric with
 * `setCurrentActivity`, which refuses the same condition — refusing is useful
 * at the moment a choice is made, when there is a person to tell; it is not
 * useful here, on a path a fresh install and an ordinary launch both run.
 */
export async function readCurrentContext(db: Database): Promise<CurrentContext> {
  const stored = await db.first<{ value: string }>('SELECT value FROM setting WHERE key = ?', [
    CURRENT_ACTIVITY_KEY,
  ])

  if (stored) {
    const activity = await getActivity(db, stored.value)
    if (activity && activity.endedAt === null) {
      const project = await getProject(db, activity.projectId)
      if (project) return { activity, project }
    }
  }

  const activity = await mostRecentActivity(db)
  if (!activity) return null

  const project = await getProject(db, activity.projectId)
  if (!project) {
    throw new Error(
      `Activity ${activity.id} belongs to project ${activity.projectId}, which does not exist ` +
        'or has been deleted. An activity cannot outlive the project it was started in.',
    )
  }
  return { activity, project }
}
