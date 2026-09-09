import React from 'react'
import { Image, Pressable, ScrollView, View } from 'react-native'
import Svg, { Line, Path, Rect } from 'react-native-svg'
import { field, radii, spacing } from '@corymbia/tokens'
// Type-only: `@corymbia/media` owns the `MediaKind` union (photo | voice —
// see packages/media/src/naming.ts, spec §12.1). Re-declaring it here would
// be a fourth copy alongside the discriminated `Fix` union pattern this repo
// already avoids duplicating (see CLAUDE.md's "three fix classes" note).
//
// This is the FIRST cross-package type-only import in `@corymbia/ui` — not
// an established pattern. `packages/ui/src/layout/reach.ts` only imports
// `DeviceClass`/`Orientation` from local files in this same package, so it
// is not a precedent for reaching into a sibling `@corymbia/*` package at
// all. That distinction matters here because `@corymbia/media` re-exports
// the `expo-file-system` adapter (`src/store/expo.ts`): nothing in the
// language stops a future contributor dropping the `type` keyword, which
// would turn this into a value import and pull that native module into
// every screen that imports anything from `@corymbia/ui` — nearly the whole
// app. `src/__tests__/import-graph.test.ts` is the guard against exactly
// that: it walks this package's barrel and fails if `@corymbia/media`'s
// entry point is ever reached as a value.
import type { MediaKind } from '@corymbia/media'
import { useTheme } from '../theme'
import { Type } from '../primitives/Type'

export type MediaStripItem = {
  id: string
  kind: MediaKind
  uri: string
  durationMs: number | null
}

/**
 * Exported (not merely module-local) because `capture.tsx`'s removal
 * confirmation needs the same kind→noun mapping this strip's own remove
 * control already uses in its `accessibilityLabel` two lines below — a
 * removal confirmation that named a "photo" removed while its own tile still
 * read `Remove voice note` would be an inconsistency inside one screen, not
 * merely a duplicated fact across two files. This is the one place that
 * mapping is written down; `capture.tsx` lowercases it the same way this
 * file's own `accessibilityLabel` does, rather than keeping a second map.
 */
export const KIND_LABEL: Readonly<Record<MediaKind, string>> = Object.freeze({
  photo: 'Photo',
  voice: 'Voice note',
})

/**
 * How one attachment is named — `Photo 3 of 10`, `Voice note 1 of 2` — to a
 * screen reader on its own tile, and to `capture.tsx`'s removal confirmation
 * for the tile it is about.
 *
 * **The number is within the kind, not across the strip.** An earlier version
 * built `${index + 1} of ${items.length}` from the flat list, so a record
 * with ten photos and three voice notes announced its last tile as "Voice
 * note 13 of 13" and its first as "Photo 1 of 13" — a count of something
 * nobody is looking at. The noun was corrected four separate times over this
 * branch; the number beside it was not looked at once. `MediaStrip.test.tsx`
 * used to render one photo and one voice note, where "1 of 2" and "2 of 2"
 * are what BOTH implementations produce, so the fixture codified the bug
 * rather than catching it — it now renders two photos and one voice note,
 * which the flat count cannot satisfy.
 *
 * Exported, and used by this component itself, because the removal
 * confirmation has to name the tile she is actually about to lose: the strip
 * shows roughly five of ten near-identical 64dp thumbnails, resets to offset
 * 0 on every refresh, and there is no undo anywhere in the app. Two
 * independently-written numbering schemes disagreeing would point her at the
 * wrong photo, so there is one.
 *
 * `null` when `id` names nothing in `items` — a strip that has just been
 * refreshed out from under a pending removal, which the caller renders as no
 * confirmation at all rather than as a question about nothing.
 */
export function mediaStripLabel(
  items: readonly { id: string; kind: MediaKind }[],
  id: string,
): string | null {
  const item = items.find((entry) => entry.id === id)
  if (item === undefined) return null
  const sameKind = items.filter((entry) => entry.kind === item.kind)
  const position = sameKind.findIndex((entry) => entry.id === id) + 1
  return `${KIND_LABEL[item.kind]} ${position} of ${sameKind.length}`
}

/**
 * A minimal microphone glyph, drawn as SVG rather than as an emoji `Text`
 * node. That distinction is load-bearing, not decorative: `toHaveTextContent`
 * walks every `Text` descendant of a tile and concatenates them (see
 * `getTextContent` in
 * @testing-library/react-native/dist/helpers/text-content.js), so a `🎙️`
 * rendered as text would land in front of the duration and turn
 * `toHaveTextContent('0:08')` — an exact match, deliberately not
 * `{ exact: false }` — into a failure no matter how the duration itself
 * formats. A voice tile's only legible text is its length.
 *
 * This is not `CaptureDial`'s pattern reused: `CaptureDial` tokenises every
 * one of its `strokeWidth`s through the `field` scale (spec §9.2.1) because
 * those weights answer an ergonomic question — how a field control reads at
 * arm's length, gloved. This glyph is a fixed 20×20 static icon with no such
 * question to answer; its width, stroke width and coordinates are bare
 * literals sized only to look right at that one size, not decisions the
 * `field` scale exists to hold.
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
  pendingRemovalId = null,
  testID,
}: {
  items: MediaStripItem[]
  onPress?: (id: string) => void
  onRemove?: (id: string) => void
  /**
   * The attachment a removal confirmation is currently open for, marked in
   * the strip so the question and the thing it is about are visibly the same
   * one.
   *
   * Two channels (doctrine rule 9), because a mis-identified tile is
   * destroyed with no undo: the tile takes the amber border the confirmation
   * panel itself uses AND a thicker one, and its spoken name says it is the
   * attachment the question is about. Neither is colour alone.
   */
  pendingRemovalId?: string | null
  testID?: string
}): React.JSX.Element | null {
  const { theme } = useTheme()

  // Step 5's proof (task-7-report.md) is that removing this guard — making
  // the empty case render the container unconditionally — turns this test
  // red: an empty strip is a frame around a void, not a lesser version of a
  // populated one.
  if (items.length === 0) return null

  return (
    <ScrollView
      testID={testID}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ flexDirection: 'row', gap: spacing.sm }}
    >
      {items.map((item) => {
        const pending = item.id === pendingRemovalId
        const place = mediaStripLabel(items, item.id) ?? KIND_LABEL[item.kind]
        const label = pending ? `${place}, the attachment the removal question is about` : place
        const tileStyle = {
          width: field.mediaTile,
          minHeight: field.mediaTile,
          borderRadius: radii.md,
          borderWidth: pending ? 3 : 1,
          borderColor: pending ? theme.colors.statusFair : theme.colors.border,
          backgroundColor: theme.colors.surfaceRaised,
          alignItems: 'center' as const,
          justifyContent: 'center' as const,
          overflow: 'hidden' as const,
        }

        const content =
          item.kind === 'photo' ? (
            // `height` is `field.mediaTile` directly, not `'100%'`: the tile
            // itself only sets `minHeight`, not `height` (a voice tile's
            // content is allowed to grow it), so a percentage height here
            // would resolve against an undetermined parent height — a known
            // Yoga trap that can settle at zero. Sized to the same token as
            // the tile itself rather than to the tile's own runtime layout,
            // which is exactly the arithmetic-on-a-token trap finding 2
            // avoids for the remove control below.
            <Image
              testID={`media-thumb-${item.id}`}
              source={{ uri: item.uri }}
              style={{ width: field.mediaTile, height: field.mediaTile }}
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
            // `touch.min` (48dp, "Absolute minimum for any interactive
            // element") still governs the *touch target* — a `Pressable`
            // used gloved and one-handed is not exempt from that floor. What
            // changed from the earlier fix is that `touch.min` is no longer
            // what gets painted: a 48dp opaque circle in a 64dp tile's corner
            // covers 56% of the thumbnail (see `field.mediaTileRemove`'s doc
            // comment in `packages/tokens/src/scales.ts`), which reintroduces
            // by occlusion the exact failure `field.mediaTile` exists to
            // prevent — a photo that no longer reads as a photo.
            //
            // `hitSlop` expands only the responder area a thumb has to hit,
            // never what is painted (React Native's `normalizeRect`,
            // `Libraries/StyleSheet/Rect.js` — a numeric `hitSlop` becomes
            // `{top, bottom, left, right}` all equal to that number). With a
            // `field.mediaTileRemove` (24dp) painted box, `spacing.md` (12dp)
            // on every edge brings the effective target to
            // 24 + 12 + 12 = 48dp in both axes — `touch.min` exactly, not the
            // ~40dp the previous 24dp-box-with-8dp-hitSlop version reached.
            //
            // Tile spacing: tiles sit `spacing.sm` (8dp) apart
            // (`contentContainerStyle`'s `gap` below) and this control is
            // inset `spacing.xs` (4dp) from the tile's right edge, so the
            // hit region's right edge lands at
            // tileRight - spacing.xs + spacing.md = tileRight + 8dp —
            // exactly the neighbouring tile's left edge, not past it. The
            // expanded regions meet, they do not overlap.
            hitSlop={spacing.md}
            style={{
              position: 'absolute',
              top: spacing.xs,
              right: spacing.xs,
              minWidth: field.mediaTileRemove,
              minHeight: field.mediaTileRemove,
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
          <View
            key={item.id}
            testID={`media-tile-${item.id}`}
            accessibilityLabel={label}
            style={tileStyle}
          >
            {content}
            {removeControl}
          </View>
        )
      })}
    </ScrollView>
  )
}
