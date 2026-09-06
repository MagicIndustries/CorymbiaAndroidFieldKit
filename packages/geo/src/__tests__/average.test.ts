import { averageReadings } from '../average'
import type { Reading } from '../classify'

const reading = (over: Partial<Reading> = {}): Reading => ({
  latitude: -37.82141,
  longitude: 145.03318,
  accuracyM: 4,
  altitudeM: 62,
  timestampMs: 1_000,
  ...over,
})

describe('averageReadings', () => {
  it('returns a single reading essentially unchanged', () => {
    const result = averageReadings([reading()])
    expect(result.latitude).toBeCloseTo(-37.82141, 6)
    expect(result.sampleCount).toBe(1)
    expect(result.spreadM).toBe(0)
  })

  it('averages the position of several readings', () => {
    const result = averageReadings([
      reading({ latitude: -37.8214 }),
      reading({ latitude: -37.8216 }),
    ])
    expect(result.latitude).toBeCloseTo(-37.8215, 6)
  })

  it('reports the spread, which is the honest measure of how much they disagreed', () => {
    const tight = averageReadings([reading(), reading()])
    // The two readings are -37.82141 and -37.8224 (longitude fixed at 145.03318).
    // Their mean latitude is -37.821905, the arithmetic midpoint. Because only
    // latitude differs, the mean is equidistant (by symmetry) from each reading,
    // so the spread is half the haversine distance between the two readings
    // themselves. That pairwise distance, via the same great-circle formula
    // distance.ts uses (haversine, Earth radius 6,371,008.8 m), is ~110.083 m,
    // so the spread — the farthest reading from the mean — is ~55.042 m.
    const loose = averageReadings([reading(), reading({ latitude: -37.8224 })])
    expect(tight.spreadM).toBe(0)
    expect(loose.spreadM).toBeCloseTo(55.0416, 3)
  })

  it('applies square-root scaling while that is above the floor', () => {
    // best = 8. At n = 4: scaling gives 8 / sqrt(4) = 8 / 2 = 4. The floor is
    // 8 / 3 ≈ 2.667. Scaling's result (4) is larger, so scaling governs and
    // the reported accuracy is exactly 4 — strictly better than the single
    // reading's 8, showing accuracy does improve as samples accumulate.
    const one = averageReadings([reading({ accuracyM: 8 })])
    const four = averageReadings(Array.from({ length: 4 }, () => reading({ accuracyM: 8 })))
    expect(four.accuracyM).toBeCloseTo(4, 6)
    expect(four.accuracyM).toBeLessThan(one.accuracyM)
  })

  it('floors the reported accuracy at a third of the best reading once scaling would go lower', () => {
    // best = 8. At n = 16: scaling gives 8 / sqrt(16) = 8 / 4 = 2. The floor is
    // 8 / 3 ≈ 2.667, which is larger, so the floor governs and the reported
    // accuracy is exactly 8 / 3, never falling below a third of the best
    // single reading no matter how many samples are averaged.
    const sixteen = averageReadings(Array.from({ length: 16 }, () => reading({ accuracyM: 8 })))
    expect(sixteen.accuracyM).toBeCloseTo(8 / 3, 6)
  })

  it('counts the samples, which is the provenance stored on the record', () => {
    expect(averageReadings([reading(), reading(), reading()]).sampleCount).toBe(3)
  })

  it('averages altitude when present and reports null when no reading had one', () => {
    expect(averageReadings([reading({ altitudeM: 60 }), reading({ altitudeM: 64 })]).altitudeM).toBe(62)
    expect(averageReadings([reading({ altitudeM: null })]).altitudeM).toBeNull()
  })

  it('throws on an empty list rather than inventing a position', () => {
    expect(() => averageReadings([])).toThrow('Cannot average an empty set of readings.')
  })
})
