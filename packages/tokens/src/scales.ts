/** Spacing scale in dp. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const

export const radii = {
  sm: 8,
  md: 11,
  lg: 14,
  xl: 16,
  pill: 999,
} as const

/**
 * Type scale. Sizes are constant physical size across form factors —
 * tablets get more content, never larger widgets (spec §5.3).
 *
 * Every variant carries a `fontFamily` key, even the ones that just want the
 * platform default (`undefined`) — a uniform shape across every entry is
 * what lets `Type` read `v.fontFamily` generically for whichever variant it
 * is given, rather than needing a special case for the one variant that
 * cares about its typeface.
 */
export const type = {
  hero: { size: 62, weight: '800', letterSpacing: -1.8, fontFamily: undefined },
  title: { size: 20, weight: '800', letterSpacing: 0, fontFamily: undefined },
  heading: { size: 16, weight: '800', letterSpacing: 0, fontFamily: undefined },
  body: { size: 14, weight: '500', letterSpacing: 0, fontFamily: undefined },
  small: { size: 12, weight: '500', letterSpacing: 0, fontFamily: undefined },
  label: { size: 10, weight: '700', letterSpacing: 1.8, fontFamily: undefined },
  /**
   * For live GPS coordinates: digits must line up as a fix updates, or the
   * numbers appear to jitter even when the value barely changed. `monospace`
   * is one of Android's built-in generic font families (resolved by the
   * platform to its system monospace face, e.g. Droid Sans Mono/Roboto
   * Mono) — this app targets Android only (see apps/fieldkit/android; there
   * is no apps/fieldkit/ios), so a single Android-native family name is
   * sufficient without a cross-platform fallback stack.
   */
  mono: { size: 12, weight: '500', letterSpacing: 0, fontFamily: 'monospace' },
} as const

/** Standard touch targets in dp. */
export const touch = {
  /** Absolute minimum for any interactive element. */
  min: 48,
  comfortable: 56,
} as const

/**
 * Field sizing scale — deliberately oversized for gloved, moving, one-handed
 * use. Distinct from `touch`, which governs settings and review screens.
 */
export const field = {
  /** Primary field controls, e.g. the capture boxes. */
  control: 72,
  /** The traffic-light frame thickness. */
  frame: 5,
  /**
   * The countdown ring's thickness, drawn concentrically *inside* the frame
   * (spec §9.2). Deliberately not `frame`: the countdown and the grade border
   * are two rings that must be visible at the same time, and one drawn at the
   * other's width, on the other's path, in the other's colour is not a second
   * ring at all — it is the first one covered up. Thinner rather than thicker
   * so the grade border stays the dominant edge of the frame, which is what a
   * survey position is judged by.
   */
  countdown: 3,
  /**
   * The unpainted gap between the grade border's inner edge and the countdown
   * ring's outer edge. It is what makes them read as two concentric rings
   * rather than one thick one, and it is why the pulse cannot cause a
   * collision: the border layer scales up from 1.0, so its inner edge only
   * ever moves further from the (unscaled) countdown ring.
   */
  countdownGap: 3,
} as const

/**
 * Elevation scale — shadow/elevation geometry only. Deliberately excludes
 * `shadowColor`: that is a themed value and must be read from
 * `useTheme().colors.overlay` at the call site, never baked in here.
 *
 * Two levels plus the resting case, matching the one raised surface the
 * product currently has (`Card`'s `raised` prop). Extend this list only
 * when a second, visually distinct raised surface actually appears.
 */
export const elevation = {
  /** The default, flush-with-the-page case. No shadow at all. */
  resting: {
    elevation: 0,
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
  },
  /** A surface lifted above the page, e.g. `Card`'s `raised` prop. */
  raised: {
    elevation: 4,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
} as const
