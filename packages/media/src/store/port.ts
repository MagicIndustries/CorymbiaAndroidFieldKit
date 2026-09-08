/**
 * Everything this application does to media files, and nothing else.
 *
 * The same shape `@corymbia/data` uses for SQLite: one narrow interface, an
 * `expo-file-system` adapter for the device, an in-memory adapter for Node
 * tests. The lifecycle rules — save before the row, roll back on failure,
 * never delete on a soft delete — live above this port, not inside it.
 *
 * `remove` is deliberately not called `delete`: deletion in this application is
 * SOFT (spec §12.1, the row is flagged and the file survives until a
 * deliberate purge in settings), and a store method named `delete` invites a
 * caller to reach for it when a user removes a photo. This one is for the
 * purge and for rolling back a half-finished save.
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
