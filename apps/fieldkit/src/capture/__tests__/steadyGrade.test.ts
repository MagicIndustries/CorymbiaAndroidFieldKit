import { GRADE_THRESHOLDS, gradeAccuracy } from '@corymbia/geo'
import type { FixGradeName } from '@corymbia/ui'
import { GRADE_HYSTERESIS_M, steadyGrade } from '../steadyGrade'

/**
 * Tests for the grade the capture screen actually shows (spec §9.2,
 * hysteresis).
 *
 * Nothing is mocked. `gradeAccuracy` is the real classifier — the whole point
 * of this module is that it does not change, and a test against a stubbed one
 * could not tell whether the displayed grade is still anchored to the real
 * thresholds.
 */

/**
 * The accuracies this receiver actually reported, in order, at the site the
 * owner was standing on: one run under open sky, the raw live reading with no
 * averaging applied.
 *
 * It bottoms out around 4.2 m. Convergence to ±1.4 m happens only through
 * `averageReadings` during a countdown, so this — a large circle that wobbles
 * and never narrows much — is the honest picture of a *ready* state, and the
 * point of these tests is not to make it look like it is converging.
 */
const MEASURED_SERIES = [
  7.5, 7.2, 6.8, 6.7, 6.3, 6.1, 5.8, 5.8, 5.6, 5.4, 5.2, 5.1, 5.0, 4.8, 4.7, 4.6, 4.4, 4.4, 4.3,
  4.2, 4.2,
]

/**
 * The same receiver, at the same place, once the trend has flattened: the
 * reading jitters roughly ±0.5 m either side of about 4.7 m, which straddles
 * `gradeAccuracy`'s 5 m good/fair boundary. **This is the sequence the owner
 * watched flip amber → green → amber → green on the device**, with no change
 * whatever in the quality of the fix.
 */
const JITTER_ACROSS_THE_BOUNDARY = [5.2, 4.8, 5.1, 4.7, 5.3, 4.9, 5.2, 4.4, 5.0, 4.2]

/** Worst to best, so "did this get worse" is an index comparison. */
const ORDER_INDEX: Record<FixGradeName, number> = { poor: 0, fair: 1, good: 2 }

/** Runs a series through the fold, returning what would be on screen at each step. */
function displayedThrough(series: number[]): FixGradeName[] {
  const shown: FixGradeName[] = []
  let previous: FixGradeName | null = null
  for (const accuracyM of series) {
    previous = steadyGrade(previous, accuracyM)
    shown.push(previous)
  }
  return shown
}

describe('steadyGrade', () => {
  it('reports the raw grade when there is nothing on screen to hold', () => {
    expect(steadyGrade(null, 4.8)).toBe('good')
    expect(steadyGrade(null, 5.0)).toBe('fair')
    expect(steadyGrade(null, 20)).toBe('poor')
  })

  /**
   * THE DEFECT, AS SEEN ON THE DEVICE.
   *
   * The raw classifier really does oscillate on this series — asserted first,
   * so this test cannot pass because the fixture stopped crossing the
   * boundary — and the displayed grade must not.
   */
  it('does not flicker while the raw reading crosses the boundary on jitter', () => {
    const raw = JITTER_ACROSS_THE_BOUNDARY.map(gradeAccuracy)
    // The fixture genuinely oscillates: more than one change of grade, which
    // is what "flicker" means and what a margin has to absorb.
    const rawChanges = raw.filter((grade, i) => i > 0 && grade !== raw[i - 1]).length
    expect(rawChanges).toBeGreaterThan(2)

    const shown = displayedThrough(JITTER_ACROSS_THE_BOUNDARY)
    const shownChanges = shown.filter((grade, i) => i > 0 && grade !== shown[i - 1]).length
    // Exactly one change: fair while it opens above the boundary, then good
    // from the first reading that genuinely crossed it, and good thereafter.
    expect(shownChanges).toBe(1)
    expect(shown[0]).toBe('fair')
    expect(shown[shown.length - 1]).toBe('good')
  })

  /**
   * THE HOLD, CHECKED READING BY READING ON A SERIES THAT ACTUALLY DEGRADES.
   *
   * This test used to run `MEASURED_SERIES` — which is monotonically
   * non-increasing — and assert only that each displayed grade was one the raw
   * classifier had already returned. On a series that never worsens, the
   * hysteresis branch is never reached at all, and set membership is satisfied
   * by anything: `return raw`, `return previous`, and stepping down one band
   * at a time all passed it.
   *
   * So the fixture degrades, in both bands, and the expectation is written out
   * per index. Each entry is what the hold actually owes:
   *
   * (`GRADE_THRESHOLDS` is good < 5 m, fair < 15 m, and the margin is 1 m, so
   * the two exits are 6 m and 16 m.)
   *
   *   4.2  good, raw, nothing on screen to hold
   *   5.4  raw fair — held, 0.4 m past the boundary is jitter
   *   5.9  held
   *   6.0  held: exactly at the margin is still inside it
   *   6.1  given up — a metre clear of the boundary is a different fix
   *   9.0  fair, raw, unchanged
   *  15.5  raw poor — held, inside fair's own margin
   *  16.0  held, exactly at it
   *  16.5  given up
   *  40    poor, unchanged
   *   4.0  good AT ONCE: improving is never delayed
   *  40    poor at once, two bands down — not the `fair` a step-down-one-band
   *        rule would invent, and the reason the series ends on this pair
   */
  const DEGRADES_THROUGH_BOTH_BANDS = [4.2, 5.4, 5.9, 6.0, 6.1, 9.0, 15.5, 16.0, 16.5, 40, 4.0, 40]
  const EXPECTED_ON_SCREEN: FixGradeName[] = [
    'good',
    'good',
    'good',
    'good',
    'fair',
    'fair',
    'fair',
    'fair',
    'poor',
    'poor',
    'good',
    'poor',
  ]

  it('holds and gives up each grade exactly where the margin says, reading by reading', () => {
    // The fixture genuinely degrades — asserted first, so this test cannot
    // pass by the series quietly becoming monotonic and never reaching the
    // hysteresis branch at all, which is how its predecessor was vacuous.
    const raw = DEGRADES_THROUGH_BOTH_BANDS.map(gradeAccuracy)
    const worsenings = raw.filter((grade, i) => {
      const before = raw[i - 1]
      return i > 0 && before !== undefined && ORDER_INDEX[grade] < ORDER_INDEX[before]
    }).length
    expect(worsenings).toBeGreaterThan(2)

    expect(displayedThrough(DEGRADES_THROUGH_BOTH_BANDS)).toEqual(EXPECTED_ON_SCREEN)
  })

  it('is the hold that makes that series differ from the raw one, not the classifier', () => {
    // Belt and braces on the test above: if `displayedThrough` ever equalled
    // the raw grades, the per-index expectation would be asserting
    // `gradeAccuracy` rather than anything this module does.
    expect(displayedThrough(DEGRADES_THROUGH_BOTH_BANDS)).not.toEqual(
      DEGRADES_THROUGH_BOTH_BANDS.map(gradeAccuracy),
    )
  })

  it('never shows a grade the accuracy has not actually justified', () => {
    // Hysteresis may only DELAY a change. Entering a grade still requires
    // crossing its threshold, so everything ever displayed must be a grade
    // the raw classifier had already returned by that point in the series.
    const series = [
      ...MEASURED_SERIES,
      ...JITTER_ACROSS_THE_BOUNDARY,
      ...DEGRADES_THROUGH_BOTH_BANDS,
    ]
    const shown = displayedThrough(series)
    const seen = new Set<FixGradeName>()
    series.forEach((accuracyM, i) => {
      seen.add(gradeAccuracy(accuracyM))
      expect(seen.has(shown[i] as FixGradeName)).toBe(true)
    })
  })

  it('takes a better grade the instant the reading earns it', () => {
    // Improving is never delayed: a reading that has crossed into a better
    // grade has earned it, and showing it at once cannot oscillate because
    // the fall back out is what is damped.
    expect(steadyGrade('fair', GRADE_THRESHOLDS.good - 0.1)).toBe('good')
    expect(steadyGrade('poor', GRADE_THRESHOLDS.fair - 0.1)).toBe('fair')
    expect(steadyGrade('poor', GRADE_THRESHOLDS.good - 0.1)).toBe('good')
  })

  it('holds a grade against jitter just the wrong side of its boundary', () => {
    expect(steadyGrade('good', GRADE_THRESHOLDS.good + 0.5)).toBe('good')
    expect(steadyGrade('fair', GRADE_THRESHOLDS.fair + 0.5)).toBe('fair')
  })

  it('gives the grade up once the accuracy is clear of the margin', () => {
    // A fix that has genuinely degraded still reports it — the margin is
    // twice the measured jitter, not a licence to keep claiming a grade.
    expect(steadyGrade('good', GRADE_THRESHOLDS.good + GRADE_HYSTERESIS_M + 0.1)).toBe('fair')
    expect(steadyGrade('fair', GRADE_THRESHOLDS.fair + GRADE_HYSTERESIS_M + 0.1)).toBe('poor')
    // Exactly at the margin is still held: the exit is a move past it, and
    // the boundary itself is `gradeAccuracy`'s to define.
    expect(steadyGrade('good', GRADE_THRESHOLDS.good + GRADE_HYSTERESIS_M)).toBe('good')
  })

  it('is worth having at all: the margin exceeds the jitter it has to absorb', () => {
    // The reading at this site moves about ±0.5 m around its trend, so a
    // margin at or under half a metre would let the same flicker straight
    // back through. Pinned so the constant cannot be quietly softened.
    expect(GRADE_HYSTERESIS_M).toBeGreaterThan(0.5)
  })

  it('falls two bands at once rather than stepping down through the middle one', () => {
    // A fix that collapsed from good to genuinely poor reports poor, not a
    // fair it never had.
    expect(steadyGrade('good', 40)).toBe('poor')
  })

  it('takes the worst grade immediately when there is no fix at all', () => {
    // Absence is not jitter. There is no reading to be wobbling, and the
    // readout beside it prints — rather than a number.
    expect(steadyGrade('good', null)).toBe('poor')
  })

  it('is a fold, so it is safe to run during render', () => {
    // `useSteadyGrade` updates its ref during render, which is only sound
    // because applying this twice to the same accuracy is the same as
    // applying it once — a double-invoked render cannot change the answer.
    for (const accuracyM of [...MEASURED_SERIES, 40, 5.5]) {
      for (const previous of ['good', 'fair', 'poor', null] as const) {
        const once = steadyGrade(previous, accuracyM)
        expect(steadyGrade(once, accuracyM)).toBe(once)
      }
    }
  })
})
