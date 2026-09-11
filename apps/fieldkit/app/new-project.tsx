import React, { useCallback, useRef, useState } from 'react'
import { ScrollView } from 'react-native'
import { router } from 'expo-router'
import { spacing } from '@corymbia/tokens'
import { Button, Screen, TextField, Type, useTheme } from '@corymbia/ui'
import { createProject } from '@corymbia/data'
import { useDatabase, useDatabaseStatus } from '../src/db/provider'

/**
 * Creating a project (spec §7.3, §10.3): a name and nothing else is required.
 *
 * **Deliberately not a wizard.** `createProject` already defaults a skipped
 * client to "Corymbia (internal)" and a skipped location to "Office / Lab"
 * (`DEFAULT_CLIENT_ID`, `DEFAULT_LOCATION_ID`), so asking for a name alone is
 * a complete, well-formed call — not a shortcut around validation this screen
 * has to reimplement.
 *
 * **Client typeahead and location lookup are not on this screen.** Spec
 * §10.3 wants both eventually, and §8.4 requires location lookup to work
 * offline, but neither has a data layer yet: there is no `listClients` query
 * and no location search. Building a typeahead over a query that does not
 * exist would be a control with nothing behind it, so this screen ships only
 * the three fields that already have somewhere to go — name, description,
 * short label — and leaves client and location on their defaults.
 */
export default function NewProjectScreen() {
  const status = useDatabaseStatus()

  // `createProject` reads the database out of context, and `useDatabase`
  // throws before it is open — the guard has to come before the body that
  // calls it, hence the split into two components (`index.tsx`, `capture.tsx`
  // and `camera.tsx` all do the same, for the same reason).
  if (status.state !== 'ready') {
    return (
      <Screen
        testID="new-project"
        spokenDescription={`New project. The database is ${status.state}, so it cannot be saved yet.`}
      >
        <Type variant="title">Database {status.state}</Type>
        {status.error ? <Type dim>{status.error.message}</Type> : null}
      </Screen>
    )
  }

  return <NewProjectBody />
}

/**
 * A human sentence first, the technical cause subordinate (doctrine rule 6) —
 * the same shape as `camera.tsx`'s `messageFor`. Trailing sentence
 * punctuation is stripped from the cause before this sentence adds its own,
 * for the same reason `camera.tsx` strips it: a cause ending in its own full
 * stop, glued to this one uncorrected, reads "...is locked.. Try again."
 */
function messageFor(cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause)
  return `The project could not be saved: ${detail.replace(/[.?!…]+$/, '')}. Try again.`
}

/**
 * The refusal an empty name earns. A module constant rather than a literal in
 * `handleSave`, because `handleNameChange` below has to recognise it: typing
 * a name answers this message and nothing else.
 */
const NEEDS_A_NAME = 'A project needs a name. Type one before saving.'

function NewProjectBody() {
  const db = useDatabase()
  const { theme } = useTheme()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [shortLabel, setShortLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Claimed synchronously, before any await — the same reason `camera.tsx`'s
  // `shoot` claims `savingRef` first: a claim taken after an await can be
  // beaten by a second press landing in the gap before the first `await`
  // resolves.
  const savingRef = useRef(false)

  /**
   * Typing a name clears the refusal that asked for one — otherwise the
   * sentence "A project needs a name" stays on screen, and in the spoken
   * description, while she is looking at the name she has just typed.
   *
   * Only that message. A failed write's message is left standing, because
   * typing does not answer it and doctrine rule 20 makes that sentence the
   * only telling she gets that the write did not land.
   */
  const handleNameChange = useCallback((text: string): void => {
    setName(text)
    setError((current) => (current === NEEDS_A_NAME ? null : current))
  }, [])

  const handleSave = useCallback(async (): Promise<void> => {
    if (savingRef.current) return

    const trimmedName = name.trim()
    if (trimmedName.length === 0) {
      // Doctrine rule 18: a save that silently does nothing on an empty name
      // is exactly the control that must not exist. This says what is
      // missing instead.
      setError(NEEDS_A_NAME)
      return
    }

    savingRef.current = true
    setSaving(true)
    setError(null)

    const input: { name: string; description?: string; shortLabel?: string } = {
      name: trimmedName,
    }
    const trimmedDescription = description.trim()
    if (trimmedDescription.length > 0) input.description = trimmedDescription
    const trimmedShortLabel = shortLabel.trim()
    if (trimmedShortLabel.length > 0) input.shortLabel = trimmedShortLabel

    try {
      await createProject(db, input)
      // The success path deliberately leaves the guard closed and `saving`
      // true, and there is deliberately no `finally`: a `finally` runs after
      // this navigation, and the frames between it and the unmount are
      // exactly where a second press would start a second project. Nothing
      // is set after the navigation either, for the same reason — this
      // component is on its way out. Mirrors `new-activity.tsx`'s
      // `handleSave`.
      router.back()
    } catch (cause) {
      // Reopened only here: the save failed, she is still on this screen, and
      // the retry has to be pressable.
      savingRef.current = false
      setSaving(false)
      setError(messageFor(cause))
    }
  }, [db, name, description, shortLabel])

  return (
    <Screen
      testID="new-project"
      spokenDescription={
        error !== null
          ? `New project. ${error}`
          : 'New project. A name, and optionally a description and a short label. Only the name is required.'
      }
    >
      <ScrollView
        testID="new-project-scroll"
        contentContainerStyle={{ gap: spacing.lg }}
        // The one place this screen has to get right per doctrine rule 19: a
        // `ScrollView` above the surface eats the save button's first tap
        // unless this is set, because React Native routes touches by the
        // React tree rather than the native one.
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TextField
          label="NAME"
          testID="new-project-name"
          accessibilityLabel="Project name"
          value={name}
          onChangeText={handleNameChange}
          placeholder="Tambo River eDNA"
        />

        <TextField
          label="SHORT LABEL (OPTIONAL)"
          testID="new-project-short-label"
          accessibilityLabel="Short label"
          value={shortLabel}
          onChangeText={setShortLabel}
          placeholder="Tambo"
        />

        <TextField
          label="DESCRIPTION (OPTIONAL)"
          testID="new-project-description"
          accessibilityLabel="Project description"
          value={description}
          onChangeText={setDescription}
          placeholder="What this project is for"
          multiline
        />

        {error !== null ? (
          <Type testID="new-project-error" style={{ color: theme.colors.statusPoor }}>
            {error}
          </Type>
        ) : null}

        {/*
          Doctrine rule 18: a control mid-write is genuinely disabled, not
          quietly inert. `savingRef` still guards the handler — it is claimed
          synchronously, ahead of any re-render — but a button that looks
          pressable and swallows the tap teaches her the tap did not register
          when it did.
        */}
        <Button
          testID="new-project-save"
          label={saving ? 'Saving…' : 'Save project'}
          size="field"
          disabled={saving}
          onPress={() => {
            void handleSave()
          }}
        />
      </ScrollView>
    </Screen>
  )
}
