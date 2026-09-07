import React, { useState } from 'react'
import { View, type LayoutChangeEvent } from 'react-native'
import Svg, { Rect } from 'react-native-svg'
import { field, radii } from '@corymbia/tokens'

export type PerimeterSize = { width: number; height: number }

/**
 * Where the countdown ring's centreline sits, measured in from the frame's
 * outer edge: past the whole of the grade border, past the gap, and then half
 * of its own thickness.
 *
 * **This is the fix for the ring nobody could see.** The first implementation
 * traced this stroke along the grade border's own centreline (`field.frame /
 * 2`), at the border's width, in the border's colour — geometry that was
 * deliberately corrected to sit exactly there. It was exact, and it was
 * invisible: the stroke covered the border, and as it retreated it uncovered
 * an identical ring in an identical colour. On a good or fair fix nothing
 * appeared to move for the whole countdown; on a poor fix a little showed
 * through only by accident, because that border is dashed.
 *
 * Two constraints bound the alternatives, and neither could be traded:
 *
 *  - **The grade colour may never weaken**, at any point in the countdown or
 *    the pulse cycle (spec §9.2, which forbids it for the same reason it
 *    forbids a fading pulse — the frame's colour is what a survey position is
 *    judged by, and a good fix must never read as fair). So the countdown
 *    cannot be a translucent or desaturated version of the border, and cannot
 *    dim the part of the border it has already left behind.
 *  - **It must read as time running out**, not as progress toward something,
 *    which is why the stroke empties rather than fills.
 *
 * Drawing it as a distinct concentric ring *inside* the grade border is what
 * satisfies both. The grade border is untouched — full width, full colour,
 * full opacity, at every instant — and the countdown is an additional,
 * thinner ring separated from it by an unpainted gap, in the same colour, so
 * no second colour vocabulary is introduced beside the traffic light either.
 *
 * This is **not** the inset pulse ring §9.2 rejects. That rejection is about
 * the *pulse*, which must move the whole frame and still does. §9.2 requires
 * the countdown to be *around the perimeter*; it does not require it to share
 * the grade border's exact path, and sharing that path is precisely what made
 * it invisible.
 */
const TRACK_INSET = field.frame + field.countdownGap + field.countdown / 2

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
  const inset = TRACK_INSET
  const width = Math.max(0, size.width - 2 * inset)
  const height = Math.max(0, size.height - 2 * inset)
  // `radii.xl` is the border's *outer* corner radius (it is what the
  // Animated.View border layer in TrafficLightFrame is rounded to). This
  // Rect is traced on the countdown ring's own centreline — inset by `inset`
  // on every side — and insetting a rounded rectangle uniformly by δ on every
  // side moves each corner's arc centre inward by δ on both axes, so the
  // radius that shares that same arc centre is `radii.xl - inset`, not
  // `radii.xl` unreduced. Using the outer radius here would shift the arc
  // centre by (inset, inset) and oversize the curve, so this ring and the
  // border's own curve would stop being concentric at every corner. Clamped
  // at 0 so a box too small for the reduced radius never goes negative, and
  // against half of each side as before.
  const r = Math.max(0, Math.min(radii.xl - inset, width / 2, height / 2))
  // Perimeter of a rounded rectangle: the straight runs plus one full circle
  // made of the four corner arcs — computed from `r`, the radius actually
  // drawn, so the dash length and the path agree and the ring reaches empty
  // exactly at zero.
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
 * The countdown, drawn as its own ring just inside the frame's grade border
 * (spec §9.2 — see `TRACK_INSET` for why it is beside that border rather than
 * on it). Sample count is shown separately, as a number, inside the frame —
 * this ring carries only the time remaining.
 *
 * It is deliberately *not* wrapped in the pulse's `Animated.View`. The pulse
 * scales the whole frame, and scaling a stroke whose dash lengths were
 * computed from an unscaled box would make the countdown's own length breathe
 * along with it — the ring would appear to gain and lose time four times a
 * minute. The grade border is what breathes; the countdown is what runs down.
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
        strokeWidth={field.countdown}
        strokeDasharray={perimeter}
        strokeDashoffset={strokeDashoffset}
      />
    </Svg>
  )
}
