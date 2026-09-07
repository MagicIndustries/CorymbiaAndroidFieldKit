import React from 'react'
import { AccessibilityInfo, Animated, Text } from 'react-native'
import { act, render, screen } from '@testing-library/react-native'
import { darkTheme } from '@corymbia/tokens'
import { ThemeProvider } from '../../theme'
import { TrafficLightFrame } from '../TrafficLightFrame'

// render() is async in @testing-library/react-native v14+ (see
// ../../theme/__tests__/ThemeProvider.test.tsx), so every call site awaits it.
const renderFrame = (grade: 'good' | 'fair' | 'poor') =>
  render(
    <ThemeProvider>
      <TrafficLightFrame grade={grade}>
        <Text>contents</Text>
      </TrafficLightFrame>
    </ThemeProvider>,
  )

describe('TrafficLightFrame', () => {
  it('says the grade in a word, so colour never carries it alone', async () => {
    await renderFrame('good')
    expect(screen.getByText('GOOD FIX')).toBeTruthy()
  })

  it('says the other two grades too', async () => {
    await renderFrame('fair')
    expect(screen.getByText('FAIR FIX')).toBeTruthy()
  })

  it('says the poor grade too', async () => {
    await renderFrame('poor')
    expect(screen.getByText('POOR FIX')).toBeTruthy()
  })

  it('renders what it encloses, because the frame is a container not a widget', async () => {
    await renderFrame('good')
    expect(screen.getByText('contents')).toBeTruthy()
  })

  it('borders in the status colour for the grade', async () => {
    await renderFrame('good')
    expect(screen.getByTestId('traffic-light-border').props.style).toEqual(
      expect.objectContaining({ borderColor: darkTheme.colors.statusGood }),
    )
  })

  // Only 'good' and 'poor' were checked for border colour before this task; a
  // mapping bug on the middle grade would have passed unnoticed.
  it('borders in the status colour for a fair fix too', async () => {
    await renderFrame('fair')
    expect(screen.getByTestId('traffic-light-border').props.style).toEqual(
      expect.objectContaining({ borderColor: darkTheme.colors.statusFair }),
    )
  })

  it('dashes the border when the fix is poor, so the grade survives greyscale', async () => {
    await renderFrame('poor')
    expect(screen.getByTestId('traffic-light-border').props.style).toEqual(
      expect.objectContaining({ borderStyle: 'dashed', borderColor: darkTheme.colors.statusPoor }),
    )
  })

  it('does not dash the border for a good fix', async () => {
    await renderFrame('good')
    expect(screen.getByTestId('traffic-light-border').props.style).toEqual(
      expect.objectContaining({ borderStyle: 'solid' }),
    )
  })

  // The pulse must scale the border layer, never fade or recolour it (see the
  // component doc comment). A build that wires every effect correctly but
  // never actually puts the transform on the style would still pass every
  // other test in this file, so the transform itself needs its own assertion.
  it('carries a scale transform on the border layer, so the breathing effect has something to animate', async () => {
    await renderFrame('good')
    const style = screen.getByTestId('traffic-light-border').props.style
    expect(style.transform).toEqual([{ scale: expect.any(Number) }])
  })
})

describe('TrafficLightFrame while refining', () => {
  // Both tests below exercise the pulse effect, which schedules an
  // `Animated.loop`. Fake timers make that loop's teardown provable: the
  // reduced-motion test below asserts `jest.getTimerCount() === 0`, and that
  // assertion is only meaningful if a real timer would have shown up as a
  // non-zero count. With Jest's default real timers, `getTimerCount()` is
  // always 0 regardless of what is running, and the assertion passes against
  // an animation looping forever — see Step 5's deliberate-breakage proof in
  // the task report for the check that this is not what is happening here.
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] })
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('keeps the border at full grade colour, because a pulse must never make a good fix look worse', async () => {
    // Not asserting on reduced motion here, so pin the initial read rather
    // than leaving `AccessibilityInfo.isReduceMotionEnabled()` to the real
    // native module, which never answers in this headless environment (see
    // apps/fieldkit/app/__tests__/diagnostics.test.tsx) and would otherwise
    // leave the animation's starting branch undetermined for this test.
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false)
    await render(
      <ThemeProvider>
        <TrafficLightFrame grade="good" refining>
          <Text>contents</Text>
        </TrafficLightFrame>
      </ThemeProvider>,
    )
    const style = screen.getByTestId('traffic-light-border').props.style
    expect(style).toEqual(expect.objectContaining({ borderColor: darkTheme.colors.statusGood }))
    expect(style.opacity).toBeUndefined()
  })

  it('runs no animation when the system asks for reduced motion', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true)
    await render(
      <ThemeProvider>
        <TrafficLightFrame grade="good" refining>
          <Text>contents</Text>
        </TrafficLightFrame>
      </ThemeProvider>,
    )
    await screen.findByTestId('traffic-light-border')
    // React Native's animation module flushes its own queue with one further
    // one-shot callback beyond the loop's own teardown (the same shape as
    // apps/fieldkit/app/__tests__/diagnostics.test.tsx's equivalent proof), so
    // the timer count only reaches zero once that has run too.
    await act(async () => {
      jest.advanceTimersByTime(30_000)
    })
    expect(jest.getTimerCount()).toBe(0)
  })

  // `isReduceMotionEnabled()` resolves asynchronously, so a naive
  // `useState(false)` default sees `false` on every mount's first effect
  // pass — before the real answer is known — starts the loop, and only tears
  // it down once the promise settles true. The test above only checks the
  // timer count once everything has settled, which cannot tell "never
  // started" apart from "started, then stopped": both read back as zero.
  // Spying on `Animated.loop` records every construction attempt across the
  // whole mount, so it is the honest way to prove the loop was never even
  // built, not just that nothing is running by the time this test looks.
  it('never constructs the animation loop when reduced motion is on, not even briefly at mount', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true)
    const loopSpy = jest.spyOn(Animated, 'loop')
    await render(
      <ThemeProvider>
        <TrafficLightFrame grade="good" refining>
          <Text>contents</Text>
        </TrafficLightFrame>
      </ThemeProvider>,
    )
    await screen.findByTestId('traffic-light-border')
    await act(async () => {
      jest.advanceTimersByTime(30_000)
    })
    expect(loopSpy).not.toHaveBeenCalled()
  })

  it('starts the pulse once reduced motion resolves off and the fix is refining', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false)
    await render(
      <ThemeProvider>
        <TrafficLightFrame grade="good" refining>
          <Text>contents</Text>
        </TrafficLightFrame>
      </ThemeProvider>,
    )
    await screen.findByTestId('traffic-light-border')
    await act(async () => {
      jest.advanceTimersByTime(30_000)
    })
    expect(jest.getTimerCount()).toBeGreaterThan(0)
  })

  it('starts nothing when the fix is not refining, even once reduced motion resolves off', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false)
    await render(
      <ThemeProvider>
        <TrafficLightFrame grade="good">
          <Text>contents</Text>
        </TrafficLightFrame>
      </ThemeProvider>,
    )
    await screen.findByTestId('traffic-light-border')
    await act(async () => {
      jest.advanceTimersByTime(30_000)
    })
    expect(jest.getTimerCount()).toBe(0)
  })

  it('stops the pulse once refining ends', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false)
    const { rerender } = await render(
      <ThemeProvider>
        <TrafficLightFrame grade="good" refining>
          <Text>contents</Text>
        </TrafficLightFrame>
      </ThemeProvider>,
    )
    await screen.findByTestId('traffic-light-border')
    await act(async () => {
      jest.advanceTimersByTime(30_000)
    })
    expect(jest.getTimerCount()).toBeGreaterThan(0)

    await rerender(
      <ThemeProvider>
        <TrafficLightFrame grade="good" refining={false}>
          <Text>contents</Text>
        </TrafficLightFrame>
      </ThemeProvider>,
    )
    await act(async () => {
      jest.advanceTimersByTime(30_000)
    })
    expect(jest.getTimerCount()).toBe(0)
  })
})
