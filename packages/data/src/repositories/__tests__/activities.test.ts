import { openTestDatabase } from '../../db/better-sqlite3'
import { migrate } from '../../db/migrate'
import type { Database } from '../../db/port'
import { ACTIVITY_KINDS, createActivity, listActivities, mostRecentActivity } from '../activities'
import { createProject } from '../projects'

// `.rejects.toThrow()` with no matcher passes on a column typo, a renamed
// table or a dropped constraint alike — see records-schema.test.ts. Naming the
// constraint below keeps this test meaningful.
const FOREIGN_KEY = /FOREIGN KEY constraint failed/

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

  /**
   * The five kinds are declared twice — once as `ACTIVITY_KINDS` in the
   * repository, once as the `CHECK (kind IN (...))` in migration 001 — and
   * nothing but this test makes the two agree. A kind added to the list and
   * not to the constraint fails here with a SQLITE_CONSTRAINT, which is what
   * it would otherwise do mid-capture on a field device.
   */
  it('accepts every kind it publishes, so the list and the constraint agree', async () => {
    for (const kind of ACTIVITY_KINDS) {
      const activity = await createActivity(db, { projectId, kind, name: `A ${kind}` })
      expect(activity.kind).toBe(kind)
    }
    expect(ACTIVITY_KINDS).toHaveLength(5)
  })

  it('refuses a blank name', async () => {
    await expect(
      createActivity(db, { projectId, kind: 'survey', name: '  ' }),
    ).rejects.toThrow(/name/i)
  })

  it('refuses an unknown project rather than orphaning the activity', async () => {
    await expect(
      createActivity(db, { projectId: 'nope', kind: 'survey', name: 'Survey 3' }),
    ).rejects.toThrow(FOREIGN_KEY)
  })

  // `nowIso()` truncates to whole seconds, so two activities created in the
  // same test share a `started_at` no matter how long the test sleeps between
  // them — the truncation is in the format, not the clock. The `id DESC`
  // tiebreak in `listActivities`/`mostRecentActivity` then decided both tests
  // below, leaving the `started_at DESC` term they are named for untested.
  //
  // Both now write the timestamps in the OPPOSITE order to the ids — the
  // technique records.test.ts uses — so the answer changes if either term is
  // dropped. Ids are time-ordered, so the FIRST-created activity is the one
  // that must come out on top.
  const EARLIER = '2026-02-11T08:00:00+11:00'
  const LATER = '2026-02-11T09:00:00+11:00'

  it('lists most recent first, by start time rather than by insertion order', async () => {
    const first = await createActivity(db, { projectId, kind: 'survey', name: 'One' })
    const second = await createActivity(db, { projectId, kind: 'sampling', name: 'Two' })
    await db.execute('UPDATE activity SET started_at = ? WHERE id = ?', [LATER, first.id])
    await db.execute('UPDATE activity SET started_at = ? WHERE id = ?', [EARLIER, second.id])

    expect((await listActivities(db, projectId)).map((a) => a.id)).toEqual([first.id, second.id])
  })

  it('reports the most recent activity across all projects, for the launcher to resume', async () => {
    const first = await createActivity(db, { projectId, kind: 'survey', name: 'One' })
    const second = await createActivity(db, { projectId, kind: 'sampling', name: 'Two' })
    await db.execute('UPDATE activity SET started_at = ? WHERE id = ?', [LATER, first.id])
    await db.execute('UPDATE activity SET started_at = ? WHERE id = ?', [EARLIER, second.id])

    expect((await mostRecentActivity(db))?.id).toBe(first.id)
  })

  it('returns null when nothing has been started yet', async () => {
    expect(await mostRecentActivity(db)).toBeNull()
  })

  it('excludes soft-deleted activities from the most recent listing', async () => {
    const older = await createActivity(db, { projectId, kind: 'survey', name: 'First' })
    await new Promise((r) => setTimeout(r, 5))
    const newer = await createActivity(db, { projectId, kind: 'survey', name: 'Second' })

    // Soft-delete the more recent one
    await db.execute('UPDATE activity SET deleted_at = ? WHERE id = ?', [
      '2026-09-06T00:00:00Z',
      newer.id,
    ])

    // mostRecentActivity should return the older one
    const recent = await mostRecentActivity(db)
    expect(recent?.id).toBe(older.id)
  })

  it('returns null for mostRecentActivity when the only activity is soft-deleted', async () => {
    const activity = await createActivity(db, { projectId, kind: 'survey', name: 'Only One' })
    await db.execute('UPDATE activity SET deleted_at = ? WHERE id = ?', [
      '2026-09-06T00:00:00Z',
      activity.id,
    ])

    expect(await mostRecentActivity(db)).toBeNull()
  })
})
