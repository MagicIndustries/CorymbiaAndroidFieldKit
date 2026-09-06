import { openTestDatabase } from '../../db/better-sqlite3'
import { migrate } from '../../db/migrate'
import type { Database } from '../../db/port'
import { createActivity, listActivities, mostRecentActivity } from '../activities'
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
