import React from 'react'
import { Image, Pressable, ScrollView, View } from 'react-native'
import Svg, { Line, Path, Rect } from 'react-native-svg'
import { field, radii, spacing, touch } from '@corymbia/tokens'
// Type-only: `@corymbia/media` owns the `MediaKind` union (photo | voice —
// see packages/media/src/naming.ts, spec §12.1). Re-declaring it here would
// be a fourth copy alongside the discriminated `Fix` union pattern this repo
// already avoids duplicating (see CLAUDE.md's "three fix classes" note) —
// `@corymbia/ui` already reaches into a sibling package for a type only this
// way (see `packages/ui/src/layout/reach.ts`).
import type { MediaKind } from '@corymbia/media'
import { useTheme } from '../theme'
import { Type } from '../primitives/Type'

export type MediaStripItem = {
  id: string
  kind: MediaKind
  uri: string
  durationMs: number | null
}

const KIND_LABEL: Record<MediaKind, string> = {
  photo: 'Photo',
  voice: 'Voice note',
}

/**
 * A minimal microphone glyph, drawn as SVG (as `CaptureDial`'s icons are)
 * rather than as an emoji `Text` node. That distinction is load-bearing, not
 * decorative: `toHaveTextContent` walks every `Text` descendant of a tile and
 * concatenates them (see `getTextContent` in
 * @testing-library/react-native/dist/helpers/text-content.js), so a `🎙️`
 * rendered as text would land in front of the duration and turn
 * `toHaveTextContent('0:08')` — an exact match, deliberately not
 * `{ exact: false }` — into a failure no matter how the duration itself
 * formats. A voice tile's only legible text is its length.
 */
function VoiceGlyph({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 20 20">
      <Rect x="7" y="2" width="6" height="9" rx="3" fill={color} />
      <Path d="M4 10a6 6 0 0 0 12 0" stroke={color} strokeWidth={1.5} fill="none" />
      <Line x1="10" y1="16" x2="10" y2="18.5" stroke={color} strokeWidth={1.5} />
    </Svg>
  )
}

/**
 * `m:ss`, seconds zero-padded, rounded to the nearest whole second — never
 * milliseconds. Local and unexported: nothing outside this file needs the
 * format, and the two duration tests in `MediaStrip.test.tsx` pin it through
 * the rendered tile rather than by calling it directly.
 */
function formatDuration(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function MediaStrip({
  items,
  onPress,
  onRemove,
  testID,
}: {
  items: MediaStripItem[]
  onPress?: (id: string) => void
  onRemove?: (id: string) => void
  testID?: string
}): React.JSX.Element | null {
  const { theme } = useTheme()

  // Step 5's proof (task-7-report.md) is that removing this guard — making
  // the empty case render the container unconditionally — turns this test
  // red: an empty strip is a frame around a void, not a lesser version of a
  // populated one.
  if (items.length === 0) return null

  const total = items.length

  return (
    <ScrollView
      testID={testID}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ flexDirection: 'row', gap: spacing.sm }}
    >
      {items.map((item, index) => {
        const label = `${KIND_LABEL[item.kind]} ${index + 1} of ${total}`
        const tileStyle = {
          width: field.mediaTile,
          minHeight: field.mediaTile,
          borderRadius: radii.md,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surfaceRaised,
          alignItems: 'center' as const,
          justifyContent: 'center' as const,
          overflow: 'hidden' as const,
        }

        const content =
          item.kind === 'photo' ? (
            <Image
              testID={`media-thumb-${item.id}`}
              source={{ uri: item.uri }}
              style={{ width: '100%', height: '100%' }}
            />
          ) : (
            <>
              <VoiceGlyph color={theme.colors.textDim} />
              <Type variant="small" dim>
                {item.durationMs === null ? '' : formatDuration(item.durationMs)}
              </Type>
            </>
          )

        const removeControl = onRemove ? (
          <Pressable
            testID={`media-remove-${item.id}`}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${KIND_LABEL[item.kind].toLowerCase()}`}
            onPress={() => onRemove(item.id)}
            hitSlop={spacing.sm}
            style={{
              position: 'absolute',
              top: spacing.xs,
              right: spacing.xs,
              minWidth: touch.min / 2,
              minHeight: touch.min / 2,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radii.pill,
              backgroundColor: theme.colors.overlay,
            }}
          >
            <Type variant="small">✕</Type>
          </Pressable>
        ) : null

        // Doctrine, and the brief: a `Pressable` only when there is
        // genuinely something to press. With no `onPress`, this tile is a
        // plain `View` — never a `Pressable` wrapping a no-op handler,
        // which looks interactive to a screen reader and swallows the tap.
        return onPress ? (
          <Pressable
            key={item.id}
            testID={`media-tile-${item.id}`}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() => onPress(item.id)}
            style={tileStyle}
          >
            {content}
            {removeControl}
          </Pressable>
        ) : (
          <View key={item.id} testID={`media-tile-${item.id}`} accessibilityLabel={label} style={tileStyle}>
            {content}
            {removeControl}
          </View>
        )
      })}
    </ScrollView>
  )
}
