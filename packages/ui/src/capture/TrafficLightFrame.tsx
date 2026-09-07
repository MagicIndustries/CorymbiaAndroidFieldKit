import React from 'react'
import { View } from 'react-native'
import { field, radii, spacing } from '@corymbia/tokens'
import { Type } from '../primitives'
import { useTheme } from '../theme'

export type FixGradeName = 'good' | 'fair' | 'poor'

const WORD: Record<FixGradeName, string> = {
  good: 'GOOD FIX',
  fair: 'FAIR FIX',
  poor: 'POOR FIX',
}

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
 */
export function TrafficLightFrame({
  grade,
  children,
}: {
  grade: FixGradeName
  children: React.ReactNode
}) {
  const { theme } = useTheme()
  const colour = {
    good: theme.colors.statusGood,
    fair: theme.colors.statusFair,
    poor: theme.colors.statusPoor,
  }[grade]

  return (
    <View>
      <View
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
