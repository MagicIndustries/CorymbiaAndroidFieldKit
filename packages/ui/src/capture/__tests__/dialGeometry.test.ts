import {
  OUTER_RADIUS_PX,
  TARGET_RADIUS_PX,
  isLocked,
  radiusForMetres,
  ringDash,
} from '../dialGeometry'

describe('radiusForMetres', () => {
  // These two anchor tests are written entirely in literals (1.4/26,
  // 7.5/118) rather than against TARGET_METRES/TARGET_RADIUS_PX or
  // OUTER_METRES/OUTER_RADIUS_PX. Calling radiusForMetres(TARGET_METRES) and
  // comparing to any value that still equals TARGET_RADIUS_PX would be a
  // tautology regardless of what expression supplies that value: a fit
  // solved exactly through (TARGET_METRES, TARGET_RADIUS_PX) returns
  // TARGET_RADIUS_PX at TARGET_METRES by construction, for whatever number
  // TARGET_METRES currently holds — so that call can never fail from
  // TARGET_METRES drifting away from what it's meant to measure. Fixing
  // both the call and the expectation to spec's own numbers makes this a
  // real check of the mapping against the specification, independent of
  // whatever the constants currently say — the same convention the
  // monotonicity test below already uses for this series.
  // Named for the floor, not for the grade. §9.2 used to claim "a good fix
  // lands exactly on the crosshair"; §9.2.1 retracted that — `gradeAccuracy`
  // calls anything under 5 m good and the crosshair is pinned to 1.4 m, so a
  // green circle resting well outside it is the normal case. What the mapping
  // actually pins is the hardware floor onto the crosshair.
  it('puts the measured floor exactly on the crosshair, which is what a fix reaching it lands on', () => {
    expect(radiusForMetres(1.4)).toBeCloseTo(26, 5)
  })

  it("puts the run's opening accuracy at the outer radius", () => {
    expect(radiusForMetres(7.5)).toBeCloseTo(118, 5)
  })

  it('is monotonic, because a worse fix must never draw smaller than a better one', () => {
    const series = [7.5, 5.2, 4.2, 3.1, 2.5, 2.0, 1.7, 1.4]
    const radii = series.map(radiusForMetres)
    radii.slice(1).forEach((r, i) => expect(r).toBeLessThan(radii[i] ?? Infinity))
  })

  it('keeps a poor fix outside the crosshair, so it visibly never locks', () => {
    expect(radiusForMetres(12)).toBeGreaterThan(TARGET_RADIUS_PX + 20)
    expect(isLocked(radiusForMetres(12))).toBe(false)
  })

  it('never returns a radius that would draw outside the ring or invert', () => {
    expect(radiusForMetres(0)).toBeGreaterThan(0)
    expect(radiusForMetres(500)).toBeLessThanOrEqual(OUTER_RADIUS_PX + 12)
    expect(Number.isFinite(radiusForMetres(Number.NaN))).toBe(true)
  })

  /**
   * AN UNUSABLE READING TAKES THE WORST CASE, NEVER A FALSE LOCK.
   *
   * `toBeGreaterThan(0)` above is satisfied by `MIN_RADIUS_PX` just as well as
   * by `MAX_RADIUS_PX`, so it cannot tell the two ends apart — and the two
   * ends are opposite claims about the fix. `Math.log(0)` is `-Infinity`, not
   * `NaN`, so a guard that tested only for `NaN` clamped zero metres to the
   * floor and reported `isLocked` true on it: the dial would have drawn a
   * degenerate reading as a converged one. `isLocked` is the assertion that
   * distinguishes them.
   */
  it('treats every unusable reading as worst case rather than as a converged one', () => {
    expect(isLocked(radiusForMetres(0))).toBe(false)
    expect(isLocked(radiusForMetres(Number.NaN))).toBe(false)
    expect(isLocked(radiusForMetres(-1))).toBe(false)
  })

  it('still lets a genuinely absent reading through as the worst case, not as a refusal', () => {
    // `capture.tsx` hands the dial `Infinity` when there is no reading at all
    // — the honest number for "no fix", rather than an invented accuracy —
    // and it must clamp to the outer end like any other unusably poor value.
    expect(radiusForMetres(Number.POSITIVE_INFINITY)).toBeCloseTo(radiusForMetres(500), 5)
    expect(isLocked(radiusForMetres(Number.POSITIVE_INFINITY))).toBe(false)
  })
})

describe('ringDash', () => {
  /**
   * THE ONE ASSERTION THAT IS NOT DERIVED FROM `ringDash` ITSELF.
   *
   * Every other test in this block compares one `ringDash` result to another,
   * so the dash length could be the radius, the diameter, or the
   * circumference without a semicolon of the suite changing colour — while
   * the drawn ring would be a short pattern repeating endlessly around the
   * path, never emptying. That is the same class of failure that killed the
   * rectangular traffic-light frame: a stroke that covers what is under it
   * instead of withdrawing from it. The circumference is computed here from
   * `2 * Math.PI * r`, independently of the module under test.
   */
  it('draws one dash exactly as long as the ring, which is what lets it empty at all', () => {
    expect(ringDash(130, 1).dasharray).toBeCloseTo(2 * Math.PI * 130, 5)
  })

  it('is fully drawn with the whole wait remaining and fully withdrawn at none', () => {
    const full = ringDash(130, 1)
    expect(full.dashoffset).toBeCloseTo(0, 5)
    const empty = ringDash(130, 0)
    expect(empty.dashoffset).toBeCloseTo(empty.dasharray, 5)
  })

  it('empties rather than fills as the wait runs down', () => {
    expect(ringDash(130, 0.25).dashoffset).toBeGreaterThan(ringDash(130, 0.75).dashoffset)
  })

  it('clamps a fraction outside nought to one rather than wrapping', () => {
    expect(ringDash(130, 2).dashoffset).toBeCloseTo(0, 5)
    expect(ringDash(130, -1).dashoffset).toBeCloseTo(ringDash(130, 0).dasharray, 5)
  })
})

describe('isLocked', () => {
  it('locks at the crosshair and just inside it', () => {
    expect(isLocked(TARGET_RADIUS_PX)).toBe(true)
    expect(isLocked(TARGET_RADIUS_PX - 4)).toBe(true)
  })

  it('does not lock while the circle is still outside the crosshair', () => {
    expect(isLocked(TARGET_RADIUS_PX + 6)).toBe(false)
  })
})
