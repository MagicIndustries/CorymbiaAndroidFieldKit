import { resolveReach } from '../reach'

describe('resolveReach', () => {
  it('uses a bottom band on compact, regardless of handedness', () => {
    expect(resolveReach({ sizeClass: 'compact', handedness: 'right' })).toEqual({
      anchor: 'bottomBand',
      primarySide: 'right',
    })
    expect(resolveReach({ sizeClass: 'compact', handedness: 'left' })).toEqual({
      anchor: 'bottomBand',
      primarySide: 'left',
    })
  })

  it('hugs the bottom corners on expanded, because the centre of a tablet is unreachable', () => {
    expect(resolveReach({ sizeClass: 'expanded', handedness: 'right' })).toEqual({
      anchor: 'bottomCorners',
      primarySide: 'right',
    })
  })

  it('mirrors the primary side for a left-handed user', () => {
    expect(resolveReach({ sizeClass: 'expanded', handedness: 'left' }).primarySide).toBe('left')
  })

  it('treats tablet portrait as a bottom band, since corners are far apart', () => {
    expect(resolveReach({ sizeClass: 'medium', handedness: 'right' }).anchor).toBe('bottomBand')
  })
})
