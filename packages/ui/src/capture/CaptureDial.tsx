import React, { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, View } from 'react-native'
import Svg, { Circle, G, Line } from 'react-native-svg'
import { field } from '@corymbia/tokens'
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
 *
 * Unlike the stroke widths below, this margin has no meaning outside this
 * one SVG canvas — it is not an ergonomic thickness decision, just headroom
 * arithmetic derived from this component's own radii and strokes — so it
 * stays a local constant rather than moving to `@corymbia/tokens`.
 */
const DIAL_MARGIN_PX = 40
const CENTER = OUTER_RADIUS_PX + DIAL_MARGIN_PX
const VIEW_SIZE = CENTER * 2

/**
 * Animated wrappers for the SVG primitives the lock treatment below drives
 * with `Animated.Value`s. Created once at module scope, not per render, the
 * same reason `Animated.createAnimatedComponent` call sites elsewhere in the
 * ecosystem hoist it out of the component body.
 */
const AnimatedCircle = Animated.createAnimatedComponent(Circle)
const AnimatedLine = Animated.createAnimatedComponent(Line)

/**
 * The lock's momentary snap, in px (spec §9.2.1: "a brief snap inside the
 * crosshair, as if catching, then easing back to rest on it"). This is the
 * figure that survived the mockup review that asked for the ripple — and by
 * extension this snap — to read as stronger than an earlier, "too subtle"
 * pass. Treat it as a measurement, not a suggestion: the accuracy circle's
 * radius is drawn this many pixels smaller than its own resting value for
 * the first part of the settle, so the snap is visible from peripheral
 * vision rather than inferred from a radius.
 */
const LOCK_SNAP_PX = 4.5
/** The snap-in half of the settle, in ms. */
const LOCK_SNAP_IN_MS = 100
/**
 * Easing back out to rest, in ms. Together with `LOCK_SNAP_IN_MS`, "roughly
 * a quarter of a second" (spec §9.2.1) end to end.
 */
const LOCK_SNAP_OUT_MS = 150
/**
 * Total duration of the snap-and-settle — and of the outline firming and
 * fill deepening below, which run for the same span so all four parts of
 * the lock (spec §9.2.1) land in one beat rather than trickling in.
 */
const LOCK_SETTLE_MS = LOCK_SNAP_IN_MS + LOCK_SNAP_OUT_MS

/**
 * The accuracy circle's outline weight before a fix locks and once it has
 * (spec §9.2.1: "its interior fills and its outline firms"). Unlocked, the
 * circle is "a soft region of uncertainty"; locked, "a definite object on
 * the target" — and the same locked weight is reused below for the
 * crosshair's own thickened stroke, because the two firm together as one
 * beat, not as two separately-tuned effects.
 */
const LOCK_OUTLINE_UNLOCKED = 1.75
const LOCK_OUTLINE_LOCKED = 4

/**
 * The accuracy circle's fill opacity, unlocked and locked (spec §9.2.1).
 * Deliberately far from opaque even once locked: the fill is what makes the
 * circle read as "a definite object", not a solid disc.
 */
const LOCK_FILL_UNLOCKED = 0.15
const LOCK_FILL_LOCKED = 0.45

/**
 * How far past the crosshair's own radius the lock's ripple travels, in px
 * (spec §9.2.1). Another of the numbers the owner asked to be made more
 * visible, not softened.
 */
const LOCK_RIPPLE_REACH_PX = 84
/**
 * How long after the first ripple ring the second starts, in ms (spec
 * §9.2.1: "the second trailing the first by about a fifth of a second"). A
 * single ring reads as a flicker; this stagger is what makes the pair read
 * as a ripple, because the eye gets a second chance at it.
 */
const LOCK_RIPPLE_STAGGER_MS = 190
/**
 * How long each ripple ring's own outward run takes. The spec gives the
 * stagger, the reach and the hold fraction below but not this figure
 * directly — chosen to read as an outward ripple rather than a flash. On
 * the device checklist alongside the rest of this animation (see the task
 * report): this duration is a judgement call this task made, not a number
 * carried over from the settled mockup.
 */
const LOCK_RIPPLE_DURATION_MS = 600
/**
 * The fraction of a ripple ring's own run that holds near full opacity
 * before falling away (spec §9.2.1: "holding near full opacity for the
 * first third then falling away").
 */
const LOCK_RIPPLE_HOLD_FRACTION = 1 / 3
/** "Near full opacity", not literally 1 (spec §9.2.1). */
const LOCK_RIPPLE_PEAK_OPACITY = 0.9

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
 * accuracy circle, the lock's ripple (while it plays), then the crosshair
 * on top. The whole design is the circle arriving *on* the target, so the
 * crosshair must never be obscured by the accuracy circle closing over it,
 * or by the ripple expanding past it — painting it last, on top of every
 * other layer, is what guarantees that regardless of any other layer's
 * radius or opacity.
 *
 * Colour never carries the grade alone (doctrine rule 9): the grade word
 * is always rendered alongside the colour. The lock is held to the same
 * rule (spec §9.2.1): `accessibilityState.selected` on the outer view
 * carries the lock as a plain fact, independent of the colour and motion
 * this component also uses to show it, so a screen (or a screen reader)
 * can render or announce a word from it without inferring anything from a
 * radius or a hue. `GOOD FIX · LOCKED ON` itself is the next task's screen
 * copy, not drawn by this component — see `locked` below.
 */
export function CaptureDial({
  grade,
  accuracyM,
  remaining,
  locked,
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
   * `isLocked` in dialGeometry.ts, computed by the screen and handed down
   * as a plain boolean — this component still computes no lock of its own,
   * consistent with the rest of the dial's inputs).
   *
   * Drives the lock's own presentation: the accuracy circle's momentary
   * snap and its firmer, deeper fill; the crosshair lighting in the grade
   * colour and thickening; and the ripple that runs once, outward, the
   * instant `locked` turns true. `GOOD FIX · LOCKED ON` — the words that
   * carry the lock where colour and motion cannot (doctrine rule 9) — is
   * the next task's screen-level copy; this component exposes the same
   * fact as `accessibilityState.selected` on its own root view so that
   * screen has something to render a word from that does not depend on
   * this component's colour or motion at all.
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
  const lockedNow = locked === true

  // `null` is a third state, distinct from `false`: the accessibility
  // setting has not resolved yet (see TrafficLightFrame.tsx, which this
  // mirrors). Treating "unresolved" the same as "reduced motion requested"
  // means the lock never plays its animation before it is positively known
  // safe to (spec §9.2.2) — it renders the locked *state* instead, which
  // costs nothing since the state is the information and the animation is
  // only the emphasis.
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (!cancelled) setReduceMotion(on)
    })
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    return () => {
      cancelled = true
      subscription.remove()
    }
  }, [])

  // `snapOffset` is a transient offset added to the accuracy circle's own
  // radius, not a replacement for it — it always starts and ends at 0, so
  // `accuracyM` (and therefore `accuracyRadius`) can keep changing under
  // the animation without this component having to track a moving target
  // inside the Animated graph.
  const snapOffset = useRef(new Animated.Value(0)).current
  // 0 = unlocked (soft, thin); 1 = locked and settled (filled, firm). Drives
  // the accuracy circle's fill opacity and outline weight, and the
  // crosshair's thickened stroke, together.
  const lockLevel = useRef(new Animated.Value(0)).current
  const ripple1 = useRef(new Animated.Value(0)).current
  const ripple2 = useRef(new Animated.Value(0)).current
  // Whether the ripple's two rings are in the tree at all. Only true for the
  // short span the ripple is actually playing — "once, then nothing" (spec
  // §9.2.1) means the rings are gone afterwards, not merely faded out.
  const [rippling, setRippling] = useState(false)
  // Tracks whether `locked` was already true on the *previous* run of the
  // effect below, so a mount that starts already locked — or a re-render
  // that is still locked — settles straight to the locked state instead of
  // replaying the snap and the ripple. Only a genuine false→true transition
  // of `locked` plays them. This is the guard the task brief calls out by
  // name: a dial that mounts already locked must not replay the moment.
  const wasLocked = useRef(false)

  useEffect(() => {
    const justLocked = lockedNow && !wasLocked.current
    wasLocked.current = lockedNow

    if (!lockedNow) {
      // Losing lock is not itself an animated moment — spec §9.2.1
      // describes only gaining it — so this settles straight back rather
      // than easing.
      snapOffset.stopAnimation()
      snapOffset.setValue(0)
      lockLevel.stopAnimation()
      lockLevel.setValue(0)
      setRippling(false)
      return
    }

    if (reduceMotion !== false) {
      // Reduced motion on, or not yet known: render the locked *state* —
      // filled circle, lit crosshair — and run no animation at all (spec
      // §9.2.2). The state is the information; the ripple is only the
      // emphasis, so skipping it here costs nothing.
      snapOffset.setValue(0)
      lockLevel.setValue(1)
      setRippling(false)
      return
    }

    if (!justLocked) {
      // Already locked before this render — a re-render with `locked`
      // unchanged, or a mount that starts locked. The moment already
      // played, or never happens here at all; either way it is not
      // replayed.
      snapOffset.setValue(0)
      lockLevel.setValue(1)
      setRippling(false)
      return
    }

    // A genuine transition into lock, with motion allowed: all four parts
    // of the moment (spec §9.2.1) start together.
    Animated.sequence([
      Animated.timing(snapOffset, {
        toValue: -LOCK_SNAP_PX,
        duration: LOCK_SNAP_IN_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.timing(snapOffset, {
        toValue: 0,
        duration: LOCK_SNAP_OUT_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
    ]).start()

    Animated.timing(lockLevel, {
      toValue: 1,
      duration: LOCK_SETTLE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start()

    setRippling(true)
    ripple1.setValue(0)
    ripple2.setValue(0)
    Animated.parallel([
      Animated.timing(ripple1, {
        toValue: 1,
        duration: LOCK_RIPPLE_DURATION_MS,
        useNativeDriver: false,
      }),
      Animated.sequence([
        Animated.delay(LOCK_RIPPLE_STAGGER_MS),
        Animated.timing(ripple2, {
          toValue: 1,
          duration: LOCK_RIPPLE_DURATION_MS,
          useNativeDriver: false,
        }),
      ]),
      // Once, then nothing (spec §9.2.1): nothing re-arms this effect
      // except `locked` genuinely going false and true again.
    ]).start(() => setRippling(false))
  }, [lockedNow, reduceMotion, lockLevel, ripple1, ripple2, snapOffset])

  const accuracyOutlineWeight = lockLevel.interpolate({
    inputRange: [0, 1],
    outputRange: [LOCK_OUTLINE_UNLOCKED, LOCK_OUTLINE_LOCKED],
  })
  const accuracyFillOpacity = lockLevel.interpolate({
    inputRange: [0, 1],
    outputRange: [LOCK_FILL_UNLOCKED, LOCK_FILL_LOCKED],
  })
  const crosshairWeight = lockLevel.interpolate({
    inputRange: [0, 1],
    outputRange: [field.countdown, LOCK_OUTLINE_LOCKED],
  })
  const crosshairColour = lockedNow ? colour : theme.colors.textDim

  return (
    <View testID="capture-dial" accessibilityState={{ selected: lockedNow }}>
      <Svg viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`} width="100%" height="100%">
        <Circle
          testID="dial-ring-track"
          cx={CENTER}
          cy={CENTER}
          r={OUTER_RADIUS_PX}
          fill="none"
          stroke={theme.colors.surfaceSunken}
          strokeWidth={field.dialRing}
        />
        {ring === null ? null : (
          <Circle
            testID="dial-ring-progress"
            cx={CENTER}
            cy={CENTER}
            r={OUTER_RADIUS_PX}
            fill="none"
            stroke={colour}
            strokeWidth={field.dialRing}
            strokeDasharray={ring.dasharray}
            strokeDashoffset={ring.dashoffset}
          />
        )}
        <AnimatedCircle
          testID="dial-accuracy"
          cx={CENTER}
          cy={CENTER}
          r={Animated.add(accuracyRadius, snapOffset)}
          fill={colour}
          fillOpacity={accuracyFillOpacity}
          stroke={colour}
          strokeWidth={accuracyOutlineWeight}
        />
        {rippling ? (
          <>
            <AnimatedCircle
              testID="dial-ripple-1"
              cx={CENTER}
              cy={CENTER}
              r={ripple1.interpolate({
                inputRange: [0, 1],
                outputRange: [TARGET_RADIUS_PX, TARGET_RADIUS_PX + LOCK_RIPPLE_REACH_PX],
              })}
              fill="none"
              stroke={colour}
              strokeWidth={field.countdown}
              opacity={ripple1.interpolate({
                inputRange: [0, LOCK_RIPPLE_HOLD_FRACTION, 1],
                outputRange: [LOCK_RIPPLE_PEAK_OPACITY, LOCK_RIPPLE_PEAK_OPACITY, 0],
              })}
            />
            <AnimatedCircle
              testID="dial-ripple-2"
              cx={CENTER}
              cy={CENTER}
              r={ripple2.interpolate({
                inputRange: [0, 1],
                outputRange: [TARGET_RADIUS_PX, TARGET_RADIUS_PX + LOCK_RIPPLE_REACH_PX],
              })}
              fill="none"
              stroke={colour}
              strokeWidth={field.countdown}
              opacity={ripple2.interpolate({
                inputRange: [0, LOCK_RIPPLE_HOLD_FRACTION, 1],
                outputRange: [LOCK_RIPPLE_PEAK_OPACITY, LOCK_RIPPLE_PEAK_OPACITY, 0],
              })}
            />
          </>
        ) : null}
        <G testID="dial-crosshair">
          <AnimatedLine
            testID="dial-crosshair-horizontal"
            x1={CENTER - TARGET_RADIUS_PX}
            y1={CENTER}
            x2={CENTER + TARGET_RADIUS_PX}
            y2={CENTER}
            stroke={crosshairColour}
            strokeWidth={crosshairWeight}
          />
          <AnimatedLine
            testID="dial-crosshair-vertical"
            x1={CENTER}
            y1={CENTER - TARGET_RADIUS_PX}
            x2={CENTER}
            y2={CENTER + TARGET_RADIUS_PX}
            stroke={crosshairColour}
            strokeWidth={crosshairWeight}
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
