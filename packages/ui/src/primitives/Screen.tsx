import React from 'react'
import { StyleSheet, View, type ViewProps } from 'react-native'
import { spacing } from '@corymbia/tokens'
import { useTheme } from '../theme'

export function Screen({
  children,
  padded = true,
  style,
  testID,
  spokenDescription,
}: {
  children: React.ReactNode
  padded?: boolean
  style?: ViewProps['style']
  testID?: string
  /**
   * Doctrine rule 16: "every screen carries a spoken description". This is
   * the component-library support for the first half of that rule — the
   * voiced mode itself is a later plan, but retrofitting the description
   * onto every screen afterwards would be a rewrite, so `Screen` carries it
   * now even though nothing reads it aloud yet.
   *
   * Rendered on a zero-size, `accessible` node rather than making the
   * `Screen` container itself `accessible` — the latter would collapse
   * every child into one opaque focus stop, which is wrong for a full
   * screen (a screen reader still needs to traverse its actual content).
   * This node is announced on its own, then focus moves into the screen
   * normally.
   */
  spokenDescription?: string
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
      {spokenDescription ? (
        <View
          testID={testID ? `${testID}-spoken-description` : undefined}
          accessible
          accessibilityRole="header"
          accessibilityLabel={spokenDescription}
          style={styles.spokenDescription}
        />
      ) : null}
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  // Present for a screen reader/voiced mode to find, invisible and
  // out-of-flow for everyone else — 1x1 rather than 0x0 because some
  // accessibility services skip zero-size nodes entirely.
  spokenDescription: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
})
