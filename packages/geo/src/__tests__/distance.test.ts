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
