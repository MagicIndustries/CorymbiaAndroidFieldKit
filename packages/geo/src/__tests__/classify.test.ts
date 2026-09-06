import { GRADE_THRESHOLDS, gradeAccuracy } from '../classify'

describe('gradeAccuracy', () => {
  it('uses the thresholds the traffic-light frame is built on', () => {
    expect(GRADE_THRESHOLDS).toEqual({ good: 5, fair: 15 })
  })

  it('grades a survey-quality fix as good', () => {
    expect(gradeAccuracy(3)).toBe('good')
    expect(gradeAccuracy(4.9)).toBe('good')
  })

  it('grades the boundary values on the safer side', () => {
    expect(gradeAccuracy(5)).toBe('fair')
    expect(gradeAccuracy(15)).toBe('poor')
  })

  it('grades a middling fix as fair', () => {
    expect(gradeAccuracy(9)).toBe('fair')
  })

  it('grades a bad fix as poor', () => {
    expect(gradeAccuracy(40)).toBe('poor')
  })
})
