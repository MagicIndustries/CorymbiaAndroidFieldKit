import React from 'react'
import { View } from 'react-native'
import { radii, spacing } from '@corymbia/tokens'
import { useTheme } from '../theme'

export function Card({
  children,
  raised = false,
  accent = false,
}: {
  children: React.ReactNode
  raised?: boolean
  accent?: boolean
}) {
  const { theme } = useTheme()
  return (
    <View
      style={{
        backgroundColor: theme.colors.surfaceRaised,
        borderRadius: radii.xl,
        borderWidth: 1,
        borderColor: accent ? theme.colors.accent : theme.colors.border,
        padding: spacing.md,
        ...(raised
          ? {
              elevation: 4,
              shadowColor: theme.colors.overlay,
              shadowOpacity: 0.35,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 4 },
            }
          : null),
      }}
    >
      {children}
    </View>
  )
}
