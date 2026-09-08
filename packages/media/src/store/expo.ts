import { Directory, File, Paths } from 'expo-file-system'
import type { MediaStore } from './port'

/**
 * The `MediaStore` the device actually runs on, over SDK 57's `expo-file-system`
 * class API (`File`, `Directory`, `Paths`) — NOT the `FileSystem.*Async`
 * surface, which now lives at `expo-file-system/legacy` and throws at runtime
 * from the package root.
 *
 * The class API is mostly synchronous (`exists`, `size`, `create`, `delete`);
 * relocation is not — `move` returns a promise in 57.0.6, with `moveSync` as
 * the synchronous variant. This port is async regardless, because the
 * in-memory adapter and every caller already are, so the promise costs nothing
 * and buys not stalling the JS thread while the OS copies a voice recording
 * across from the recorder's temporary directory.
 */

/**
 * The directory every media file lives in, flat (spec §12.1).
 *
 * Under `Paths.document`, which the SDK 57 docs describe as "a place to store
 * files that are safe from being deleted by the system" — NOT `Paths.cache`,
 * "a place to store files that can be deleted by the system when the device
 * runs low on storage". A day's photos disappearing with no error, leaving
 * rows that point at nothing, is the failure that choice prevents. Nobody
 * would find out until the export at the end of the trip.
 */
const MEDIA_DIRECTORY = 'media'

export function createExpoMediaStore(): MediaStore {
  const directory = (): Directory => new Directory(Paths.document, MEDIA_DIRECTORY)
  const fileFor = (fileName: string): File => new File(Paths.document, MEDIA_DIRECTORY, fileName)

  return {
    async save(fileName, sourceUri) {
      const destination = fileFor(fileName)
      if (destination.exists) {
        throw new Error(
          `${fileName} already exists. Saving over it would replace one record's media with ` +
            "another's, and the row pointing at the old bytes would not know.",
        )
      }
      const source = new File(sourceUri)
      if (!source.exists) {
        throw new Error(`No source file at ${sourceUri} to save as ${fileName}.`)
      }

      // Checked above, not below: a missing source has nothing to move, and
      // creating the directory first would leave an empty `media/` behind
      // when a camera or recorder failed silently and there was never
      // anything to put in it.
      //
      // Idempotent so a second capture does not throw on a directory that is
      // already there, and `intermediates` so a fresh install does not fail on
      // a missing parent.
      directory().create({ intermediates: true, idempotent: true })

      // A File destination, not a Directory one. `move` accepts either
      // (installed typings, node_modules/expo-file-system/build/internal/
      // NativeFileSystem.types.d.ts:190: `move(destination: PublicDirectory |
      // PublicFile, options?: RelocationOptions): Promise<void>` — cited by
      // file and line rather than by docs section, which moves around across
      // SDK versions in a way a path into node_modules does not), and the
      // difference is the whole of this line: handed a Directory the file
      // keeps its SOURCE name — the docs' own example moves `example.txt`
      // into a folder and it is `${dir}/example.txt` on the far side — which
      // here would leave the bytes under the camera's throwaway name while
      // every row points at the media id. Handed a File it lands at that
      // File's uri, so the move and the rename are one operation and there is
      // no window in which a half-renamed file exists.
      await source.move(destination)

      // Re-read through a fresh handle rather than trusting `destination`'s
      // properties across the move: `exists` and `size` are native-backed, and
      // the one thing worth being certain of is that the bytes are where the
      // row is about to say they are.
      const stored = fileFor(fileName)
      return { uri: stored.uri, byteSize: stored.size }
    },
    async remove(fileName) {
      const file = fileFor(fileName)
      if (!file.exists) return
      file.delete()
    },
    async exists(fileName) {
      return fileFor(fileName).exists
    },
    uriFor(fileName) {
      return fileFor(fileName).uri
    },
  }
}
