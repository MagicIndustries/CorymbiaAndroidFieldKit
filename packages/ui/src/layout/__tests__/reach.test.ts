import { resolveReach } from '../reach'

describe('resolveReach', () => {
  it('uses a bottom band on a phone in portrait, regardless of handedness', () => {
    expect(
      resolveReach({ deviceClass: 'phone', orientation: 'portrait', handedness: 'right' }),
    ).toEqual({
      anchor: 'bottomBand',
      primarySide: 'right',
    })
    expect(
      resolveReach({ deviceClass: 'phone', orientation: 'portrait', handedness: 'left' }),
    ).toEqual({
      anchor: 'bottomBand',
      primarySide: 'left',
    })
  })

  it('keeps a bottom band on a phone in landscape, even though it can be expanded by width', () => {
    // A phone rotated to landscape is ~915dp wide (expanded by size class),
    // but its corners are still only a few centimetres apart — the tablet
    // ergonomic is wrong here. This is the case the size-class-only rule
    // used to get wrong.
    expect(
      resolveReach({ deviceClass: 'phone', orientation: 'landscape', handedness: 'right' }).anchor,
    ).toBe('bottomBand')
  })

  it('hugs the bottom corners on a tablet in landscape, because the centre is unreachable', () => {
    expect(
      resolveReach({ deviceClass: 'tablet', orientation: 'landscape', handedness: 'right' }),
    ).toEqual({
      anchor: 'bottomCorners',
      primarySide: 'right',
    })
  })

  it('mirrors the primary side for a left-handed user', () => {
    expect(
      resolveReach({ deviceClass: 'tablet', orientation: 'landscape', handedness: 'left' })
        .primarySide,
    ).toBe('left')
  })

  it('treats tablet portrait as a bottom band, since corners are far apart', () => {
    expect(
      resolveReach({ deviceClass: 'tablet', orientation: 'portrait', handedness: 'right' }).anchor,
    ).toBe('bottomBand')
  })
})
