import { useRef } from 'react'
import { GRADE_THRESHOLDS, gradeAccuracy } from '@corymbia/geo'
import type { FixGradeName } from '@corymbia/ui'

/**
 * The grade the *screen* shows, which is not always the grade this instant's
 * accuracy alone would give it (spec §9.2, hysteresis).
 *
 * ## Why this exists
 *
 * `gradeAccuracy` puts the good/fair boundary at exactly 5 m. At the site
 * this app was measured on, under open sky, the receiver's raw live reading
 * hovers either side of that: 7.5 m falling to about 4.2 m, jittering
 * roughly ±0.5 m around its trend the whole way. The owner watched the ready
 * state on a Samsung S25 there and saw the dial flip amber → green → amber →
 * green with no change whatever in the quality of the fix. A colour that
 * flickers between two states says nothing and reads as a fault.
 *
 * The fix is not a different threshold — 5 m is spec'd, shared, and the
 * diagnostics instrument depends on it reading raw — it is that **leaving** a
 * grade takes a real move while **entering** one still takes crossing the
 * threshold.
 *
 * ## What it may and may not claim
 *
 * Hysteresis delays a *change*; it must never report a grade the accuracy has
 * never justified. So:
 *
 *  - Improving is immediate. A reading that has genuinely crossed into a
 *    better grade has earned that grade, and showing it at once cannot
 *    oscillate, because the fall back out of it is what is damped.
 *  - Worsening waits until the accuracy is `GRADE_HYSTERESIS_M` clear of the
 *    boundary it entered by. Below that it is jitter, and the last grade the
 *    accuracy actually justified is still the honest answer.
 *  - An absent accuracy is not jitter, it is the absence of a fix, so it
 *    takes the worst grade immediately with no margin applied.
 *
 * This is display only. Nothing stored, nothing graded on the diagnostics
 * screen, and nothing in `@corymbia/geo` changes: `gradeAccuracy` is called
 * here exactly as it is everywhere else, and this module only decides whether
 * the screen has yet earned the right to *stop* showing what it was showing.
 */

/**
 * How far past a boundary the accuracy must go before the grade falls back
 * across it, in metres.
 *
 * Chosen from the measured series rather than picked: the raw reading at that
 * site jitters about ±0.5 m around its trend, so a margin at or under half a
 * metre would let the same flicker straight back through. One metre is twice
 * that jitter and still well inside the width of either band (5 m and 10 m
 * wide), so a fix that has genuinely degraded still reports it — 6.0 m is a
 * different fix from 4.8 m in a way 5.1 m is not.
 */
export const GRADE_HYSTERESIS_M = 1

/** Worst to best, so "has this got better or worse" is an index comparison. */
const ORDER: FixGradeName[] = ['poor', 'fair', 'good']

/**
 * The accuracy at which a grade is finally given up, in metres: its own upper
 * boundary plus the margin. `poor` is the floor of the scale and has nothing
 * below it to fall into, so it has no exit of its own.
 */
const EXIT_M: Record<FixGradeName, number> = {
  good: GRADE_THRESHOLDS.good + GRADE_HYSTERESIS_M,
  fair: GRADE_THRESHOLDS.fair + GRADE_HYSTERESIS_M,
  poor: Number.POSITIVE_INFINITY,
}

/**
 * The grade to show, given the one being shown and the accuracy now.
 *
 * Pure, and a fold: `steadyGrade(steadyGrade(previous, m), m)` is
 * `steadyGrade(previous, m)`, which is what makes it safe to run during
 * render rather than in an effect (see `useSteadyGrade`).
 */
export function steadyGrade(previous: FixGradeName | null, accuracyM: number | null): FixGradeName {
  // No fix at all takes the worst grade with no margin: there is no reading
  // to be jittering, and the dashed outline and the `—` readout beside it are
  // already saying so.
  if (accuracyM === null) return 'poor'

  const raw = gradeAccuracy(accuracyM)
  if (previous === null || raw === previous) return raw

  const rawIndex = ORDER.indexOf(raw)
  const previousIndex = ORDER.indexOf(previous)
  // Better than what is on screen: it crossed the threshold, so it has earned
  // the grade and gets it now.
  if (rawIndex > previousIndex) return raw

  // Worse. Hold the grade on screen until the accuracy is clear of the
  // boundary it came in by — and then hand over to `gradeAccuracy`'s own
  // answer rather than stepping down one band, so an accuracy that fell two
  // bands at once is reported as what it is.
  return accuracyM > EXIT_M[previous] ? raw : previous
}

/**
 * `steadyGrade`, holding the grade currently on screen.
 *
 * A ref updated during render rather than state set from an effect: the grade
 * has to be the one this very render paints, and a state update a frame later
 * would show the raw grade first and correct it afterwards — which is the
 * flicker this exists to remove. Safe because `steadyGrade` is a fold (above):
 * running it twice on the same accuracy, as a double-invoked render does,
 * produces the same answer as running it once.
 */
export function useSteadyGrade(accuracyM: number | null): FixGradeName {
  const shown = useRef<FixGradeName | null>(null)
  const next = steadyGrade(shown.current, accuracyM)
  shown.current = next
  return next
}
