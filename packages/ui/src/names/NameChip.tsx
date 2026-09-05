import React from 'react'
import { View } from 'react-native'
import { radii, spacing } from '@corymbia/tokens'
import { useTheme } from '../theme'
import { Type } from '../primitives/Type'
import { resolveDisplayName } from './shortLabel'

export type NameChipProps = {
  name: string
  shortLabel?: string | null
  /**
   * Optional hard cap in dp. Leave unset for the common case: the chip
   * shrinks to fit whatever room its flex container gives it (a row of
   * several chips, a hero card on a tablet, ...) and truncates the label
   * only once it actually runs out of space. Set this only when a specific
   * layout genuinely needs a fixed ceiling regardless of available space.
   */
  maxWidth?: number
  testID?: string
}

/**
 * Compact treatment. Doctrine rule 11: middle truncation, because field project
 * names are front-loaded with the site and back-loaded with what actually tells
 * them apart. The full name always reaches assistive tech and the voiced mode.
 *
 * No fixed pixel width here: `flexShrink: 1` lets the chip give up space to
 * its siblings in a row and shrink below its content size, while
 * `alignSelf: 'flex-start'` keeps it hugging its content (chip-shaped)
 * rather than stretching to fill its parent when used on its own. Together
 * they let the chip take whatever room the surrounding layout — sized via
 * `useLayout()`'s size classes, never a raw dimension read here — actually
 * gives it, and truncate (see `ellipsizeMode="middle"` below) only when it
 * has to.
 */
export function NameChip({ name, shortLabel, maxWidth, testID }: NameChipProps) {
  const { theme } = useTheme()
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        flexShrink: 1,
        borderWidth: 1,
        borderColor: theme.colors.accent,
        borderRadius: radii.pill,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        ...(maxWidth != null ? { maxWidth } : null),
      }}
    >
      <Type
        testID={testID}
        variant="small"
        numberOfLines={1}
        ellipsizeMode="middle"
        accessibilityLabel={name}
        style={{ color: theme.colors.accent }}
      >
        {resolveDisplayName({ name, shortLabel })}
      </Type>
    </View>
  )
}
