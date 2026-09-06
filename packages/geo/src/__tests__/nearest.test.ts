import { nearestPlace } from '../nearest'

const PLACES = [
  { id: 'a', name: 'North Reach', latitude: -37.82141, longitude: 145.03318 },
  { id: 'b', name: 'South Reach', latitude: -37.83, longitude: 145.04 },
]

describe('nearestPlace', () => {
  it('finds the closest known location and its distance', () => {
    const result = nearestPlace({ latitude: -37.8215, longitude: 145.0332 }, PLACES)
    expect(result?.place.name).toBe('North Reach')
    expect(result?.distanceM).toBeLessThan(20)
  })

  it('returns null when the project has no known locations', () => {
    expect(nearestPlace({ latitude: -37.8, longitude: 145.0 }, [])).toBeNull()
  })

  it('picks the genuinely nearer of two candidates', () => {
    expect(nearestPlace({ latitude: -37.8299, longitude: 145.0399 }, PLACES)?.place.id).toBe('b')
  })

  it('rounds the distance to a whole metre, which is all the UI shows', () => {
    const result = nearestPlace({ latitude: -37.8215, longitude: 145.0332 }, PLACES)
    expect(Number.isInteger(result?.distanceM)).toBe(true)
  })
})
