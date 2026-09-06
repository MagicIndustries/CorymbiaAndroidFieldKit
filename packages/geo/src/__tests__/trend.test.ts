import { holdVerdict } from '../trend'
import type { Reading } from '../classify'

const at = (accuracyM: number, timestampMs: number): Reading => ({
  latitude: -37.82141,
  longitude: 145.03318,
  accuracyM,
  altitudeM: null,
  timestampMs,
})

describe('holdVerdict', () => {
  it('says improving while accuracy is still falling', () => {
    expect(holdVerdict([at(20, 0), at(14, 1000), at(9, 2000), at(6, 3000)])).toBe('improving')
  })

  it('says plateaued once accuracy has stopped falling meaningfully', () => {
    expect(holdVerdict([at(4.2, 0), at(4.1, 1000), at(4.1, 2000), at(4.0, 3000)])).toBe('plateaued')
  })

  it('says plateaued when accuracy is getting worse', () => {
    expect(holdVerdict([at(4, 0), at(6, 1000), at(9, 2000), at(12, 3000)])).toBe('plateaued')
  })

  it('judges only recent readings, so an early improvement does not claim a current one', () => {
    const readings = [at(60, 0), at(30, 1000), at(5, 2000), at(5, 3000), at(5, 4000), at(5, 5000)]
    expect(holdVerdict(readings)).toBe('plateaued')
  })

  it('says improving on too little evidence, because the honest default is to let her wait', () => {
    expect(holdVerdict([at(9, 0)])).toBe('improving')
    expect(holdVerdict([])).toBe('improving')
  })
})
