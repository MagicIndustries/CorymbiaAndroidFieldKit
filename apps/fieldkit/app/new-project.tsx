import React, { useCallback, useRef, useState } from 'react'
import { ScrollView, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { field, radii, spacing, touch, type Theme } from '@corymbia/tokens'
import { Button, Screen, Type, useTheme } from '@corymbia/ui'
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

  const handleSave = useCallback(async (): Promise<void> => {
    if (savingRef.current) return

    const trimmedName = name.trim()
    if (trimmedName.length === 0) {
      // Doctrine rule 18: a save that silently does nothing on an empty name
      // is exactly the control that must not exist. This says what is
      // missing instead.
      setError('A project needs a name. Type one before saving.')
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
      router.back()
    } catch (cause) {
      setError(messageFor(cause))
    } finally {
      savingRef.current = false
      setSaving(false)
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
        <View style={{ gap: spacing.xs }}>
          <Type variant="label" dim>
            NAME
          </Type>
          <TextInput
            testID="new-project-name"
            accessibilityLabel="Project name"
            value={name}
            onChangeText={setName}
            placeholder="Tambo River eDNA"
            placeholderTextColor={theme.colors.textDim}
            style={inputStyle(theme)}
          />
        </View>

        <View style={{ gap: spacing.xs }}>
          <Type variant="label" dim>
            SHORT LABEL (OPTIONAL)
          </Type>
          <TextInput
            testID="new-project-short-label"
            accessibilityLabel="Short label"
            value={shortLabel}
            onChangeText={setShortLabel}
            placeholder="Tambo"
            placeholderTextColor={theme.colors.textDim}
            style={inputStyle(theme)}
          />
        </View>

        <View style={{ gap: spacing.xs }}>
          <Type variant="label" dim>
            DESCRIPTION (OPTIONAL)
          </Type>
          <TextInput
            testID="new-project-description"
            accessibilityLabel="Project description"
            value={description}
            onChangeText={setDescription}
            placeholder="What this project is for"
            placeholderTextColor={theme.colors.textDim}
            multiline
            style={[inputStyle(theme), { minHeight: field.control, textAlignVertical: 'top' }]}
          />
        </View>

        {error !== null ? (
          <Type testID="new-project-error" style={{ color: theme.colors.statusPoor }}>
            {error}
          </Type>
        ) : null}

        <Button
          testID="new-project-save"
          label={saving ? 'Saving…' : 'Save project'}
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
