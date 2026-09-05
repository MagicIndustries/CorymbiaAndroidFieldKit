import { useWindowDimensions } from 'react-native'
import { sizeClassFor, type SizeClass } from './sizeClass'
import { deviceClassFor, type DeviceClass } from './deviceClass'
import { orientationFor, type Orientation } from './orientation'

export type LayoutInfo = {
  sizeClass: SizeClass
  deviceClass: DeviceClass
  orientation: Orientation
  width: number
  height: number
}

/**
 * THE ONLY PLACE IN THE REPO THAT READS WINDOW DIMENSIONS. Every other
 * component branches on the composed values below. Enforced by lint (Task 5).
 *
 * Pure composition, no logic of its own: `sizeClass` from the current width
 * (orientation-dependent — rotating the device can change it), `deviceClass`
 * from the shortest side (orientation-invariant — rotating the device can't
 * change it), `orientation` from both. Do not collapse these back into
 * `sizeClassFor(Math.min(width, height))` — that conflation is the bug this
 * module exists to prevent (a rigid device's shortest side never changes on
 * rotation, so it can never reach `expanded`).
 */
export function useLayout(): LayoutInfo {
  const { width, height } = useWindowDimensions()
  return {
    width,
    height,
    sizeClass: sizeClassFor(width),
    deviceClass: deviceClassFor(Math.min(width, height)),
    orientation: orientationFor(width, height),
  }
}
