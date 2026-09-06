// Mock functions must be named with a leading "mock" (case-insensitive):
// babel-plugin-jest-hoist hoists `jest.mock()` calls above other module-scope
// declarations, and refuses to let the factory close over any other
// out-of-scope variable — see packages/data/src/db/__tests__/expo.test.ts for
// the same constraint on the sibling package's device adapter.
const mockRequestForegroundPermissionsAsync = jest.fn()
const mockGetLastKnownPositionAsync = jest.fn()
const mockRemove = jest.fn()
const mockWatchPositionAsync = jest.fn().mockResolvedValue({ remove: mockRemove })

jest.mock('expo-location', () => ({
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  Accuracy: { BestForNavigation: 6 },
  requestForegroundPermissionsAsync: mockRequestForegroundPermissionsAsync,
  getLastKnownPositionAsync: mockGetLastKnownPositionAsync,
  watchPositionAsync: mockWatchPositionAsync,
}))

// A static `import { createExpoLocationSource } from '../expo'` here would be
// transformed into a hoisted `require`, which Babel would then run above the
// `jest.mock('expo-location', ...)` call, resolving the real module before
// the mock is registered. A plain `require`, run as an ordinary statement,
// runs where it is written instead. Same fix as the data package's device
// adapter test, for the same reason.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createExpoLocationSource } = require('../expo') as typeof import('../expo')
import { gradeAccuracy } from '../../classify'

const basePosition = {
  coords: {
    latitude: -37.82141,
    longitude: 145.03318,
    accuracy: 4,
    altitude: 62,
    altitudeAccuracy: 2,
  },
  timestamp: 1_700_000_000_000,
}

describe('the expo-location adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockWatchPositionAsync.mockResolvedValue({ remove: mockRemove })
  })

  describe('requestPermission', () => {
    it.each([
      ['granted', 'granted'],
      ['denied', 'denied'],
      ['undetermined', 'undetermined'],
    ] as const)('maps expo-location status %s to %s', async (status, expected) => {
      mockRequestForegroundPermissionsAsync.mockResolvedValue({ status })
      const source = createExpoLocationSource()
      expect(await source.requestPermission()).toBe(expected)
    })
  })

  // The position itself, which nothing here read back until now. This adapter
  // is the one file in the package no test can exercise against real hardware,
  // and the whole suite survived both swapping latitude for longitude in the
  // mapping and setting `timestampMs` to 0 — the latter being the field the
  // ambient cache's entire behaviour (staleness, out-of-order rejection) is
  // built on, and which is only ever tested against the fake source.
  //
  // The fixture's values are deliberately unlike each other: -37.82141 and
  // 145.03318 differ in sign and in magnitude, so a transposition cannot pass
  // either assertion, and the timestamp is a specific epoch millisecond rather
  // than anything a default could coincide with.
  describe('the position and the moment it was taken', () => {
    it('carries latitude through, and not the longitude', async () => {
      mockGetLastKnownPositionAsync.mockResolvedValue(basePosition)
      const reading = await createExpoLocationSource().getLastKnown()
      expect(reading?.latitude).toBe(-37.82141)
    })

    it('carries longitude through, and not the latitude', async () => {
      mockGetLastKnownPositionAsync.mockResolvedValue(basePosition)
      const reading = await createExpoLocationSource().getLastKnown()
      expect(reading?.longitude).toBe(145.03318)
    })

    it("carries the platform's timestamp through, which is what the ambient cache orders by", async () => {
      mockGetLastKnownPositionAsync.mockResolvedValue(basePosition)
      const reading = await createExpoLocationSource().getLastKnown()
      expect(reading?.timestampMs).toBe(1_700_000_000_000)
    })

    it('carries the position and its timestamp through the watch callback too', async () => {
      // getLastKnown and watch share `toReading`, but they are separate call
      // sites and the watch path is the one a capture actually uses.
      let deliver: ((position: unknown) => void) | undefined
      mockWatchPositionAsync.mockImplementation(
        async (_options: unknown, callback: (p: unknown) => void) => {
          deliver = callback
          return { remove: mockRemove }
        },
      )
      const seen: { latitude: number; longitude: number; timestampMs: number }[] = []
      await createExpoLocationSource().watch((r) =>
        seen.push({ latitude: r.latitude, longitude: r.longitude, timestampMs: r.timestampMs }),
      )
      deliver?.(basePosition)
      expect(seen).toEqual([
        { latitude: -37.82141, longitude: 145.03318, timestampMs: 1_700_000_000_000 },
      ])
    })
  })

  describe('accuracyM', () => {
    it('carries the accuracy Android supplied', async () => {
      mockGetLastKnownPositionAsync.mockResolvedValue(basePosition)
      const reading = await createExpoLocationSource().getLastKnown()
      expect(reading?.accuracyM).toBe(4)
    })

    // Resolution 2: the Infinity fallback is deliberately unusable for
    // averaging (see average.ts's weightOf), not a stand-in for a real
    // number. What it must still do is grade sanely rather than crash.
    it('falls back to Infinity when the platform reports no accuracy, and that grades as poor rather than crashing', async () => {
      mockGetLastKnownPositionAsync.mockResolvedValue({
        ...basePosition,
        coords: { ...basePosition.coords, accuracy: null },
      })
      const reading = await createExpoLocationSource().getLastKnown()
      expect(reading?.accuracyM).toBe(Number.POSITIVE_INFINITY)
      expect(gradeAccuracy(reading?.accuracyM ?? NaN)).toBe('poor')
    })
  })

  // Resolution 3: `isMocked` must preserve the platform's three-way answer —
  // true, false, or "did not say" — rather than defaulting an unreported
  // value to false.
  describe('isMocked', () => {
    it('is true when the platform flags the fix as mocked', async () => {
      mockGetLastKnownPositionAsync.mockResolvedValue({ ...basePosition, mocked: true })
      const reading = await createExpoLocationSource().getLastKnown()
      expect(reading?.isMocked).toBe(true)
    })

    it('is false when the platform explicitly says the fix is not mocked', async () => {
      mockGetLastKnownPositionAsync.mockResolvedValue({ ...basePosition, mocked: false })
      const reading = await createExpoLocationSource().getLastKnown()
      expect(reading?.isMocked).toBe(false)
    })

    it('is left undefined when the platform did not report mocked status at all', async () => {
      mockGetLastKnownPositionAsync.mockResolvedValue({ ...basePosition })
      const reading = await createExpoLocationSource().getLastKnown()
      expect(reading?.isMocked).toBeUndefined()
    })
  })

  describe('getLastKnown', () => {
    it('returns null when there is no last-known fix', async () => {
      mockGetLastKnownPositionAsync.mockResolvedValue(null)
      expect(await createExpoLocationSource().getLastKnown()).toBeNull()
    })

    it('carries altitude and vertical accuracy through', async () => {
      mockGetLastKnownPositionAsync.mockResolvedValue(basePosition)
      const reading = await createExpoLocationSource().getLastKnown()
      expect(reading?.altitudeM).toBe(62)
      expect(reading?.verticalAccuracyM).toBe(2)
    })
  })

  describe('watch', () => {
    it('requests BestForNavigation accuracy at a one-second interval', async () => {
      await createExpoLocationSource().watch(() => undefined)
      expect(mockWatchPositionAsync).toHaveBeenCalledWith(
        { accuracy: 6, timeInterval: 1000, distanceInterval: 0 },
        expect.any(Function),
      )
    })

    it('delivers converted readings to the callback', async () => {
      let deliver: ((position: unknown) => void) | undefined
      mockWatchPositionAsync.mockImplementation(async (_options: unknown, callback: (p: unknown) => void) => {
        deliver = callback
        return { remove: mockRemove }
      })
      const seen: number[] = []
      await createExpoLocationSource().watch((r) => seen.push(r.accuracyM))
      deliver?.(basePosition)
      expect(seen).toEqual([4])
    })

    it('unsubscribing removes the underlying subscription', async () => {
      const stop = await createExpoLocationSource().watch(() => undefined)
      stop()
      expect(mockRemove).toHaveBeenCalled()
    })
  })
})
