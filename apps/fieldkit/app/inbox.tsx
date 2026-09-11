import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { radii, spacing, touch } from '@corymbia/tokens'
import {
  Button,
  Card,
  ContextStamp,
  Screen,
  TextField,
  Type,
  formatElapsed,
  useTheme,
} from '@corymbia/ui'
import {
  fileRecord,
  listActivities,
  listProjects,
  listUnfiledRecords,
  readCurrentContext,
  type Activity,
  type FieldRecord,
} from '@corymbia/data'
import { useDatabase, useDatabaseStatus, useDevice } from '../src/db/provider'
import { stampFixFor } from '../src/records/stampFix'

/**
 * The Inbox (spec §10.2) — where the launcher's Inbox strip goes, listing
 * every record captured with no activity running, and offering to file each
 * one.
 *
 * **It is a supported destination, not an error state.** Capturing without a
 * context is a way of working the application deliberately allows (rule 4:
 * nothing blocks capture), so nothing on this screen may read as a queue of
 * mistakes: no count of "unassigned" records, no warning colour, no verb that
 * implies she should have done something else. It says what is here and
 * offers to file it.
 *
 * **The filing itself is `fileRecord`'s and none of this screen's.** That
 * function assigns the activity, allocates the sequence and — when a position
 * is given — renumbers everything at and after it, all in one transaction,
 * refusing a record that is already filed and a destination that is dead. It
 * is tested in `@corymbia/data`. This screen's whole job is deciding what to
 * pass it and what to say about the answer.
 *
 * **Two ways to file, and the one-tap one is the common case.** Spec §8.3
 * stamps every capture with the activity that was running at the time
 * precisely so an unfiled record still knows where she was, which makes one
 * tap enough most of the time. The chooser is for the rest.
 */
export default function InboxScreen() {
  const status = useDatabaseStatus()

  // `useDatabase` and `useDevice` both throw before the database is open — the
  // guard has to come before the body that calls them, hence the split into
  // two components rather than an early return inside one (`index.tsx`,
  // `projects.tsx`, `new-activity.tsx`, `capture.tsx`, `records.tsx` and
  // `camera.tsx` all do the same, for the same reason).
  if (status.state !== 'ready') {
    return (
      <Screen testID="inbox" spokenDescription={`Inbox. The database is ${status.state}.`}>
        <Type variant="title">Database {status.state}</Type>
        {status.error ? <Type dim>{status.error.message}</Type> : null}
      </Screen>
    )
  }

  return <InboxBody />
}

/** The live activities of one project, as the chooser groups them. */
type ActivityGroup = { projectId: string; projectName: string; activities: Activity[] }

/**
 * Everything one read of this screen settled, or `null` while the first read
 * is still out.
 *
 * The destinations live in here beside the records rather than in state of
 * their own because they are read together, in one pass, and a half-answer —
 * records listed but no activities yet — would render rows whose one-tap
 * button had not appeared yet and then have it appear under her thumb.
 */
type Listing = {
  records: FieldRecord[]
  groups: ActivityGroup[]
  /**
   * Every live activity by id. This is what decides whether a record's
   * one-tap button exists at all: `fileRecord` refuses a destination that has
   * been deleted, so a button offering one is a control that can only ever
   * produce a refusal — doctrine rule 18's inert control, dressed as the
   * primary action.
   */
  activitiesById: ReadonlyMap<string, Activity>
  /** The activity she is in, marked in the chooser and listed first. */
  currentActivityId: string | null
}

/**
 * A human sentence first, the technical cause subordinate (doctrine rule 6) —
 * the same shape as `records.tsx`'s and `projects.tsx`'s, and trailing
 * sentence punctuation is stripped from the cause for the same reason: a
 * cause ending in its own full stop, glued to this one uncorrected, reads
 * "...is locked.. Try again."
 */
function readMessageFor(cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause)
  return `Your Inbox could not be read: ${detail.replace(/[.?!…]+$/, '')}. Try again.`
}

/**
 * Names the capture that did not move.
 *
 * Doctrine rule 20: this sentence is the only telling she gets that the
 * record is still here, and with a dozen rows on the screen an unattributed
 * "it could not be filed" is a sentence about nothing. The capture number is
 * the right name for it — in the Inbox a record has no sequence, because it
 * is in no activity to be an ordinal within (spec §7.2).
 */
function fileMessageFor(captureNumber: number, cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause)
  return (
    `Capture ${String(captureNumber)} could not be filed: ` +
    `${detail.replace(/[.?!…]+$/, '')}. It is still here. Try again.`
  )
}

/**
 * What she may type into the position field, read.
 *
 * Blank is not a refusal and not a zero — it is the default and the common
 * case, "put it at the end", which is exactly what `fileRecord` does with an
 * omitted position. Everything else has to be a whole number of at least one,
 * because that is what an activity ordinal is.
 *
 * Refused here rather than left to `fileRecord`, which would refuse it too:
 * its refusal arrives as a thrown error dressed as a failure, and this is not
 * a failure. It is a field she has mistyped, and it is said as one, before
 * anything is written — the same reasoning as `new-activity.tsx`'s empty-name
 * refusal.
 */
type PositionChoice =
  | { state: 'chosen'; position: number | undefined }
  | { state: 'refused'; message: string }

const POSITION_MUST_BE_A_PLACE =
  'A position is a whole number, 1 or more — the place in the activity this capture should ' +
  'take. Leave it blank to put it at the end.'

function readPosition(text: string): PositionChoice {
  const trimmed = text.trim()
  if (trimmed.length === 0) return { state: 'chosen', position: undefined }
  // Digits only: `Number('3.5')`, `Number(' 3 ')` and `Number('3e2')` are all
  // numbers, and none of them is a place in a list.
  if (!/^\d+$/.test(trimmed)) return { state: 'refused', message: POSITION_MUST_BE_A_PLACE }
  const position = Number(trimmed)
  if (position < 1) return { state: 'refused', message: POSITION_MUST_BE_A_PLACE }
  return { state: 'chosen', position }
}

/**
 * Puts the activity she is standing in at the top of the chooser, and its
 * project at the top of the list of projects.
 *
 * `listProjects` orders by status and then by recency, which has nothing to do
 * with where she is. The current activity is the likeliest destination for an
 * unfiled capture — it is very often the same one the record's context stamp
 * already names — and it must not be somewhere down a scrolling list.
 */
function withCurrentFirst(
  groups: ActivityGroup[],
  currentActivityId: string | null,
): ActivityGroup[] {
  if (currentActivityId === null) return groups
  const index = groups.findIndex((group) =>
    group.activities.some((activity) => activity.id === currentActivityId),
  )
  const group = index === -1 ? undefined : groups[index]
  if (group === undefined) return groups
  const promoted: ActivityGroup = {
    ...group,
    activities: [
      ...group.activities.filter((activity) => activity.id === currentActivityId),
      ...group.activities.filter((activity) => activity.id !== currentActivityId),
    ],
  }
  return [promoted, ...groups.filter((_, at) => at !== index)]
}

/** Doctrine rule 16: accurate to the exact state this screen is in. */
function describeInbox(
  listing: Listing | null,
  loadError: string | null,
  fileError: string | null,
): string {
  const parts: string[] = ['Inbox.']
  if (listing === null) {
    // Nothing said about the contents while a failed first read is the only
    // thing known about them: "finding what is waiting" would be a claim the
    // screen has already stopped making.
    if (loadError === null) parts.push('Finding what is waiting to be filed.')
  } else if (listing.records.length === 0) {
    parts.push('Nothing waiting.')
  } else {
    // "1 capture waiting", never "1 captures" — the launcher's ledger already
    // shipped "1 unfiled capture are waiting" once.
    const count = listing.records.length
    parts.push(`${String(count)} capture${count === 1 ? '' : 's'} waiting to be filed.`)
  }
  if (loadError !== null) parts.push(loadError)
  if (fileError !== null) parts.push(fileError)
  return parts.join(' ')
}

function InboxBody() {
  const db = useDatabase()
  const device = useDevice()
  const { theme } = useTheme()

  const [listing, setListing] = useState<Listing | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  /** Which row's chooser is open, at most one. Two open choosers are two half-answered questions. */
  const [openRecordId, setOpenRecordId] = useState<string | null>(null)
  const [chosenActivityId, setChosenActivityId] = useState<string | null>(null)
  const [position, setPosition] = useState('')
  const [positionError, setPositionError] = useState<string | null>(null)
  const [filingRecordId, setFilingRecordId] = useState<string | null>(null)

  // Claimed synchronously, before any await — the same reason `camera.tsx`'s
  // `shoot` and `new-activity.tsx`'s `handleSave` claim theirs first: a claim
  // taken after an await can be beaten by a second press landing in the gap
  // before the first await resolves. The `disabled` below is the visible half
  // of the same fact (doctrine rule 18); this is the half that is sound.
  const filingRef = useRef(false)

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Which read the state currently belongs to — the same ticketed pattern
  // `records.tsx`, `projects.tsx` and `useCurrentContext.ts` use, and for the
  // same reason: inbox → capture → back → inbox happens in seconds, and an
  // older read finishing last must not put a filed record back on screen.
  const generation = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    generation.current += 1
    const ticket = generation.current
    try {
      const [records, projects, context] = await Promise.all([
        listUnfiledRecords(db),
        listProjects(db),
        readCurrentContext(db),
      ])
      /*
        The destinations are read once, here, with the list — not when a
        chooser opens. There are few projects and few activities, she may open
        a chooser on every row in turn, and re-querying each time buys nothing
        but a pause between her tap and the list appearing.
      */
      const groups = await Promise.all(
        projects.map(async (project): Promise<ActivityGroup> => {
          return {
            projectId: project.id,
            projectName: project.name,
            activities: await listActivities(db, project.id),
          }
        }),
      )
      if (!mounted.current || ticket !== generation.current) return

      // A project with no activity is not a destination — nothing can be
      // filed into a project — so it is left out rather than rendered as a
      // heading with nothing under it (doctrine rule 18).
      const populated = groups.filter((group) => group.activities.length > 0)
      const currentActivityId = context === null ? null : context.activity.id
      const activitiesById = new Map<string, Activity>()
      for (const group of populated) {
        for (const activity of group.activities) activitiesById.set(activity.id, activity)
      }

      setListing({
        // The order `listUnfiledRecords` hands back — `captured_at DESC`,
        // newest first. This screen never re-sorts: a second ordering here
        // could disagree with the repository's, and the two would be right on
        // different days.
        records,
        groups: withCurrentFirst(populated, currentActivityId),
        activitiesById,
        currentActivityId,
      })
      setLoadError(null)
    } catch (cause) {
      if (!mounted.current || ticket !== generation.current) return
      // Deliberately leaves `listing` alone. What is on the screen was true a
      // moment ago, and replacing it with nothing because a later read failed
      // tells her less, not more (doctrine rule 20).
      setLoadError(readMessageFor(cause))
    }
  }, [db])

  /**
   * Re-read on every focus, not once on mount: she comes here from a capture
   * and back again, and a record taken thirty seconds ago is often the reason
   * she opened this screen.
   *
   * **`listing` is deliberately never set back to `null` here.** It marks the
   * first read only. A refresh that blanked the list would take her Inbox off
   * the screen for as long as the query takes, every time she came back from
   * a capture — the same bug the launcher's card had.
   */
  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )

  const file = useCallback(
    async (record: FieldRecord, activityId: string, at: number | undefined): Promise<void> => {
      if (filingRef.current) return
      filingRef.current = true
      setFilingRecordId(record.id)

      try {
        /*
          No `fix`. `fileRecord` stamps the filing event with where the filing
          happened, the way creation and deletion are stamped (spec §8.5), and
          it is optional for exactly this case: filing in bulk from a list is
          not a positioned act — she may be doing it in the car on the way
          home — and a position invented for it would be a reading nobody
          took. The record's own fix, which is the one that matters, is
          already on the record.
        */
        await fileRecord(db, {
          recordId: record.id,
          activityId,
          deviceId: device.id,
          position: at,
        })
        if (!mounted.current) return
        setFileError(null)
        setOpenRecordId(null)
        setChosenActivityId(null)
        setPosition('')
        setPositionError(null)
        /*
          Re-read rather than drop the row from local state. An optimistic
          removal would tell her the record is filed at the moment the write
          might still fail, and the records list one screen over would
          disagree with this one. What is shown is what the database holds.
        */
        await refresh()
      } catch (cause) {
        if (!mounted.current) return
        // The row stays. Doctrine rule 20: the sentence renders here, on the
        // screen it belongs to, and stays until a filing actually succeeds.
        setFileError(fileMessageFor(record.captureNumber, cause))
      } finally {
        // Reopened in both outcomes, unlike `new-activity.tsx`'s save: nothing
        // here navigates away, so there is no frame after this in which a
        // second press could start a second write against a screen on its way
        // out. She is still standing on the Inbox either way.
        filingRef.current = false
        if (mounted.current) setFilingRecordId(null)
      }
    },
    [db, device.id, refresh],
  )

  /**
   * Opening a chooser abandons whatever was half-answered in the last one.
   * The position she typed belonged to a destination she is no longer
   * choosing, and carrying it across would file a different record at a place
   * she picked for another.
   */
  const toggleChooser = useCallback((recordId: string): void => {
    setOpenRecordId((current) => (current === recordId ? null : recordId))
    setChosenActivityId(null)
    setPosition('')
    setPositionError(null)
  }, [])

  /**
   * Typing answers the refusal that asked for a number. Only that one: a
   * failed write's message is left standing, because typing does not answer
   * it and doctrine rule 20 makes that sentence the only telling she gets.
   */
  const handlePositionChange = useCallback((text: string): void => {
    setPosition(text)
    setPositionError(null)
  }, [])

  const handleConfirm = useCallback(
    (record: FieldRecord, activity: Activity): void => {
      const choice = readPosition(position)
      if (choice.state === 'refused') {
        setPositionError(choice.message)
        return
      }
      void file(record, activity.id, choice.position)
    },
    [file, position],
  )

  const chosenActivity =
    listing === null || chosenActivityId === null
      ? undefined
      : listing.activitiesById.get(chosenActivityId)

  return (
    <Screen testID="inbox" spokenDescription={describeInbox(listing, loadError, fileError)}>
      <ScrollView
        testID="inbox-scroll"
        contentContainerStyle={{ flexGrow: 1, gap: spacing.md }}
        // Doctrine rule 19: a `ScrollView` above a text field eats the first
        // tap on the control that acts on it, because React Native routes
        // touches by the React tree rather than the native one. Without this,
        // her first press of "File into …" only dismisses the keyboard.
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Type testID="inbox-title" variant="title">
          Inbox
        </Type>
        <Type variant="small" dim>
          Captured with no activity running. File them whenever it suits you.
        </Type>

        {/*
          Both sentences render here, on the screen they belong to, and neither
          is dismissible (doctrine rule 20). The filing one is above the rows
          rather than inside one, because the row it is about may be one of
          twelve and may have scrolled — which is why it names its capture.
        */}
        {fileError !== null ? (
          <Type testID="inbox-error" style={{ color: theme.colors.statusPoor }}>
            {fileError}
          </Type>
        ) : null}

        {loadError !== null ? (
          <View style={{ gap: spacing.sm }}>
            <Type testID="inbox-load-error">{loadError}</Type>
            <Button
              testID="inbox-retry"
              label="Try again"
              kind="secondary"
              onPress={() => {
                void refresh()
              }}
            />
          </View>
        ) : null}

        {listing === null ? (
          // Said in words rather than left blank: an empty scroll view is
          // indistinguishable from an empty Inbox.
          loadError === null ? (
            <Type testID="inbox-loading" dim>
              Finding what is waiting to be filed.
            </Type>
          ) : null
        ) : listing.records.length === 0 ? (
          <Type testID="inbox-empty" dim>
            Nothing waiting. Every capture you have taken is already in an activity.
          </Type>
        ) : (
          listing.records.map((record) => {
            /*
              The suggested destination: the activity that was running when
              she took it (spec §8.3). Absent for a capture taken with no
              activity at all, and absent for one whose activity has since
              been deleted — `fileRecord` refuses a dead destination, so the
              button would be a control that can only produce a refusal.
              Either way she gets the chooser and no guess is made for her.
            */
            const suggested =
              record.contextActivityId === null
                ? undefined
                : listing.activitiesById.get(record.contextActivityId)
            const busy = filingRecordId === record.id
            const chooserOpen = openRecordId === record.id

            return (
              <Card key={record.id} testID={`inbox-row-${record.id}`}>
                <View style={{ gap: spacing.sm }}>
                  <View
                    style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}
                  >
                    {/*
                      The capture number, which in the Inbox is the only number
                      this record has: it is in no activity, so it has no
                      sequence to be an ordinal within (spec §7.2). It is also
                      the number written on the tube. The record id never
                      reaches the screen (doctrine rule 6).
                    */}
                    <Type variant="mono">Capture {String(record.captureNumber)}</Type>
                    {/*
                      Doctrine rules 6 and 10: a record with no title says so
                      in a word rather than leaving a blank where a name goes,
                      and a long one clamps at two lines so the buttons below
                      it do not move.
                    */}
                    <Type
                      variant="heading"
                      dim={record.title === null}
                      numberOfLines={2}
                      style={{ flexShrink: 1 }}
                    >
                      {record.title ?? 'Untitled'}
                    </Type>
                  </View>

                  {/*
                    The fix is `ContextStamp`'s to render and no one else's —
                    spec §8.2's three classes are stated once, by that
                    component, and restating them here would be a fourth
                    statement of a rule that must never be blurred.
                  */}
                  <ContextStamp fix={stampFixFor(record.fix)} />

                  <Type variant="small" dim>
                    {formatElapsed(record.capturedAt)}
                  </Type>

                  {suggested !== undefined ? (
                    <Button
                      testID={`inbox-file-${record.id}`}
                      // Doctrine rule 6: the activity's name, never its id.
                      label={`File into ${suggested.name}`}
                      disabled={busy}
                      onPress={() => {
                        // Appending — no position asked for and none invented.
                        // Spec: she asked for insertion because a misfiled
                        // thing should be placeable later, not because she
                        // wants to answer "where" every time.
                        void file(record, suggested.id, undefined)
                      }}
                    />
                  ) : null}

                  <Button
                    testID={`inbox-choose-${record.id}`}
                    label={suggested === undefined ? 'Choose an activity' : 'File somewhere else'}
                    kind="secondary"
                    disabled={busy}
                    onPress={() => {
                      toggleChooser(record.id)
                    }}
                  />

                  {chooserOpen ? (
                    <View testID={`inbox-chooser-${record.id}`} style={{ gap: spacing.md }}>
                      {listing.groups.map((group) => (
                        <View key={group.projectId} style={{ gap: spacing.xs }}>
                          {/*
                            Two projects can each have a "Reach 4 transect".
                            The activity name alone does not say which survey
                            she would be filing into, so the project's name
                            stands over its activities.
                          */}
                          <Type variant="label" dim numberOfLines={1}>
                            {group.projectName}
                          </Type>
                          {group.activities.map((activity) => {
                            const chosen = activity.id === chosenActivityId
                            const current = activity.id === listing.currentActivityId
                            return (
                              <Pressable
                                key={activity.id}
                                testID={`inbox-activity-${activity.id}`}
                                accessibilityRole="button"
                                accessibilityState={{ selected: chosen }}
                                accessibilityLabel={
                                  `${activity.name}` +
                                  `${current ? ', the activity you are in' : ''}` +
                                  `${chosen ? ', chosen' : ''}`
                                }
                                onPress={() => {
                                  setChosenActivityId(activity.id)
                                  setPositionError(null)
                                }}
                                style={({ pressed }) => ({
                                  minHeight: touch.min,
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  gap: spacing.sm,
                                  paddingHorizontal: spacing.md,
                                  borderRadius: radii.md,
                                  // Constant width in both states, so choosing
                                  // does not reflow the list under her thumb.
                                  borderWidth: 2,
                                  borderColor: chosen
                                    ? theme.colors.accent
                                    : theme.colors.border,
                                  backgroundColor: chosen
                                    ? theme.colors.accent
                                    : theme.colors.surfaceRaised,
                                  opacity: pressed ? 0.7 : 1,
                                })}
                              >
                                {/*
                                  Doctrine rule 9: the fill is not allowed to
                                  be the only thing saying which destination is
                                  chosen, and the accent is not allowed to be
                                  the only thing saying which one she is in.
                                  The mark and the word "current" are the
                                  second channel in glare; `accessibilityState`
                                  and the spoken label are the second channel
                                  for a screen reader.
                                */}
                                {chosen ? (
                                  <Type
                                    variant="heading"
                                    style={{ color: theme.colors.textOnAccent }}
                                  >
                                    ✓
                                  </Type>
                                ) : null}
                                <Type
                                  variant="heading"
                                  numberOfLines={2}
                                  style={{
                                    flexShrink: 1,
                                    color: chosen
                                      ? theme.colors.textOnAccent
                                      : theme.colors.textPrimary,
                                  }}
                                >
                                  {activity.name}
                                </Type>
                                {current ? (
                                  <Type
                                    variant="small"
                                    style={{
                                      color: chosen
                                        ? theme.colors.textOnAccent
                                        : theme.colors.textDim,
                                    }}
                                  >
                                    current
                                  </Type>
                                ) : null}
                              </Pressable>
                            )
                          })}
                        </View>
                      ))}

                      {/*
                        Nothing further is asked until she has chosen a
                        destination: a position with no activity is a place in
                        no list, and a confirm button with nowhere to file to
                        is doctrine rule 18's control that can only swallow the
                        tap.
                      */}
                      {chosenActivity !== undefined ? (
                        <View style={{ gap: spacing.sm }}>
                          <TextField
                            label="POSITION IN THE ACTIVITY (OPTIONAL)"
                            testID="inbox-position"
                            accessibilityLabel="Position in the activity. Optional; leave it blank to put this capture at the end."
                            value={position}
                            onChangeText={handlePositionChange}
                            keyboardType="number-pad"
                            placeholder="At the end"
                          />
                          {positionError !== null ? (
                            <Type
                              testID="inbox-position-error"
                              style={{ color: theme.colors.statusPoor }}
                            >
                              {positionError}
                            </Type>
                          ) : null}
                          <Button
                            testID="inbox-confirm"
                            label={`File into ${chosenActivity.name}`}
                            size="field"
                            disabled={busy}
                            onPress={() => {
                              handleConfirm(record, chosenActivity)
                            }}
                          />
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              </Card>
            )
          })
        )}
      </ScrollView>
    </Screen>
  )
}
