import { orientationFor } from '../orientation'

describe('orientationFor', () => {
  it('is portrait when height exceeds width', () => {
    expect(orientationFor(412, 915)).toBe('portrait')
  })

  it('is landscape when width exceeds height', () => {
    expect(orientationFor(915, 412)).toBe('landscape')
  })

  it('treats a perfectly square window as portrait, an explicit tie-break', () => {
    expect(orientationFor(500, 500)).toBe('portrait')
  })
})
