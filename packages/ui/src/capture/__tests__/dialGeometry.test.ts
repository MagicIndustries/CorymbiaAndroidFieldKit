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
  it('puts the measured floor exactly on the crosshair, which is what makes a good fix land on it', () => {
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
})

describe('ringDash', () => {
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
