/**
 * Window size classes, mirroring Android's own convention and keyed on the
 * shortest side in dp (spec §5.3). Components branch on these names only —
 * never on raw dimensions.
 */
export type SizeClass = 'compact' | 'medium' | 'expanded'

export const BREAKPOINTS = { medium: 600, expanded: 840 } as const

export function sizeClassFor(shortestSideDp: number): SizeClass {
  if (shortestSideDp >= BREAKPOINTS.expanded) return 'expanded'
  if (shortestSideDp >= BREAKPOINTS.medium) return 'medium'
  return 'compact'
}
