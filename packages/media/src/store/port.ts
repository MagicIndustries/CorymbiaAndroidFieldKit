/**
 * Everything this application does to media files, and nothing else.
 *
 * The same shape `@corymbia/data` uses for SQLite: one narrow interface, an
 * `expo-file-system` adapter for the device, an in-memory adapter for Node
 * tests. The lifecycle rules — save before the row, roll back on failure,
 * never delete on a soft delete — live above this port, not inside it.
 *
 * `remove` is deliberately not called `delete`: deletion in this application is
 * SOFT (spec §12.1 — the row is flagged and the file stays on disk), and a
 * store method named `delete` invites a caller to reach for it when a user
 * removes a photo. Today this method has exactly one caller,
 * `useAttachMedia`'s rollback of a save it has just made.
 *
 * The purge that spec §12.1 puts in settings **is not built** — no route, no
 * reconciliation, nothing under `apps/` or `packages/` that would ever call
 * this for a soft-deleted attachment. Until a later plan builds it, removed
 * attachments' bytes and every crash-orphaned file accumulate on the device
 * permanently. See `docs/media-storage.md` §5 for what that costs and why it
 * matters more than it looks.
 */
export type MediaStore = {
  /** Moves the captured file at `sourceUri` into app-owned storage. */
  save(fileName: string, sourceUri: string): Promise<{ uri: string; byteSize: number }>
  /** Permanently removes the file. Silent if it is already gone. */
  remove(fileName: string): Promise<void>
  exists(fileName: string): Promise<boolean>
  /** Where the file lives, whether or not it is there yet. */
  uriFor(fileName: string): string
}
