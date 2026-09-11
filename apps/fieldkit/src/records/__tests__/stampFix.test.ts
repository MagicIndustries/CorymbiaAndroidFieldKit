import type { StoredFix } from '@corymbia/data'
import { stampFixFor } from '../stampFix'

/**
 * The seam between the fix as `@corymbia/data` stores it and the fix as
 * `ContextStamp` renders it. Two shapes of the same spec §8.2 distinction,
 * and the differences between them are exactly the places a mistake would be
 * invisible: the stored fix ages in seconds and the stamp ages in minutes, and
 * the stored fix carries provenance the stamp has no business showing.
 */

const POSITION = {
  latitude: -37.8136,
  longitude: 147.8302,
  datum: 'WGS84',
  verticalAccuracyM: null,
  isMocked: false,
  provider: 'gps',
  gpsTime: null,
  altitudeM: null,
  altitudeReference: null,
} as const

describe('stampFixFor', () => {
  it('carries a deliberate fix across with its accuracy', () => {
    const fix: StoredFix = {
      quality: 'deliberate',
      ...POSITION,
      accuracyM: 2.4,
      holdMs: 8000,
      accuracyConvention: 'radius68',
      sampleCount: 1,
      spreadM: null,
    }
    expect(stampFixFor(fix)).toEqual({ quality: 'deliberate', accuracyM: 2.4 })
  })

  it('rounds a deliberate fix’s accuracy to one decimal place', () => {
    // A real reading, not a round number: GPS accuracy arrives as a float
    // with far more precision than the reading ever earned. Printed raw,
    // ContextStamp's chip would show `±4.728091239929199 m` — an appearance
    // of precision docs/gps-accuracy.md is explicit is the misleading
    // direction. One decimal matches every other accuracy display in the app.
    const fix: StoredFix = {
      quality: 'deliberate',
      ...POSITION,
      accuracyM: 4.728091239929199,
      holdMs: 8000,
      accuracyConvention: 'radius68',
      sampleCount: 6,
      spreadM: 2.1,
    }
    expect(stampFixFor(fix)).toEqual({ quality: 'deliberate', accuracyM: 4.7 })
  })

  it('rounds an ambient fix’s accuracy to one decimal place', () => {
    // Same float-precision hazard as the deliberate branch above, and the
    // same fix: round before it reaches ContextStamp's chip.
    const fix: StoredFix = {
      quality: 'ambient',
      ...POSITION,
      accuracyM: 4.728091239929199,
      accuracyConvention: 'unknown',
      ageSeconds: 240,
    }
    expect(stampFixFor(fix)).toEqual({ quality: 'ambient', accuracyM: 4.7, ageMinutes: 4 })
  })

  it('turns an ambient fix’s age from seconds into whole minutes', () => {
    const fix: StoredFix = {
      quality: 'ambient',
      ...POSITION,
      accuracyM: 38,
      accuracyConvention: 'unknown',
      ageSeconds: 240,
    }
    expect(stampFixFor(fix)).toEqual({ quality: 'ambient', accuracyM: 38, ageMinutes: 4 })
  })

  it('rounds a part-minute age rather than truncating it away', () => {
    // 110 seconds is nearly two minutes old. Truncating would call it one,
    // which understates how stale the position is — and understating staleness
    // is the direction that misleads (docs/gps-accuracy.md).
    const fix: StoredFix = {
      quality: 'ambient',
      ...POSITION,
      accuracyM: 38,
      accuracyConvention: 'unknown',
      ageSeconds: 110,
    }
    expect(stampFixFor(fix)).toEqual({ quality: 'ambient', accuracyM: 38, ageMinutes: 2 })
  })

  it('gives a positionless record no accuracy and no age to misread', () => {
    expect(stampFixFor({ quality: 'none' })).toEqual({ quality: 'none' })
  })
})
