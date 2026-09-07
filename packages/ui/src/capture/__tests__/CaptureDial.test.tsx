import React from 'react'
import { processColor } from 'react-native'
import { render, screen } from '@testing-library/react-native'
import type { ReactTestRendererJSON, ReactTestRendererNode } from 'react-test-renderer'
import { darkTheme } from '@corymbia/tokens'
import { ThemeProvider } from '../../theme'
import { CaptureDial } from '../CaptureDial'
import { OUTER_RADIUS_PX, TARGET_RADIUS_PX, radiusForMetres, ringDash } from '../dialGeometry'

const renderDial = (props: {
  grade: 'good' | 'fair' | 'poor'
  accuracyM: number
  remaining?: number
}) =>
  render(
    <ThemeProvider>
      <CaptureDial {...props} />
    </ThemeProvider>,
  )

// The four layers a real capture draws, in the order layer order requires
// (spec: ring track, ring progress, accuracy circle, then the crosshair on
// top). Walked out of the rendered JSON tree in depth-first (paint) order,
// which is the same order `collectDialLayerOrder` below returns them in.
const LAYER_TEST_IDS = ['dial-ring-track', 'dial-ring-progress', 'dial-accuracy', 'dial-crosshair']

function collectDialLayerOrder(node: ReactTestRendererNode | ReactTestRendererNode[] | null): string[] {
  const order: string[] = []
  const targets = new Set(LAYER_TEST_IDS)

  function walk(n: ReactTestRendererNode | ReactTestRendererNode[] | null) {
    if (n == null) return
    if (Array.isArray(n)) {
      n.forEach(walk)
      return
    }
    if (typeof n === 'string') return
    const json = n as ReactTestRendererJSON
    const testID = json.props['testID']
    if (typeof testID === 'string' && targets.has(testID)) {
      order.push(testID)
    }
    walk(json.children)
  }

  walk(node)
  return order
}

describe('CaptureDial', () => {
  it('says a good fix in a word, so colour never carries the grade alone', async () => {
    await renderDial({ grade: 'good', accuracyM: 3 })
    expect(screen.getByText('GOOD FIX')).toBeTruthy()
  })

  it('says a fair fix too', async () => {
    await renderDial({ grade: 'fair', accuracyM: 3 })
    expect(screen.getByText('FAIR FIX')).toBeTruthy()
  })

  it('says a poor fix too', async () => {
    await renderDial({ grade: 'poor', accuracyM: 3 })
    expect(screen.getByText('POOR FIX')).toBeTruthy()
  })

  it('carries the status colour for the grade on both the ring stroke and the accuracy circle', async () => {
    await renderDial({ grade: 'good', accuracyM: 3, remaining: 0.5 })
    const progress = screen.getByTestId('dial-ring-progress')
    const accuracy = screen.getByTestId('dial-accuracy')
    expect(progress.props.stroke).toEqual({
      type: 0,
      payload: processColor(darkTheme.colors.statusGood),
    })
    expect(accuracy.props.stroke).toEqual({
      type: 0,
      payload: processColor(darkTheme.colors.statusGood),
    })
    expect(accuracy.props.fill).toEqual({
      type: 0,
      payload: processColor(darkTheme.colors.statusGood),
    })
  })

  // Only 'good' was checked above; a mapping bug on the middle grade would
  // pass unnoticed without this one (the same gap TrafficLightFrame's own
  // tests were once caught by).
  it('carries the status colour for a fair fix too', async () => {
    await renderDial({ grade: 'fair', accuracyM: 3, remaining: 0.5 })
    const progress = screen.getByTestId('dial-ring-progress')
    expect(progress.props.stroke).toEqual({
      type: 0,
      payload: processColor(darkTheme.colors.statusFair),
    })
  })

  it("draws the accuracy circle at radiusForMetres's own radius for the accuracy given", async () => {
    await renderDial({ grade: 'good', accuracyM: 4.2 })
    expect(screen.getByTestId('dial-accuracy').props.r).toBeCloseTo(radiusForMetres(4.2), 6)
  })

  // 0.25 is deliberate, not an arbitrary choice: react-native-svg folds a
  // strokeDashoffset of exactly 0 to null on the native host props it hands
  // to the renderer (extractStroke.js: `strokeDasharray && strokeDashoffset`
  // is falsy whenever strokeDashoffset is 0), so an assertion at a full or
  // empty ring would read nothing back. 0.25 is known to round-trip a
  // non-zero offset intact (see CaptureFramePerimeter.test.tsx, which hit
  // this first).
  it("wires the ring's strokeDashoffset to ringDash's own value for the fraction given", async () => {
    await renderDial({ grade: 'good', accuracyM: 3, remaining: 0.25 })
    const { dasharray, dashoffset } = ringDash(OUTER_RADIUS_PX, 0.25)
    const progress = screen.getByTestId('dial-ring-progress')
    // A scalar strokeDasharray is lowered to a two-element array (an
    // odd-length dash list duplicated onto itself so it still alternates) —
    // same lowering CaptureFramePerimeter's own ring goes through.
    expect(progress.props.strokeDasharray).toHaveLength(2)
    expect(progress.props.strokeDasharray[0]).toBeCloseTo(dasharray, 5)
    expect(progress.props.strokeDasharray[1]).toBeCloseTo(dasharray, 5)
    expect(progress.props.strokeDashoffset).toBeCloseTo(dashoffset, 5)
  })

  it('renders no progress stroke when remaining is absent, only the track', async () => {
    await renderDial({ grade: 'good', accuracyM: 3 })
    expect(screen.getByTestId('dial-ring-track')).toBeTruthy()
    expect(screen.queryByTestId('dial-ring-progress')).toBeNull()
  })

  // A countdown at its very last tick is still a countdown: `remaining: 0`
  // must still render a (fully withdrawn) progress stroke, not be treated
  // the same as "no countdown running" by a truthiness check.
  it('still renders a progress stroke at the instant the wait reaches zero', async () => {
    await renderDial({ grade: 'good', accuracyM: 3, remaining: 0 })
    expect(screen.getByTestId('dial-ring-progress')).toBeTruthy()
  })

  it('renders the crosshair sized to TARGET_RADIUS_PX', async () => {
    await renderDial({ grade: 'good', accuracyM: 3 })
    const horizontal = screen.getByTestId('dial-crosshair-horizontal')
    const vertical = screen.getByTestId('dial-crosshair-vertical')
    expect(horizontal.props.x2 - horizontal.props.x1).toBeCloseTo(2 * TARGET_RADIUS_PX, 6)
    expect(vertical.props.y2 - vertical.props.y1).toBeCloseTo(2 * TARGET_RADIUS_PX, 6)
  })

  it('renders the crosshair in textDim while unlit', async () => {
    await renderDial({ grade: 'good', accuracyM: 3 })
    const horizontal = screen.getByTestId('dial-crosshair-horizontal')
    expect(horizontal.props.stroke).toEqual({
      type: 0,
      payload: processColor(darkTheme.colors.textDim),
    })
  })

  it('renders what it encloses, because the dial can carry a readout inside it', async () => {
    await render(
      <ThemeProvider>
        <CaptureDial grade="good" accuracyM={3}>
          <></>
        </CaptureDial>
      </ThemeProvider>,
    )
    expect(screen.getByTestId('capture-dial')).toBeTruthy()
  })

  /**
   * THE CROSSHAIR MUST NEVER BE HIDDEN UNDER THE ACCURACY CIRCLE.
   *
   * The whole design is the circle arriving *on* the target — a target
   * hidden underneath the circle that is supposed to be landing on it says
   * nothing. Painted last, the crosshair sits on top of every other layer
   * regardless of the accuracy circle's own radius or opacity, so this is
   * asserted directly on draw order rather than inferred from the geometry
   * being merely correct (see dialGeometry's own note on that failure
   * mode).
   */
  it('draws in the required layer order: track, progress, accuracy circle, then the crosshair on top', async () => {
    await renderDial({ grade: 'good', accuracyM: 3, remaining: 0.5 })
    expect(collectDialLayerOrder(screen.toJSON())).toEqual(LAYER_TEST_IDS)
  })

  it('keeps that same order even with no countdown running, minus the progress layer', async () => {
    await renderDial({ grade: 'good', accuracyM: 3 })
    expect(collectDialLayerOrder(screen.toJSON())).toEqual([
      'dial-ring-track',
      'dial-accuracy',
      'dial-crosshair',
    ])
  })
})
