/**
 * Raw colour ramps. THIS IS THE ONLY FILE IN THE REPO PERMITTED TO CONTAIN HEX
 * LITERALS. Everything else consumes the semantic layer in `semantic.ts`.
 * Values are taken from design/logo/logo.svg and design/brochure/.
 */
export const ramp = {
  /** Five-stop gradient from the logo mark, left to right. */
  brandGradient: ['#ABD246', '#99D252', '#6BD371', '#22D5A3', '#1CD5A7'] as const,

  /** Discrete brand greens, from the logo's spore dots. */
  brand: {
    lime: '#98D455',
    limeDeep: '#4E9B22', // Dark lime for light-theme capture-fast control
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

  /** Semantic status hues. Deliberately outside the brand — they mean, not decorate. */
  status: {
    goodDark: '#30CF9F',
    goodLight: '#12996F',
    fair: '#E8B33D',
    fairLight: '#9A6B10', // Light-theme fair status
    poor: '#E86A4D',
    poorLight: '#B23A21', // Light-theme poor status
  },

  text: {
    onDark: '#E6EDEA', // Dark-theme primary text
    dimOnDark: '#8FA3AD', // Dark-theme dim text
  },

  ink: {
    black: '#000000', // Scrim/overlay base
    onLime: '#12290A',
    onTeal: '#04231A',
    onFair: '#2B1C05',
    onPoor: '#2B0C05',
  },
} as const
