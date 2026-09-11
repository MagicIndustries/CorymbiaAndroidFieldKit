import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, TextInput, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { radii, spacing, touch, type Theme } from '@corymbia/tokens'
import { Button, Screen, Type, useTheme } from '@corymbia/ui'
import {
  ACTIVITY_KINDS,
  createActivity,
  getProject,
  setCurrentActivity,
  type ActivityKind,
  type Project,
} from '@corymbia/data'
import { useDatabase, useDatabaseStatus } from '../src/db/provider'

/**
 * Starting an activity (spec §7.4, §10.1) — reached two ways: from
 * `projects.tsx` when the project she chose has no activity to resume, and
 * from the launcher's "New activity" when she wants a fresh one in the
 * project she is already in. Both carry the project id as a route parameter,
 * because an activity cannot exist without a project to belong to.
 *
 * **Starting an activity selects it.** She started it because she is about
 * to work in it; making her then go and choose it is a tap that answers a
 * question she has already answered. That is why this screen ends on the
 * launcher rather than on whichever screen it was pushed from: the launcher
 * is where the new activity becomes the card she captures from.
 *
 * **The kind is not decoration.** It orders the launcher's tool tiles
 * (`ToolTiles`, spec §10.1), so this screen decides what she sees when she
 * gets back.
 */
export default function NewActivityScreen() {
  const status = useDatabaseStatus()

  // `useDatabase` throws before the database is open — the guard has to come
  // before the body that calls it, hence the split into components rather
  // than an early return inside one (`index.tsx`, `projects.tsx`,
  // `new-project.tsx`, `capture.tsx` and `camera.tsx` all do the same, for
  // the same reason).
  if (status.state !== 'ready') {
    return (
      <Screen
        testID="new-activity"
        spokenDescription={`New activity. The database is ${status.state}, so one cannot be started yet.`}
      >
        <Type variant="title">Database {status.state}</Type>
        {status.error ? <Type dim>{status.error.message}</Type> : null}
      </Screen>
    )
  }

  return <NewActivityBody />
}

/**
 * A human sentence first, the technical cause subordinate (doctrine rule 6) —
 * the same shape as `new-project.tsx`'s `messageFor`, and trailing sentence
 * punctuation is stripped from the cause for the same reason: a cause ending
 * in its own full stop, glued to this one uncorrected, reads "...is locked..
 * Try again."
 */
function messageFor(cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause)
  return `The activity could not be saved: ${detail.replace(/[.?!…]+$/, '')}. Try again.`
}

function lookupMessageFor(cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause)
  return `That project could not be opened: ${detail.replace(/[.?!…]+$/, '')}.`
}

/**
 * What she reads for each kind. Keyed by `ActivityKind`, so a sixth kind
 * added to `ACTIVITY_KINDS` is a compile error here rather than a chip with
 * a blank label — the same device `CarryOnCard`'s `ACTIVITY_KIND_LABEL` uses,
 * and deliberately the same wording, so a kind is called the same thing on
 * the screen that starts it and on the card that resumes it.
 *
 * It is not shared with that component: `@corymbia/ui` renders what it is
 * handed and depends on no repository, which is what keeps it testable
 * without a database.
 */
const KIND_LABEL: Readonly<Record<ActivityKind, string>> = Object.freeze({
  survey: 'Survey',
  sampling: 'Sampling',
  collection: 'Collection',
  workshop: 'Workshop',
  meeting: 'Meeting',
})

/**
 * Resolves the project the route named, and renders one of three things: the
 * form, the "no project" state, or the moment before either is known.
 *
 * **The no-project state carries no form and no save button.** A missing
 * parameter, a project that has been deleted and a read that failed all land
 * here, and in every one of them there is nothing a save could be written
 * against — a form whose save could only fail is exactly the control doctrine
 * rule 18 says must not exist. She gets a sentence and the one way forward.
 */
function NewActivityBody() {
  const db = useDatabase()
  const { projectId } = useLocalSearchParams<{ projectId?: string }>()

  // `undefined` is "not answered yet", distinct from `null`, which is the
  // settled answer "there is no project to start this in".
  const [project, setProject] = useState<Project | null | undefined>(undefined)
  const [lookupError, setLookupError] = useState<string | null>(null)

  useEffect(() => {
    if (projectId === undefined) {
      // Nothing to look up, and not a failure: the launcher can reach this
      // screen on a first run with no project selected at all.
      setProject(null)
      setLookupError(null)
      return
    }

    // Guards the `setState` after the await: she can leave this screen while
    // the read is still in flight, and a second read started by a changed
    // parameter must not be overwritten by the first one landing late.
    let current = true
    void (async () => {
      try {
        const found = await getProject(db, projectId)
        if (!current) return
        setProject(found)
        setLookupError(null)
      } catch (cause) {
        if (!current) return
        setProject(null)
        setLookupError(lookupMessageFor(cause))
      }
    })()
    return () => {
      current = false
    }
  }, [db, projectId])

  if (project === undefined) {
    return (
      <Screen testID="new-activity" spokenDescription="New activity. Finding the project.">
        <Type variant="title">One moment</Type>
        <Type dim>Finding the project.</Type>
      </Screen>
    )
  }

  if (project === null) {
    const sentence =
      lookupError ?? 'No project has been chosen, so there is nothing to start an activity in.'
    return (
      <Screen
        testID="new-activity"
        spokenDescription={`New activity. ${sentence} Choose a project to go on.`}
      >
        <View style={{ gap: spacing.lg }}>
          <Type testID="new-activity-no-project">{sentence}</Type>
          <Button
            testID="new-activity-choose-project"
            label="Choose a project"
            onPress={() => {
              router.push('/projects')
            }}
          />
        </View>
      </Screen>
    )
  }

  return <NewActivityForm project={project} />
}

function NewActivityForm({ project }: { project: Project }) {
  const db = useDatabase()
  const { theme } = useTheme()

  // Survey is the starting kind rather than nothing at all: spec §10.1 treats
  // a survey as the primary case, and a screen that refuses to save until she
  // has chosen from five equally plausible chips is a required field standing
  // between her and the work. Every chip is one tap away if it is wrong.
  const [kind, setKind] = useState<ActivityKind>('survey')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Claimed synchronously, before any await — the same reason `camera.tsx`'s
  // `shoot` and `new-project.tsx`'s `handleSave` claim theirs first: a claim
  // taken after an await can be beaten by a second press landing in the gap
  // before the first await resolves.
  const savingRef = useRef(false)

  const handleSave = useCallback(async (): Promise<void> => {
    if (savingRef.current) return

    const trimmedName = name.trim()
    if (trimmedName.length === 0) {
      // Doctrine rule 18: a save that silently does nothing on an empty name
      // is exactly the control that must not exist. `createActivity` would
      // refuse this too, but its refusal arrives as a thrown error dressed
      // as a failure — this is not a failure, it is a field she has not
      // filled in yet, and it is said as one.
      setError('An activity needs a name. Type one before saving.')
      return
    }

    savingRef.current = true
    setSaving(true)
    setError(null)

    try {
      const created = await createActivity(db, {
        projectId: project.id,
        kind,
        name: trimmedName,
      })
      // Only now, and only with the id the database actually returned: a
      // creation that failed must not select an activity that does not
      // exist. `setCurrentActivity` refuses an unknown id anyway, so the
      // wrong order here would surface as a second failure rather than as a
      // bad selection — but it would surface after she had been told the
      // save failed, which is worse than not trying.
      await setCurrentActivity(db, created.id)
      // Not `back()`: this screen is pushed from two different places, and
      // the launcher is where the activity she just started becomes the card
      // she captures from. The launcher re-reads on focus, so it is already
      // showing the new activity by the time she lands.
      router.dismissTo('/')
    } catch (cause) {
      setError(messageFor(cause))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [db, project.id, kind, name])

  return (
    <Screen
      testID="new-activity"
      spokenDescription={
        error !== null
          ? `New activity in ${project.name}. ${error}`
          : `New activity in ${project.name}. ${KIND_LABEL[kind]} is the chosen kind. ` +
            'Type a name and save. Only the name is required.'
      }
    >
      <ScrollView
        testID="new-activity-scroll"
        contentContainerStyle={{ gap: spacing.lg }}
        // Doctrine rule 19: a `ScrollView` above the surface eats the save
        // button's first tap unless this is set, because React Native routes
        // touches by the React tree rather than the native one.
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={{ gap: spacing.xs }}>
          <Type variant="label" dim>
            GOING INTO
          </Type>
          {/* Doctrine rule 6: the project's name, never the id the route carried. */}
          <Type testID="new-activity-project" variant="heading">
            {project.name}
          </Type>
        </View>

        <View style={{ gap: spacing.sm }}>
          <Type variant="label" dim>
            KIND
          </Type>
          {/*
            One chip per kind, mapped from `ACTIVITY_KINDS` rather than from a
            list written out here: a sixth kind added to the repository has to
            appear on this screen without anyone remembering to add it.
          */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {ACTIVITY_KINDS.map((option) => {
              const selected = option === kind
              return (
                <Pressable
                  key={option}
                  testID={`activity-kind-${option}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={
                    selected ? `${KIND_LABEL[option]}, chosen` : KIND_LABEL[option]
                  }
                  onPress={() => {
                    setKind(option)
                  }}
                  style={({ pressed }) => ({
                    minHeight: touch.min,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.xs,
                    paddingHorizontal: spacing.md,
                    borderRadius: radii.pill,
                    // Constant width in both states, so choosing a kind does
                    // not reflow the row under her thumb.
                    borderWidth: 2,
                    borderColor: selected ? theme.colors.accent : theme.colors.border,
                    backgroundColor: selected ? theme.colors.accent : theme.colors.surfaceRaised,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  {/*
                    Doctrine rule 9: the fill is not allowed to be the only
                    thing saying which kind is chosen. The mark is the second
                    channel in glare, `accessibilityState` the second channel
                    for a screen reader.
                  */}
                  {selected ? (
                    <Type
                      testID={`activity-kind-${option}-chosen`}
                      variant="heading"
                      style={{ color: theme.colors.textOnAccent }}
                    >
                      ✓
                    </Type>
                  ) : null}
                  <Type
                    variant="heading"
                    style={{
                      color: selected ? theme.colors.textOnAccent : theme.colors.textPrimary,
                    }}
                  >
                    {KIND_LABEL[option]}
                  </Type>
                </Pressable>
              )
            })}
          </View>
        </View>

        <View style={{ gap: spacing.xs }}>
          <Type variant="label" dim>
            NAME
          </Type>
          <TextInput
            testID="new-activity-name"
            accessibilityLabel="Activity name"
            value={name}
            onChangeText={setName}
            placeholder="Reach 4 transect"
            placeholderTextColor={theme.colors.textDim}
            style={inputStyle(theme)}
          />
        </View>

        {error !== null ? (
          <Type testID="new-activity-error" style={{ color: theme.colors.statusPoor }}>
            {error}
          </Type>
        ) : null}

        <Button
          testID="new-activity-save"
          label={saving ? 'Starting…' : 'Start activity'}
          size="field"
          onPress={() => {
            void handleSave()
          }}
        />
      </ScrollView>
    </Screen>
  )
}

function inputStyle(theme: Theme) {
  return {
    minHeight: touch.min,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    color: theme.colors.textPrimary,
    paddingHorizontal: spacing.md,
  }
}
