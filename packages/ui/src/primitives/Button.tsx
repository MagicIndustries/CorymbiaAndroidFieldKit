import React from 'react'
import { Pressable } from 'react-native'
import { radii, spacing, touch, field } from '@corymbia/tokens'
import { useTheme } from '../theme'
import { Type } from './Type'

export type ButtonKind = 'primary' | 'secondary' | 'fast' | 'accurate' | 'danger'

export function Button({
  label,
  spokenLabel,
  onPress,
  kind = 'primary',
  size = 'standard',
  disabled = false,
  testID,
}: {
  label: string
  /** Voice-mode contract (doctrine rule 16). Defaults to the visible label. */
  spokenLabel?: string
  onPress: () => void
  kind?: ButtonKind
  size?: 'standard' | 'field'
  disabled?: boolean
  testID?: string
}) {
  const { theme } = useTheme()
  const c = theme.colors

  const palette: Record<ButtonKind, { bg: string; ink: string; border: string }> = {
    primary: { bg: c.accent, ink: c.textOnAccent, border: c.accent },
    secondary: { bg: c.surfaceRaised, ink: c.textPrimary, border: c.border },
    fast: { bg: c.captureFast, ink: c.captureFastInk, border: c.captureFast },
    accurate: { bg: c.captureAccurate, ink: c.captureAccurateInk, border: c.accent },
    // A destructive action that reads as `secondary` in glare is the failure
    // doctrine rule 9 exists to name: the label is the only channel telling
    // it apart from the safe control beside it. `statusPoor` is the one
    // semantic token this system already uses for "this is the bad one" —
    // borrowed here from GPS grading rather than adding a parallel red, so a
    // destructive control and a poor fix read as the same colour on purpose.
    danger: { bg: c.statusPoor, ink: c.statusPoorInk, border: c.statusPoor },
  }
  const p = palette[kind]

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={spokenLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: size === 'field' ? field.control : touch.min,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: spacing.lg,
        borderRadius: radii.lg,
        borderWidth: 2,
        borderColor: p.border,
        backgroundColor: p.bg,
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <Type variant={size === 'field' ? 'heading' : 'body'} style={{ color: p.ink }}>
        {label}
      </Type>
    </Pressable>
  )
}
