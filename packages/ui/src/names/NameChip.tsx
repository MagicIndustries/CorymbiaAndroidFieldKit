import React from 'react'
import { View } from 'react-native'
import { radii, spacing } from '@corymbia/tokens'
import { useTheme } from '../theme'
import { Type } from '../primitives/Type'
import { resolveDisplayName } from './shortLabel'

export type NameChipProps = {
  name: string
  shortLabel?: string | null
  testID?: string
}

/**
 * Compact treatment. Doctrine rule 11: middle truncation, because field project
 * names are front-loaded with the site and back-loaded with what actually tells
 * them apart. The full name always reaches assistive tech and the voiced mode.
 */
export function NameChip({ name, shortLabel, testID }: NameChipProps) {
  const { theme } = useTheme()
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        borderWidth: 1,
        borderColor: theme.colors.accent,
        borderRadius: radii.pill,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        maxWidth: 220,
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
