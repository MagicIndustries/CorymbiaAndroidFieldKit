import React from 'react'
import { act, render, screen } from '@testing-library/react-native'
import { darkTheme } from '@corymbia/tokens'
import { CaptureFramePerimeter, perimeterGeometry } from '../CaptureFramePerimeter'

// `colour` takes a resolved colour value, same as the border it must always
// agree with (see TrafficLightFrame). A token-derived value here, never a
// raw hex literal — the same architectural rule this component's colour
// prop exists to honour applies to the tests exercising it too.
const COLOUR = darkTheme.colors.statusGood

// A 300x200 measured box, inset by field.frame (5) so the traced rectangle
// is 295x195, with a corner radius capped at radii.xl (16) — well under half
// of either side, so all four corners use the full 16.
//
// Hand calculation: perimeter = straight runs + one full circle of corner
// arcs = 2*(295-32) + 2*(195-32) + 2*pi*16
//                    = 2*263 + 2*163 + 32*pi
//                    = 526 + 326 + 100.530964...
//                    = 952.530964...
const SIZE = { width: 300, height: 200 }
const HAND_CALCULATED_PERIMETER = 2 * (295 - 32) + 2 * (195 - 32) + 2 * Math.PI * 16

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
})
