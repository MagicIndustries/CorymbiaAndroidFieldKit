import { resolveDisplayName } from '../shortLabel'

describe('resolveDisplayName', () => {
  it('prefers the short label when one is set', () => {
    expect(
      resolveDisplayName({
        name: 'Yarra Flats Riparian Restoration — North Reach Stage 2',
        shortLabel: 'Yarra Nth 2',
      }),
    ).toBe('Yarra Nth 2')
  })

  it('falls back to the full name when the short label is absent', () => {
    expect(resolveDisplayName({ name: 'Yarra Flats' })).toBe('Yarra Flats')
  })

  it('falls back to the full name when the short label is null or blank', () => {
    expect(resolveDisplayName({ name: 'Yarra Flats', shortLabel: null })).toBe('Yarra Flats')
    expect(resolveDisplayName({ name: 'Yarra Flats', shortLabel: '   ' })).toBe('Yarra Flats')
  })

  it('trims a short label', () => {
    expect(resolveDisplayName({ name: 'Yarra Flats', shortLabel: ' Yarra 2 ' })).toBe('Yarra 2')
  })
})
