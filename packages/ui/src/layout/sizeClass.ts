/**
 * Window size classes, mirroring Android's own `WindowWidthSizeClass`
 * convention (spec §5.3): compact under 600dp, medium 600–839dp, expanded
 * 840dp and up. Takes the **current window width** — this answers "how much
 * horizontal room is there right now?", which drives layout decisions like
 * "two panes side by side, or one pane you navigate between".
 *
 * This is orientation-*dependent* by design: rotating a device changes its
 * window width, so it can (and should) change size class. Components branch
 * on these names only — never on raw dimensions.
 *
 * Size class is a layout question, not an ergonomic one. For the
 * orientation-*invariant* "what kind of device is this?" question that
 * drives reach zones, see `deviceClassFor`.
 */
export type SizeClass = 'compact' | 'medium' | 'expanded'

export const BREAKPOINTS = { medium: 600, expanded: 840 } as const

export function sizeClassFor(widthDp: number): SizeClass {
  if (widthDp >= BREAKPOINTS.expanded) return 'expanded'
  if (widthDp >= BREAKPOINTS.medium) return 'medium'
  return 'compact'
}
