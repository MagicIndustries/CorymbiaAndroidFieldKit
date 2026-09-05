import React from 'react'
import { StyleSheet, View, type ViewProps } from 'react-native'
import { spacing } from '@corymbia/tokens'
import { useTheme } from '../theme'

export function Screen({
  children,
  padded = true,
  style,
  testID,
}: {
  children: React.ReactNode
  padded?: boolean
  style?: ViewProps['style']
  testID?: string
}) {
  const { theme } = useTheme()
  return (
    <View
      testID={testID}
      style={StyleSheet.flatten([
        {
          flex: 1,
          backgroundColor: theme.colors.surface,
          padding: padded ? spacing.lg : 0,
        },
        style,
      ])}
    >
      {children}
    </View>
  )
}
