import { distanceMetres } from '../distance'

describe('distanceMetres', () => {
  it('is zero for the same point', () => {
    expect(distanceMetres({ latitude: -37.8, longitude: 145.0 }, { latitude: -37.8, longitude: 145.0 })).toBe(0)
  })

  it('measures a short north-south hop accurately', () => {
    // 0.001 degrees of latitude is very close to 111.32 m everywhere.
    const d = distanceMetres(
      { latitude: -37.8, longitude: 145.0 },
      { latitude: -37.801, longitude: 145.0 },
    )
    expect(d).toBeGreaterThan(110)
    expect(d).toBeLessThan(113)
  })

  it('measures a purely east-west hop at Melbourne to the centimetre', () => {
    // The exact assertion this file was missing. Every other test here states a
    // band, and the east-west term — the `cos(lat1) * cos(lat2)` factor — was
    // pinned by none of them: replacing `toRadians(a.latitude)` with the bare
    // degree value leaves the convergence-ratio test below at 0.995, inside its
    // (0.7, 1.0) window, and the whole suite green while a 0.001° longitude hop
    // at Melbourne grows from 87.86 m to 110.63 m — a 26% east-west error in a
    // number that becomes a published coordinate.
    //
    // The arithmetic, for a hop of 0.001° of longitude at latitude -37.8°:
    //
    //   Δλ  = 0.001 × π / 180        = 1.7453292519943296e-5 rad
    //   φ   = 37.8 × π / 180         = 0.65973445725385649 rad
    //   cos φ                        = 0.79015501237569041
    //
    // With Δφ = 0 the haversine reduces to h = sin²(Δλ/2) · cos²φ, so
    //   d = 2R · asin(sin(Δλ/2) · cos φ) ≈ R · Δλ · cos φ
    // (the approximation is exact to about 1e-9 m at this size, far below the
    // tolerance below).
    //
    //   R · Δλ                       = 6 371 008.8 × 1.7453292519943296e-5
    //                                = 111.19508023353292 m   (a degree-minute of
    //                                  longitude at the equator, as expected)
    //   d = 111.19508023353292 × 0.79015501237569041
    //                                = 87.861349998 m
    //
    // Asserted to four decimals, which also pins the earth radius: the tempting
    // round 6 371 000 m gives 87.8612286 m, off by 1.2e-4 m and outside the
    // 5e-5 m tolerance below.
    const d = distanceMetres(
      { latitude: -37.8, longitude: 145.0 },
      { latitude: -37.8, longitude: 145.001 },
    )
    expect(d).toBeCloseTo(87.86135, 4)
  })

  it('accounts for longitude lines converging away from the equator', () => {
    const atEquator = distanceMetres(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0.001 },
    )
    const atMelbourne = distanceMetres(
      { latitude: -37.8, longitude: 145.0 },
      { latitude: -37.8, longitude: 145.001 },
    )
    expect(atMelbourne).toBeLessThan(atEquator)
    expect(atMelbourne).toBeGreaterThan(atEquator * 0.7)
  })

  it('is symmetric', () => {
    const a = { latitude: -37.8, longitude: 145.0 }
    const b = { latitude: -37.81, longitude: 145.02 }
    expect(distanceMetres(a, b)).toBeCloseTo(distanceMetres(b, a), 6)
  })

  it('handles a realistic field distance', () => {
    // Roughly 120 m, the distance used throughout the spec's examples.
    const d = distanceMetres(
      { latitude: -37.82141, longitude: 145.03318 },
      { latitude: -37.82249, longitude: 145.03318 },
    )
    expect(d).toBeGreaterThan(115)
    expect(d).toBeLessThan(125)
  })
})
