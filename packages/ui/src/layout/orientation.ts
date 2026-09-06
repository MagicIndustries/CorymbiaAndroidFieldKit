export type Orientation = 'portrait' | 'landscape'

/**
 * Landscape only when the window is strictly wider than it is tall. A
 * perfectly square window (`width === height`) resolves to `'portrait'` —
 * there is no principled way to call a square screen "landscape", so this
 * pins the tie-break explicitly rather than leaving it as an accident of
 * `width > height` buried inline somewhere uninspectable.
 */
export function orientationFor(width: number, height: number): Orientation {
  return width > height ? 'landscape' : 'portrait'
}
