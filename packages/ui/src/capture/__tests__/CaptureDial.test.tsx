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
  settled?: boolean
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

// And for a settled completion, whose companion ring sits between the
// accuracy circle and the crosshair for the same reason the ripple does: the
// crosshair is what the ring is measured against, so it must never be under
// it.
const LAYER_TEST_IDS_WITH_SETTLED = [
  'dial-ring-track',
  'dial-ring-progress',
  'dial-accuracy',
  'dial-settled-ring',
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
  // pass unnoticed without this one (the same gap the deleted
  // TrafficLightFrame's own tests were once caught by).
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
  // non-zero offset intact — the deleted CaptureFramePerimeter's own tests
  // hit this first, and the lowering is react-native-svg's, not that
  // component's, so it still applies here.
  it("wires the ring's strokeDashoffset to ringDash's own value for the fraction given", async () => {
    await renderDial({ grade: 'good', accuracyM: 3, remaining: 0.25 })
    const { dasharray, dashoffset } = ringDash(OUTER_RADIUS_PX, 0.25)
    const progress = screen.getByTestId('dial-ring-progress')
    // A scalar strokeDasharray is lowered to a two-element array (an
    // odd-length dash list duplicated onto itself so it still alternates) —
    // same lowering the deleted CaptureFramePerimeter's ring went through.
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

  it('centres the crosshair on the target the accuracy circle closes onto', async () => {
    await renderDial({ grade: 'good', accuracyM: 3 })
    const horizontal = screen.getByTestId('dial-crosshair-horizontal')
    const vertical = screen.getByTestId('dial-crosshair-vertical')
    // The arms may run past the ring (below), but the point they mark is
    // still the target: symmetric about the centre, and equal in both axes.
    expect((horizontal.props.x1 + horizontal.props.x2) / 2).toBeCloseTo(vertical.props.x1, 6)
    expect((vertical.props.y1 + vertical.props.y2) / 2).toBeCloseTo(horizontal.props.y1, 6)
    expect(vertical.props.y2 - vertical.props.y1).toBeCloseTo(
      horizontal.props.x2 - horizontal.props.x1,
      6,
    )
  })

  it('runs each crosshair arm past the ring, so it reads as a reticule and not a cross in a circle', async () => {
    // The owner's judgement on the device, and the reason the arms are no
    // longer `TARGET_RADIUS_PX` long: arms stopping exactly on the ring read
    // as two shapes that happen to touch. Crossing it fuses them into one mark.
    //
    // Measured against the ring's *own rendered* radius rather than an
    // imported constant, so shortening the arms back to the ring — or growing
    // the ring out to meet them — fails here.
    await renderDial({ grade: 'good', accuracyM: 3 })
    const ring = screen.getByTestId('dial-crosshair-ring')
    const horizontal = screen.getByTestId('dial-crosshair-horizontal')
    const vertical = screen.getByTestId('dial-crosshair-vertical')

    const overshoot = (horizontal.props.x2 - horizontal.props.x1) / 2 - ring.props.r
    expect(overshoot).toBeCloseTo(6, 6)
    expect((vertical.props.y2 - vertical.props.y1) / 2 - ring.props.r).toBeCloseTo(6, 6)

    // Small enough to stay a tick breaking the ring's edge rather than a
    // second cross competing with the circle closing onto it.
    expect(overshoot).toBeLessThan(ring.props.r / 2)
  })

  it('rings the crosshair, so it reads as a reticule rather than a tappable plus', async () => {
    // Judged on the device: a bare cross in the middle of a screen reads as
    // "add" and invites a tap it will never answer. The ring is what says
    // target, and it must sit exactly on the radius the circle closes onto.
    await renderDial({ grade: 'good', accuracyM: 3 })
    const ring = screen.getByTestId('dial-crosshair-ring')
    expect(ring.props.r).toBeCloseTo(TARGET_RADIUS_PX, 6)
  })

  it('renders the whole crosshair, ring included, in textDim while unlit', async () => {
    await renderDial({ grade: 'good', accuracyM: 3 })
    for (const part of ['dial-crosshair-ring', 'dial-crosshair-horizontal', 'dial-crosshair-vertical']) {
      expect(screen.getByTestId(part).props.stroke).toEqual({
        type: 0,
        payload: processColor(darkTheme.colors.textDim),
      })
    }
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

  /**
   * The ring is part of the crosshair, so it lights with it.
   *
   * This assertion used to be made on an *unlocked* dial, against `textDim` —
   * which is the ring's resting colour and would still hold with the ring's
   * stroke hardcoded to `textDim` and the crosshair never lighting again. The
   * three parts are checked together here, on the locked render, because
   * lighting two of the three is the regression a per-part test invites.
   */
  it('lights the whole crosshair, ring included, in the grade colour once locked', async () => {
    await renderDial({ grade: 'good', accuracyM: 1, locked: true })
    for (const part of ['dial-crosshair-ring', 'dial-crosshair-horizontal', 'dial-crosshair-vertical']) {
      expect(screen.getByTestId(part).props.stroke).toEqual({
        type: 0,
        payload: processColor(darkTheme.colors.statusGood),
      })
    }
  })

  /**
   * THE CROSSHAIR THICKENS — the fourth of the four parts spec §9.2.1 lists
   * for the lock, and the only one nothing asserted a `strokeWidth` for.
   *
   * 3 and 4 are `field.countdown` and `field.dialAccuracyOutlineLocked`
   * (packages/tokens/src/scales.ts), written as literals for the same reason
   * every other number in this file is: a test that imported the constant the
   * component draws with would pass whatever that constant held — including a
   * pair that are equal, which is a crosshair that never thickens at all.
   * Asserted on all three parts, since they share one interpolated value and
   * a regression that split them apart is exactly what this catches.
   */
  it('thickens the crosshair as it lights, which is the fourth part of the lock', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true)
    const parts = ['dial-crosshair-ring', 'dial-crosshair-horizontal', 'dial-crosshair-vertical']

    const { rerender } = await renderDial({ grade: 'good', accuracyM: 7, locked: false })
    await screen.findByTestId('dial-accuracy')
    for (const part of parts) {
      expect(screen.getByTestId(part).props.strokeWidth).toBeCloseTo(3, 5)
    }

    await rerender(
      <ThemeProvider>
        <CaptureDial grade="good" accuracyM={1} locked />
      </ThemeProvider>,
    )
    for (const part of parts) {
      expect(screen.getByTestId(part).props.strokeWidth).toBeCloseTo(4, 5)
    }
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

  /**
   * Motion is explicitly ALLOWED here, and that is the whole point.
   *
   * This test used to render with no reduced-motion mock at all, which left
   * the `reduceMotion !== false` branch — "on, or not yet known: run nothing"
   * — as the thing keeping the ripple out of the tree. The `wasLocked` guard
   * this test is named for was never reached, so deleting it left this green.
   * With motion positively allowed, `wasLocked` is the only thing between a
   * dial that mounts locked and a ripple it never earned.
   */
  it('renders no ripple when the dial mounts already locked', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false)
    await renderDial({ grade: 'good', accuracyM: 1, locked: true })
    await screen.findByTestId('dial-accuracy')
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
    // A promise that never settles, so `reduceMotion` genuinely stays `null`
    // — "not yet known", which the component treats the same as "on" (see its
    // own doc comment). This has to be mocked rather than left to the
    // environment: `AccessibilityInfo.isReduceMotionEnabled()` resolves
    // `false` under jest-expo, so an unmocked render exercises the
    // motion-allowed branch instead, and this test was named for a state it
    // never reached. (Before `restoreMocks` was turned on in jest.config.js it
    // was worse still — it inherited a leaked `mockResolvedValue(true)` from
    // an earlier test and exercised the reduced-motion-ON branch, which the
    // test directly above already covers.)
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockReturnValue(new Promise<boolean>(() => undefined))
    await renderDial({ grade: 'good', accuracyM: 1, locked: true })
    const accuracy = screen.getByTestId('dial-accuracy')
    expect(accuracy.props.fillOpacity).toBeCloseTo(0.45, 5)
    expect(screen.queryByTestId('dial-ripple-1')).toBeNull()
    expect(screen.queryByTestId('dial-ripple-2')).toBeNull()
  })
})

describe('CaptureDial the lock: the ripple actually starts (and does not replay)', () => {
  // Fake timers make "started" provable the way the deleted
  // TrafficLightFrame proved its pulse loop started: `Animated.parallel` is
  // spied on directly,
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

  /**
   * AND THE SNAP MUST ACTUALLY HAPPEN WHERE THERE IS ROOM FOR IT.
   *
   * The test above proves the clamp at an accuracy chosen so the snap's reach
   * is zero *by construction* — `radiusForMetres(0.5)` is already
   * `MIN_RADIUS_PX`, so `snapReachPx` is zero and the circle is expected not
   * to move. That makes it a proof about the clamp and no proof at all about
   * the snap: replacing `snapOffsetPx` with a constant zero, or deleting the
   * `Animated.add` that applies it, passes it unchanged. Spec §9.2.1 lists the
   * snap first among the four parts of the lock, and calls for it to be
   * visible from peripheral vision rather than inferred from a radius.
   *
   * 4.2 m puts the circle at roughly 86 px, far above the floor, so the full
   * `LOCK_SNAP_PX` (4.5) of reach is available — and the assertion is that the
   * drawn radius genuinely dips inside its own resting value during the
   * settle, then comes back to rest on it.
   */
  it('actually snaps inward at an accuracy with room for it, then eases back to rest', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false)
    const { rerender } = await renderDial({ grade: 'good', accuracyM: 7 })
    await screen.findByTestId('capture-dial')
    await act(async () => {
      jest.advanceTimersByTime(0)
    })

    const restingPx = radiusForMetres(4.2)
    // Real headroom, unlike the floor case above — so a snap that never fires
    // is distinguishable from one that fired and was clamped to nothing.
    expect(restingPx - MIN_RADIUS_PX).toBeGreaterThan(4.5)

    await rerender(
      <ThemeProvider>
        <CaptureDial grade="good" accuracyM={4.2} locked />
      </ThemeProvider>,
    )

    let minR = Number.POSITIVE_INFINITY
    for (let sample = 0; sample < 11; sample++) {
      await act(async () => {
        jest.advanceTimersByTime(25)
      })
      const r: unknown = screen.getByTestId('dial-accuracy').props.r
      if (typeof r !== 'number') {
        throw new Error(`Expected dial-accuracy's r to be a number, got ${typeof r}.`)
      }
      minR = Math.min(minR, r)
    }

    // It went inward, by an amount only the snap can produce...
    expect(minR).toBeLessThan(restingPx - 3)
    // ...and no further than the snap's own reach, so this cannot pass on a
    // radius that simply collapsed.
    expect(minR).toBeGreaterThanOrEqual(restingPx - 4.5)
    // And it came back: the snap eases out onto the resting radius rather
    // than leaving the circle parked inside it (spec §9.2.1).
    await act(async () => {
      jest.advanceTimersByTime(500)
    })
    expect(screen.getByTestId('dial-accuracy').props.r).toBeCloseTo(restingPx, 5)
  })
})

/**
 * THE DIAL MUST BOUND ITSELF.
 *
 * Its SVG is `width="100%" height="100%"` against a fixed viewBox, so it has
 * no intrinsic size: dropped into a flex-grown container it takes the whole
 * of it. That shipped to a Samsung S25, where the dial filled the viewport and
 * pushed the accuracy, the verdict and *the only control* off the bottom —
 * no capture could be started at all, so nothing counted down and nothing
 * locked. The reported symptoms ("it went very slowly and never locked") were
 * all this one defect.
 *
 * Asserted here, on the component, rather than only on the screen that places
 * one: a component whose height is whatever its container allows is a trap for
 * every future caller, and both the capture screen and the gallery would
 * otherwise have to re-derive the same square.
 *
 * The cap is asserted as a plain upper bound rather than against
 * `field.dialMax` itself — the same reasoning the lock's own fill/outline
 * tests give: a test that imported the constant the component draws with would
 * pass no matter what that constant held, including a value that fills a
 * phone screen twice over.
 */
describe('CaptureDial bounds its own size', () => {
  it('caps the drawn dial rather than growing to fill whatever contains it', async () => {
    await renderDial({ grade: 'good', accuracyM: 3 })
    const style: unknown = screen.getByTestId('dial-canvas').props.style

    if (typeof style !== 'object' || style === null || Array.isArray(style)) {
      throw new Error(`Expected dial-canvas to carry one style object, got ${typeof style}.`)
    }
    const { maxWidth, aspectRatio } = style as { maxWidth?: unknown; aspectRatio?: unknown }

    // A real, finite cap in dp — not `undefined`, not '100%'.
    expect(typeof maxWidth).toBe('number')
    expect(maxWidth as number).toBeGreaterThan(0)
    // Comfortably inside the 360dp width of the phone this failed on, so the
    // readouts and the 72dp control still have a screen to sit on.
    expect(maxWidth as number).toBeLessThanOrEqual(320)
    // Square, and square without reading a window dimension — only
    // `useLayout` may do that.
    expect(aspectRatio).toBe(1)
  })

  it('still fills anything narrower than the cap, so a small screen is not left with a small dial', async () => {
    await renderDial({ grade: 'good', accuracyM: 3 })
    const style: unknown = screen.getByTestId('dial-canvas').props.style
    expect(style).toMatchObject({ width: '100%' })
  })
})

/**
 * THE SETTLED COMPLETION (spec §9.2.1).
 *
 * The weaker of the two completion levels, and the common one: the crosshair
 * is pinned to this hardware's measured floor and most captures stop improving
 * above it. What settled must NOT do is the thing that would make the picture
 * lie — move the circle onto the crosshair. The radius always means metres
 * (spec §9.2), so the circle stays where its accuracy puts it and a companion
 * ring marks that radius, with the crosshair still visible inside it.
 */
describe('CaptureDial the settled completion (spec §9.2.1)', () => {
  // Well outside the crosshair: `radiusForMetres(4.2)` is comfortably larger
  // than `TARGET_RADIUS_PX`, which is what makes every assertion below about
  // a fix that genuinely stopped short.
  const SETTLED_M = 4.2

  it('leaves the accuracy circle at exactly the radius its accuracy earned', async () => {
    await renderDial({ grade: 'good', accuracyM: SETTLED_M, settled: true })
    expect(radiusForMetres(SETTLED_M)).toBeGreaterThan(TARGET_RADIUS_PX)
    expect(screen.getByTestId('dial-accuracy').props.r).toBeCloseTo(radiusForMetres(SETTLED_M), 6)
  })

  it('marks where the capture got to with a ring at that radius, not at the crosshair', async () => {
    await renderDial({ grade: 'good', accuracyM: SETTLED_M, settled: true })
    const ring = screen.getByTestId('dial-settled-ring')

    // `field.dialSettledGap` is 7 (packages/tokens/src/scales.ts), written as
    // a literal here for the same reason the lock's numbers are: a test that
    // imported it would pass whatever it held, including a gap that put this
    // ring on the crosshair.
    expect(ring.props.r).toBeCloseTo(radiusForMetres(SETTLED_M) + 7, 5)
    // The assertion that actually carries the design: the ring is nowhere
    // near the target it fell short of, and the distance between them is the
    // signal.
    expect(ring.props.r).toBeGreaterThan(TARGET_RADIUS_PX)
  })

  it('leaves the crosshair unlit and inside the ring, showing what was possible', async () => {
    await renderDial({ grade: 'good', accuracyM: SETTLED_M, settled: true })
    const horizontal = screen.getByTestId('dial-crosshair-horizontal')
    // Unlit: the crosshair lighting is the LOCK's, and this capture never
    // reached it.
    expect(horizontal.props.stroke).toEqual({
      type: 0,
      payload: processColor(darkTheme.colors.textDim),
    })
    // And still its own size — the target has not moved to meet the circle
    // any more than the circle moved to meet the target.
    expect(screen.getByTestId('dial-crosshair-ring').props.r).toBeCloseTo(TARGET_RADIUS_PX, 6)

    // The claim in this test's name, which nothing else checks: the whole
    // crosshair, arms included, sits inside the ring marking where the
    // capture actually got to. That containment IS the settled signal — the
    // visible gap between what was reached and what was possible — so an
    // overshoot grown until the arms broke out through the settled ring
    // would destroy it.
    const armEnd = (horizontal.props.x2 - horizontal.props.x1) / 2
    expect(armEnd).toBeLessThan(screen.getByTestId('dial-settled-ring').props.r)
  })

  it('firms the circle, so a finished measurement does not read as one still moving', async () => {
    await renderDial({ grade: 'good', accuracyM: SETTLED_M, settled: true })
    const accuracy = screen.getByTestId('dial-accuracy')
    expect(accuracy.props.fillOpacity).toBeCloseTo(0.45, 5)
    expect(accuracy.props.strokeWidth).toBeCloseTo(4, 5)
  })

  it('runs no ripple, because settled is not the lock', async () => {
    await renderDial({ grade: 'good', accuracyM: SETTLED_M, settled: true })
    expect(screen.queryByTestId('dial-ripple-1')).toBeNull()
    expect(screen.queryByTestId('dial-ripple-2')).toBeNull()
  })

  it('draws no companion ring when nothing has settled', async () => {
    await renderDial({ grade: 'good', accuracyM: SETTLED_M })
    expect(screen.queryByTestId('dial-settled-ring')).toBeNull()
  })

  it('keeps the poor-fix dash, because settled claims no certainty for it to contradict', async () => {
    // A poor fix stopping short of the floor is precisely what settling
    // means, so this combination is the normal case rather than an odd one —
    // and unlike the lock, settled makes no "definite object" claim that a
    // dashed edge would contradict.
    await renderDial({ grade: 'poor', accuracyM: 30, settled: true })
    expect(screen.getByTestId('dial-accuracy').props.strokeDasharray).toEqual([8, 5])
    expect(screen.getByTestId('dial-settled-ring')).toBeTruthy()
  })

  it('exposes the settled level as a plain fact, not only as a ring', async () => {
    // Doctrine rule 9 again: the ring and the colour are not the only
    // channels. A screen reader gets the same fact off the root view.
    await renderDial({ grade: 'good', accuracyM: SETTLED_M, settled: true })
    expect(screen.getByTestId('capture-dial').props.accessibilityValue).toEqual({
      text: 'Settled short of the target',
    })
  })

  it('lets the lock win outright if a caller ever reports both', async () => {
    // Mutually exclusive by construction — a capture cannot have stopped
    // short of the floor and reached it — but they are two independent props
    // this component is simply told. The lock is the stronger claim, and a
    // circle carrying both treatments is a hybrid nothing intends.
    await renderDial({ grade: 'good', accuracyM: 1, settled: true, locked: true })
    expect(screen.queryByTestId('dial-settled-ring')).toBeNull()
    expect(screen.getByTestId('capture-dial').props.accessibilityValue).toEqual({
      text: 'Locked on',
    })
  })

  it('keeps the companion ring beneath the crosshair', async () => {
    await renderDial({ grade: 'good', accuracyM: SETTLED_M, remaining: 0.5, settled: true })
    expect(collectDialLayerOrder(screen.toJSON(), LAYER_TEST_IDS_WITH_SETTLED)).toEqual(
      LAYER_TEST_IDS_WITH_SETTLED,
    )
  })
})

describe('CaptureDial the settled completion starts no animation', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] })
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  /**
   * Settled is deliberately NOT a ceremony. The circle is already at rest
   * where its accuracy put it; the companion ring appearing at that radius is
   * the whole of the moment. Proved the same way the ripple's own start is —
   * by spying on the constructors, which record every attempt regardless of
   * what happens to the animation afterwards — rather than by a timer count,
   * which cannot tell "never started" from "started and finished".
   */
  it('neither ripples nor snaps on a genuine transition into settled', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false)
    const parallelSpy = jest.spyOn(Animated, 'parallel')
    const sequenceSpy = jest.spyOn(Animated, 'sequence')
    const { rerender } = await renderDial({ grade: 'good', accuracyM: 7 })
    await screen.findByTestId('capture-dial')

    await rerender(
      <ThemeProvider>
        <CaptureDial grade="good" accuracyM={4.2} settled />
      </ThemeProvider>,
    )

    expect(screen.getByTestId('dial-settled-ring')).toBeTruthy()
    expect(parallelSpy).not.toHaveBeenCalled()
    expect(sequenceSpy).not.toHaveBeenCalled()
  })
})
