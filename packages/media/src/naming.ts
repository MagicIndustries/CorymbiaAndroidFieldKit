/**
 * How a stored media file is named on disk (spec §12.1).
 *
 * The media row's own id, and nothing else. §12.1 rejects three richer names
 * for one reason: a path must not depend on anything that can change.
 *
 *  - NOT the title — editable, duplicable, blank-able, and can contain slashes.
 *  - NOT under a project directory — records are refilable between projects.
 *  - NOT the record id plus an index — the index moves when an earlier
 *    attachment is removed or the order changes, and because deletion is soft
 *    the removed file is STILL ON DISK under the name the new one would take.
 *
 * The media id is minted once and never changes. The record it belongs to is a
 * column, which is where a mutable relationship belongs. Human-readable names
 * are applied at export, where project and sequence are known and nothing
 * downstream depends on them.
 */
export type MediaKind = 'photo' | 'voice'

/**
 * The extension per kind, which must match what the capture APIs actually
 * write: `expo-camera`'s `takePictureAsync` produces JPEG, and `expo-audio`'s
 * `RecordingPresets.HIGH_QUALITY` produces `.m4a` on Android.
 */
const EXTENSION: Record<MediaKind, string> = {
  photo: 'jpg',
  voice: 'm4a',
}

/** Ids from `newId` are `prefix_` plus base-36, so this is not restrictive. */
const SAFE_MEDIA_ID = /^[A-Za-z0-9_-]+$/

export function mediaFileName(mediaId: string, kind: MediaKind): string {
  if (!SAFE_MEDIA_ID.test(mediaId)) {
    throw new Error(
      `Refusing to build a filename from media id ${JSON.stringify(mediaId)}. The result is ` +
        'a filesystem path, and an id carrying a separator or a dot segment would write ' +
        'outside the media directory.',
    )
  }
  return `${mediaId}.${EXTENSION[kind]}`
}
