import { renderHook } from '@testing-library/react-native'
import type { AmbientFix } from '@corymbia/geo'
import type { Attachment, Database, Device } from '@corymbia/data'

/**
 * Tests for `useAttachMedia` (Plan 4, Task 10): the pipeline behind
 * `attachPhoto` and `attachVoice` — mint the id, derive the filename, write
 * the bytes, insert the row, and roll the file back if the row is refused.
 *
 * WHAT IS AND IS NOT MOCKED, and why.
 *
 * Mocked: `@corymbia/data`'s `attachMedia` — the write this hook must order
 * correctly against the file, not a thing this file re-proves. `attachMedia`
 * itself is covered by `packages/data`'s own repository tests (transactions,
 * the `media_added` event, the CHECK constraints). `newMediaId` is left real:
 * it is a pure id generator with no I/O, and every test below reads the id
 * back out of the mocked calls rather than assuming what it produced, so
 * nothing here depends on its exact shape.
 *
 * Mocked: `../store`'s `mediaStore` and `../ambient`'s `readAmbient` /
 * `refreshAmbient` — the two singletons this hook reads from, each backed by
 * a native module (`expo-file-system`, `expo-location`) that has no
 * meaningful behaviour in a headless test environment.
 *
 * Mocked: `../../db/provider`'s `useDatabase` / `useDevice` — this hook's
 * only two context reads, stood up as fixed test doubles rather than a real
 * `DatabaseProvider` tree, the same way `useCapture.test.ts` hands its hook a
 * handle instead of a live SQLite connection.
 *
 * Not mocked: `useAttachMedia` itself, and the mapping from an `AmbientFix`
 * to a `Fix` of quality `'ambient'` — the logic actually under test.
 */

// ---------------------------------------------------------------------------
// Module mocks. Every factory reaches its fixtures through a `mock`-prefixed
// variable — Jest's module-factory hoisting only allows a `jest.mock` factory
// to close over out-of-scope identifiers whose name starts with "mock"
// (enforced by babel-plugin-jest-hoist) — and plain aliases matching the
// brief's own naming are declared after the imports below, never inside a
// factory.
// ---------------------------------------------------------------------------

const mockAttachMedia = jest.fn()

jest.mock('@corymbia/data', () => {
  const actual = jest.requireActual<typeof import('@corymbia/data')>('@corymbia/data')
  return {
    ...actual,
    attachMedia: (...args: unknown[]) => mockAttachMedia(...args),
  }
})

const mockSave = jest.fn()
const mockRemove = jest.fn()

jest.mock('../store', () => ({
  mediaStore: {
    save: (...args: unknown[]) => mockSave(...args),
    remove: (...args: unknown[]) => mockRemove(...args),
    exists: () => Promise.reject(new Error('not used by useAttachMedia')),
    uriFor: () => {
      throw new Error('not used by useAttachMedia')
    },
  },
}))

const mockReadAmbient = jest.fn()
const mockRefreshAmbient = jest.fn()

jest.mock('../ambient', () => ({
  readAmbient: (...args: unknown[]) => mockReadAmbient(...args),
  refreshAmbient: (...args: unknown[]) => mockRefreshAmbient(...args),
}))

const testDb: Database = {
  execute: () => Promise.reject(new Error('the test database is a handle, not a database')),
  all: () => Promise.reject(new Error('the test database is a handle, not a database')),
  first: () => Promise.reject(new Error('the test database is a handle, not a database')),
  transaction: () => Promise.reject(new Error('the test database is a handle, not a database')),
  close: () => Promise.resolve(),
}

const testDevice: Device = {
  id: 'device-under-test',
  installId: 'install-1',
  label: 'test-handset',
  manufacturer: 'Test',
  brand: 'Test',
  modelName: 'Model',
  modelId: 'model-1',
  deviceType: 'tablet',
  osName: 'Android',
  osVersion: '15',
  isPhysical: true,
  appVersion: '1.0.0',
  appBuild: '1',
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
}

jest.mock('../../db/provider', () => ({
  useDatabase: () => testDb,
  useDevice: () => testDevice,
}))

// Imported after every mock above so it picks them up.
import { useAttachMedia } from '../useAttachMedia'

// Aliases matching the brief's own naming, declared after the import — never
// referenced from inside a `jest.mock` factory.
const save = mockSave
const remove = mockRemove
const attachMediaSpy = mockAttachMedia
const readAmbient = mockReadAmbient
const refreshAmbient = mockRefreshAmbient

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function fakeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 'med_fixture',
    recordId: 'rec_a',
    kind: 'photo',
    fileName: 'med_fixture.jpg',
    byteSize: 1234,
    durationMs: null,
    ordinal: 1,
    capturedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

function fakeAmbientFix(overrides: Partial<AmbientFix> = {}): AmbientFix {
  return {
    latitude: -37.8214,
    longitude: 144.9631,
    accuracyM: 12,
    altitudeM: null,
    verticalAccuracyM: null,
    isMocked: 'notMocked',
    ageSeconds: 30,
    ...overrides,
  }
}

/**
 * `mock.invocationCallOrder[0]` is `number | undefined` under this project's
 * `noUncheckedIndexedAccess`, and casts are forbidden — so ordering
 * assertions go through this rather than an `as number`. A mock that was
 * never called throws here instead of comparing `undefined < undefined`,
 * which is `false` either way round and would make an ordering test pass
 * for the wrong reason.
 */
function callOrder(mockFn: jest.Mock): number {
  const order: number | undefined = mockFn.mock.invocationCallOrder[0]
  if (order === undefined) {
    throw new Error('Expected this mock to have been called at least once, but it was not.')
  }
  return order
}

async function setUp() {
  const rendered = await renderHook(() => useAttachMedia())
  return rendered.result
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAttachMedia', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    save.mockResolvedValue({ uri: 'file:///media/med_x.jpg', byteSize: 1234 })
    remove.mockResolvedValue(undefined)
    attachMediaSpy.mockResolvedValue(fakeAttachment())
    readAmbient.mockReturnValue(fakeAmbientFix())
    refreshAmbient.mockResolvedValue(null)
  })

  it('writes the file before the row', async () => {
    const result = await setUp()
    await result.current.attachPhoto({ recordId: 'rec_a', sourceUri: 'file:///tmp/shot.jpg' })
    expect(callOrder(save)).toBeLessThan(callOrder(attachMediaSpy))
  })

  it('names the file after the media id it inserts', async () => {
    // The row and the bytes must agree. If these two ever diverge, the strip
    // renders a tile whose image is another record's photo.
    const result = await setUp()
    await result.current.attachPhoto({ recordId: 'rec_a', sourceUri: 'file:///tmp/shot.jpg' })
    const [fileName] = save.mock.calls[0] as [string, string]
    const inserted = attachMediaSpy.mock.calls[0]?.[1]
    expect(fileName).toBe(`${inserted.mediaId}.jpg`)
    expect(inserted.fileName).toBe(fileName)
  })

  it('mints a fresh id and filename for every attachment, not a reused one', async () => {
    // The relational check above would still pass if every attachment were
    // (wrongly) written under the same hardcoded id. Two calls with two
    // different filenames is what actually proves each mint is fresh.
    const result = await setUp()
    await result.current.attachPhoto({ recordId: 'rec_a', sourceUri: 'file:///tmp/shot-1.jpg' })
    await result.current.attachPhoto({ recordId: 'rec_a', sourceUri: 'file:///tmp/shot-2.jpg' })
    const [firstFileName] = save.mock.calls[0] as [string, string]
    const [secondFileName] = save.mock.calls[1] as [string, string]
    expect(firstFileName).not.toBe(secondFileName)
  })

  it('stores the byte size the store measured, not one it was told', async () => {
    save.mockResolvedValue({ uri: 'file:///media/med_a.jpg', byteSize: 91234 })
    const result = await setUp()
    await result.current.attachPhoto({ recordId: 'rec_a', sourceUri: 'file:///tmp/shot.jpg' })
    expect(attachMediaSpy.mock.calls[0]?.[1].byteSize).toBe(91234)
  })

  it('stores a different byte size for a different save, proving it is not hardcoded', async () => {
    save.mockResolvedValue({ uri: 'file:///media/med_b.jpg', byteSize: 7 })
    const result = await setUp()
    await result.current.attachPhoto({ recordId: 'rec_a', sourceUri: 'file:///tmp/shot.jpg' })
    expect(attachMediaSpy.mock.calls[0]?.[1].byteSize).toBe(7)
  })

  it('removes the file when the row is refused', async () => {
    attachMediaSpy.mockRejectedValue(new Error('constraint failed'))
    const result = await setUp()
    await expect(
      result.current.attachPhoto({ recordId: 'rec_a', sourceUri: 'file:///tmp/shot.jpg' }),
    ).rejects.toThrow()
    expect(remove).toHaveBeenCalledWith(expect.stringMatching(/\.jpg$/))
  })

  it('reports the row failure even when the rollback also fails', async () => {
    // The rollback failing is a leaked file. The insert failing is a photo
    // she thinks she took. She needs to hear about the second one.
    attachMediaSpy.mockRejectedValue(new Error('constraint failed'))
    remove.mockRejectedValue(new Error('read-only filesystem'))
    const result = await setUp()
    await expect(
      result.current.attachPhoto({ recordId: 'rec_a', sourceUri: 'file:///tmp/shot.jpg' }),
    ).rejects.toThrow(/constraint failed/)
  })

  it('does not remove the file when the row succeeded', async () => {
    const result = await setUp()
    await result.current.attachPhoto({ recordId: 'rec_a', sourceUri: 'file:///tmp/shot.jpg' })
    expect(remove).not.toHaveBeenCalled()
  })

  it('gives a voice note the m4a name and its duration', async () => {
    const result = await setUp()
    await result.current.attachVoice({
      recordId: 'rec_a',
      sourceUri: 'file:///tmp/n.m4a',
      durationMs: 8200,
    })
    expect(save.mock.calls[0]?.[0]).toMatch(/\.m4a$/)
    expect(attachMediaSpy.mock.calls[0]?.[1].durationMs).toBe(8200)
  })

  it('passes through whatever duration the recorder measured, not a fixed one', async () => {
    // Guards against an implementation that happens to satisfy the test
    // above with a hardcoded 8200 rather than genuinely forwarding
    // `durationMs`.
    const result = await setUp()
    await result.current.attachVoice({
      recordId: 'rec_a',
      sourceUri: 'file:///tmp/n.m4a',
      durationMs: 1500,
    })
    expect(attachMediaSpy.mock.calls[0]?.[1].durationMs).toBe(1500)
  })

  it('sends no duration at all for a photo', async () => {
    // The database refuses a photo carrying one (media_duration_matches_kind).
    // Sending 0 instead of null would fail at the constraint, mid-capture.
    const result = await setUp()
    await result.current.attachPhoto({ recordId: 'rec_a', sourceUri: 'file:///tmp/shot.jpg' })
    expect(attachMediaSpy.mock.calls[0]?.[1].durationMs).toBeNull()
  })

  it('stamps the event with an ambient fix and never waits for one', async () => {
    const result = await setUp()
    await result.current.attachPhoto({ recordId: 'rec_a', sourceUri: 'file:///tmp/shot.jpg' })
    expect(attachMediaSpy.mock.calls[0]?.[1].fix.quality).toBe('ambient')
    expect(refreshAmbient).not.toHaveBeenCalled()
  })

  it('carries the cached position, age and mocked verdict onto the fix', async () => {
    // A second, differently-valued fixture — the single-fixture ambient test
    // above would still pass if the mapping silently dropped every field but
    // `quality`.
    readAmbient.mockReturnValue(
      fakeAmbientFix({
        latitude: -38.1,
        longitude: 145.2,
        accuracyM: 55,
        altitudeM: 12,
        verticalAccuracyM: 4,
        isMocked: 'mocked',
        ageSeconds: 210,
      }),
    )
    const result = await setUp()
    await result.current.attachPhoto({ recordId: 'rec_a', sourceUri: 'file:///tmp/shot.jpg' })
    const fix = attachMediaSpy.mock.calls[0]?.[1].fix
    expect(fix).toEqual({
      quality: 'ambient',
      latitude: -38.1,
      longitude: 145.2,
      accuracyM: 55,
      datum: 'WGS84',
      ageSeconds: 210,
      verticalAccuracyM: 4,
      isMocked: true,
      provider: null,
      accuracyConvention: 'radius68',
      gpsTime: null,
      altitudeM: 12,
      altitudeReference: 'wgs84Ellipsoid',
    })
  })

  it('stamps no position when the cache has none, rather than inventing one', async () => {
    readAmbient.mockReturnValue(null)
    const result = await setUp()
    await result.current.attachPhoto({ recordId: 'rec_a', sourceUri: 'file:///tmp/shot.jpg' })
    expect(attachMediaSpy.mock.calls[0]?.[1].fix).toEqual({ quality: 'none' })
  })

  it('stamps no position when the cache never learned whether it was mocked', async () => {
    // `Fix`'s ambient arm requires a real boolean for `isMocked`. Defaulting
    // an unreported verdict to `false` would assert "not spoofed" about a
    // reading that never said so — the same mistake `mockedVerdict`'s own
    // doc comment warns against — so this downgrades to `'none'` rather than
    // inventing an answer, without refusing the attachment itself.
    readAmbient.mockReturnValue(fakeAmbientFix({ isMocked: 'notReported' }))
    const result = await setUp()
    await result.current.attachPhoto({ recordId: 'rec_a', sourceUri: 'file:///tmp/shot.jpg' })
    expect(attachMediaSpy.mock.calls[0]?.[1].fix).toEqual({ quality: 'none' })
  })
})
