/**
 * Raw colour ramps. THIS IS THE ONLY FILE IN THE REPO PERMITTED TO CONTAIN HEX
 * LITERALS. Everything else consumes the semantic layer in `semantic.ts`.
 * Values are taken from design/logo/logo.svg and design/brochure/.
 *
 * Entries here are named for what the colour IS, never for where it is used
 * or which theme it serves — that assignment happens in `semantic.ts`.
 */
export const ramp = {
  /** Five-stop gradient from the logo mark, left to right. */
  brandGradient: ['#ABD246', '#99D252', '#6BD371', '#22D5A3', '#1CD5A7'] as const,

  /** Discrete brand greens, from the logo's spore dots. */
  brand: {
    lime: '#98D455',
    limeDeep: '#4E9B22',
    grass: '#84CF69',
    mint: '#55D28C',
    teal: '#30CF9F',
  },

  /** Dark ground, derived from the brochure's slate. */
  slate: {
    950: '#0E1519',
    900: '#16212A',
    800: '#1E2C36',
    700: '#2C3E4A',
    600: '#3B4A57',
    500: '#2E3B47',
  },

  /** Light ground. */
  paper: {
    0: '#FFFFFF',
    50: '#F2F5F4',
    100: '#E4EAE8',
    200: '#CBD6D2',
    600: '#5F7480',
    900: '#16212A',
  },

  /** A deep, muted green — distinct from the brand greens above. */
  deepGreen: '#12996F',

  /** Amber, as named in the spec. */
  amber: '#E8B33D',
  /** A deeper ochre variant of amber, for use on light grounds. */
  amberDeep: '#9A6B10',

  /** Rust, as named in the spec. */
  rust: '#E86A4D',
  /** A deeper brick-red variant of rust, for use on light grounds. */
  rustDeep: '#B23A21',

  /** Pale green-grey. */
  paleGreenGrey: '#E6EDEA',
  /** Blue-grey. */
  blueGrey: '#8FA3AD',

  /** Plain black, used as a scrim/overlay base. */
  black: '#000000',

  /** Four near-black tints, one per hue, for text/ink pairings on saturated fills. */
  nearBlack: {
    green: '#12290A',
    teal: '#04231A',
    brown: '#2B1C05',
    red: '#2B0C05',
  },
} as const
