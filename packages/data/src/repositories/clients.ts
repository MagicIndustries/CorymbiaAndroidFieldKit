import type { Database } from '../db/port'

/**
 * The organisation a project is for (§7.3). Only the name is ever shown —
 * doctrine rule 6 keeps ids off the screen — so this exists to turn a
 * project's `clientId` into something the launcher can print beside the
 * project name.
 *
 * **A client is its own aggregate, not a shape borrowed from `Project`.** It
 * used to live in `repositories/projects.ts` beside a `ClientRow` that
 * duplicated this type field for field, with no mapper between them — unlike
 * `getProject`'s `ProjectRow`, whose columns are genuinely `snake_case` where
 * this type is `camelCase`, `client`'s three columns (`id`, `name`,
 * `contact`) already read straight into `Client` with no translation to do.
 * A row type that repeats the type it maps to earns nothing, so this module
 * has none.
 */
export type Client = {
  id: string
  name: string
  contact: string | null
}

/**
 * One client by id, or null when there is no live one under it.
 *
 * Mirrors `getProject` and `getActivity`: a soft-deleted client reads as
 * absent rather than as a row with a tombstone on it, so a caller that only
 * wants a name to print does not have to know the difference. `project.
 * client_id` is `NOT NULL REFERENCES client(id)` (migration 001), so the only
 * way this returns null for a live project is a client that was soft-deleted
 * out from under it — which is a thing to render honestly, not to throw over.
 */
export async function getClient(db: Database, id: string): Promise<Client | null> {
  return db.first<Client>('SELECT id, name, contact FROM client WHERE deleted_at IS NULL AND id = ?', [
    id,
  ])
}
