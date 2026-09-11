import React from 'react'
import { View } from 'react-native'
import { spacing } from '@corymbia/tokens'
import { useTheme } from '../theme'
import { Card } from '../primitives/Card'
import { Type } from '../primitives/Type'
import { Button } from '../primitives/Button'
import { ProjectName } from '../names/ProjectName'

export type CarryOnActivityKind = 'survey' | 'sampling' | 'collection' | 'workshop' | 'meeting'

/**
 * Spec §10.1: what the launcher's "Carry on with" card is handed. This
 * component is presentational only — it renders these strings and hands back
 * presses; it queries nothing. Task 5 assembles the real value from the
 * activity repository Tasks 1–2 built.
 */
export type CarryOn = {
  projectName: string
  activityName: string
  activityKind: CarryOnActivityKind
  /** ISO 8601. Rendered as elapsed time, never as a timestamp — see `formatElapsed`. */
  startedAt: string
  captureCount: number
  clientName: string
}

const ACTIVITY_KIND_LABEL: Readonly<Record<CarryOnActivityKind, string>> = Object.freeze({
  survey: 'Survey',
  sampling: 'Sampling',
  collection: 'Collection',
  workshop: 'Workshop',
  meeting: 'Meeting',
})

/**
 * "40 minutes ago" mid-survey, "3 hours ago" further in — never the raw ISO
 * timestamp `startedAt` carries, which is arithmetic homework at a glance.
 * Whole minutes under an hour, whole hours above (brief, spec §10.1). Pure,
 * and the two duration tests in `CarryOnCard.test.tsx` pin it through the
 * rendered card rather than by calling it directly.
 *
 * Exported because the records list says when each record was taken and must
 * say it the same way this card says when the activity started — two
 * renderings of "how long ago" that disagreed would be a worse answer than
 * either. It is a stopgap either way: the owner's design pass may decide a
 * list of records wants something denser than a sentence per row, and this is
 * the one place that would change.
 */
export function formatElapsed(startedAt: string): string {
  const elapsedMs = Date.now() - new Date(startedAt).getTime()
  const minutes = Math.max(0, Math.round(elapsedMs / 60_000))
  if (minutes < 60) {
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`
  }
  const hours = Math.round(minutes / 60)
  return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
}

/** "1 capture", "12 captures" — singular only at exactly one. */
function formatCaptureCount(captureCount: number): string {
  return `${captureCount} ${captureCount === 1 ? 'capture' : 'captures'}`
}

/**
 * The launcher's "Carry on with" card (spec §10.1): project, activity, when
 * it started, capture count and client, with `CAPTURE` inside it and
 * `Switch project` / `New activity` beneath.
 *
 * **The null case is a first run, not an error.** With no context there is
 * nothing to carry on with, so this renders no `CAPTURE` at all — a control
 * that looks pressable and does nothing is exactly what must not exist — and
 * offers the one way forward that makes sense with no project selected:
 * choosing one.
 */
export function CarryOnCard({
  carryOn,
  onCapture,
  onSwitchProject,
  onNewActivity,
  testID,
}: {
  carryOn: CarryOn | null
  onCapture: () => void
  onSwitchProject: () => void
  onNewActivity: () => void
  testID?: string
}): React.JSX.Element {
  const { theme } = useTheme()

  const subTestID = (suffix: string): string | undefined => (testID ? `${testID}-${suffix}` : undefined)

  if (carryOn === null) {
    return (
      <Card testID={testID}>
        <View style={{ gap: spacing.sm }}>
          <Type variant="heading">No project yet</Type>
          <Type dim>Choose a project to see what to carry on with.</Type>
          <Button
            testID={subTestID('switch-project')}
            label="Choose a project"
            onPress={onSwitchProject}
          />
        </View>
      </Card>
    )
  }

  return (
    <Card testID={testID}>
      <View style={{ gap: spacing.sm }}>
        <Type variant="label" style={{ color: theme.colors.accent }}>
          {ACTIVITY_KIND_LABEL[carryOn.activityKind]}
        </Type>
        <ProjectName name={carryOn.projectName} />
        <Type variant="heading">{carryOn.activityName}</Type>
        <Type
          variant="small"
          dim
          testID={subTestID('started')}
          accessibilityLabel={`Started ${formatElapsed(carryOn.startedAt)}`}
        >
          {formatElapsed(carryOn.startedAt)}
        </Type>
        <Type variant="small" dim testID={subTestID('captures')}>
          {formatCaptureCount(carryOn.captureCount)}
        </Type>
        <Type variant="small" dim>
          {carryOn.clientName}
        </Type>
        <Button testID={subTestID('capture')} label="CAPTURE" size="field" onPress={onCapture} />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button
            testID={subTestID('switch-project')}
            label="Switch project"
            kind="secondary"
            onPress={onSwitchProject}
          />
          <Button
            testID={subTestID('new-activity')}
            label="New activity"
            kind="secondary"
            onPress={onNewActivity}
          />
        </View>
      </View>
    </Card>
  )
}
