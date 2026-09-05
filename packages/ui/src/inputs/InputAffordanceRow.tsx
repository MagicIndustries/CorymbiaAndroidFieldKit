import React from 'react'
import { Pressable, View } from 'react-native'
import { radii, spacing, touch } from '@corymbia/tokens'
import { useTheme } from '../theme'
import { Type } from '../primitives/Type'

export type InputAffordanceKind = 'title' | 'description' | 'voice' | 'photo'

/**
 * Doctrine rule 5: one visual signature per input kind, used identically
 * everywhere, ALWAYS IN THIS ORDER. Learned once, recognised forever.
 */
const AFFORDANCES: {
  kind: InputAffordanceKind
  glyph: string
  label: string
  spoken: string
}[] = [
  { kind: 'title', glyph: '✏️', label: 'Title', spoken: 'Add a title' },
  { kind: 'description', glyph: '🗒️', label: 'Notes', spoken: 'Add notes' },
  { kind: 'voice', glyph: '🎙️', label: 'Voice', spoken: 'Record a voice note' },
  { kind: 'photo', glyph: '📷', label: 'Photo', spoken: 'Take a photo' },
]

/** The canonical order, exported so it can be asserted without a test-only element. */
export const INPUT_AFFORDANCE_ORDER: InputAffordanceKind[] = AFFORDANCES.map((a) => a.kind)

export function InputAffordanceRow({
  onPress,
  completed = [],
  testID,
}: {
  onPress: (kind: InputAffordanceKind) => void
  completed?: InputAffordanceKind[]
  testID?: string
}) {
  const { theme } = useTheme()

  return (
    <View testID={testID} style={{ flexDirection: 'row', gap: spacing.sm }}>
      {AFFORDANCES.map((a) => {
        const done = completed.includes(a.kind)
        return (
          <Pressable
            key={a.kind}
            testID={`affordance-${a.kind}`}
            accessibilityRole="button"
            accessibilityLabel={a.spoken}
            accessibilityState={{ selected: done }}
            onPress={() => onPress(a.kind)}
            style={{
              flex: 1,
              minHeight: touch.comfortable,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radii.md,
              borderWidth: 2,
              borderColor: done ? theme.colors.accent : theme.colors.border,
              backgroundColor: theme.colors.surfaceRaised,
              paddingVertical: spacing.sm,
            }}
          >
            <Type variant="heading">{a.glyph}</Type>
            <Type variant="label" dim>
              {a.label}
            </Type>
          </Pressable>
        )
      })}
    </View>
  )
}
