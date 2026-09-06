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

  it('pins the window to exactly the last 4 readings, not 3 or 5', () => {
    // Accuracies by index: [50, 10.3, 20, 10.2, 15, 10]. The window's first
    // reading is a local peak (20) so that shrinking or growing the window
    // picks a different, smaller "first" and flips the verdict:
    //   WINDOW=4 (correct): first=recent[0]=20 (index 2), last=10 (index 5).
    //     20 - 10 = 10 >= 0.5 -> 'improving'.
    //   WINDOW=3 (too small): first=10.2 (index 3), last=10 (index 5).
    //     10.2 - 10 = 0.2 < 0.5 -> 'plateaued'.
    //   WINDOW=5 (too large): first=10.3 (index 1), last=10 (index 5).
    //     10.3 - 10 = 0.3 < 0.5 -> 'plateaued'.
    // Both a smaller and a larger window than 4 disagree with the correct verdict.
    const readings = [at(50, 0), at(10.3, 1000), at(20, 2000), at(10.2, 3000), at(15, 4000), at(10, 5000)]
    expect(holdVerdict(readings)).toBe('improving')
  })

  it('compares the first and last reading of the window, not some other pair', () => {
    // Window (last 4 of 6): [20, 10, 10, 19.8].
    //   first & last (correct): 20 - 19.8 = 0.2 < 0.5 -> 'plateaued'.
    //   first & second (wrong pair): 20 - 10 = 10 >= 0.5 -> 'improving'.
    // The sequence dips sharply and then climbs back almost to its starting
    // point, so only the true first/last comparison sees the plateau.
    const readings = [at(50, 0), at(45, 1000), at(20, 2000), at(10, 3000), at(10, 4000), at(19.8, 5000)]
    expect(holdVerdict(readings)).toBe('plateaued')
  })

  it('treats improvement just above the meaningful threshold as improving', () => {
    // Diff = 10 - 9.49 = 0.51, just above MEANINGFUL_IMPROVEMENT_M = 0.5.
    expect(holdVerdict([at(10, 0), at(9.49, 1000)])).toBe('improving')
  })

  it('treats improvement just below the meaningful threshold as plateaued', () => {
    // Diff = 10 - 9.51 = 0.49, just below MEANINGFUL_IMPROVEMENT_M = 0.5.
    expect(holdVerdict([at(10, 0), at(9.51, 1000)])).toBe('plateaued')
  })
})
