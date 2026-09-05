import React from 'react'
import { StyleSheet, Text, type TextProps } from 'react-native'
import { type as typeScale } from '@corymbia/tokens'
import { useTheme } from '../theme'

export type TypeVariant = keyof typeof typeScale

export function Type({
  variant = 'body',
  dim = false,
  style,
  children,
  ...rest
}: TextProps & { variant?: TypeVariant; dim?: boolean }) {
  const { theme } = useTheme()
  const v = typeScale[variant]
  return (
    <Text
      {...rest}
      // Flattened (rather than left as [base, style]) so the rendered
      // element's `style` prop is always a single plain object — the same
      // merged style RN applies visually, just verifiable directly by a
      // test reading the real host element instead of an unflattened array.
      style={StyleSheet.flatten([
        {
          fontSize: v.size,
          fontWeight: v.weight,
          letterSpacing: v.letterSpacing,
          color: dim ? theme.colors.textDim : theme.colors.textPrimary,
        },
        style,
      ])}
    >
      {children}
    </Text>
  )
}
