/**
 * Pure geometry for the capture dial (spec §9.2). No React, no
 * `react-native-svg`, no rendering — arithmetic only, so the claim the dial
 * design rests on ("a good fix lands exactly on the crosshair; a poor one
 * visibly stops short") is checkable without drawing anything.
 *
 * `@corymbia/ui` must not import `@corymbia/geo` — this module receives a
 * metres figure and a countdown fraction as plain numbers, never a `Reading`
 * or an accuracy estimate it would have to compute itself.
 */

/**
 * The sharpest accuracy the Samsung S25 actually reached outdoors, in
 * metres — the measured floor from spec §9.1's table (the 20 s and 60 s
 * rows span ±1.0 m to ±1.4 m; 1.4 m is the worst of that flat tail, so the
 * crosshair is sized to what this hardware reliably reaches, not to its best
 * single run). Every other radius on the dial is scaled against this pair,
 * which is what makes "a good fix lands on the crosshair" a consequence of
 * the arithmetic rather than a decoration drawn on top of it.
 */
export const TARGET_METRES = 1.4

/**
 * Where `TARGET_METRES` sits on the dial, in pixels. The crosshair's own
 * radius — arrived at as a fix worth locking closes onto it.
 */
export const TARGET_RADIUS_PX = 26

/**
 * The accuracy the same measured run opened at, in metres — the first
 * reading's own estimate before any averaging (spec §9.1's table, n=1). This
 * is the wait's starting point, not an arbitrary "worst case".
 */
export const OUTER_METRES = 7.5

/**
 * Where `OUTER_METRES` sits on the dial, in pixels — the dial's outer ring.
 */
export const OUTER_RADIUS_PX = 118

/**
 * How far a radius may run past `OUTER_RADIUS_PX` before it is clamped, in
 * pixels. Without this a fix worse than `OUTER_METRES` (a poor GPS moment,
 * or `radiusForMetres(500)` at the degenerate end) would draw exactly on the
 * outer ring's own edge, and a circle sharing the ring's edge reads as part
 * of the ring rather than as an accuracy that has simply maxed out. Twelve
 * pixels is enough separation to keep the two visually distinct at the
 * dial's drawn scale without pushing the accuracy circle meaningfully past
 * the ring it sits inside.
 */
const RING_SLACK_PX = 12

/**
 * The smallest radius the dial ever draws, in pixels. Never zero: a
 * zero-radius circle is visually indistinguishable from no reading being
 * present at all, and this module must never produce that by accident from
 * an accuracy better than anything actually measured (`radiusForMetres(0)`
 * is degenerate input — GPS never reports exactly zero metres — but it must
 * still resolve to a real, visible, positive radius rather than blanking the
 * SVG it feeds). Small enough to read as a point well inside the crosshair.
 */
const MIN_RADIUS_PX = 4

/**
 * The maximum radius `radiusForMetres` will ever return.
 */
const MAX_RADIUS_PX = OUTER_RADIUS_PX + RING_SLACK_PX

/**
 * `radiusForMetres` fits a straight line to `ln(metres)` —
 * `radius = LOG_INTERCEPT_PX + LOG_SLOPE_PX_PER_LN_M * ln(metres)` — solved
 * by hand from the two measured anchors above, and then written here as
 * fixed literals rather than recomputed from `TARGET_METRES`/`OUTER_METRES`
 * at load time.
 *
 * That is a deliberate choice, not a shortcut: if the slope and intercept
 * were instead derived live from those two exported constants, then
 * `radiusForMetres(TARGET_METRES)` would equal `TARGET_RADIUS_PX` for *any*
 * value `TARGET_METRES` happened to hold — `ln(x / x)` is `0` for every `x`
 * — which would make the crosshair test in `dialGeometry.test.ts` a
 * tautology, true regardless of whether `TARGET_METRES` still means what its
 * own comment claims. Freezing the fitted numbers means an edit to
 * `TARGET_METRES` alone genuinely decouples the formula from its anchor, so
 * that test is actually checking the two are still in agreement (see Step 5
 * of the task brief, which breaks exactly this).
 *
 * The hand solution, from `radius = A + B·ln(m)` at the two anchor points:
 *
 * ```
 * 26  = A + B·ln(1.4)     ln(1.4) = 0.3364722366212128
 * 118 = A + B·ln(7.5)     ln(7.5) = 2.0149030205422647
 *
 * B = (118 − 26) / (ln(7.5) − ln(1.4))
 *   = 92 / 1.6784307839210519
 *   = 54.813103335172983
 *
 * A = 26 − B·ln(1.4)
 *   = 26 − 54.813103335172983 × 0.3364722366212128
 *   = 7.5569125246646855
 * ```
 *
 * Checked against both anchors: `A + B·ln(1.4) = 26.000000000000004` and
 * `A + B·ln(7.5) = 118.00000000000001` — exact to floating-point precision
 * (the trailing digits are `Math.log`/IEEE-754 rounding, well inside the
 * tests' `toBeCloseTo(…, 5)`), which is what "hits both anchors exactly"
 * means here: solved algebra, not a curve fit chosen to look right.
 *
 * A log mapping (rather than linear) is deliberate on top of that: accuracy
 * improves fast early in a hold and slowly thereafter (spec §9.1 — the
 * averaged figure runs 7.5 → 1.4 m over the measured series, most of that
 * drop in the first few readings), and a log radius makes that same shape
 * visible — the circle collapses quickly at first and eases into the
 * crosshair, rather than crawling there at a constant rate that never looks
 * like it is arriving.
 */
const LOG_SLOPE_PX_PER_LN_M = 54.813103335172983
const LOG_INTERCEPT_PX = 7.5569125246646855

/**
 * The accuracy circle's radius for a given accuracy, in metres (spec §9.2:
 * "the filled circle is the accuracy, drawn as a real radius"). Anchored
 * exactly on the two measured points documented above and clamped at both
 * ends so a degenerate input — zero, a huge outlier, `NaN`, `Infinity` — can
 * never reach the SVG this feeds as a negative, `NaN`, or off-ring radius,
 * which would otherwise render as a silent blank rather than a visible bug.
 *
 * `NaN` and non-positive metres both produce a `NaN` from `Math.log`, and
 * `Math.min`/`Math.max` propagate `NaN` rather than discarding it, so they
 * are handled explicitly: an unusable reading is treated as worst-case
 * (`MAX_RADIUS_PX`) — never as a false "locked" — rather than left to blank
 * the render. `Infinity` needs no special case: `Math.log(Infinity)` is
 * `Infinity`, and `Math.min(MAX_RADIUS_PX, Infinity)` clamps to
 * `MAX_RADIUS_PX` on its own.
 */
export function radiusForMetres(metres: number): number {
  const raw = LOG_INTERCEPT_PX + LOG_SLOPE_PX_PER_LN_M * Math.log(metres)
  if (Number.isNaN(raw)) return MAX_RADIUS_PX
  return Math.min(MAX_RADIUS_PX, Math.max(MIN_RADIUS_PX, raw))
}

/**
 * Dash geometry for the countdown ring (spec §9.2: "the ring is the clock…
 * it empties as the seconds run down"). Mirrors `perimeterGeometry` in
 * `CaptureFramePerimeter.tsx` — same clamp, same "offset grows as the stroke
 * withdraws" direction — because the dial replaces that rectangular
 * perimeter with a circular one and must keep the same honest-countdown
 * behaviour that fix was written for.
 *
 * `remaining` is the fraction of the wait *left*, clamped to `[0, 1]` rather
 * than wrapped, so a caller passing a stale or out-of-range fraction (a
 * frame computed a tick late, or before the countdown starts) still draws a
 * valid ring instead of an inverted or repeating one.
 */
export function ringDash(
  radius: number,
  remaining: number,
): { dasharray: number; dashoffset: number } {
  const circumference = 2 * Math.PI * radius
  const clampedRemaining = Math.min(1, Math.max(0, remaining))

  return {
    dasharray: circumference,
    dashoffset: circumference * (1 - clampedRemaining),
  }
}

/**
 * Whether an accuracy circle of this radius counts as locked onto the
 * crosshair (spec §9.2.1). At or inside `TARGET_RADIUS_PX` — the crosshair's
 * own size — rather than requiring an exact match, because a converged fix's
 * radius settles asymptotically toward `TARGET_RADIUS_PX` and a
 * floating-point mapping essentially never lands on it to the bit.
 */
export function isLocked(radiusPx: number): boolean {
  return radiusPx <= TARGET_RADIUS_PX
}
