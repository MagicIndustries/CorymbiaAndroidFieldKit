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
 * reading's own estimate before any averaging (spec §9.3's prose, which
 * narrates the run descending from this opening figure to `TARGET_METRES`;
 * §9.1's table only carries aggregated wait/readings/accuracy rows and has
 * no per-reading entry to cite). This is the wait's starting point, not an
 * arbitrary "worst case".
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
 * from the two measured anchors above (`TARGET_METRES` → `TARGET_RADIUS_PX`,
 * `OUTER_METRES` → `OUTER_RADIUS_PX`) and computed here, at load time, from
 * those four exported constants rather than pasted in as fitted literals.
 * That is what keeps the mapping retunable: replacing a constant above — a
 * different device's measured floor, say — moves the line automatically,
 * with no hand algebra to redo and transcribe.
 *
 * The earlier draft of this module framed that as unsafe, because
 * `radiusForMetres(TARGET_METRES)` reduces to
 * `TARGET_RADIUS_PX + B·ln(TARGET_METRES / TARGET_METRES)`, and `ln(x / x)`
 * is `0` for every `x` — so a crosshair test asserting
 * `radiusForMetres(TARGET_METRES) === TARGET_RADIUS_PX` would pass no matter
 * what `TARGET_METRES` held, which is a tautology. That diagnosis was
 * correct; freezing the fitted numbers as literals was one fix for it, but
 * the weaker of two, because it also froze the mapping itself against the
 * constants it claims to be anchored on — an edit to `TARGET_METRES` no
 * longer moved anything, it only made a test fail until someone re-solved
 * the algebra by hand.
 *
 * The other fix — used here — is to keep the derivation live and instead
 * make the *tests* independent of these constants on both sides of the
 * assertion: `dialGeometry.test.ts` calls `radiusForMetres(1.4)` and
 * `radiusForMetres(7.5)` — the spec's own numbers, written as literals, not
 * `TARGET_METRES`/`OUTER_METRES` — and compares the result to the literals
 * `26`/`118`, not `TARGET_RADIUS_PX`/`OUTER_RADIUS_PX`. Asserting the
 * expected pixel value as a literal is not sufficient on its own:
 * `radiusForMetres(TARGET_METRES)` reduces to `TARGET_RADIUS_PX` by
 * construction of `A`/`B` below, for *whatever* `TARGET_METRES` currently
 * holds, so a test that still calls with the live constant would remain a
 * tautology no matter what its expectation was written as. Fixing the call
 * to the literal `1.4` is what makes the test actually about the
 * specification's claim ("1.4 m measured ⇒ 26 px drawn") rather than about
 * the mapping's self-consistency — so it fails the moment the mapping and
 * the constants disagree, however that disagreement happens: change
 * `TARGET_METRES` and the derived line moves off `(1.4, 26)`, so
 * `radiusForMetres(1.4)` stops returning `26`; break the derivation's
 * arithmetic and it stops matching even with the constants untouched. Both
 * are exercised in `dialGeometry.test.ts`.
 *
 * The algebra being solved, from `radius = A + B·ln(m)` at the two anchor
 * points, for reference (this is what the two lines below compute, not a
 * value pasted from it):
 *
 * ```
 * TARGET_RADIUS_PX = A + B·ln(TARGET_METRES)
 * OUTER_RADIUS_PX  = A + B·ln(OUTER_METRES)
 *
 * B = (OUTER_RADIUS_PX − TARGET_RADIUS_PX) / ln(OUTER_METRES / TARGET_METRES)
 * A = TARGET_RADIUS_PX − B·ln(TARGET_METRES)
 * ```
 *
 * A log mapping (rather than linear) is deliberate on top of that: accuracy
 * improves fast early in a hold and slowly thereafter (spec §9.3's prose —
 * the run's accuracy runs `OUTER_METRES` → `TARGET_METRES`, most of that
 * drop in the first few readings), and a log radius makes that same shape
 * visible — the circle collapses quickly at first and eases into the
 * crosshair, rather than crawling there at a constant rate that never looks
 * like it is arriving.
 */
const LOG_SLOPE_PX_PER_LN_M =
  (OUTER_RADIUS_PX - TARGET_RADIUS_PX) / Math.log(OUTER_METRES / TARGET_METRES)
const LOG_INTERCEPT_PX = TARGET_RADIUS_PX - LOG_SLOPE_PX_PER_LN_M * Math.log(TARGET_METRES)

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
