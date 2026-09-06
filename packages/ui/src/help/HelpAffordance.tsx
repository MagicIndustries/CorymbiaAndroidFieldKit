import React, { useState } from 'react'
import { Modal, Pressable, View } from 'react-native'
import { radii, spacing, touch } from '@corymbia/tokens'
import { useTheme } from '../theme'
import { Type } from '../primitives/Type'
import { Button } from '../primitives/Button'

/**
 * Doctrine rule 7: help is adjacent and tappable. Never a hover tooltip —
 * there is no hover on a tablet in the field.
 */
export function HelpAffordance({
  title,
  body,
  testID,
}: {
  title: string
  body: string
  testID?: string
}) {
  const { theme } = useTheme()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`Help with ${title}`}
        onPress={() => setOpen(true)}
        style={{
          minHeight: touch.min,
          minWidth: touch.min,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Type variant="heading" style={{ color: theme.colors.textDim }}>
          ?
        </Type>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            padding: spacing.xl,
            backgroundColor: `${theme.colors.overlay}CC`,
          }}
        >
          <View
            style={{
              backgroundColor: theme.colors.surfaceRaised,
              borderRadius: radii.xl,
              borderWidth: 1,
              borderColor: theme.colors.border,
              padding: spacing.lg,
              gap: spacing.md,
            }}
          >
            <Type variant="heading">{title}</Type>
            <Type dim>{body}</Type>
            <Button label="Got it" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  )
}
