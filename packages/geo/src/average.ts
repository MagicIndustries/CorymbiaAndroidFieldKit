import { isUsableAccuracy } from './accuracy'
import { distanceMetres } from './distance'
import { mockedVerdict, type MockedVerdict } from './mocked'
import type { Reading } from './classify'

/**
 * A reading paired with the weight it carries in the average.
 *
 * The weight is inverse variance: `1 / accuracyM²`. A reading Android calls
 * good to 2 m carries 25 times the weight of one it calls good to 10 m, which
 * is the whole reason the countdown after a capture is worth waiting through —
 * the fix settles toward the readings the receiver was most confident about,
 * instead of being dragged around by the poor ones it took while acquiring
 * satellites.
 */
type WeightedReading = { reading: Reading; weight: number }

/**
 * The weight a reading carries, or `null` when it carries none.
 *
 * A reading only earns a weight if its `accuracyM` is a finite positive number
 * *and* `1 / accuracyM²` is finite and positive too. That rejects three kinds
 * of nonsense, none of which a healthy Android location provider emits but all
 * of which a mock provider can — and `isMocked` exists on `Reading`
 * (spec §7.5) precisely because mock providers reach this code:
 *
 * - **Zero or negative accuracy.** A zero would mean "this reading is perfect",
 *   giving it infinite weight: one mock reading would seize the whole position
 *   and drive the reported accuracy to 0 m. That is exactly the optimistic
 *   number this function exists to stop being written to the record. A negative
 *   figure is meaningless as a radius. Neither is a claim of quality, so
 *   neither buys any weight.
 * - **NaN or Infinity accuracy.** A provider that reports no usable figure has
 *   told us nothing about the reading's quality, so the reading cannot vote on
 *   where the fix lies. Arithmetic on it would silently turn the whole result
 *   into NaN.
 * - **Accuracies so extreme that the weight itself overflows or underflows.**
 *   The weight is checked as well as the accuracy, so a value like 1e-200
 *   (whose square underflows to zero, giving an infinite weight) is caught too.
 *
 * A reading with no weight is not deleted from the result. It still counts in
 * `sampleCount`, and it still widens `spreadM` if it sits far from the fix —
 * the spread is the independent honesty check on the whole procedure and must
 * keep showing a wild reading even when the weighting has learned to ignore it.
 * It is also excluded from `best`, so a mock reading claiming 0 m cannot drag
 * the floor down with it.
 */
function weightOf(reading: Reading): number | null {
  const { accuracyM } = reading
  // The accuracy is checked (via the shared `isUsableAccuracy`, also used by
  // the ambient cache) before it is squared: squaring throws the sign away,
  // so -1 m would otherwise sail through as a perfectly respectable weight
  // of 1.
  if (!isUsableAccuracy(accuracyM)) return null
  const weight = 1 / (accuracyM * accuracyM)
  return Number.isFinite(weight) && weight > 0 ? weight : null
}

/**
 * Averages the readings taken while the post-capture countdown ran.
 *
 * Readings are combined by **inverse-variance weighting**: each contributes in
 * proportion to `w = 1 / accuracyM²`, so the position is
 * `Σ(w·lat) / Σw` (and the same for longitude) and the accuracy the readings
 * jointly support is `1 / √(Σw)`. When every reading shares one accuracy σ,
 * `Σw = n/σ²` and that collapses to exactly `σ/√n` — the plain square-root
 * improvement, of which this is a strict generalisation.
 *
 * The combined accuracy is floored at a third of the best single reading.
 * Averaging removes random error; beyond that point the limiting factor is
 * systematic (multipath, satellite geometry, atmosphere), which averaging
 * cannot remove, and claiming otherwise would put a number on the record that
 * the hardware never earned.
 *
 * Two further things are reported that the record keeps as provenance
 * (spec §7.4): the **spread**, being the greatest distance between any reading
 * and the weighted mean — deliberately *not* weighted, so a bad reading far
 * from the centre still widens it and stays visible; and the **sample count**.
 *
 * Altitude stays a plain unweighted mean of the readings that have one. The
 * weights here are built from *horizontal* accuracy, which says nothing about
 * vertical uncertainty; weighting altitude by them would be borrowing the wrong
 * number.
 *
 * The **vertical accuracy** reported alongside it is the *largest* figure any
 * contributing reading gave, and it is null unless at least one reading that
 * supplied an altitude also supplied one. Three decisions are packed into that:
 *
 * - **Not weighted, by anything.** The inverse-variance weights are built from
 *   horizontal accuracy. Vertical and horizontal GNSS error are neither the
 *   same quantity nor reliably proportional (vertical is typically one and a
 *   half to three times horizontal, and depends on satellite geometry
 *   differently), so weighting a vertical uncertainty by `1 / horizontal²`
 *   would be dressing up the wrong number.
 * - **The worst, not the mean, and no `√n` improvement.** The horizontal figure
 *   may claim improvement from averaging because independent random error does
 *   average away. Vertical error across readings a second apart is not
 *   independent: it is dominated by the same satellite geometry and the same
 *   multipath for the whole hold, so the argument that justifies the horizontal
 *   improvement does not transfer, and no floor is needed here because nothing
 *   is claimed. Taking the mean would also silently assume the readings that
 *   never reported a vertical accuracy were as good as the ones that did. The
 *   largest reported figure is the only number every contributing reading's own
 *   data supports.
 * - **Paired with the altitude it describes.** Only readings that supplied an
 *   altitude are considered, because that is what the number is the uncertainty
 *   *of*; a vertical accuracy taken from a reading that contributed no height
 *   would be provenance borrowed from somewhere else. A figure that is not a
 *   finite positive number of metres is not a report at all and is ignored, the
 *   same rule `isUsableAccuracy` applies horizontally — and migration 003's
 *   `record_vertical_accuracy_positive` would refuse it anyway.
 *
 * The **mocked verdict** is derived from the contributing readings, not taken
 * from whatever the live position happened to say when the save button was
 * pressed — see `mockedVerdict`. It is a `MockedVerdict` rather than a
 * `boolean | undefined` so that a caller cannot `?? false` an unreported flag
 * into a claim that the fix was clean.
 *
 * `accuracyM` is stored permanently on the record and later becomes the
 * Victorian Biodiversity Atlas's mandatory "Positional accuracy (metres)"
 * field, which DEECA uses to filter which records reach public extracts. See
 * `docs/gps-accuracy.md` for the full derivation, the worked example, and why
 * an optimistic figure there misrepresents survey data to a government dataset.
 */
export function averageReadings(readings: Reading[]): {
  latitude: number
  longitude: number
  accuracyM: number
  altitudeM: number | null
  verticalAccuracyM: number | null
  isMocked: MockedVerdict
  spreadM: number
  sampleCount: number
} {
  if (readings.length === 0) {
    throw new Error('Cannot average an empty set of readings.')
  }

  const sampleCount = readings.length

  const weighted = readings.reduce<WeightedReading[]>((acc, reading) => {
    const weight = weightOf(reading)
    return weight === null ? acc : [...acc, { reading, weight }]
  }, [])

  // Every reading carried an unusable accuracy, so there is no defensible
  // number to put on the record — not a position (nothing here says which
  // reading to believe) and least of all an accuracy. Refusing is the same
  // answer the empty list gets, for the same reason: inventing provenance is
  // worse than failing loudly. Callers holding readings from a mock or broken
  // provider must handle this rather than record the sample.
  if (weighted.length === 0) {
    throw new Error('Cannot average readings that carry no usable accuracy.')
  }

  const weightSum = weighted.reduce((sum, w) => sum + w.weight, 0)
  const latitude =
    weighted.reduce((sum, w) => sum + w.weight * w.reading.latitude, 0) / weightSum
  const longitude =
    weighted.reduce((sum, w) => sum + w.weight * w.reading.longitude, 0) / weightSum

  const withAltitude = readings.filter(
    (r): r is Reading & { altitudeM: number } => r.altitudeM !== null,
  )
  const altitudeM =
    withAltitude.length === 0
      ? null
      : withAltitude.reduce((sum, r) => sum + r.altitudeM, 0) / withAltitude.length

  // The vertical accuracies of the readings that actually contributed a height,
  // ignoring anything that is not a finite positive number of metres — see the
  // doc comment above for why the worst of them is what gets reported.
  const verticalAccuracies = withAltitude
    .map((r) => r.verticalAccuracyM)
    .filter((v): v is number => v !== null && v !== undefined && isUsableAccuracy(v))
  const verticalAccuracyM =
    verticalAccuracies.length === 0 ? null : Math.max(...verticalAccuracies)

  const centre = { latitude, longitude }
  const spreadM = readings.reduce((max, r) => Math.max(max, distanceMetres(centre, r)), 0)

  const best = weighted.reduce(
    (min, w) => Math.min(min, w.reading.accuracyM),
    Number.POSITIVE_INFINITY,
  )
  const combined = 1 / Math.sqrt(weightSum)
  const accuracyM = Math.max(combined, best / 3)

  return {
    latitude,
    longitude,
    accuracyM,
    altitudeM,
    verticalAccuracyM,
    // Every reading that went into the hold, weighted or not — a mock reading
    // that earned no weight still went into it.
    isMocked: mockedVerdict(readings),
    spreadM,
    sampleCount,
  }
}
