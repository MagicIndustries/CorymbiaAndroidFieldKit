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

// A 300x200 measured box, inset by field.frame/2 (2.5) on every side so the
// traced rectangle is 295x195. The corner radius is drawn on the
// centreline, not the border's outer radius: radii.xl (16) minus the 2.5
// inset, sharing the same arc centre as the border it must overlay.
//
// Hand calculation: r = 16 - 2.5 = 13.5
// perimeter = straight runs + one full circle of corner arcs
//           = 2*(295-27) + 2*(195-27) + 2*pi*13.5
//           = 2*268 + 2*168 + 27*pi
//           = 536 + 336 + 84.823001...
//           = 956.823001...
const SIZE = { width: 300, height: 200 }
const HAND_CALCULATED_PERIMETER = 2 * (295 - 27) + 2 * (195 - 27) + 2 * Math.PI * 13.5

describe('perimeterGeometry', () => {
  it('matches a hand calculation of the rounded-rectangle perimeter', () => {
    expect(perimeterGeometry(SIZE, 1).perimeter).toBeCloseTo(HAND_CALCULATED_PERIMETER, 6)
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
    // Inset by half the frame thickness (field.frame is 5) on every side, so
    // the traced rectangle sits inside the measured 300x200 box.
    expect(track.props.x).toBeCloseTo(2.5, 6)
    expect(track.props.y).toBeCloseTo(2.5, 6)
    expect(track.props.width).toBeCloseTo(295, 6)
    expect(track.props.height).toBeCloseTo(195, 6)
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
    expect(track.props.strokeWidth).toBe(field.frame)
    // A scalar `strokeDasharray` is lowered to a two-element array (an odd-
    // length dash list is duplicated onto itself so it still alternates).
    expect(track.props.strokeDasharray).toHaveLength(2)
    expect(track.props.strokeDasharray[0]).toBeCloseTo(perimeter, 6)
    expect(track.props.strokeDasharray[1]).toBeCloseTo(perimeter, 6)
    expect(track.props.strokeDashoffset).toBeCloseTo(strokeDashoffset, 6)
  })
})
