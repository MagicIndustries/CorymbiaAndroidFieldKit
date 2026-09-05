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

  it('pins the raw brand and status palette to exact values from the logo and brochure', () => {
    // Discrete brand greens, from the logo's spore dots.
    expect(ramp.brand.lime).toBe('#98D455')
    expect(ramp.brand.limeDeep).toBe('#4E9B22')
    expect(ramp.brand.grass).toBe('#84CF69')
    expect(ramp.brand.mint).toBe('#55D28C')
    expect(ramp.brand.teal).toBe('#30CF9F')

    // Deep green used for the light-theme accent/status-good role.
    expect(ramp.deepGreen).toBe('#12996F')

    // Amber and rust, and their darker light-theme variants.
    expect(ramp.amber).toBe('#E8B33D')
    expect(ramp.amberDark).toBe('#9A6B10')
    expect(ramp.rust).toBe('#E86A4D')
    expect(ramp.rustDark).toBe('#B23A21')

    // Near-black text/ink tints, one per hue.
    expect(ramp.nearBlack.green).toBe('#12290A')
    expect(ramp.nearBlack.teal).toBe('#04231A')
    expect(ramp.nearBlack.brown).toBe('#2B1C05')
    expect(ramp.nearBlack.red).toBe('#2B0C05')
  })

  it('meets the minimum and field touch target sizes from the spec', () => {
    expect(touch.min).toBe(48)
    expect(field.control).toBe(72)
  })
})
