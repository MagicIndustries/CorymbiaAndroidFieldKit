/**
 * The seam between the camera screen (Task 8) and the media pipeline
 * (Task 10, spec §12.1).
 *
 * The camera screen only needs something to call and await once a photo has
 * been captured to a temporary file: it does not open the database, does not
 * know the current device or the fix to attribute the attachment to, and
 * should not need to for a screen whose whole job is the viewfinder and the
 * shutter. Task 10 fills this in with the real pipeline — minting a media id
 * (`newMediaId`), deriving its permanent filename, copying the bytes from
 * `sourceUri` into place, and calling `attachMedia` (`@corymbia/data`) to
 * write the row and its `media_added` event in one transaction.
 *
 * Until then this throws, deliberately, rather than silently doing nothing:
 * a stub that pretended to succeed would let the camera screen "work" while
 * dropping every photo on the floor, and the screen's own error path (spec
 * doctrine rule 3: shown on the screen, not swallowed) is exactly what would
 * hide that.
 */
export type AttachPhotoInput = {
  recordId: string
  sourceUri: string
}

export async function attachPhoto(_input: AttachPhotoInput): Promise<void> {
  throw new Error(
    'attachPhoto is not wired to the media pipeline yet — Task 10 implements this seam.',
  )
}
