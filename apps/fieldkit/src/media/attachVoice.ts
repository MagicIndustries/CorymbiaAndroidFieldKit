/**
 * The seam between the voice note screen (Task 9) and the media pipeline
 * (Task 10, spec §12.1) — the sibling of `attachPhoto.ts` (Task 8).
 *
 * The voice screen only needs something to call and await once a recording
 * has been stopped and written to a temporary file: it does not open the
 * database, does not know the current device or the fix to attribute the
 * attachment to, and should not need to for a screen whose whole job is the
 * toggle and the elapsed-time readout. Task 10 fills this in with the real
 * pipeline — minting a media id (`newMediaId`), deriving its permanent
 * filename (`.m4a`, matching `RecordingPresets.HIGH_QUALITY`'s Android
 * extension), copying the bytes from `sourceUri` into place, and calling
 * `attachMedia` (`@corymbia/data`) to write the row and its `media_added`
 * event in one transaction.
 *
 * `durationMs` travels with the file rather than being recomputed later: it
 * is the length the recording actually ran for, read from
 * `useAudioRecorderState` before `stop()` was even called, and there is no
 * way to recover it afterwards short of decoding the `.m4a` itself.
 *
 * Until Task 10 lands this throws, deliberately, rather than silently doing
 * nothing: a stub that pretended to succeed would let the voice screen
 * "work" while dropping every note on the floor, and the screen's own error
 * path (doctrine rule 6: shown on the screen, not swallowed) is exactly what
 * would hide that.
 */
export type AttachVoiceInput = {
  recordId: string
  sourceUri: string
  durationMs: number
}

export async function attachVoice(_input: AttachVoiceInput): Promise<void> {
  throw new Error(
    'attachVoice is not wired to the media pipeline yet — Task 10 implements this seam.',
  )
}
