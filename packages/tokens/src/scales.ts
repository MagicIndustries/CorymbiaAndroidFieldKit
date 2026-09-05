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
 */
export const type = {
  hero: { size: 62, weight: '800', letterSpacing: -1.8 },
  title: { size: 20, weight: '800', letterSpacing: 0 },
  heading: { size: 16, weight: '800', letterSpacing: 0 },
  body: { size: 14, weight: '500', letterSpacing: 0 },
  small: { size: 12, weight: '500', letterSpacing: 0 },
  label: { size: 10, weight: '700', letterSpacing: 1.8 },
  mono: { size: 12, weight: '500', letterSpacing: 0 },
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
} as const
