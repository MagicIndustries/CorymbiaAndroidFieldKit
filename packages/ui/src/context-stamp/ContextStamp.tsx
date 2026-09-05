import React from 'react'
import { View } from 'react-native'
import { radii, spacing } from '@corymbia/tokens'
import { useTheme } from '../theme'
import { Type } from '../primitives/Type'

export type FixQuality = 'deliberate' | 'ambient' | 'none'

/**
 * A discriminated union on `quality`, so an accuracy-less "deliberate" or
 * "ambient" fix — and an aged "deliberate" fix — cannot be constructed.
 *
 * - `deliberate`: the GPS cannot hand back a position without an accuracy
 *   estimate, and the fix was taken just now, so it never carries an age.
 * - `ambient`: always has an accuracy; its age may be unknown (a cached fix
 *   whose timestamp wasn't recorded), but the field itself always exists.
 * - `none`: no position at all, so neither field is meaningful.
 */
export type ContextStampFix =
  | { quality: 'deliberate'; accuracyM: number }
  | { quality: 'ambient'; accuracyM: number; ageMinutes?: number }
  | { quality: 'none' }

export type ContextStampProps = {
  fix: ContextStampFix
  place?: { name: string; distanceM?: number } | null
  device?: string | null
  activity?: { name: string; wasFiled: boolean } | null
  testID?: string
}

function Chip({
  testID,
  color,
  dashed = false,
  children,
}: {
  testID: string
  color: string
  dashed?: boolean
  children: string
}) {
  const { theme } = useTheme()
  return (
    <View
      testID={`${testID}-box`}
      style={{
        borderWidth: 1,
        borderStyle: dashed ? 'dashed' : 'solid',
        borderColor: color,
        borderRadius: radii.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
        backgroundColor: theme.colors.surfaceRaised,
      }}
    >
      <Type testID={testID} variant="label" style={{ color, letterSpacing: 0 }}>
        {children}
      </Type>
    </View>
  )
}

/**
 * Doctrine rule 9: colour never carries meaning alone. Each fix quality has a
 * distinct border style AND distinct text, so the three are told apart in
 * sunlight, with colour-vision deficiency, and by the voiced mode.
 *
 * "deliberate" is a solid border because it is a survey-grade reading the
 * user stood still to take. "ambient" and "none" both render dashed — that
 * pair is the real risk of colour-only differentiation (see the tests), so
 * their wording never collapses: ambient always states its age and "none"
 * always says so in words rather than guessing a position.
 */
function fixChip(fix: ContextStampFix): { text: string; dashed: boolean } {
  if (fix.quality === 'none') return { text: '⚑ no position', dashed: true }
  if (fix.quality === 'ambient') {
    const age = fix.ageMinutes === undefined ? '' : ` · ${fix.ageMinutes} min old`
    return { text: `~ ±${fix.accuracyM} m${age}`, dashed: true }
  }
  return { text: `◎ ±${fix.accuracyM} m`, dashed: false }
}

export function ContextStamp({ fix, place, device, activity, testID }: ContextStampProps) {
  const { theme } = useTheme()
  const c = theme.colors
  const { text, dashed } = fixChip(fix)

  const fixColor =
    fix.quality === 'deliberate' ? c.statusGood : fix.quality === 'ambient' ? c.statusFair : c.textDim

  return (
    <View testID={testID} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
      <Chip testID="fix-chip" color={fixColor} dashed={dashed}>
        {text}
      </Chip>

      {place ? (
        <Chip testID="place-chip" color={c.accentMuted}>
          {place.distanceM === undefined ? place.name : `${place.distanceM} m from ${place.name}`}
        </Chip>
      ) : null}

      {device ? (
        <Chip testID="device-chip" color={c.textDim}>
          {`▣ ${device}`}
        </Chip>
      ) : null}

      {activity ? (
        <Chip testID="activity-chip" color={c.textDim}>
          {activity.wasFiled ? activity.name : `during ${activity.name}`}
        </Chip>
      ) : null}
    </View>
  )
}
