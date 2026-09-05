import { useWindowDimensions } from 'react-native'
import { sizeClassFor, type SizeClass } from './sizeClass'
import { orientationFor, type Orientation } from './orientation'

export type LayoutInfo = {
  sizeClass: SizeClass
  orientation: Orientation
  width: number
  height: number
}

/**
 * THE ONLY PLACE IN THE REPO THAT READS WINDOW DIMENSIONS. Every other
 * component branches on the composed values below. Enforced by lint (Task 5).
 *
 * Pure composition, no logic of its own: `sizeClass` from the current width
 * (orientation-dependent — rotating the device can change it), `orientation`
 * from both dimensions via `orientationFor`. Do not collapse this back into
 * `sizeClassFor(Math.min(width, height))` — that conflation was the bug: a
 * rigid device's shortest side never changes on rotation, so `sizeClass`
 * could never reach `expanded` for a 10-inch tablet turned to landscape.
 */
export function useLayout(): LayoutInfo {
  const { width, height } = useWindowDimensions()
  return {
    width,
    height,
    sizeClass: sizeClassFor(width),
    orientation: orientationFor(width, height),
  }
}
