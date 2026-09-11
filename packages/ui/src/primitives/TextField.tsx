import React from 'react'
import { TextInput, View, type TextStyle } from 'react-native'
import { field, radii, spacing, touch } from '@corymbia/tokens'
import { useTheme } from '../theme'
import { Type } from './Type'

/**
 * A labelled text field — doctrine rule 5: text entry has one visual
 * signature, used identically everywhere. It was declared twice before this
 * existed, as a byte-identical `inputStyle(theme)` in `new-project.tsx` and
 * `new-activity.tsx`, which is exactly how two screens drift apart one
 * border at a time.
 *
 * The label is passed already in the caller's own casing — the screens write
 * `NAME` and `SHORT LABEL (OPTIONAL)` — rather than upper-cased here, so what
 * a screen reader says is what the author wrote.
 *
 * `testID` lands on the `TextInput` itself, not on the wrapper: it is the
 * input a test types into.
 */
export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  keyboardType = 'default',
  testID,
  accessibilityLabel,
}: {
  label: string
  value: string
  onChangeText: (text: string) => void
  placeholder?: string
  /** A field for more than a line: taller, and text starts at the top of it. */
  multiline?: boolean
  /**
   * Which keyboard Android raises. `'number-pad'` for a field that can only
   * ever hold digits — the Inbox's filing position — because a full QWERTY
   * keyboard for a one-digit answer is four times the keys and every one of
   * them wrong.
   *
   * Deliberately narrower than `TextInput`'s own `KeyboardTypeOptions`: this
   * component is doctrine rule 5's one visual signature for text entry, and
   * a prop that forwarded all eleven platform keyboards would be a hole in
   * that. A twelfth case that genuinely needs one adds it here, named.
   */
  keyboardType?: 'default' | 'number-pad'
  testID?: string
  accessibilityLabel?: string
}) {
  const { theme } = useTheme()

  const style: TextStyle = {
    minHeight: multiline ? field.control : touch.min,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    color: theme.colors.textPrimary,
    paddingHorizontal: spacing.md,
  }
  if (multiline) {
    // Without this a multiline box centres its first line vertically on
    // Android, so a one-line note floats in the middle of a 72dp field.
    style.textAlignVertical = 'top'
  }

  return (
    <View style={{ gap: spacing.xs }}>
      <Type variant="label" dim>
        {label}
      </Type>
      <TextInput
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textDim}
        multiline={multiline}
        keyboardType={keyboardType}
        style={style}
      />
    </View>
  )
}
