import React from 'react'
import { View } from 'react-native'
import { spacing } from '@corymbia/tokens'
import { useTheme } from '../theme'

export function Screen({
  children,
  padded = true,
}: {
  children: React.ReactNode
  padded?: boolean
}) {
  const { theme } = useTheme()
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.colors.surface,
        padding: padded ? spacing.lg : 0,
      }}
    >
      {children}
    </View>
  )
}
