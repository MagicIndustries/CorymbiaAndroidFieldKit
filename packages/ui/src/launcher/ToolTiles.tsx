import React from 'react'
import { Pressable, View } from 'react-native'
import { radii, spacing, touch } from '@corymbia/tokens'
import { useTheme } from '../theme'
import { Card } from '../primitives/Card'
import { Type } from '../primitives/Type'
import type { CarryOn, CarryOnActivityKind } from './CarryOnCard'

export type ToolKind = 'capture' | 'records' | 'media' | 'batching'

const TILES: Readonly<Record<ToolKind, { label: string; glyph: string; spoken: string }>> = Object.freeze({
  capture: { label: 'Capture', glyph: '🎯', spoken: 'Open capture' },
  records: { label: 'Records', glyph: '🗂️', spoken: 'Open records' },
  media: { label: 'Media', glyph: '🖼️', spoken: 'Open media library' },
  batching: { label: 'Batching', glyph: '📦', spoken: 'Open batching' },
})

/**
 * The order with no activity to reorder by (brief: "keeps a stable order
 * when there is no activity to order by"), and also the `survey` row from
 * spec §10.1 itself — a survey floats capture and records to the top and
 * dims batching, which is exactly declaration order below.
 */
const DEFAULT_ORDER: readonly ToolKind[] = Object.freeze(['capture', 'records', 'media', 'batching'])

/**
 * Spec §10.1: tool tiles are reordered by activity type. Only the `survey`
 * row is pinned by the spec text itself (capture and records float to the
 * top, batching sinks) — the other four are this task's own judgement about
 * what each activity kind leans on most, not spec-mandated, so they are
 * documented rather than cited:
 *
 * - `sampling`: a round is many individual chain-of-custody entries under
 *   one activity, so `records` — the log of what has been taken — floats
 *   above `capture`.
 * - `collection`: a run gathers many specimens for later bulk processing, so
 *   `batching` floats up instead of sinking, right behind `capture`.
 * - `workshop`: an indoor session with no site to fix a GPS position on, so
 *   `records` and reference `media` lead and `capture` drops back.
 * - `meeting`: mostly note-taking, so `records` leads; nothing here is
 *   documenting a site, so the rest keeps the field default order.
 *
 * **`batching` sinking for `survey` cannot be observed yet.** `batching` has
 * no built destination, so no caller can ever pass it in `available` (see
 * doctrine rule 3 on the component below) — there is currently no way to
 * exercise the branch of this table that places it. The row is still
 * written correctly, on the day the tool exists this needs no revisiting.
 */
const ORDER_BY_ACTIVITY: Readonly<Record<CarryOnActivityKind, readonly ToolKind[]>> = {
  survey: DEFAULT_ORDER,
  sampling: ['records', 'capture', 'media', 'batching'],
  collection: ['capture', 'batching', 'records', 'media'],
  workshop: ['records', 'media', 'capture', 'batching'],
  meeting: ['records', 'capture', 'media', 'batching'],
}

function orderFor(activityKind: CarryOnActivityKind | null): readonly ToolKind[] {
  return activityKind === null ? DEFAULT_ORDER : ORDER_BY_ACTIVITY[activityKind]
}

/**
 * The launcher's tool tiles beneath `CarryOnCard` (spec §10.1), reordered
 * per activity kind by `orderFor` above.
 *
 * **`available` is doctrine rule 3 made structural.** Batching and the media
 * library are not built yet, so a caller with nothing to open for them
 * passes only the kinds that exist — this component filters `available`
 * against the order table and renders nothing for the rest. A tile for an
 * unbuilt destination is not rendered disabled and carries no "coming soon"
 * badge; a control that looks pressable and does nothing is exactly what
 * doctrine rule 3 forbids, whether that "nothing" is silence or a badge
 * explaining the silence.
 */
export function ToolTiles({
  activityKind,
  available,
  onOpen,
  testID,
}: {
  activityKind: CarryOn['activityKind'] | null
  available: ToolKind[]
  onOpen: (tool: ToolKind) => void
  testID?: string
}): React.JSX.Element {
  const { theme } = useTheme()
  const order = orderFor(activityKind)
  const kinds = order.filter((kind) => available.includes(kind))

  return (
    <View testID={testID} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
      {kinds.map((kind) => {
        const tile = TILES[kind]
        return (
          <Pressable
            key={kind}
            testID={`tool-${kind}`}
            accessibilityRole="button"
            accessibilityLabel={tile.spoken}
            onPress={() => onOpen(kind)}
            style={({ pressed }) => ({
              flexGrow: 1,
              flexBasis: '45%',
              minHeight: touch.comfortable,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Card style={{ flex: 1, borderRadius: radii.lg, alignItems: 'center', justifyContent: 'center', gap: spacing.xs }}>
              <Type variant="heading" style={{ color: theme.colors.accent }}>
                {tile.glyph}
              </Type>
              <Type variant="label" dim>
                {tile.label}
              </Type>
            </Card>
          </Pressable>
        )
      })}
    </View>
  )
}
