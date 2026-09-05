import { ramp } from './ramp'

/**
 * The semantic layer. Components consume ONLY these keys — never `ramp`,
 * never a raw hex value. Enforced by the `no-restricted-syntax` lint rule
 * added in Task 5.
 */
export type SemanticColors = {
  surface: string
  surfaceRaised: string
  surfaceSunken: string

  border: string
  borderStrong: string

  textPrimary: string
  textDim: string
  textOnAccent: string

  accent: string
  accentMuted: string

  captureFast: string
  captureFastInk: string
  captureAccurate: string
  captureAccurateInk: string

  statusGood: string
  statusGoodInk: string
  statusFair: string
  statusFairInk: string
  statusPoor: string
  statusPoorInk: string

  overlay: string
}

export type ThemeName = 'dark' | 'light'

export type Theme = {
  name: ThemeName
  colors: SemanticColors
}

export const darkTheme: Theme = {
  name: 'dark',
  colors: {
    surface: ramp.slate[950],
    surfaceRaised: ramp.slate[900],
    surfaceSunken: ramp.slate[800],

    border: ramp.slate[700],
    borderStrong: ramp.slate[600],

    textPrimary: ramp.text.onDark,
    textDim: ramp.text.dimOnDark,
    textOnAccent: ramp.ink.onTeal,

    accent: ramp.brand.teal,
    accentMuted: ramp.brand.mint,

    captureFast: ramp.brand.lime,
    captureFastInk: ramp.ink.onLime,
    captureAccurate: ramp.slate[900],
    captureAccurateInk: ramp.text.onDark,

    statusGood: ramp.status.goodDark,
    statusGoodInk: ramp.ink.onTeal,
    statusFair: ramp.status.fair,
    statusFairInk: ramp.ink.onFair,
    statusPoor: ramp.status.poor,
    statusPoorInk: ramp.ink.onPoor,

    overlay: ramp.ink.black,
  },
}

export const lightTheme: Theme = {
  name: 'light',
  colors: {
    surface: ramp.paper[50],
    surfaceRaised: ramp.paper[0],
    surfaceSunken: ramp.paper[100],

    border: ramp.paper[200],
    borderStrong: ramp.paper[600],

    textPrimary: ramp.paper[900],
    textDim: ramp.paper[600],
    textOnAccent: ramp.paper[0],

    accent: ramp.status.goodLight,
    accentMuted: ramp.brand.mint,

    captureFast: ramp.brand.limeDeep,
    captureFastInk: ramp.paper[0],
    captureAccurate: ramp.paper[0],
    captureAccurateInk: ramp.paper[900],

    statusGood: ramp.status.goodLight,
    statusGoodInk: ramp.paper[0],
    statusFair: ramp.status.fairLight,
    statusFairInk: ramp.paper[0],
    statusPoor: ramp.status.poorLight,
    statusPoorInk: ramp.paper[0],

    overlay: ramp.ink.black,
  },
}
