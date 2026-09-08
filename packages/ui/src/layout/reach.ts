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

/**
 * How wide a `bottomCorners` control block may grow — the capture block on
 * `capture.tsx`, the shutter controls on `camera.tsx`. A tablet in landscape
 * is the only case that reaches `bottomCorners`, and there the whole point is
 * that the block sits under one thumb: allowed to span a ten-inch screen it
 * would put its own far edge further from the control than the layout this
 * anchor exists to replace. This is a fixed physical size in dp, not a
 * fraction of the window — nothing here may branch on a raw width (doctrine's
 * layout rule), and the ergonomic question is how far a thumb reaches, which
 * is a distance rather than a proportion.
 *
 * Owned here, next to `resolveReach`, rather than declared per screen: two
 * copies of the same ergonomic constant drift the moment one screen's is
 * tuned and the other's is not.
 */
export const CORNER_BLOCK_MAX_W = 420
