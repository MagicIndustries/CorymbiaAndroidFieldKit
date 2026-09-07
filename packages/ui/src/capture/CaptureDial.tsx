import React from 'react'
import { View } from 'react-native'
import Svg, { Circle, G, Line } from 'react-native-svg'
import { Type } from '../primitives'
import { useTheme } from '../theme'
import { OUTER_RADIUS_PX, TARGET_RADIUS_PX, radiusForMetres, ringDash } from './dialGeometry'

export type FixGradeName = 'good' | 'fair' | 'poor'

const WORD: Record<FixGradeName, string> = {
  good: 'GOOD FIX',
  fair: 'FAIR FIX',
  poor: 'POOR FIX',
}

/**
 * Rendering geometry for the dial's own SVG canvas. Distinct from
 * `dialGeometry.ts`, which computes only in the pixel units `radiusForMetres`
 * and `ringDash` already return and knows nothing about a viewBox —
 * `CENTER`/`VIEW_SIZE` just place those radii inside a square big enough to
 * hold the widest thing the dial ever draws: the ring at `OUTER_RADIUS_PX`
 * plus half its own stroke, and the accuracy circle's clamp, which can run
 * up to twelve pixels past `OUTER_RADIUS_PX` (see `RING_SLACK_PX` in
 * dialGeometry.ts, not exported) plus half its own outline stroke. Forty
 * pixels of margin clears both comfortably without needing that private
 * constant here.
 */
const DIAL_MARGIN_PX = 40
const CENTER = OUTER_RADIUS_PX + DIAL_MARGIN_PX
const VIEW_SIZE = CENTER * 2

/** Stroke widths are this canvas's own artwork geometry; colours come from the theme. */
const RING_STROKE_WIDTH = 10
const ACCURACY_STROKE_WIDTH = 3
const CROSSHAIR_STROKE_WIDTH = 3

/**
 * The dial (spec §9.2). One circular control doing three jobs at once, each
 * answering a different question:
 *
 * - **The ring is the clock.** It empties as `remaining` runs down. Absent
 *   `remaining` means no countdown is running — the dial is live at all
 *   times, but a countdown is not, so only the track renders, never a
 *   resting full or empty progress stroke.
 * - **The filled circle is the accuracy**, drawn as a real radius via
 *   `radiusForMetres(accuracyM)` — shrinking as the fix converges.
 * - **The crosshair is the target**, sized to `TARGET_RADIUS_PX` — the
 *   sharpest this hardware actually reaches.
 *
 * The dial is told everything: it computes no grade, no lock and no
 * accuracy mapping itself (that arithmetic lives in `dialGeometry.ts`,
 * called by the screen), which is what keeps `@corymbia/ui` free of any
 * dependency on `@corymbia/geo`.
 *
 * Layer order is a requirement, not a detail: ring track, ring progress,
 * accuracy circle, then the crosshair on top. The whole design is the
 * circle arriving *on* the target, so the crosshair must never be
 * obscured by the accuracy circle closing over it — painting it last, on
 * top of every other layer, is what guarantees that regardless of the
 * accuracy circle's radius or opacity.
 *
 * Colour never carries the grade alone (doctrine rule 9): the grade word
 * is always rendered alongside the colour.
 */
export function CaptureDial({
  grade,
  accuracyM,
  remaining,
  children,
}: {
  grade: FixGradeName
  accuracyM: number
  /**
   * Fraction of the wait remaining, 1 down to 0. Absent means no countdown
   * is running: the ring's track still renders, but no progress stroke.
   */
  remaining?: number
  /**
   * Whether the fix has converged onto the crosshair (spec §9.2.1,
   * `isLocked` in dialGeometry.ts). Accepted here for interface stability
   * with the screen that computes it, but not read: this component draws
   * only the resting and counting states. The lock's own presentation —
   * the snap, the ripple, the lit and thickened crosshair, "LOCKED ON" —
   * is a later task.
   */
  locked?: boolean
  children?: React.ReactNode
}) {
  const { theme } = useTheme()
  const colour = {
    good: theme.colors.statusGood,
    fair: theme.colors.statusFair,
    poor: theme.colors.statusPoor,
  }[grade]

  const accuracyRadius = radiusForMetres(accuracyM)
  const ring = remaining === undefined ? null : ringDash(OUTER_RADIUS_PX, remaining)

  return (
    <View testID="capture-dial">
      <Svg viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`} width="100%" height="100%">
        <Circle
          testID="dial-ring-track"
          cx={CENTER}
          cy={CENTER}
          r={OUTER_RADIUS_PX}
          fill="none"
          stroke={theme.colors.surfaceSunken}
          strokeWidth={RING_STROKE_WIDTH}
        />
        {ring === null ? null : (
          <Circle
            testID="dial-ring-progress"
            cx={CENTER}
            cy={CENTER}
            r={OUTER_RADIUS_PX}
            fill="none"
            stroke={colour}
            strokeWidth={RING_STROKE_WIDTH}
            strokeDasharray={ring.dasharray}
            strokeDashoffset={ring.dashoffset}
          />
        )}
        <Circle
          testID="dial-accuracy"
          cx={CENTER}
          cy={CENTER}
          r={accuracyRadius}
          fill={colour}
          stroke={colour}
          strokeWidth={ACCURACY_STROKE_WIDTH}
        />
        <G testID="dial-crosshair">
          <Line
            testID="dial-crosshair-horizontal"
            x1={CENTER - TARGET_RADIUS_PX}
            y1={CENTER}
            x2={CENTER + TARGET_RADIUS_PX}
            y2={CENTER}
            stroke={theme.colors.textDim}
            strokeWidth={CROSSHAIR_STROKE_WIDTH}
          />
          <Line
            testID="dial-crosshair-vertical"
            x1={CENTER}
            y1={CENTER - TARGET_RADIUS_PX}
            x2={CENTER}
            y2={CENTER + TARGET_RADIUS_PX}
            stroke={theme.colors.textDim}
            strokeWidth={CROSSHAIR_STROKE_WIDTH}
          />
        </G>
      </Svg>
      <Type variant="label" style={{ color: colour }}>
        {WORD[grade]}
      </Type>
      {children}
    </View>
  )
}
