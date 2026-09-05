import type { SizeClass } from './sizeClass'

export type Handedness = 'left' | 'right'
export type ReachAnchor = 'bottomBand' | 'bottomCorners'

export type Reach = {
  anchor: ReachAnchor
  primarySide: Handedness
}

/**
 * On a 10-inch tablet held in two hands the corners are easiest to reach and
 * the centre is hardest — the inverse of phone thinking (spec §5.4). Tablet
 * portrait keeps a bottom band because the corners are too far apart to pair.
 */
export function resolveReach({
  sizeClass,
  handedness,
}: {
  sizeClass: SizeClass
  handedness: Handedness
}): Reach {
  return {
    anchor: sizeClass === 'expanded' ? 'bottomCorners' : 'bottomBand',
    primarySide: handedness,
  }
}
