import React, { useState } from 'react'
import { View, type LayoutChangeEvent } from 'react-native'
import Svg, { Rect } from 'react-native-svg'
import { field, radii } from '@corymbia/tokens'

export type PerimeterSize = { width: number; height: number }

/**
 * Pure geometry for the countdown stroke (spec §9.2), exported so its
 * arithmetic can be unit-tested directly against a hand calculation.
 *
 * `progress` is the fraction of the wait *remaining*, so the stroke empties
 * as the seconds run down. Under the superseded press-and-hold model the
 * only measure of progress was how many readings a hold had gathered; there
 * is now a wait with a known end, so this is the honest progress of that.
 *
 * This is kept separate from the `Rect` it feeds because `react-native-svg`'s
 * own prop extraction (`extractStroke.ts`) folds a `strokeDashoffset` of
 * exactly `0` to `null` on the native host props it hands to the renderer —
 * real library behaviour, not a test artefact — and React Testing Library
 * v14 only exposes host elements (`UNSAFE_getByProps`/`UNSAFE_getByType`
 * were removed), so a fully-drawn stroke's offset can't be read back off the
 * rendered `Rect`. Testing this function directly proves the arithmetic
 * without depending on a rendering detail this codebase doesn't control.
 */
export function perimeterGeometry(size: PerimeterSize, progress: number) {
  const inset = field.frame / 2
  const width = Math.max(0, size.width - field.frame)
  const height = Math.max(0, size.height - field.frame)
  // Perimeter of a rounded rectangle: the straight runs plus one full circle
  // made of the four corner arcs.
  const r = Math.min(radii.xl, width / 2, height / 2)
  const perimeter = 2 * (width - 2 * r) + 2 * (height - 2 * r) + 2 * Math.PI * r
  const remaining = Math.min(1, Math.max(0, progress))

  return {
    inset,
    width,
    height,
    r,
    perimeter,
    strokeDashoffset: perimeter * (1 - remaining),
  }
}

/**
 * The countdown, drawn around the frame's perimeter (spec §9.2). Sample
 * count is shown separately, as a number, inside the frame — this perimeter
 * carries only the time remaining.
 *
 * The size comes from `onLayout` — the view's own measured box, not the
 * window — because a perimeter cannot be drawn without one. `onLayout` is a
 * view measuring itself, not a window-dimension read, so it does not go
 * through `useLayout`.
 */
export function CaptureFramePerimeter({
  progress,
  colour,
}: {
  progress: number
  colour: string
}) {
  const [size, setSize] = useState<PerimeterSize | null>(null)

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    setSize({ width, height })
  }

  return (
    <View
      testID="perimeter"
      pointerEvents="none"
      onLayout={onLayout}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
    >
      {size ? <Track size={size} progress={progress} colour={colour} /> : null}
    </View>
  )
}

function Track({
  size,
  progress,
  colour,
}: {
  size: PerimeterSize
  progress: number
  colour: string
}) {
  const { inset, width, height, r, perimeter, strokeDashoffset } = perimeterGeometry(
    size,
    progress,
  )

  return (
    <Svg width={size.width} height={size.height}>
      <Rect
        testID="perimeter-track"
        x={inset}
        y={inset}
        width={width}
        height={height}
        rx={r}
        ry={r}
        fill="none"
        stroke={colour}
        strokeWidth={field.frame}
        strokeDasharray={perimeter}
        strokeDashoffset={strokeDashoffset}
      />
    </Svg>
  )
}
