import { darkTheme, lightTheme, ramp, touch, field } from '../index'

describe('themes', () => {
  it('dark and light expose an identical set of semantic colour keys', () => {
    const darkKeys = Object.keys(darkTheme.colors).sort()
    const lightKeys = Object.keys(lightTheme.colors).sort()
    expect(lightKeys).toEqual(darkKeys)
  })

  it('every semantic colour resolves to a hex string', () => {
    for (const theme of [darkTheme, lightTheme]) {
      for (const [key, value] of Object.entries(theme.colors)) {
        expect(`${key}=${value}`).toMatch(/=#[0-9A-Fa-f]{6}$/)
      }
    }
  })

  it('names the themes', () => {
    expect(darkTheme.name).toBe('dark')
    expect(lightTheme.name).toBe('light')
  })

  it('carries the exact brand gradient from the logo', () => {
    expect(ramp.brandGradient).toEqual([
      '#ABD246',
      '#99D252',
      '#6BD371',
      '#22D5A3',
      '#1CD5A7',
    ])
  })

  it('meets the minimum and field touch target sizes from the spec', () => {
    expect(touch.min).toBe(48)
    expect(field.control).toBe(72)
  })
})
