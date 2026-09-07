import React from 'react'
import { AccessibilityInfo, Animated, processColor, Text } from 'react-native'
import { act, render, screen } from '@testing-library/react-native'
import type { ReactTestRendererNode } from 'react-test-renderer'
import { darkTheme } from '@corymbia/tokens'
import { ThemeProvider } from '../../theme'
import { CaptureDial } from '../CaptureDial'
import {
  MIN_RADIUS_PX,
  OUTER_RADIUS_PX,
  TARGET_RADIUS_PX,
  radiusForMetres,
  ringDash,
} from '../dialGeometry'

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

// The same layers, but for the span the lock's ripple is actually playing
// (spec §9.2.1): the ripple's two rings sit between the accuracy circle and
// the crosshair. This is the order the doc comment on `CaptureDial` claims —
// "painting it last... is what guarantees" the crosshair is never obscured
// by the ripple — and which nothing checked before this task.
const LAYER_TEST_IDS_WITH_RIPPLE = [
  'dial-ring-track',
  'dial-ring-progress',
  'dial-accuracy',
  'dial-ripple-1',
  'dial-ripple-2',
  'dial-crosshair',
]

function collectDialLayerOrder(
  node: ReactTestRendererNode | ReactTestRendererNode[] | null,
  targetIds: string[] = LAYER_TEST_IDS,
): string[] {
  const order: string[] = []
  const targets = new Set(targetIds)

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

describe('CaptureDial the poor-fix dashed outline (doctrine rule 9, spec §9.2.2)', () => {
  // 8/5 are field.dialAccuracyOutlineDash/DashGap (packages/tokens/src/scales.ts),
  // asserted here as literals rather than by importing the token — the same
  // reasoning the lock's fill/outline test above gives: a test that imported
  // the same constant the component draws with would pass no matter what
  // that constant held.
  it('dashes the accuracy outline on a poor fix, and no other grade', async () => {
    await renderDial({ grade: 'poor', accuracyM: 3 })
    expect(screen.getByTestId('dial-accuracy').props.strokeDasharray).toEqual([8, 5])
  })

  it('draws a solid outline on a good fix', async () => {
    await renderDial({ grade: 'good', accuracyM: 3 })
    expect(screen.getByTestId('dial-accuracy').props.strokeDasharray).toBeUndefined()
  })

  it('draws a solid outline on a fair fix', async () => {
    await renderDial({ grade: 'fair', accuracyM: 3 })
    expect(screen.getByTestId('dial-accuracy').props.strokeDasharray).toBeUndefined()
  })

  /**
   * A poor fix never actually locks — by definition it is the fix that
   * stops short of the crosshair rather than converging onto it — but
   * `grade` and `locked` are two independent props this component is simply
   * told, not values it derives from each other. Nothing stops a caller (or
   * this test) handing it both, so the treatment must not leave that
   * combination looking like a rendering bug: a dashed outline on a circle
   * simultaneously filled and firmed to the *locked* weight would read as
   * neither "uncertain" nor "definite" cleanly. Reduced motion is mocked so
   * the locked state renders immediately, deterministically, with no
   * animation to wait out (same pattern the lock's own fill/outline test
   * above uses).
   */
  it('drops the dash rather than leaving a dashed-and-locked hybrid, if a poor fix is ever reported locked', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true)
    await renderDial({ grade: 'poor', accuracyM: 1, locked: true })
    await screen.findByTestId('dial-accuracy')
    const accuracy = screen.getByTestId('dial-accuracy')
    expect(accuracy.props.strokeDasharray).toBeUndefined()
    // The locked visual still proceeds normally otherwise: firm outline,
    // deep fill — nothing about dropping the dash blocks the rest of the
    // lock treatment from rendering.
    expect(accuracy.props.strokeWidth).toBeCloseTo(4, 5)
    expect(accuracy.props.fillOpacity).toBeCloseTo(0.45, 5)
  })

  it('brings the dash back the moment lock is lost again', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true)
    const { rerender } = await renderDial({ grade: 'poor', accuracyM: 1, locked: true })
    await screen.findByTestId('dial-accuracy')
    expect(screen.getByTestId('dial-accuracy').props.strokeDasharray).toBeUndefined()

    await rerender(
      <ThemeProvider>
        <CaptureDial grade="poor" accuracyM={7} locked={false} />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('dial-accuracy').props.strokeDasharray).toEqual([8, 5])
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
   * colour and motion: `accessibilityValue.text`, readable off the root
   * view without inspecting a stroke colour or waiting out an animation.
   * `accessibilityValue` rather than `accessibilityState.selected` (review
   * fix, task 3): "selected" is a chosen-from-a-group semantic that does not
   * actually describe a fix converging, where a literal text fact does.
   */
  it('exposes the lock on the dial itself as a plain fact, not only through colour', async () => {
    await renderDial({ grade: 'good', accuracyM: 1, locked: true })
    expect(screen.getByTestId('capture-dial').props.accessibilityValue).toEqual({
      text: 'Locked on',
    })
  })

  it('exposes not-locked the same way', async () => {
    await renderDial({ grade: 'good', accuracyM: 7 })
    expect(screen.getByTestId('capture-dial').props.accessibilityValue).toEqual({
      text: 'Not locked',
    })
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

  /**
   * THE RIPPLE MUST NEVER PAINT OVER THE CROSSHAIR EITHER.
   *
   * The component's own doc comment claims painting the crosshair last
   * "guarantees" it survives the ripple expanding past it, but nothing
   * checked that claim before this task — every layer-order test elsewhere
   * in this file renders with no ripple in the tree at all. This test
   * reaches a render where the ripple is actually active (a genuine
   * unlocked→locked transition, motion allowed, asserted immediately after
   * the rerender that starts it, while `rippling` is still true) and checks
   * the full six-layer order including both ripple rings.
   */
  it('keeps the ripple beneath the crosshair while the ripple is actually playing', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false)
    const { rerender } = await renderDial({ grade: 'good', accuracyM: 7, remaining: 0.5 })
    await screen.findByTestId('capture-dial')

    await rerender(
      <ThemeProvider>
        <CaptureDial grade="good" accuracyM={1} remaining={0.5} locked />
      </ThemeProvider>,
    )

    expect(screen.getByTestId('dial-ripple-1')).toBeTruthy()
    expect(screen.getByTestId('dial-ripple-2')).toBeTruthy()
    expect(collectDialLayerOrder(screen.toJSON(), LAYER_TEST_IDS_WITH_RIPPLE)).toEqual(
      LAYER_TEST_IDS_WITH_RIPPLE,
    )
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

describe('CaptureDial the lock: the snap never draws a negative radius', () => {
  // Same fake-timer setup as the ripple-start block above, for the same
  // reason: the snap plays out over real animation frames (100ms in, 150ms
  // out), and only fake timers make sampling mid-flight deterministic under
  // Jest.
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] })
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  /**
   * THE SNAP MUST NEVER PUSH THE ACCURACY CIRCLE'S RADIUS BELOW MIN_RADIUS_PX.
   *
   * `radiusForMetres` clamps at `MIN_RADIUS_PX` so the SVG this feeds is
   * never handed a negative or NaN radius (dialGeometry.ts's own stated
   * discipline). The lock's snap adds a further, animated offset on top of
   * that already-clamped radius — unclamped, `LOCK_SNAP_PX` (4.5) is bigger
   * than the floor itself (4), so a fix locking at or near that floor used
   * to be able to swing the drawn radius negative mid-snap.
   *
   * 0.5 m is comfortably under the ~0.94 m accuracy at which
   * `radiusForMetres` itself starts clamping to `MIN_RADIUS_PX` — so
   * `radiusForMetres(0.5) === MIN_RADIUS_PX` exactly, leaving zero headroom
   * for the snap. Sampling `dial-accuracy`'s own `r` prop at every 25ms
   * across the full 250ms settle (rather than only at a single guessed
   * instant) is what makes this a proof the radius never dips below the
   * floor at any point during the snap-in *or* the ease-out, not just a
   * spot check of one frame.
   */
  it('clamps the snap so the accuracy circle never draws a negative radius at the measured floor', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false)
    const { rerender } = await renderDial({ grade: 'good', accuracyM: 7 })
    await screen.findByTestId('capture-dial')
    await act(async () => {
      jest.advanceTimersByTime(0)
    })

    expect(radiusForMetres(0.5)).toBe(MIN_RADIUS_PX)

    await rerender(
      <ThemeProvider>
        <CaptureDial grade="good" accuracyM={0.5} locked />
      </ThemeProvider>,
    )

    let minR = Number.POSITIVE_INFINITY
    for (let sample = 0; sample < 11; sample++) {
      await act(async () => {
        jest.advanceTimersByTime(25)
      })
      const r = screen.getByTestId('dial-accuracy').props.r
      minR = Math.min(minR, r)
    }

    expect(minR).toBeGreaterThanOrEqual(MIN_RADIUS_PX)
    // Zero headroom at this accuracy means the clamp does not just keep the
    // radius non-negative, it holds the circle exactly at the floor rather
    // than letting the snap move it at all — the scaled-by-headroom
    // behaviour the component's own comment describes, not merely a
    // last-resort floor.
    expect(minR).toBeCloseTo(MIN_RADIUS_PX, 5)
  })
})
