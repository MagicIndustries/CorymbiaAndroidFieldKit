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
