import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { spacing, touch } from '@corymbia/tokens'
import { Button, Card, Screen, Type } from '@corymbia/ui'
import {
  listActivities,
  listProjects,
  setCurrentActivity,
  type Project,
} from '@corymbia/data'
import { useDatabase, useDatabaseStatus } from '../src/db/provider'

/**
 * The project list (spec §10.3) — where "Switch project" on the launcher
 * goes. The most recent in-progress project is highlighted, "Start a new
 * project" is prominent, and choosing a project chooses an activity: that is
 * what the launcher actually resumes into (spec §10.1), so a tap here cannot
 * leave her in a project with nothing to capture into. See `handleSelect`
 * below for what happens when the chosen project has no activity yet.
 */
export default function ProjectsScreen() {
  const status = useDatabaseStatus()

  // `useDatabase` throws before the database is open — the guard has to come
  // before the body that calls it, hence the split into two components
  // rather than an early return inside one (`index.tsx`, `capture.tsx` and
  // `camera.tsx` all do the same, for the same reason).
  if (status.state !== 'ready') {
    return (
      <Screen
        testID="projects"
        spokenDescription={`Projects. The database is ${status.state}.`}
      >
        <Type variant="title">Database {status.state}</Type>
        {status.error ? <Type dim>{status.error.message}</Type> : null}
      </Screen>
    )
  }

  return <ProjectsBody />
}

/**
 * A human sentence first, the technical cause subordinate (doctrine rule 6) —
 * the same shape as `camera.tsx`'s `messageFor`.
 */
function messageFor(cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause)
  return `Projects could not be loaded: ${detail.replace(/[.?!…]+$/, '')}. Try again.`
}

/**
 * Which project counts as "the most recent in-progress" one (spec §10.3).
 *
 * `listProjects` already orders active projects first and, within that, most
 * recently updated first (`packages/data/src/repositories/projects.ts`), so
 * the most recent in-progress project — if there is one — is always the
 * first row, and only when that row is still active rather than archived. No
 * second query is needed: re-deriving "in progress" from activities would
 * duplicate an ordering the repository already guarantees, for the same
 * answer.
 */
function highlightedProjectId(projects: readonly Project[]): string | null {
  const first = projects[0]
  return first !== undefined && first.status === 'active' ? first.id : null
}

/** Doctrine rule 16: accurate to the exact state this screen is in. */
function describeProjects(projects: Project[] | null, error: string | null): string {
  if (error !== null) return `Projects. ${error}`
  if (projects === null) return 'Projects. Finding your projects.'
  if (projects.length === 0) {
    return 'Projects. No projects yet. Start a new project to begin.'
  }
  const highlightId = highlightedProjectId(projects)
  const highlight = projects.find((project) => project.id === highlightId)
  const highlightText =
    highlight === undefined ? '' : ` ${highlight.name} is the most recent, in progress.`
  const count = `${projects.length} project${projects.length === 1 ? '' : 's'}`
  return `Projects. ${count}.${highlightText} Choose one to switch to it, or start a new project.`
}

function ProjectsBody() {
  const db = useDatabase()
  const router = useRouter()
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [switchingId, setSwitchingId] = useState<string | null>(null)

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Which `listProjects` call the state currently belongs to — the same
  // ticketed pattern `useCurrentContext.ts` and `capture.tsx`'s media refresh
  // use, and for the same reason: launcher → projects → back → projects
  // happens in seconds, and an older read finishing last must not overwrite
  // a newer one.
  const generation = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    generation.current += 1
    const ticket = generation.current
    try {
      const rows = await listProjects(db)
      if (!mounted.current || ticket !== generation.current) return
      setProjects(rows)
      setError(null)
    } catch (cause) {
      if (!mounted.current || ticket !== generation.current) return
      setError(messageFor(cause))
    }
  }, [db])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )

  /**
   * Selecting a project must select an activity, because the launcher's
   * context is an activity, not a project (spec §10.1). A project with
   * activities resumes its most recent one; a project with none is left in a
   * context that cannot capture, so this sends her to start one instead —
   * the same `/new-activity` route Task 7 builds, carrying the project id so
   * that screen knows which project the new activity belongs to.
   *
   * `switchingRef` is claimed before the first `await`, the same guard
   * `camera.tsx`'s `shoot` uses and for the same reason: a claim taken after
   * an await can be beaten by a second press landing in the gap.
   */
  const switchingRef = useRef(false)
  const handleSelect = useCallback(
    async (project: Project): Promise<void> => {
      if (switchingRef.current) return
      switchingRef.current = true
      setSwitchingId(project.id)
      setError(null)
      try {
        const activities = await listActivities(db, project.id)
        const mostRecent = activities[0]
        if (mostRecent === undefined) {
          router.push({ pathname: '/new-activity', params: { projectId: project.id } })
          return
        }
        await setCurrentActivity(db, mostRecent.id)
        router.back()
      } catch (cause) {
        if (!mounted.current) return
        setError(messageFor(cause))
      } finally {
        switchingRef.current = false
        if (mounted.current) setSwitchingId(null)
      }
    },
    [db, router],
  )

  const highlightId = projects === null ? null : highlightedProjectId(projects)

  return (
    <Screen testID="projects" spokenDescription={describeProjects(projects, error)}>
      <ScrollView
        testID="projects-scroll"
        contentContainerStyle={{ flexGrow: 1, gap: spacing.md }}
        showsVerticalScrollIndicator={false}
      >
        <Button
          testID="projects-new"
          label="Start a new project"
          onPress={() => {
            router.push('/new-project')
          }}
        />

        {error !== null ? (
          <View style={{ gap: spacing.sm }}>
            <Type testID="projects-error">{error}</Type>
            <Button
              testID="projects-retry"
              label="Try again"
              kind="secondary"
              onPress={() => {
                void refresh()
              }}
            />
          </View>
        ) : null}

        {/*
          Rendered unconditionally against `projects === null` — the first
          read, not a state to guess an empty list in — but the choice
          between the empty state and the list itself is the one branch this
          screen cannot collapse: an empty list rendered as a list is a blank
          scroll view with nothing on it, and she would have no way to tell
          "no projects yet" apart from "still loading" apart from "the list
          failed to load quietly".
        */}
        {projects === null ? null : projects.length === 0 ? (
          <Type testID="projects-empty" dim>
            No projects yet. Start a new project to begin.
          </Type>
        ) : (
          projects.map((project) => {
            const selected = project.id === highlightId
            const busy = switchingId === project.id
            return (
              <Pressable
                key={project.id}
                testID={`project-${project.id}`}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: busy }}
                accessibilityLabel={
                  selected ? `${project.name}, most recent, in progress` : project.name
                }
                disabled={busy}
                onPress={() => {
                  void handleSelect(project)
                }}
                style={({ pressed }) => ({
                  minHeight: touch.comfortable,
                  opacity: pressed || busy ? 0.7 : 1,
                })}
              >
                <Card accent={selected}>
                  <View style={{ gap: spacing.xs }}>
                    <Type variant="heading">{project.name}</Type>
                    {selected ? (
                      <Type variant="small" dim>
                        Most recent, in progress
                      </Type>
                    ) : null}
                  </View>
                </Card>
              </Pressable>
            )
          })
        )}
      </ScrollView>
    </Screen>
  )
}
