import { useWindowDimensions } from 'react-native'
import { sizeClassFor, type SizeClass } from './sizeClass'

export type LayoutInfo = {
  sizeClass: SizeClass
  orientation: 'portrait' | 'landscape'
  width: number
  height: number
}

/**
 * THE ONLY PLACE IN THE REPO THAT READS WINDOW DIMENSIONS. Every other
 * component branches on `sizeClass`. Enforced by lint (Task 5).
 */
export function useLayout(): LayoutInfo {
  const { width, height } = useWindowDimensions()
  return {
    width,
    height,
    sizeClass: sizeClassFor(Math.min(width, height)),
    orientation: width > height ? 'landscape' : 'portrait',
  }
}
