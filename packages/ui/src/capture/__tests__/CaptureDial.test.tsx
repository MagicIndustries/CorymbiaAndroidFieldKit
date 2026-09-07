import React from 'react'
import { AccessibilityInfo, Animated, processColor, Text } from 'react-native'
import { act, render, screen } from '@testing-library/react-native'
import type { ReactTestRendererNode } from 'react-test-renderer'
import { darkTheme } from '@corymbia/tokens'
import { ThemeProvider } from '../../theme'
import { CaptureDial } from '../CaptureDial'
import { OUTER_RADIUS_PX, TARGET_RADIUS_PX, radiusForMetres, ringDash } from '../dialGeometry'

const renderDial = (props: {
  grade: 'good' | 'fair' | 'poor'
  accuracyM: number
  remaining?: number
  locked?: boolean
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
    const testID = n.props['testID']
    if (typeof testID === 'string' && targets.has(testID)) {
      order.push(testID)
    }
    walk(n.children)
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
          <Text testID="dial-readout">12 m</Text>
        </CaptureDial>
      </ThemeProvider>,
    )
    expect(screen.getByTestId('dial-readout')).toHaveTextContent('12 m')
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

describe('CaptureDial the lock (spec §9.2.1)', () => {
  it('renders the crosshair in textDim while unlocked, even when a lock prop is explicitly false', async () => {
    await renderDial({ grade: 'good', accuracyM: 3, locked: false })
    const horizontal = screen.getByTestId('dial-crosshair-horizontal')
    expect(horizontal.props.stroke).toEqual({
      type: 0,
      payload: processColor(darkTheme.colors.textDim),
    })
  })

  it('lights the crosshair in the grade colour once locked', async () => {
    await renderDial({ grade: 'good', accuracyM: 1, locked: true })
    const horizontal = screen.getByTestId('dial-crosshair-horizontal')
    const vertical = screen.getByTestId('dial-crosshair-vertical')
    expect(horizontal.props.stroke).toEqual({
      type: 0,
      payload: processColor(darkTheme.colors.statusGood),
    })
    expect(vertical.props.stroke).toEqual({
      type: 0,
      payload: processColor(darkTheme.colors.statusGood),
    })
  })

  it('lights the crosshair for a fair fix too, not just good', async () => {
    await renderDial({ grade: 'fair', accuracyM: 1, locked: true })
    const horizontal = screen.getByTestId('dial-crosshair-horizontal')
    expect(horizontal.props.stroke).toEqual({
      type: 0,
      payload: processColor(darkTheme.colors.statusFair),
    })
  })

  // The exact figures — 0.15/0.45 fill opacity, 1.75/4 outline weight — are
  // spec §9.2.1's own numbers, settled by eye against an animated mockup and
  // strengthened twice on review. They are asserted as literals rather than
  // via any shared constant, the same reasoning dialGeometry.test.ts uses
  // for its own anchor points: a test that imported the same constant the
  // component uses to draw would pass no matter what that constant held.
  it('keeps the accuracy circle soft — a low fill opacity and a thin outline — while unlocked', async () => {
    await renderDial({ grade: 'good', accuracyM: 7 })
    const accuracy = screen.getByTestId('dial-accuracy')
    expect(accuracy.props.fillOpacity).toBeCloseTo(0.15, 5)
    expect(accuracy.props.strokeWidth).toBeCloseTo(1.75, 5)
  })

  it('fills and firms the accuracy circle once locked — a definite object, not a soft region', async () => {
    // Reduced motion renders the locked *state* with no animation to wait
    // out (spec §9.2.2), which is what makes this assertion deterministic
    // under Jest rather than dependent on animation frames never advancing.
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true)
    await renderDial({ grade: 'good', accuracyM: 1, locked: true })
    await screen.findByTestId('dial-accuracy')
    const accuracy = screen.getByTestId('dial-accuracy')
    expect(accuracy.props.fillOpacity).toBeCloseTo(0.45, 5)
    expect(accuracy.props.strokeWidth).toBeCloseTo(4, 5)
  })

  it('renders no ripple while not locked', async () => {
    await renderDial({ grade: 'good', accuracyM: 7 })
    expect(screen.queryByTestId('dial-ripple-1')).toBeNull()
    expect(screen.queryByTestId('dial-ripple-2')).toBeNull()
  })

  it('renders no ripple when the dial mounts already locked', async () => {
    await renderDial({ grade: 'good', accuracyM: 1, locked: true })
    expect(screen.queryByTestId('dial-ripple-1')).toBeNull()
    expect(screen.queryByTestId('dial-ripple-2')).toBeNull()
  })

  /**
   * DOCTRINE RULE 9: THE LOCK MUST NOT BE CARRIED BY COLOUR OR MOTION ALONE.
   *
   * The screen adds `GOOD FIX · LOCKED ON` in the next task, and it already
   * holds `locked` itself — it computed it to pass down as this very prop.
   * What this component still owes doctrine rule 9 on its own is a fact
   * about the lock that survives independently of this component's own
   * colour and motion: `accessibilityState.selected`, readable off the root
   * view without inspecting a stroke colour or waiting out an animation.
   */
  it('exposes the lock on the dial itself as a plain fact, not only through colour', async () => {
    await renderDial({ grade: 'good', accuracyM: 1, locked: true })
    expect(screen.getByTestId('capture-dial').props.accessibilityState).toEqual({ selected: true })
  })

  it('exposes not-locked the same way', async () => {
    await renderDial({ grade: 'good', accuracyM: 7 })
    expect(screen.getByTestId('capture-dial').props.accessibilityState).toEqual({ selected: false })
  })
})

describe('CaptureDial the lock: reduced motion (spec §9.2.2)', () => {
  // "The setting means 'do not animate at me unbidden'... Motion that is
  // the direct result of something she did... is a response to a request."
  // But the lock's *ripple* is pure emphasis on top of a state already
  // fully conveyed by fill, outline and crosshair colour — so §9.2.2 is
  // read here as: render the locked state, run no ripple, when reduced
  // motion is on. This is the branch Step 5's deliberate-breakage proof
  // targets (see the task report).
  it('renders the locked state with no ripple when reduced motion is on', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true)
    await renderDial({ grade: 'good', accuracyM: 1, locked: true })
    await screen.findByTestId('dial-accuracy')
    const accuracy = screen.getByTestId('dial-accuracy')
    expect(accuracy.props.fillOpacity).toBeCloseTo(0.45, 5)
    expect(accuracy.props.strokeWidth).toBeCloseTo(4, 5)
    expect(screen.queryByTestId('dial-ripple-1')).toBeNull()
    expect(screen.queryByTestId('dial-ripple-2')).toBeNull()
  })

  it('renders the locked state with no ripple while reduced motion is still unresolved', async () => {
    // No mock: `isReduceMotionEnabled()` never answers in this headless
    // environment, so `reduceMotion` stays `null` — "not yet known" is
    // treated the same as "on" (see the component's own doc comment).
    await renderDial({ grade: 'good', accuracyM: 1, locked: true })
    const accuracy = screen.getByTestId('dial-accuracy')
    expect(accuracy.props.fillOpacity).toBeCloseTo(0.45, 5)
    expect(screen.queryByTestId('dial-ripple-1')).toBeNull()
  })
})

describe('CaptureDial the lock: the ripple actually starts (and does not replay)', () => {
  // Fake timers make "started" provable the same way TrafficLightFrame.tsx
  // proves its pulse loop starts: `Animated.parallel` is spied on directly,
  // which records every construction attempt regardless of what later
  // happens to it. This is the fix for the exact trap the task brief warns
  // about — a timer count reaching zero cannot tell "never started" apart
  // from "started, then finished" (both read back as zero), so nothing
  // below asserts on a timer count.
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] })
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('starts the ripple on a genuine transition into lock, with motion allowed', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false)
    const parallelSpy = jest.spyOn(Animated, 'parallel')
    const { rerender } = await renderDial({ grade: 'good', accuracyM: 7 })
    await screen.findByTestId('capture-dial')
    await act(async () => {
      jest.advanceTimersByTime(0)
    })
    expect(parallelSpy).not.toHaveBeenCalled()

    await rerender(
      <ThemeProvider>
        <CaptureDial grade="good" accuracyM={1} locked />
      </ThemeProvider>,
    )
    expect(parallelSpy).toHaveBeenCalledTimes(1)
  })

  it('never starts the ripple when the dial mounts already locked', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false)
    const parallelSpy = jest.spyOn(Animated, 'parallel')
    await renderDial({ grade: 'good', accuracyM: 1, locked: true })
    await screen.findByTestId('capture-dial')
    await act(async () => {
      jest.advanceTimersByTime(0)
    })
    expect(parallelSpy).not.toHaveBeenCalled()
  })

  it('does not replay the ripple on a redundant re-render that is still locked', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false)
    const parallelSpy = jest.spyOn(Animated, 'parallel')
    const { rerender } = await renderDial({ grade: 'good', accuracyM: 7 })
    await screen.findByTestId('capture-dial')

    await rerender(
      <ThemeProvider>
        <CaptureDial grade="good" accuracyM={1} locked />
      </ThemeProvider>,
    )
    expect(parallelSpy).toHaveBeenCalledTimes(1)

    await rerender(
      <ThemeProvider>
        <CaptureDial grade="good" accuracyM={1} locked />
      </ThemeProvider>,
    )
    expect(parallelSpy).toHaveBeenCalledTimes(1)
  })

  it('starts nothing new once lock is lost, and replays on a subsequent re-lock', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false)
    const parallelSpy = jest.spyOn(Animated, 'parallel')
    const { rerender } = await renderDial({ grade: 'good', accuracyM: 7 })
    await screen.findByTestId('capture-dial')

    await rerender(
      <ThemeProvider>
        <CaptureDial grade="good" accuracyM={1} locked />
      </ThemeProvider>,
    )
    expect(parallelSpy).toHaveBeenCalledTimes(1)

    await rerender(
      <ThemeProvider>
        <CaptureDial grade="good" accuracyM={7} locked={false} />
      </ThemeProvider>,
    )
    expect(parallelSpy).toHaveBeenCalledTimes(1)

    await rerender(
      <ThemeProvider>
        <CaptureDial grade="good" accuracyM={1} locked />
      </ThemeProvider>,
    )
    expect(parallelSpy).toHaveBeenCalledTimes(2)
  })
})
