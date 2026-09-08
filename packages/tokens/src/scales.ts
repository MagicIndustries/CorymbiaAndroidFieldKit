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
   * The dial's thin secondary stroke, in dp.
   *
   * Named for the countdown because that is where it started: it was the
   * stroke of the deleted traffic-light frame's countdown ring, sized
   * deliberately thinner than `frame` so the grade border stayed the dominant
   * edge. That frame and its perimeter are gone (spec §9.2 — the dial
   * supersedes them), and this weight survived them, on the three pieces of
   * `CaptureDial`'s linework that want a thin, secondary stroke rather than
   * a weight of their own (spec §9.2.1): the crosshair while unlocked (it
   * thickens to `dialAccuracyOutlineLocked` once lit), the lock's ripple
   * rings, and the settled level's companion ring.
   *
   * It is *not* used for the accuracy circle's own outline — that wants a
   * softer resting weight than this, so it has its own pair of tokens below —
   * nor for the dial's own ring, which is `dialRing` and much heavier.
   */
  countdown: 3,
  /**
   * `CaptureDial`'s own ring stroke (spec §9.2): the track that is always
   * drawn, and — while a countdown is running — the same-width progress
   * stroke painted over it in the grade colour. One ring doing both jobs is
   * deliberate: the dial has no separate always-on grade border the way
   * `TrafficLightFrame` does, carried instead by the accuracy circle, so this
   * ring is the only edge a glance has to register the control by and must
   * stand on its own rather than nest thinly inside a thicker frame the way
   * `countdown` nests inside `frame`.
   */
  dialRing: 10,
  /**
   * The greatest diameter `CaptureDial` will ever draw itself at, in dp.
   *
   * **This is the bound that stops the dial being the whole screen.** Its
   * SVG is sized `width="100%" height="100%"` against a square viewBox, so
   * without a cap it grows to whatever its container allows — and in the
   * capture screen's centred, flex-grown column that is the entire viewport.
   * That shipped, and on a Samsung S25 it pushed the accuracy readout, the
   * verdict and *the only control* off the bottom of the screen: no capture
   * could be started at all, so nothing ever counted down and nothing ever
   * locked.
   *
   * An ergonomic figure rather than a fraction of the window, which is why
   * it lives here and not in a stylesheet: at roughly 5 cm across on a
   * phone it is comfortably the largest single element in the acquiring
   * state — larger than the `hero` accuracy's own ~74dp line — and legible
   * at arm's length in glare, while leaving room in a 360×780dp portrait
   * viewport for the accuracy, the verdict and a 72dp control beneath it.
   * The dial still takes the full width of anything narrower than this
   * (`width: '100%'` beside the cap), so it shrinks on a small screen and
   * stops growing on a large one — never branching on a raw width, which
   * the layout doctrine forbids.
   */
  dialMax: 300,
  /**
   * The accuracy circle's outline weight before a fix locks (spec §9.2.1:
   * unlocked, the circle is "a soft region of uncertainty"). Promoted here
   * from a local constant in `CaptureDial.tsx` for the same reason
   * `dialRing` was: it is an ergonomic line weight on a field control, which
   * is exactly what this scale exists to hold, not a rendering detail
   * private to one SVG.
   */
  dialAccuracyOutline: 1.75,
  /**
   * The accuracy circle's outline weight once a fix locks, and — reused
   * as-is, because the two firm together as one beat, not as two
   * separately-tuned effects (spec §9.2.1) — the crosshair's own thickened
   * stroke once lit. "A definite object on the target," firm rather than
   * soft.
   */
  dialAccuracyOutlineLocked: 4,
  /**
   * The accuracy circle's outline dash length on a poor fix, in px (doctrine
   * rule 9, spec §9.2.2: "a dashed treatment when poor"). A poor fix is the
   * one case where the accuracy circle visibly stops short of the crosshair
   * rather than converging onto it — the exact condition a dashed boundary
   * exists to say ("this edge is uncertain") — so the treatment lives on the
   * accuracy circle's own outline, not the ring (the clock) or the crosshair
   * (a fixed target).
   *
   * Sized against `dialAccuracyOutline` (1.75px), not against anything the
   * deleted `TrafficLightFrame` used: that frame dashed a rectangle with
   * React Native's own `borderStyle: 'dashed'`, which has no numeric dash
   * geometry of its own to inherit, and a rectangle's straight edges are a
   * different drawing problem from a circle's curved one regardless. At
   * ~4.5x the unlocked outline's own weight, each dash reads as a solid
   * segment rather than a hairline that could be mistaken for anti-aliasing
   * — the risk with a short dash on a thin stroke — without growing so long
   * it reads as a broken ring rather than a deliberately dashed one.
   */
  dialAccuracyOutlineDash: 8,
  /**
   * The gap between dashes on a poor fix's accuracy outline, in px. Shorter
   * than the dash itself (5px against 8px, roughly 2:3) so the eye reads
   * mostly-line-interrupted-by-gaps rather than a row of separate dots —
   * dashes and gaps close to equal length are the dotted look this is
   * deliberately not going for.
   */
  dialAccuracyOutlineDashGap: 5,
  /**
   * How far outside the accuracy circle's own outline the *settled*
   * companion ring is drawn, in px (spec §9.2.1's settled level).
   *
   * The ring marks where the capture actually got to, so it belongs at the
   * accuracy circle's own radius — but two strokes on the same path are one
   * thickened stroke, not two rings (the exact defect that killed the
   * rectangular traffic-light frame, spec §9.2). This is the separation that
   * makes it read as a companion ring around the circle rather than as a
   * heavier outline on it, and it is deliberately small: the ring must stay
   * unmistakably *at* the accuracy's radius, because the gap between it and
   * the crosshair inside it is the whole signal — how far this spot fell
   * short of what the device can do.
   */
  dialSettledGap: 7,
  /**
   * The side of a square media tile in `MediaStrip`, in dp — the ergonomic
   * question it answers is "how big does an attached photo's thumbnail need
   * to be to actually be *recognisable* as that photo, at arm's length,
   * while staying a control she can hit one-handed and gloved without
   * looking closely." `touch.comfortable` (56dp) covers the second half of
   * that alone — it is where `InputAffordanceRow`'s glyph-and-label tiles
   * stop, and a bare label needs no more — but a photo shrunk to 56dp reads
   * as a coloured square, not a photo, which defeats the reason `MediaStrip`
   * shows a thumbnail at all rather than a filename. Sized above
   * `touch.comfortable`, short of `field.control` (72dp, reserved for the
   * primary capture boxes) so a row of these never reads as more capture
   * controls.
   */
  mediaTile: 64,
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
