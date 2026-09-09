import { openTestDatabase } from '../../db/better-sqlite3'
import { migrate } from '../../db/migrate'
import type { Database } from '../../db/port'
import { createActivity } from '../activities'
import { createProject } from '../projects'
import { readCurrentContext, setCurrentActivity } from '../context'

// Distinct, ordered start times, written in the same way activities.test.ts
// writes them: `nowIso()` truncates to whole seconds, so three activities
// created back-to-back in one test can tie on `started_at` no matter how long
// the test waits between them. Setting them explicitly, out of insertion
// order, is what makes `mostRecentlyStarted` actually test the "most recent"
// rule rather than piggybacking on `id DESC` or on creation order.
const EARLIEST = '2026-02-11T08:00:00+11:00'
const MIDDLE = '2026-02-11T09:00:00+11:00'
const LATEST = '2026-02-11T10:00:00+11:00'

describe('the current context', () => {
  let db: Database
  let projectB: Awaited<ReturnType<typeof createProject>>
  let activityB: Awaited<ReturnType<typeof createActivity>>
  let mostRecentlyStarted: Awaited<ReturnType<typeof createActivity>>

  beforeEach(async () => {
    db = await openTestDatabase()
    await migrate(db)

    const projectA = await createProject(db, { name: 'Dandenong Creek Survey' })
    projectB = await createProject(db, { name: 'Tambo River eDNA' })

    const activityA = await createActivity(db, {
      projectId: projectA.id,
      kind: 'survey',
      name: 'Site 1',
    })
    activityB = await createActivity(db, {
      projectId: projectB.id,
      kind: 'sampling',
      name: 'Site 2',
    })
    mostRecentlyStarted = await createActivity(db, {
      projectId: projectA.id,
      kind: 'survey',
      name: 'Site 3',
    })

    await db.execute('UPDATE activity SET started_at = ? WHERE id = ?', [EARLIEST, activityA.id])
    await db.execute('UPDATE activity SET started_at = ? WHERE id = ?', [MIDDLE, activityB.id])
    await db.execute('UPDATE activity SET started_at = ? WHERE id = ?', [
      LATEST,
      mostRecentlyStarted.id,
    ])
  })
  afterEach(async () => {
    await db.close()
  })

  it('remembers the activity she selected', async () => {
    await setCurrentActivity(db, activityB.id)
    const context = await readCurrentContext(db)
    expect(context?.activity.id).toBe(activityB.id)
  })

  it('returns the project that activity belongs to, not just the activity', async () => {
    // The launcher shows both, and a second query from the screen would be a
    // second chance to disagree with this one.
    await setCurrentActivity(db, activityB.id)
    const context = await readCurrentContext(db)
    expect(context?.project.id).toBe(projectB.id)
    expect(context?.project.name).toBe('Tambo River eDNA')
  })

  it('falls back to the most recent activity when nothing has been selected', async () => {
    const context = await readCurrentContext(db)
    expect(context?.activity.id).toBe(mostRecentlyStarted.id)
  })

  it('falls back rather than throwing when the stored activity has been deleted', async () => {
    await setCurrentActivity(db, activityB.id)
    // softDeleteActivity does not exist in this repository yet, so the
    // tombstone is written directly rather than adding a repository function
    // this plan does not need.
    await db.execute('UPDATE activity SET deleted_at = ? WHERE id = ?', [
      '2026-02-11T11:00:00+11:00',
      activityB.id,
    ])
    const context = await readCurrentContext(db)
    expect(context?.activity.id).toBe(mostRecentlyStarted.id)
  })

  it('falls back rather than resuming an activity that has ended', async () => {
    // There is no repository function for ending an activity yet either, so
    // `ended_at` is set directly for the same reason as the deletion case
    // above.
    await setCurrentActivity(db, activityB.id)
    await db.execute('UPDATE activity SET ended_at = ? WHERE id = ?', [
      '2026-02-11T11:00:00+11:00',
      activityB.id,
    ])
    const context = await readCurrentContext(db)
    expect(context?.activity.id).toBe(mostRecentlyStarted.id)
  })

  it('reports no context at all on a fresh install', async () => {
    // The genuine first-run state. The launcher has to render something
    // honest here, so this must be distinguishable from an error. A separate,
    // truly empty database — no projects, no activities — rather than `db`
    // with nothing selected, which is the "fall back" case above.
    const emptyDb = await openTestDatabase()
    await migrate(emptyDb)
    try {
      const context = await readCurrentContext(emptyDb)
      expect(context).toBeNull()
    } finally {
      await emptyDb.close()
    }
  })

  it('clears the selection when given null', async () => {
    await setCurrentActivity(db, activityB.id)
    await setCurrentActivity(db, null)
    const context = await readCurrentContext(db)
    expect(context?.activity.id).toBe(mostRecentlyStarted.id)
  })

  it('refuses an activity that does not exist, rather than storing it', async () => {
    // Storing an unknown id would look fine until the next launch, when the
    // fallback would silently take over and she would wonder why her
    // selection did not stick.
    await expect(setCurrentActivity(db, 'act_nope')).rejects.toThrow(/does not exist/i)
  })

  it('refuses an activity that has been soft-deleted, the same as an unknown one', async () => {
    // A second example of the same rule, so this does not pass merely
    // because the string 'act_nope' happens not to exist — a real,
    // once-valid id that has since been tombstoned must be refused too.
    await db.execute('UPDATE activity SET deleted_at = ? WHERE id = ?', [
      '2026-02-11T11:00:00+11:00',
      activityB.id,
    ])
    await expect(setCurrentActivity(db, activityB.id)).rejects.toThrow(/does not exist/i)
  })
})
