/**
 * `expo-file-system` is a native module with no Node implementation, so this
 * suite mocks it. That means it proves the adapter CALLS THE RIGHT API in the
 * right order with the right arguments — not that files actually move. The
 * real thing is proven on the device, in Task 12's hardware checklist.
 *
 * Mocking is worth doing anyway because the three things most likely to be
 * wrong here are exactly the things a mock can see: writing into `Paths.cache`
 * instead of `Paths.document` (silent, until Android reclaims storage and a
 * day's photos are gone), not creating the directory before the move, and
 * moving into the media DIRECTORY rather than onto the destination FILE —
 * which lands the bytes under the camera's temporary name instead of the media
 * id, so every row points at a path that does not exist.
 *
 * Everything the fake filesystem needs at module-evaluation time lives on
 * `mockFs`. The name matters: `jest.mock` is hoisted above the imports, so its
 * factory runs before any module-scope `const` in this file, and
 * babel-plugin-jest-hoist only permits a factory to close over out-of-scope
 * variables whose names begin with `mock`. The factory below never
 * dereferences `mockFs` — only the fake classes' methods do, and those run
 * inside tests, long after this file's body has finished.
 */
const mockFs = {
  move: jest.fn<void, [source: string, landedAt: string]>(),
  remove: jest.fn<void, [uri: string]>(),
  createDirectory: jest.fn<void, [uri: string, options: unknown]>(),
  /** The fake filesystem's existence table: every uri that is "on disk". */
  present: new Set<string>(),
  /**
   * Byte sizes, per uri — not one global number. A single shared size cannot
   * tell a test whether the adapter read the source's size, the destination's
   * (0, since nothing is there before the move), or the stored file's size
   * after the move actually landed it. Only the last of those is correct.
   */
  sizes: new Map<string, number>(),
}

const DOCUMENTS = 'file:///data/app/documents'
const SOURCE_URI = 'file:///tmp/shot.jpg'
const STORED_URI = `${DOCUMENTS}/media/med_a1.jpg`

jest.mock('expo-file-system', () => {
  const join = (segments: readonly (string | { uri: string })[]): string =>
    segments.map((segment) => (typeof segment === 'string' ? segment : segment.uri)).join('/')

  class FakeDirectory {
    uri: string
    constructor(...segments: (string | { uri: string })[]) {
      this.uri = join(segments)
    }
    create(options: unknown) {
      mockFs.createDirectory(this.uri, options)
    }
  }

  class FakeFile {
    uri: string
    /**
     * Snapshotted once, at construction — like a native stat, not a live
     * pointer into `mockFs.sizes`. That distinction is the whole point: a
     * `File` handle built before a move (the adapter's `destination`) must
     * report the size it had *then*, even after `mockFs.sizes` is updated by
     * a move that happened on a *different* handle. Only a fresh `File`
     * constructed after the move picks up the new value. A live getter here
     * would let the adapter read `destination.size` post-move and still get
     * the right answer by accident, defeating the point of the deliberate
     * fresh re-read in `expo.ts`.
     */
    #size: number
    constructor(...segments: (string | { uri: string })[]) {
      this.uri = join(segments)
      this.#size = mockFs.sizes.get(this.uri) ?? 0
    }
    get exists() {
      return mockFs.present.has(this.uri)
    }
    get size() {
      return this.#size
    }
    /**
     * Faithful to SDK 57's two documented destination types, because the
     * difference between them is the bug this suite exists to catch. Handed a
     * Directory, the file keeps its SOURCE name — the docs' own example moves
     * `example.txt` into a folder and it is still `example.txt` on the other
     * side. Handed a File, it lands at that File's uri, name and all.
     *
     * Async, matching `move(): Promise<void>` in 57.0.6; `moveSync` is the
     * synchronous variant. The `await Promise.resolve()` before anything is
     * mutated is deliberate: with no internal await at all, a missing `await`
     * on the call site is unobservable, because this whole body then runs
     * synchronously to completion before the caller gets a chance to look at
     * anything. Deferring even one microtask means a caller that forgot to
     * await sees the pre-move state.
     */
    async move(destination: FakeFile | FakeDirectory) {
      await Promise.resolve()
      const landedAt =
        destination instanceof FakeDirectory
          ? `${destination.uri}/${this.uri.split('/').pop() ?? ''}`
          : destination.uri
      mockFs.move(this.uri, landedAt)
      mockFs.present.delete(this.uri)
      mockFs.present.add(landedAt)
      const size = mockFs.sizes.get(this.uri) ?? this.#size
      mockFs.sizes.delete(this.uri)
      mockFs.sizes.set(landedAt, size)
      this.uri = landedAt
      this.#size = size
    }
    delete() {
      mockFs.remove(this.uri)
      mockFs.present.delete(this.uri)
      mockFs.sizes.delete(this.uri)
    }
  }

  return {
    File: FakeFile,
    Directory: FakeDirectory,
    Paths: { document: 'file:///data/app/documents', cache: 'file:///data/app/cache' },
  }
})

import { createExpoMediaStore } from '../store/expo'

beforeEach(() => {
  jest.clearAllMocks()
  mockFs.present.clear()
  mockFs.sizes.clear()
  // The camera has just written its temporary file, and nothing is in the
  // media directory yet. That is the state every save starts from.
  mockFs.present.add(SOURCE_URI)
  mockFs.sizes.set(SOURCE_URI, 4096)
})

describe('the expo-file-system media store', () => {
  it('stores under the document directory, never the cache', async () => {
    // Paths.cache is reclaimed by Android under storage pressure. A field day's
    // photos living there would vanish without an error, and the rows would
    // survive pointing at nothing.
    const store = createExpoMediaStore()
    expect(store.uriFor('med_a1.jpg')).toContain('file:///data/app/documents')
    expect(store.uriFor('med_a1.jpg')).not.toContain('cache')
  })

  it('creates the media directory before moving anything into it', async () => {
    const store = createExpoMediaStore()
    await store.save('med_a1.jpg', SOURCE_URI)
    // Pins both the destination and the options in one call. A `directory()`
    // whose base had been mutated to `Paths.cache` would create
    // `file:///data/app/cache/media` instead — a fresh install's
    // `documents/media` would never exist, and the move destined for it would
    // fail on device. Dropping the options object would default `idempotent`
    // to false, so the SDK throws on the second capture of the app's life.
    expect(mockFs.createDirectory).toHaveBeenCalledWith(`${DOCUMENTS}/media`, {
      intermediates: true,
      idempotent: true,
    })
    const createOrder = mockFs.createDirectory.mock.invocationCallOrder[0]
    const moveOrder = mockFs.move.mock.invocationCallOrder[0]
    if (createOrder === undefined || moveOrder === undefined) {
      throw new Error('expected both createDirectory and move to have been recorded')
    }
    expect(createOrder).toBeLessThan(moveOrder)
  })

  it('moves the captured file out of its temporary home, under the name it was given', async () => {
    // Both halves matter. Moving into the media Directory would satisfy "out of
    // its temporary home" while leaving the bytes at `.../media/shot.jpg` — the
    // camera's throwaway name, not the media id the row stores. The second
    // argument is where the file actually landed, so it fails on that mistake.
    const store = createExpoMediaStore()
    const saved = await store.save('med_a1.jpg', SOURCE_URI)
    expect(mockFs.move).toHaveBeenCalledWith(SOURCE_URI, STORED_URI)
    expect(saved.uri).toBe(STORED_URI)
  })

  it('reports a saved file as existing', async () => {
    // `exists`'s only other call sites (below) all expect `false`, so a body
    // hardcoded to `return false` passes the rest of this suite outright.
    // This is the one assertion that needs it to come back `true`.
    const store = createExpoMediaStore()
    await store.save('med_a1.jpg', SOURCE_URI)
    expect(await store.exists('med_a1.jpg')).toBe(true)
  })

  it('reports the stored size, read fresh from the destination after the move', async () => {
    // Per-uri sizing (see the fake, above) makes the destination start at 0 —
    // nothing is there yet — and only pick up the source's size once `move`
    // actually carries it across a *different* File handle. That makes two
    // otherwise-invisible bugs observable through the same assertion: a
    // dropped `await` on `source.move(destination)` (the adapter reads the
    // fresh handle before the move's mutation has run) and skipping the
    // adapter's deliberate re-read (reusing the pre-move `destination`
    // handle's snapshot instead of constructing a fresh one). Both come back
    // as 0 instead of the real size.
    mockFs.sizes.set(SOURCE_URI, 123456)
    const store = createExpoMediaStore()
    const saved = await store.save('med_a1.jpg', SOURCE_URI)
    expect(saved.byteSize).toBe(123456)
  })

  it('refuses to overwrite an existing name', async () => {
    // The destination is already on disk. Saving over it would replace one
    // record's media with another's, and the row pointing at the old bytes
    // would not know.
    mockFs.present.add(STORED_URI)
    const store = createExpoMediaStore()
    await expect(store.save('med_a1.jpg', SOURCE_URI)).rejects.toThrow(/already/i)
    expect(mockFs.move).not.toHaveBeenCalled()
  })

  it('refuses when the capture it was pointed at is not there', async () => {
    // A camera or recorder that failed silently would otherwise produce a row
    // with a byteSize of 0 pointing at a path that never existed.
    mockFs.present.delete(SOURCE_URI)
    const store = createExpoMediaStore()
    await expect(store.save('med_a1.jpg', SOURCE_URI)).rejects.toThrow(/no source file/i)
    expect(mockFs.move).not.toHaveBeenCalled()
  })

  it('removes a stored file', async () => {
    mockFs.present.add(STORED_URI)
    const store = createExpoMediaStore()
    await store.remove('med_a1.jpg')
    expect(mockFs.remove).toHaveBeenCalledWith(STORED_URI)
    expect(await store.exists('med_a1.jpg')).toBe(false)
  })

  it('is silent about removing a file that is already gone', async () => {
    const store = createExpoMediaStore()
    await expect(store.remove('med_a1.jpg')).resolves.toBeUndefined()
    expect(mockFs.remove).not.toHaveBeenCalled()
  })
})
