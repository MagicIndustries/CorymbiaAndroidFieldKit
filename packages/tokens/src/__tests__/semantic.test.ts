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

  it('pins the entire ramp as a complete palette manifest', () => {
    // Every colour in the ramp, organized to match the structure in ramp.ts.
    // This test serves as the authoritative record of the product palette: adding or
    // changing a ramp value without updating this test will cause it to fail.
    expect(ramp).toEqual({
      // Five-stop gradient from the logo mark, left to right.
      brandGradient: ['#ABD246', '#99D252', '#6BD371', '#22D5A3', '#1CD5A7'],

      // Discrete brand greens, from the logo's spore dots.
      brand: {
        lime: '#98D455',
        limeDeep: '#4E9B22',
        grass: '#84CF69',
        mint: '#55D28C',
        teal: '#30CF9F',
      },

      // Dark ground, derived from the brochure's slate.
      slate: {
        950: '#0E1519',
        900: '#16212A',
        800: '#1E2C36',
        700: '#2C3E4A',
        600: '#3B4A57',
        500: '#2E3B47',
      },

      // Light ground.
      paper: {
        0: '#FFFFFF',
        50: '#F2F5F4',
        100: '#E4EAE8',
        200: '#CBD6D2',
        600: '#5F7480',
        900: '#16212A',
      },

      // A deep, muted green — distinct from the brand greens above.
      deepGreen: '#12996F',

      // Amber, as named in the spec.
      amber: '#E8B33D',
      // A deeper ochre variant of amber, for use on light grounds.
      amberDeep: '#9A6B10',

      // Rust, as named in the spec.
      rust: '#E86A4D',
      // A deeper brick-red variant of rust, for use on light grounds.
      rustDeep: '#B23A21',

      // Pale green-grey.
      paleGreenGrey: '#E6EDEA',
      // Blue-grey.
      blueGrey: '#8FA3AD',

      // Plain black, used as a scrim/overlay base.
      black: '#000000',

      // Four near-black tints, one per hue, for text/ink pairings on saturated fills.
      nearBlack: {
        green: '#12290A',
        teal: '#04231A',
        brown: '#2B1C05',
        red: '#2B0C05',
      },
    })
  })

  it('meets the minimum and field touch target sizes from the spec', () => {
    expect(touch.min).toBe(48)
    expect(field.control).toBe(72)
  })

  it('pins the field stroke-width and sizing tokens the capture dial draws with', () => {
    // `frame` is the diagnostics screen's own bordered capture block; every
    // other token here belongs to `CaptureDial`. (`countdownGap` was removed
    // with the traffic-light frame this test used to be named for: it was the
    // gap between that frame's grade border and its countdown ring, and with
    // both gone it had no consumer left but this line.)
    expect(field.frame).toBe(5)
    expect(field.countdown).toBe(3)
    // CaptureDial's own ring stroke — thicker than `countdown` because it has
    // no separate always-on grade border to lean on (see the doc comment in
    // scales.ts).
    expect(field.dialRing).toBe(10)
    // The dial's own bound, in dp. Pinned because it is the number that stops
    // the dial being the whole screen: unbounded, its `width/height="100%"`
    // SVG took the entire viewport on a Samsung S25 and pushed the accuracy,
    // the verdict and the only control off the bottom, so no capture could be
    // started at all. 300 leaves a 360dp-wide phone room for all three.
    expect(field.dialMax).toBe(300)
    // How far outside the accuracy circle's outline the settled completion's
    // companion ring is drawn. Small on purpose — the ring has to read as
    // being AT the accuracy's own radius, because the gap between it and the
    // crosshair is the whole signal — but non-zero, since two strokes on one
    // path are one thickened stroke rather than two rings.
    expect(field.dialSettledGap).toBe(7)
    // The accuracy circle's own outline weights, unlocked and locked — moved
    // here from local constants in CaptureDial.tsx (review fix, task 3): the
    // same "ergonomic line weight on a field control" argument that already
    // justified promoting `dialRing` applies to these two as well. The
    // locked weight is also reused, unchanged, for the crosshair once lit.
    expect(field.dialAccuracyOutline).toBe(1.75)
    expect(field.dialAccuracyOutlineLocked).toBe(4)
    // The accuracy circle's dash geometry on a poor fix (doctrine rule 9,
    // spec §9.2.2) — added closing the gap task-5's report recorded: the
    // deleted TrafficLightFrame's `borderStyle: 'dashed'` had no numeric
    // pattern of its own for these to inherit, so they are this task's own
    // figures, sized against `dialAccuracyOutline` (see scales.ts).
    expect(field.dialAccuracyOutlineDash).toBe(8)
    expect(field.dialAccuracyOutlineDashGap).toBe(5)
  })
})
