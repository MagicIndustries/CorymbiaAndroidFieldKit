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
  size: 4096,
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
    constructor(...segments: (string | { uri: string })[]) {
      this.uri = join(segments)
    }
    get exists() {
      return mockFs.present.has(this.uri)
    }
    get size() {
      return mockFs.size
    }
    /**
     * Faithful to SDK 57's two documented destination types, because the
     * difference between them is the bug this suite exists to catch. Handed a
     * Directory, the file keeps its SOURCE name — the docs' own example moves
     * `example.txt` into a folder and it is still `example.txt` on the other
     * side. Handed a File, it lands at that File's uri, name and all.
     *
     * Async, matching `move(): Promise<void>` in 57.0.6; `moveSync` is the
     * synchronous variant.
     */
    async move(destination: FakeFile | FakeDirectory) {
      const landedAt =
        destination instanceof FakeDirectory
          ? `${destination.uri}/${this.uri.split('/').pop() ?? ''}`
          : destination.uri
      mockFs.move(this.uri, landedAt)
      mockFs.present.delete(this.uri)
      mockFs.present.add(landedAt)
      this.uri = landedAt
    }
    delete() {
      mockFs.remove(this.uri)
      mockFs.present.delete(this.uri)
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
  // The camera has just written its temporary file, and nothing is in the
  // media directory yet. That is the state every save starts from.
  mockFs.present.add(SOURCE_URI)
  mockFs.size = 4096
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
    expect(mockFs.createDirectory).toHaveBeenCalled()
    const createOrder = mockFs.createDirectory.mock.invocationCallOrder[0]
    const moveOrder = mockFs.move.mock.invocationCallOrder[0]
    expect(createOrder).toBeDefined()
    expect(moveOrder).toBeDefined()
    expect(createOrder as number).toBeLessThan(moveOrder as number)
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
    expect(mockFs.present.has(SOURCE_URI)).toBe(false)
  })

  it('reports the stored size', async () => {
    mockFs.size = 123456
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
