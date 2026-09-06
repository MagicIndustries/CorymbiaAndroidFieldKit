import { DUPLICATE_THRESHOLD_M, isProbableDuplicate } from '../duplicate'

const HERE = { latitude: -37.82141, longitude: 145.03318 }

describe('isProbableDuplicate', () => {
  it('defaults to the 5 m threshold from the spec', () => {
    expect(DUPLICATE_THRESHOLD_M).toBe(5)
  })

  it('flags a second pin dropped essentially on the spot', () => {
    expect(isProbableDuplicate(HERE, HERE)).toBe(true)
  })

  it('does not flag a pin a clear distance away', () => {
    expect(isProbableDuplicate({ latitude: -37.8224, longitude: 145.03318 }, HERE)).toBe(false)
  })

  it('does not flag the first pin of a session, when there is nothing to compare with', () => {
    expect(isProbableDuplicate(HERE, null)).toBe(false)
  })

  it('honours a caller-supplied threshold', () => {
    const twentyMetresAway = { latitude: -37.82159, longitude: 145.03318 }
    expect(isProbableDuplicate(twentyMetresAway, HERE)).toBe(false)
    expect(isProbableDuplicate(twentyMetresAway, HERE, 50)).toBe(true)
  })
})
