import React from 'react'
import { Pressable, View } from 'react-native'
import { radii, spacing, touch } from '@corymbia/tokens'
import { useTheme } from '../theme'
import { Type } from '../primitives/Type'

export type InputAffordanceKind = 'title' | 'description' | 'voice' | 'photo'

/**
 * Doctrine rule 5: one visual signature per input kind, used identically
 * everywhere, ALWAYS IN THIS ORDER. Learned once, recognised forever.
 */
const AFFORDANCES: {
  kind: InputAffordanceKind
  glyph: string
  label: string
  spoken: string
}[] = [
  { kind: 'title', glyph: '✏️', label: 'Title', spoken: 'Add a title' },
  { kind: 'description', glyph: '🗒️', label: 'Notes', spoken: 'Add notes' },
  { kind: 'voice', glyph: '🎙️', label: 'Voice', spoken: 'Record a voice note' },
  { kind: 'photo', glyph: '📷', label: 'Photo', spoken: 'Take a photo' },
]

/** The canonical order, exported so it can be asserted without a test-only element. */
export const INPUT_AFFORDANCE_ORDER: InputAffordanceKind[] = AFFORDANCES.map((a) => a.kind)

export function InputAffordanceRow({
  onPress,
  completed = [],
  counts = {},
  busy = [],
  testID,
}: {
  onPress: (kind: InputAffordanceKind) => void
  completed?: InputAffordanceKind[]
  /**
   * How many of a kind are attached, e.g. several photos on one record.
   * `Photo ✓` after four of them is a worse answer than `Photo · 4` — a
   * kind that can only happen once (a title) carries no count, so it stays
   * `Title ✓` rather than the noise of `Title · 1`.
   *
   * This component does not enforce that: nothing stops a caller passing
   * `counts={{ title: 3 }}` and getting `Title · 3` rendered. "A kind that
   * can only happen once shows no count" is caller discipline, not a
   * guarantee made here — callers are relying on a convention, not a
   * constraint.
   */
  counts?: Partial<Record<InputAffordanceKind, number>>
  /**
   * Kinds mid-write (a photo being saved to a file and then a row). A busy
   * tile must be genuinely `disabled` — not an `onPress` that returns early,
   * which looks pressable and silently swallows the tap.
   */
  busy?: InputAffordanceKind[]
  testID?: string
}) {
  const { theme } = useTheme()

  return (
    <View testID={testID} style={{ flexDirection: 'row', gap: spacing.sm }}>
      {AFFORDANCES.map((a) => {
        const done = completed.includes(a.kind)
        const isBusy = busy.includes(a.kind)
        const count = counts[a.kind]
        // Doctrine rule 9: busy must read from the label wording, not only
        // from the `opacity` dim below — a dim is one channel, and the one
        // most likely to be lost in field glare. `isBusy` takes precedence
        // over `count`/`done` because it is the freshest fact: a save in
        // flight is more relevant than a count that hasn't caught up with it
        // yet.
        const label = isBusy
          ? `${a.label} · Saving`
          : count !== undefined && count > 0
            ? `${a.label} · ${count}`
            : done
              ? `${a.label} ✓`
              : a.label
        // The spoken name mirrors the same two facts the visible label
        // carries — a save in flight, or how many are already attached — so
        // a screen-reader user isn't left with `accessibilityState.disabled`
        // as its only, AT-only, signal.
        const accessibilityLabel = isBusy
          ? `${a.spoken}, saving`
          : count !== undefined && count > 0
            ? `${a.spoken}, ${count} attached`
            : a.spoken
        return (
          <Pressable
            key={a.kind}
            testID={`affordance-${a.kind}`}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ selected: done, disabled: isBusy }}
            disabled={isBusy}
            onPress={() => onPress(a.kind)}
            style={{
              flex: 1,
              minHeight: touch.comfortable,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radii.md,
              borderWidth: 2,
              // Doctrine rule 9: colour never carries meaning alone. `done`
              // gets a solid border (a confirmed state) where the pending
              // tile is dashed (provisional), and the label's wording
              // changes too — the same two-channel pattern ContextStamp
              // uses for fix quality — so completion reads at a glance
              // without colour, for a colour-vision-deficient user or in
              // glare that washes the accent colour out.
              borderStyle: done ? 'solid' : 'dashed',
              borderColor: done ? theme.colors.accent : theme.colors.border,
              backgroundColor: theme.colors.surfaceRaised,
              paddingVertical: spacing.sm,
              opacity: isBusy ? 0.6 : 1,
            }}
          >
            <Type variant="heading">{a.glyph}</Type>
            <Type variant="label" dim testID={`affordance-${a.kind}-label`}>
              {label}
            </Type>
          </Pressable>
        )
      })}
    </View>
  )
}
