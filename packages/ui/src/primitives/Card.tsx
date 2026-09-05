import React from 'react'
import { StyleSheet, View, type ViewProps } from 'react-native'
import { elevation, radii, spacing } from '@corymbia/tokens'
import { useTheme } from '../theme'

export function Card({
  children,
  raised = false,
  accent = false,
  style,
  testID,
}: {
  children: React.ReactNode
  raised?: boolean
  accent?: boolean
  style?: ViewProps['style']
  testID?: string
}) {
  const { theme } = useTheme()
  return (
    <View
      testID={testID}
      style={StyleSheet.flatten([
        {
          backgroundColor: theme.colors.surfaceRaised,
          borderRadius: radii.xl,
          borderWidth: 1,
          borderColor: accent ? theme.colors.accent : theme.colors.border,
          padding: spacing.md,
          ...(raised ? elevation.raised : elevation.resting),
          shadowColor: theme.colors.overlay,
        },
        style,
      ])}
    >
      {children}
    </View>
  )
}
