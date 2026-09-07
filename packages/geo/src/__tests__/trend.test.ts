import { holdVerdict } from '../trend'
import type { Reading } from '../classify'

const at = (accuracyM: number, timestampMs: number): Reading => ({
  latitude: -37.82141,
  longitude: 145.03318,
  accuracyM,
  altitudeM: null,
  timestampMs,
})

/** A run of readings a second apart, from their accuracies in metres. */
const run = (accuracies: number[]): Reading[] =>
  accuracies.map((accuracyM, index) => at(accuracyM, index * 1000))

/**
 * The verdict at every prefix of a run — what the screen would have said as
 * each reading landed, which is the only way to see a false early fire or a
 * verdict being taken back. Index `i` is the verdict after `i + 1` readings.
 */
const verdicts = (accuracies: number[]): string[] => {
  const readings = run(accuracies)
  return readings.map((_reading, index) => holdVerdict(readings.slice(0, index + 1)))
}

/** The sample count at which a run first said `plateaued`, or null if it never did. */
const firstPlateau = (accuracies: number[]): number | null => {
  const index = verdicts(accuracies).indexOf('plateaued')
  return index === -1 ? null : index + 1
}

/**
 * The measured hardware run this rule was rewritten against: Samsung S25,
 * outdoors, 21 readings at 1 Hz, each number the receiver's own accuracy
 * estimate for that reading in metres.
 *
 * This is real data, not a construction, and it is the regression guard for
 * the specific defect being fixed. Under the old rule — which compared the
 * first and last RAW accuracy of a four-reading window with no minimum sample
 * count — it read: improving, **plateaued at n=2**, improving, improving,
 * improving, improving, improving, improving, improving, plateaued, improving,
 * plateaued, then plateaued for the rest. Two failures in that: a plateau
 * declared 0.6 s after the tap, at a moment when the averaged fix was ±5.2 m
 * and waiting would reach ±1.4 m; and flapping between the two verdicts across
 * n=2 to n=12 while the fix improved monotonically and fast.
 *
 * The averaged accuracy `averageReadings` reports over these prefixes runs
 * 7.5, 5.2, 4.1, 3.5, 3.1, 2.7, 2.5, 2.3, 2.1, 2.0, 1.8, 1.7, 1.7, 1.6, 1.6,
 * 1.5, 1.5, 1.5, 1.4, 1.4, 1.4 — smooth and monotonic where the raw column
 * jitters. That is the series the rule judges.
 */
const MEASURED_RUN = [
  7.5, 7.2, 6.8, 6.7, 6.3, 6.1, 5.8, 5.8, 5.6, 5.4, 5.2, 5.1, 5.0, 4.8, 4.7, 4.6, 4.4, 4.4,
  4.3, 4.2, 4.2,
]

/**
 * The late-session stretch from the same device, where the receiver genuinely
 * had stopped improving: raw accuracy pinned at 3.6–3.7 m for eight
 * consecutive seconds. The old rule called this `plateaued` and was right to;
 * the new one must still say so, or the fix has been bought at the cost of the
 * signal ever firing.
 */
const MEASURED_FLAT = [3.6, 3.7, 3.6, 3.7, 3.6, 3.7, 3.6, 3.7, 3.6, 3.7, 3.6, 3.7]

describe('holdVerdict on the measured hardware run', () => {
  it('never says plateaued in the first several samples, and never at n=2', () => {
    // The catastrophic case, asserted on its own because it is the one that
    // costs a field ecologist a four-times worse fix: with auto-finish on, a
    // plateau at n=2 ends the capture at ±5.2 m when waiting reaches ±1.4 m.
    expect(holdVerdict(run(MEASURED_RUN).slice(0, 2))).toBe('improving')

    // And the whole early stretch, which is the minimum-sample guard's job:
    // below MIN_SAMPLES the answer is 'improving' whatever the numbers say.
    expect(verdicts(MEASURED_RUN).slice(0, 9)).toEqual([
      'improving',
      'improving',
      'improving',
      'improving',
      'improving',
      'improving',
      'improving',
      'improving',
      'improving',
    ])
  })

  it('reaches plateaued before the run ends', () => {
    expect(firstPlateau(MEASURED_RUN)).not.toBeNull()
    expect(holdVerdict(run(MEASURED_RUN))).toBe('plateaued')
  })

  it('never reverts to improving once it has said plateaued', () => {
    // The old rule went plateaued, improving, plateaued, improving across
    // n=2..12 of this very run. Whatever the crossing point, the sequence must
    // be a block of 'improving' followed by a block of 'plateaued' and nothing
    // else — which is what this asserts without hard-coding where the boundary
    // falls (the test below does that separately).
    const sequence = verdicts(MEASURED_RUN)
    const crossing = sequence.indexOf('plateaued')
    expect(crossing).toBeGreaterThan(-1)
    expect(sequence.slice(crossing).every((v) => v === 'plateaued')).toBe(true)
  })

  it('crosses at n=12, which is where the stored records say the wait stops paying', () => {
    // This pins WINDOW and MEANINGFUL_IMPROVEMENT_M together against the
    // hardware. The averaged accuracy improves across a trailing window of
    // four by 0.775 m at n=10, 0.640 m at n=11, 0.549 m at n=12 and 0.444 m at
    // n=13, so the 0.6 m threshold flips the verdict at exactly n=12 — about
    // 11 s after the tap, and the stored records from this session (±1.2 m at
    // n=12, ±1.3 m at n=16, ±1.0–1.4 m at n=21, ±1.1 m at n=61) say nothing
    // further is bought after that.
    //
    // Neither neighbouring window agrees: with WINDOW=3 this run first
    // plateaus at n=10, and with WINDOW=5 at n=14. Neither neighbouring
    // threshold agrees either — anything at or below 0.549 m crosses later,
    // anything above 0.640 m crosses earlier.
    expect(firstPlateau(MEASURED_RUN)).toBe(12)
  })
})

describe('holdVerdict', () => {
  it('says plateaued on a genuinely flat run, as it did on the hardware', () => {
    expect(holdVerdict(run(MEASURED_FLAT))).toBe('plateaued')
  })

  it('says improving throughout a run that is still improving fast', () => {
    // Twelve readings, past MIN_SAMPLES, each one materially sharper than the
    // last. Nothing here has stopped improving and the rule must not say it
    // has, however long the hold has run.
    expect(verdicts([60, 40, 30, 20, 15, 12, 10, 8, 6, 5, 4, 3])).not.toContain('plateaued')
  })

  it('says plateaued when accuracy is getting worse', () => {
    // Worse readings carry less weight, so the averaged fix barely moves: the
    // window improvement is 0.075 m by n=9 and falls from there. Holding
    // through a run like this buys nothing and the screen must say so.
    expect(holdVerdict(run([4, 6, 9, 12, 16, 20, 25, 30, 36, 42, 50, 60]))).toBe('plateaued')
  })

  it('judges recent readings, so an early improvement does not claim a current one', () => {
    // A large improvement in the first three seconds and then ten seconds of
    // nothing. The verdict is about now, not about what happened at the start
    // of the hold.
    expect(holdVerdict(run([60, 30, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]))).toBe('plateaued')
  })

  it('cannot say plateaued before ten samples, however flat the run is', () => {
    // Nine identical readings — an unambiguous plateau by any reading of the
    // numbers — and the answer is still 'improving'. This is a deliberate
    // behaviour change: the old rule declared a plateau after four flat
    // readings, and four seconds is a quarter of the time the hardware
    // measurably needs. The generous default with too little evidence is to
    // let her wait.
    expect(holdVerdict(run([4.2, 4.2, 4.2, 4.2, 4.2, 4.2, 4.2, 4.2, 4.2]))).toBe('improving')

    // The tenth reading is what unlocks the verdict, and nothing about the
    // data changed between the two.
    expect(holdVerdict(run([4.2, 4.2, 4.2, 4.2, 4.2, 4.2, 4.2, 4.2, 4.2, 4.2]))).toBe('plateaued')
  })

  it('says improving on too little evidence, because the honest default is to let her wait', () => {
    expect(holdVerdict([at(9, 0)])).toBe('improving')
    expect(holdVerdict([])).toBe('improving')
  })

  it('says improving when no prefix carries a usable accuracy to judge', () => {
    // `averageReadings` refuses a set in which every reading's accuracy is
    // unusable — only a mock or broken provider produces one. A refusal is the
    // absence of a measurement, not evidence that the fix has stopped
    // improving, so it must not be reported as a plateau.
    expect(holdVerdict(run([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('improving')
  })
})
