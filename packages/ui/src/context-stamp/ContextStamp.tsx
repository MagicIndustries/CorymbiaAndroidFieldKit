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

function pluralMinutes(n: number): string {
  return `${n} minute${n === 1 ? '' : 's'}`
}

/**
 * Doctrine rule 16, second half (final-review round b, Finding 5):
 * `ContextStamp` has every fact the voiced mode needs and, until now, no way
 * to say it. Its chips (`◎ ±4 m`, `~ ±38 m · 4 min old`, `⚑ no position`,
 * `▣ field-s24`) are glyph-prefixed fragments meant for a glance in
 * sunlight, not for a screen reader or TTS voice to read aloud one after
 * another as noise.
 *
 * This composes one readable sentence instead. Fix quality gets the most
 * words precisely because it is the one thing rule 9 says colour must never
 * carry alone — 'deliberate' is a routine, high-confidence reading and is
 * spoken plainly ("recorded"); 'ambient' and 'none' are the two qualities a
 * field ecologist actually needs warned about aloud, so they spell out the
 * uncertainty (approximate accuracy, age, or its absence) that a sighted
 * user gets from the dashed border and amber/grey colour instead.
 *
 * Exact worked example from the spec: a deliberate fix, filmed during
 * (not filed to) "Survey 3", 120 m from "Yarra Flats — North Reach", no
 * device —
 *   "recorded during Survey 3, near Yarra Flats — North Reach, 120 m away"
 * — pinned verbatim in the test file, one case per fix class.
 */
export function composeContextStampSpokenLabel({
  fix,
  place,
  device,
  activity,
}: Pick<ContextStampProps, 'fix' | 'place' | 'device' | 'activity'>): string {
  let sentence: string
  if (fix.quality === 'deliberate') {
    sentence = 'recorded'
  } else if (fix.quality === 'ambient') {
    const age = fix.ageMinutes === undefined ? '' : `, ${pluralMinutes(fix.ageMinutes)} old`
    sentence = `recorded approximately, accurate to about ${fix.accuracyM} metres${age}`
  } else {
    sentence = 'no position recorded'
  }

  if (activity) {
    sentence += activity.wasFiled ? ` for ${activity.name}` : ` during ${activity.name}`
  }

  const trailing: string[] = []
  if (place) {
    trailing.push(
      place.distanceM === undefined ? `near ${place.name}` : `near ${place.name}, ${place.distanceM} m away`,
    )
  }
  if (device) {
    trailing.push(`on ${device}`)
  }
  if (trailing.length > 0) {
    sentence += `, ${trailing.join(', ')}`
  }

  return sentence
}

export function ContextStamp({ fix, place, device, activity, testID }: ContextStampProps) {
  const { theme } = useTheme()
  const c = theme.colors
  const { text, dashed } = fixChip(fix)
  const spokenLabel = composeContextStampSpokenLabel({ fix, place, device, activity })

  const fixColor =
    fix.quality === 'deliberate' ? c.statusGood : fix.quality === 'ambient' ? c.statusFair : c.textDim

  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={spokenLabel}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}
    >
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
