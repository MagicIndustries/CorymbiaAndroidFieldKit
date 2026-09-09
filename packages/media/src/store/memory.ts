import type { MediaStore } from './port'

/**
 * An in-memory `MediaStore` for Node tests. Holds byte sizes rather than bytes:
 * nothing above this port reads a file's contents, so contents would be a
 * fiction the tests then have to maintain.
 *
 * `sources` seeds the fake filesystem the camera and recorder are pretending to
 * have written into: a map of source uri to byte size.
 */
export function createMemoryStore(
  sources: Record<string, number> = {},
): MediaStore & { contents(): Map<string, number> } {
  const stored = new Map<string, number>()

  return {
    async save(fileName, sourceUri) {
      const size = sources[sourceUri]
      if (size === undefined) {
        throw new Error(`No source file at ${sourceUri} to save as ${fileName}.`)
      }
      if (stored.has(fileName)) {
        throw new Error(
          `${fileName} already exists. Saving over it would replace one record's media with ` +
            "another's, and the row pointing at the old bytes would not know.",
        )
      }
      stored.set(fileName, size)
      return { uri: this.uriFor(fileName), byteSize: size }
    },
    async remove(fileName) {
      stored.delete(fileName)
    },
    async exists(fileName) {
      return stored.has(fileName)
    },
    uriFor(fileName) {
      return `memory://media/${fileName}`
    },
    contents() {
      return new Map(stored)
    },
  }
}
