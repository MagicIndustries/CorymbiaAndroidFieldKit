import React from 'react'
import { act, render, screen } from '@testing-library/react-native'
import { processColor } from 'react-native'
import { darkTheme, field } from '@corymbia/tokens'
import { CaptureFramePerimeter, perimeterGeometry } from '../CaptureFramePerimeter'

// `colour` takes a resolved colour value, same as the border it must always
// agree with (see TrafficLightFrame). A token-derived value here, never a
// raw hex literal — the same architectural rule this component's colour
// prop exists to honour applies to the tests exercising it too.
const COLOUR = darkTheme.colors.statusGood

// A 300x200 measured box. The ring is inset on every side by the whole of
// the grade border (field.frame, 5), plus the unpainted gap
// (field.countdownGap, 3), plus half its own thickness
// (field.countdown / 2, 1.5) — 9.5 in all — so the traced rectangle is
// 281x181. That inset is the whole of the fix for the invisible countdown:
// this ring is drawn beside the grade border, not along it. The corner
// radius follows the same inset, sharing the border's arc centre so the two
// rings stay concentric.
//
// Hand calculation: r = 16 - 9.5 = 6.5
// perimeter = straight runs + one full circle of corner arcs
//           = 2*(281-13) + 2*(181-13) + 2*pi*6.5
//           = 2*268 + 2*168 + 13*pi
//           = 536 + 336 + 40.840704...
//           = 912.840704...
const SIZE = { width: 300, height: 200 }
const INSET = field.frame + field.countdownGap + field.countdown / 2
const HAND_CALCULATED_PERIMETER = 2 * (281 - 13) + 2 * (181 - 13) + 2 * Math.PI * 6.5

describe('perimeterGeometry', () => {
  it('matches a hand calculation of the rounded-rectangle perimeter', () => {
    expect(perimeterGeometry(SIZE, 1).perimeter).toBeCloseTo(HAND_CALCULATED_PERIMETER, 6)
  })

  /**
   * The property that separates the two rings, asserted on the arithmetic
   * itself rather than only on the rendering.
   *
   * The first implementation put this stroke on the grade border's own
   * centreline at the border's own width, which is not a countdown drawn onto
   * the frame — it is the frame covered up, uncovering an identically
   * coloured ring behind it as it retreats. Nothing appeared to move for a
   * whole countdown on a good or fair fix.
   */
  it('clears the grade border entirely, rather than being traced along it', () => {
    const { inset } = perimeterGeometry(SIZE, 1)
    // The ring's outer edge — its centreline less half its own thickness —
    // has to fall clear of the border's inner edge, which is `field.frame`
    // from the box. The old coincident geometry put this at exactly 0.
    expect(inset - field.countdown / 2).toBeGreaterThan(field.frame)
    expect(inset).toBeCloseTo(INSET, 6)
  })

  it('is fully drawn — zero offset — when the whole wait remains', () => {
    expect(perimeterGeometry(SIZE, 1).strokeDashoffset).toBeCloseTo(0, 6)
  })

  it('is fully withdrawn — offset equals the full perimeter — when none of the wait remains', () => {
    const { perimeter, strokeDashoffset } = perimeterGeometry(SIZE, 0)
    expect(strokeDashoffset).toBeCloseTo(perimeter, 6)
  })

  it('empties as the wait runs down: less remaining means more offset', () => {
    const full = perimeterGeometry(SIZE, 1).strokeDashoffset
    const quarter = perimeterGeometry(SIZE, 0.25).strokeDashoffset
    // Offset grows as the stroke is withdrawn, so less remaining means more offset.
    expect(quarter).toBeGreaterThan(full)
  })

  it('clamps progress above 1 to fully drawn', () => {
    expect(perimeterGeometry(SIZE, 1.5).strokeDashoffset).toBeCloseTo(0, 6)
  })

  it('clamps progress below 0 to fully withdrawn', () => {
    const { perimeter, strokeDashoffset } = perimeterGeometry(SIZE, -0.5)
    expect(strokeDashoffset).toBeCloseTo(perimeter, 6)
  })
})

describe('CaptureFramePerimeter', () => {
  it('renders nothing until it has been measured, because a perimeter needs a size', async () => {
    await render(<CaptureFramePerimeter progress={1} colour={COLOUR} />)
    expect(screen.queryByTestId('perimeter-track')).toBeNull()
  })

  it('renders the track once its own box has been measured, sized to that box', async () => {
    await render(<CaptureFramePerimeter progress={1} colour={COLOUR} />)
    const box = screen.getByTestId('perimeter')
    await act(async () => {
      box.props.onLayout({ nativeEvent: { layout: { width: 300, height: 200 } } })
    })

    const track = screen.getByTestId('perimeter-track')
    // Inset past the border, the gap and half its own thickness (9.5) on
    // every side, so the traced rectangle sits well inside the measured
    // 300x200 box and clear of the grade border drawn around it.
    expect(track.props.x).toBeCloseTo(9.5, 6)
    expect(track.props.y).toBeCloseTo(9.5, 6)
    expect(track.props.width).toBeCloseTo(281, 6)
    expect(track.props.height).toBeCloseTo(181, 6)
  })

  // The geometry can be perfectly correct while never reaching the stroke at
  // all — a wiring slip, distinct from an arithmetic one. `progress=0.25` is
  // used deliberately: it is the one value already known (see
  // `extractStroke.ts` in `react-native-svg`) to round-trip a non-zero
  // `strokeDashoffset` through the library's native host-prop extraction
  // intact, so this is the one place these four props can be asserted on
  // the rendered element rather than only on the pure function.
  it('wires the geometry onto the rendered stroke: colour, width, dasharray and offset all present', async () => {
    await render(<CaptureFramePerimeter progress={0.25} colour={COLOUR} />)
    const box = screen.getByTestId('perimeter')
    await act(async () => {
      box.props.onLayout({ nativeEvent: { layout: { width: 300, height: 200 } } })
    })

    const track = screen.getByTestId('perimeter-track')
    const { perimeter, strokeDashoffset } = perimeterGeometry(SIZE, 0.25)

    // `stroke` is lowered to react-native-svg's brush shape, not the raw
    // colour string — `processColor` is the same lowering the library
    // itself applies, so this compares like with like.
    expect(track.props.stroke).toEqual({ type: 0, payload: processColor(COLOUR) })
    // Thinner than the grade border it runs inside, which is the other half
    // of what keeps the two rings distinguishable.
    expect(track.props.strokeWidth).toBe(field.countdown)
    expect(track.props.strokeWidth).toBeLessThan(field.frame)
    // A scalar `strokeDasharray` is lowered to a two-element array (an odd-
    // length dash list is duplicated onto itself so it still alternates).
    expect(track.props.strokeDasharray).toHaveLength(2)
    expect(track.props.strokeDasharray[0]).toBeCloseTo(perimeter, 6)
    expect(track.props.strokeDasharray[1]).toBeCloseTo(perimeter, 6)
    expect(track.props.strokeDashoffset).toBeCloseTo(strokeDashoffset, 6)
  })
})
