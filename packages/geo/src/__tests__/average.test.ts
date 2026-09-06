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

  it('averages only the readings that have an altitude, so missing ones do not drag it toward zero', () => {
    // If the null-altitude reading were coerced to 0 and included, the mean would be
    // (60 + 0 + 64) / 3 = 41.33..., not 62. The correct answer ignores it entirely.
    const result = averageReadings([
      reading({ altitudeM: 60 }),
      reading({ altitudeM: null }),
      reading({ altitudeM: 64 }),
    ])
    expect(result.altitudeM).toBe(62)
  })

  describe('vertical accuracy — measured by the platform, and no longer thrown away', () => {
    it('reports the largest vertical accuracy any contributing reading gave', () => {
      // Not the mean (2.5), and emphatically not any √n improvement on it.
      // Vertical error across readings a second apart is dominated by the same
      // satellite geometry and multipath for the whole hold, so it does not
      // average away the way independent horizontal error does — and the
      // readings that reported nothing cannot be assumed to have been as good
      // as the ones that did. The worst figure is the only one every
      // contributing reading's own data supports.
      const result = averageReadings([
        reading({ altitudeM: 60, verticalAccuracyM: 2 }),
        reading({ altitudeM: 64, verticalAccuracyM: 3 }),
      ])
      expect(result.verticalAccuracyM).toBe(3)
    })

    it('is not weighted by horizontal accuracy, which describes a different quantity', () => {
      // The 2 m reading is horizontally 25 times the weight of the 10 m one and
      // dominates the position completely. If the vertical figure were weighted
      // by those same weights it would sit near 8.2; it is 30, because the
      // vertical uncertainty of a reading is not a function of its horizontal
      // one (vertical error is typically 1.5–3× horizontal, and depends on
      // geometry differently).
      const result = averageReadings([
        reading({ accuracyM: 2, altitudeM: 60, verticalAccuracyM: 8 }),
        reading({ accuracyM: 10, altitudeM: 64, verticalAccuracyM: 30 }),
      ])
      expect(result.verticalAccuracyM).toBe(30)
    })

    it('is null when no contributing reading reported one', () => {
      expect(averageReadings([reading(), reading()]).verticalAccuracyM).toBeNull()
    })

    it('is null when there is no altitude for it to be the uncertainty of', () => {
      // A vertical accuracy on a reading that supplied no height is provenance
      // about nothing — the same pairing rule AltitudeEvidence enforces one
      // level up.
      const result = averageReadings([reading({ altitudeM: null, verticalAccuracyM: 3 })])
      expect(result.altitudeM).toBeNull()
      expect(result.verticalAccuracyM).toBeNull()
    })

    it('ignores a reading that has one but contributed no height', () => {
      const result = averageReadings([
        reading({ altitudeM: 62, verticalAccuracyM: 2 }),
        reading({ altitudeM: null, verticalAccuracyM: 90 }),
      ])
      expect(result.altitudeM).toBe(62)
      expect(result.verticalAccuracyM).toBe(2)
    })

    it('takes the reported figure even when only some readings reported one', () => {
      const result = averageReadings([
        reading({ altitudeM: 60, verticalAccuracyM: 4 }),
        reading({ altitudeM: 64 }),
      ])
      expect(result.verticalAccuracyM).toBe(4)
    })

    it.each([0, -3, Number.NaN, Number.POSITIVE_INFINITY])(
      'ignores a vertical accuracy of %s, which is not a report of anything',
      (bogus) => {
        // The same rule isUsableAccuracy applies horizontally, and what
        // migration 003's record_vertical_accuracy_positive would refuse.
        const result = averageReadings([
          reading({ altitudeM: 60, verticalAccuracyM: 2 }),
          reading({ altitudeM: 64, verticalAccuracyM: bogus }),
        ])
        expect(result.verticalAccuracyM).toBe(2)
      },
    )

    it('reports null rather than a bogus figure when that is all there was', () => {
      expect(
        averageReadings([reading({ altitudeM: 62, verticalAccuracyM: 0 })]).verticalAccuracyM,
      ).toBeNull()
    })
  })

  describe('the mocked verdict comes from the readings that were averaged', () => {
    // The full precedence table lives in mocked.test.ts; these pin that
    // averageReadings actually consults the contributing readings rather than
    // leaving the caller to stamp on whatever the live position last said.
    it.each([
      ['every reading mocked', true, 'mocked'],
      ['every reading explicitly clean', false, 'notMocked'],
      ['no reading saying', undefined, 'notReported'],
    ] as const)('reports %s as %s', (_what, isMocked, expected) => {
      expect(averageReadings([reading({ isMocked }), reading({ isMocked })]).isMocked).toBe(expected)
    })

    it('is mocked when one reading in the hold was, however little weight it carried', () => {
      // The zero-accuracy mock reading earns no weight at all (see above), but
      // it was in the hold and it said it was a mock.
      const result = averageReadings([
        reading({ isMocked: false }),
        reading({ accuracyM: 0, isMocked: true }),
      ])
      expect(result.isMocked).toBe('mocked')
    })

    it('is notReported when one reading in the hold never said', () => {
      expect(averageReadings([reading({ isMocked: false }), reading()]).isMocked).toBe('notReported')
    })
  })

  it('throws on an empty list rather than inventing a position', () => {
    expect(() => averageReadings([])).toThrow('Cannot average an empty set of readings.')
  })

  it('combines a converging hold by inverse variance, not by its best reading alone', () => {
    // A realistic hold: the fix converges 40 → 20 → 10 → 6 → 5 → 4 m as
    // satellites are acquired. Each reading weighs 1 / accuracyM²:
    //
    //   1/40² = 1/1600 = 0.000625
    //   1/20² = 1/400  = 0.0025
    //   1/10² = 1/100  = 0.01
    //   1/6²  = 1/36   = 0.02777777…
    //   1/5²  = 1/25   = 0.04
    //   1/4²  = 1/16   = 0.0625
    //   Σw            = 0.14340277…
    //
    // Combined accuracy = 1 / √0.14340277… = 1 / 0.3786857… = 2.640713…
    // The floor is best/3 = 4/3 = 1.333…, which is lower, so the combined
    // figure governs and the reported accuracy is ≈ 2.6407 m.
    const hold = [40, 20, 10, 6, 5, 4].map((accuracyM) => reading({ accuracyM }))
    const result = averageReadings(hold)
    expect(result.accuracyM).toBeCloseTo(2.640713, 5)
    expect(result.sampleCount).toBe(6)
  })

  it('reports a more conservative accuracy than the best reading scaled by √n', () => {
    // The old formula derived accuracy from the single best reading and ignored
    // the quality of every other one: 4 / √6 = 1.63299… m for the hold above,
    // a figure the six readings never jointly supported. Inverse-variance
    // weighting reports 2.6407 m, which is worse — and worse is the point,
    // because this number is stored as provenance and published.
    const hold = [40, 20, 10, 6, 5, 4].map((accuracyM) => reading({ accuracyM }))
    const bestScaledByRootN = 4 / Math.sqrt(6)
    expect(averageReadings(hold).accuracyM).toBeGreaterThan(bestScaledByRootN)

    // Same story for a shorter, dirtier hold: 3 m alongside two 30 m readings.
    // Σw = 1/9 + 2/900 = 0.111111… + 0.002222… = 0.113333…, so the combined
    // figure is 1 / √0.113333… = 2.97045… m, against the old 3 / √3 = 1.73205 m.
    const dirty = [3, 30, 30].map((accuracyM) => reading({ accuracyM }))
    expect(averageReadings(dirty).accuracyM).toBeCloseTo(2.970443, 5)
    expect(averageReadings(dirty).accuracyM).toBeGreaterThan(3 / Math.sqrt(3))
  })

  it('lets the good readings pull the position, which is the point of holding', () => {
    // Three tight readings good to 2 m (w = 0.25 each) and one poor reading
    // good to 50 m (w = 0.0004) sitting 0.001° — about 111 m — to the south.
    //
    //   Σw = 3(0.25) + 0.0004 = 0.7504
    //   The three good ones average to exactly -37.82141, so the weighted mean
    //   is -37.82141 + (0.0004 × -0.001) / 0.7504 = -37.82141 - 0.000000533
    //                = -37.8214105330…
    //   The plain arithmetic mean would be
    //   -37.82141 + (-0.001 / 4) = -37.821660 — some 27 m further south, off
    //   the good cluster entirely.
    const result = averageReadings([
      reading({ latitude: -37.8214, accuracyM: 2 }),
      reading({ latitude: -37.82142, accuracyM: 2 }),
      reading({ latitude: -37.82141, accuracyM: 2 }),
      reading({ latitude: -37.82241, accuracyM: 50 }),
    ])
    expect(result.latitude).toBeCloseTo(-37.82141053, 8)
    // And demonstrably not the unweighted mean: if the weighting were dropped,
    // this assertion is what fails.
    expect(result.latitude).not.toBeCloseTo(-37.82166, 5)

    // Σw = 0.7504 → 1 / √0.7504 = 1.154392…, above the floor of 2/3.
    expect(result.accuracyM).toBeCloseTo(1.154393, 5)

    // The spread is measured from the weighted mean and is NOT weighted: the
    // poor reading is still ~111.1358 m away and still says so.
    expect(result.spreadM).toBeCloseTo(111.1358, 3)
  })

  it('still floors the accuracy at a third of the best reading when weighting would go lower', () => {
    // Twenty readings good to 6 m: Σw = 20/36 = 0.5555…, so the combined figure
    // is 1 / √0.5555… = 1.34164… m. The floor is 6/3 = 2, which is larger, so
    // the floor governs. Averaging cannot remove multipath or bad satellite
    // geometry, and the record must not claim it did.
    const twenty = Array.from({ length: 20 }, () => reading({ accuracyM: 6 }))
    expect(averageReadings(twenty).accuracyM).toBeCloseTo(2, 6)
  })

  it('gives a reading claiming zero or negative accuracy no weight at all', () => {
    // A mock provider reporting accuracyM = 0 is claiming a perfect fix. Taken
    // literally its weight is infinite: it would seize the whole position and
    // drive the reported accuracy to 0 m. It gets no weight instead, so the
    // one real reading decides the position and the accuracy (Σw = 1/16 → 4 m,
    // above the 4/3 floor). It still counts in sampleCount and still widens the
    // spread, so it cannot hide.
    for (const bogus of [0, -1, -12.5]) {
      const result = averageReadings([
        reading({ latitude: -37.82141, accuracyM: 4 }),
        reading({ latitude: -37.82241, accuracyM: bogus, isMocked: true }),
      ])
      expect(result.latitude).toBeCloseTo(-37.82141, 8)
      expect(result.accuracyM).toBeCloseTo(4, 6)
      expect(Number.isFinite(result.accuracyM)).toBe(true)
      expect(result.sampleCount).toBe(2)
      expect(result.spreadM).toBeCloseTo(111.1949, 3)
    }
  })

  it('gives a reading with a non-finite accuracy no weight at all', () => {
    // NaN or Infinity from a misbehaving provider is not a claim of quality, so
    // it buys no weight — and crucially it does not poison the arithmetic into
    // returning NaN for the whole fix.
    for (const bogus of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const result = averageReadings([
        reading({ latitude: -37.82141, accuracyM: 4 }),
        reading({ latitude: -37.82241, accuracyM: bogus }),
      ])
      expect(result.latitude).toBeCloseTo(-37.82141, 8)
      expect(result.accuracyM).toBeCloseTo(4, 6)
      expect(Number.isNaN(result.accuracyM)).toBe(false)
      expect(result.sampleCount).toBe(2)
    }
  })

  it('does not let a bogus accuracy drag the floor down with it', () => {
    // best is taken over the readings that earned a weight, so the zero-metre
    // mock reading cannot make the floor 0/3 = 0. Sixteen readings good to 8 m
    // give Σw = 16/64 = 0.25 → 1 / √0.25 = 2, below the 8/3 ≈ 2.667 floor, so
    // the floor governs and the answer is 8/3 — unchanged by the mock reading.
    const withMock = [
      ...Array.from({ length: 16 }, () => reading({ accuracyM: 8 })),
      reading({ accuracyM: 0, isMocked: true }),
    ]
    expect(averageReadings(withMock).accuracyM).toBeCloseTo(8 / 3, 6)
  })

  it('refuses to invent a fix when no reading carries a usable accuracy', () => {
    // Nothing here says which reading to believe, so there is no defensible
    // position and certainly no defensible accuracy to store as provenance.
    // Failing loudly is the same answer the empty list gets.
    expect(() =>
      averageReadings([reading({ accuracyM: 0 }), reading({ accuracyM: Number.NaN })]),
    ).toThrow('Cannot average readings that carry no usable accuracy.')
  })
})
