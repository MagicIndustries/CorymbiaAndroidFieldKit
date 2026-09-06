import type { DeviceClass } from './deviceClass'
import type { Orientation } from './orientation'

export type Handedness = 'left' | 'right'
export type ReachAnchor = 'bottomBand' | 'bottomCorners'

export type Reach = {
  anchor: ReachAnchor
  primarySide: Handedness
}

/**
 * Reach is an ergonomic question, not a width question (spec §5.4), so it is
 * decided from `deviceClass` and `orientation` — never from `SizeClass`.
 *
 * On a 10-inch tablet held in two hands in landscape, the corners are
 * easiest to reach and the centre is hardest — the inverse of phone
 * thinking — so only `tablet` + `landscape` gets bottom corners. Tablet
 * portrait keeps a bottom band because the corners are too far apart to
 * pair. A phone in landscape can be `expanded` by width (it's roughly
 * 915dp wide), but its corners are still only a few centimetres apart, so
 * it keeps the phone ergonomic — a bottom band — regardless of size class.
 *
 * Handedness only mirrors which side is primary; it never changes the
 * anchor.
 */
export function resolveReach({
  deviceClass,
  orientation,
  handedness,
}: {
  deviceClass: DeviceClass
  orientation: Orientation
  handedness: Handedness
}): Reach {
  return {
    anchor: deviceClass === 'tablet' && orientation === 'landscape' ? 'bottomCorners' : 'bottomBand',
    primarySide: handedness,
  }
}
