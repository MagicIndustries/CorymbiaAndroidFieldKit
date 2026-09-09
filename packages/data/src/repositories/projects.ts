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
      await db.execute('INSERT INTO project_location (project_id, location_id) VALUES (?, ?)', [
        id,
        locationId,
      ])
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
