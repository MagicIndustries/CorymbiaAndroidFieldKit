import { openTestDatabase } from '../../db/better-sqlite3'
import { migrate } from '../../db/migrate'
import type { Database } from '../../db/port'
import { createProject, getProject, listProjects } from '../projects'

const FOREIGN_KEY = /FOREIGN KEY constraint failed/

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

  it('rolls back the entire transaction if a location does not exist', async () => {
    await expect(
      createProject(db, { name: 'Yarra Flats', locationIds: ['location-does-not-exist'] }),
    ).rejects.toThrow(FOREIGN_KEY)

    // The critical assertion: the project row must not exist either
    const projectRow = await db.all<{ id: string }>(
      'SELECT id FROM project WHERE name = ? AND deleted_at IS NULL',
      ['Yarra Flats'],
    )
    expect(projectRow).toEqual([])
  })

  it('sorts active projects before archived ones, regardless of update time', async () => {
    const archived = await createProject(db, { name: 'Old Active' })
    await new Promise((r) => setTimeout(r, 5))
    const active = await createProject(db, { name: 'New Active' })

    // Archive the first one and update it to be more recent than the active project
    await db.execute('UPDATE project SET status = ?, updated_at = ? WHERE id = ?', [
      'archived',
      '2026-09-07T00:00:00+00:00',
      archived.id,
    ])
    // Update the active project to have an older timestamp
    await db.execute('UPDATE project SET updated_at = ? WHERE id = ?', [
      '2026-01-01T00:00:00+00:00',
      active.id,
    ])

    const listed = await listProjects(db)
    expect(listed.map((p) => p.id)).toEqual([active.id, archived.id])
    expect(listed).toHaveLength(2)
    expect(listed[0]!.status).toBe('active')
    expect(listed[1]!.status).toBe('archived')
  })
})
