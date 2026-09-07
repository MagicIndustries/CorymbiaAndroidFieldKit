import React, { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, View } from 'react-native'
import { field, radii, spacing } from '@corymbia/tokens'
import { Type } from '../primitives'
import { useTheme } from '../theme'

export type FixGradeName = 'good' | 'fair' | 'poor'

const WORD: Record<FixGradeName, string> = {
  good: 'GOOD FIX',
  fair: 'FAIR FIX',
  poor: 'POOR FIX',
}

/** One full breath. Slow enough to read as "still working", never as urgency. */
const PULSE_MS = 5000
/** Deliberately small: the frame should breathe, not throb. */
const PULSE_SCALE = 1.012

/**
 * The frame around the capture block (spec §9.2).
 *
 * It encloses the readout and the control together, because §9.1.2 requires
 * them to be one object within sight of the thumb pressing it. A frame around
 * the whole screen would put its perimeter as far from the button as the panel
 * this design exists to replace.
 *
 * The border is drawn on its own absolutely-positioned layer rather than on the
 * container. Task 2 breathes that layer while the fix refines, and scaling a
 * layer that holds the content would scale the text with it.
 *
 * Colour never carries the grade alone (doctrine rule 9): the word is always
 * present, and a poor fix additionally dashes the border so the grade survives
 * a greyscale screenshot or a colour-blind reader.
 *
 * While a fix is still refining (spec §9.2), the whole frame breathes: the
 * border layer's `scale` is animated, never its colour or opacity, so the
 * grade reads at full strength at every point in the cycle. A pulse of colour
 * or opacity would make a good fix look worse at the bottom of every cycle,
 * which this frame must never do — the user is judging a survey position by
 * that colour. A user who has asked the system for less motion gets a
 * perfectly steady frame instead, not a degraded animation: the grade is
 * carried by the colour and the word either way, so stillness costs nothing.
 */
export function TrafficLightFrame({
  grade,
  refining,
  children,
}: {
  grade: FixGradeName
  refining?: boolean
  children: React.ReactNode
}) {
  const { theme } = useTheme()
  const colour = {
    good: theme.colors.statusGood,
    fair: theme.colors.statusFair,
    poor: theme.colors.statusPoor,
  }[grade]

  const [reduceMotion, setReduceMotion] = useState(false)
  const scale = useRef(new Animated.Value(1)).current

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

  useEffect(() => {
    // A steady frame is the correct rendering when motion is refused, not a
    // degraded one: the grade is in the colour and the word either way.
    if (!refining || reduceMotion) {
      scale.setValue(1)
      return
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, {
          toValue: PULSE_SCALE,
          duration: PULSE_MS / 2,
          useNativeDriver: true,
        }),
        Animated.timing(scale, { toValue: 1, duration: PULSE_MS / 2, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => {
      loop.stop()
      scale.setValue(1)
    }
  }, [refining, reduceMotion, scale])

  return (
    <View>
      <Animated.View
        testID="traffic-light-border"
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderWidth: field.frame,
          borderColor: colour,
          borderStyle: grade === 'poor' ? 'dashed' : 'solid',
          borderRadius: radii.xl,
          transform: [{ scale }],
        }}
      />
      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        <Type variant="label" style={{ color: colour }}>
          {WORD[grade]}
        </Type>
        {children}
      </View>
    </View>
  )
}
