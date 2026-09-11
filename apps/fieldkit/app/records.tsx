import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { spacing } from '@corymbia/tokens'
import { Button, Card, ContextStamp, Screen, Type, formatElapsed } from '@corymbia/ui'
import { listRecords, readCurrentContext, type FieldRecord } from '@corymbia/data'
import { useDatabase, useDatabaseStatus } from '../src/db/provider'
import { stampFixFor } from '../src/records/stampFix'

/**
 * The records list (spec §7.2, §10.1) — where the launcher's Records tile
 * goes, and the screen the owner went looking for after capturing and could
 * not find. Everything she recorded in the activity she is in, newest first.
 *
 * **The sequence, never the capture number.** Spec §7.2 keeps two numbers per
 * record and they answer different questions: the capture number is the
 * stable one safe to write on a sample tube, and the sequence is the ordinal
 * within this activity — which is what makes a number mean anything in the
 * survey she is walking. This list is about the survey, so it shows the
 * sequence and the capture number never reaches the screen. Neither does the
 * record id (doctrine rule 6).
 */
export default function RecordsScreen() {
  const status = useDatabaseStatus()

  // `useDatabase` throws before the database is open — the guard has to come
  // before the body that calls it, hence the split into two components
  // rather than an early return inside one (`index.tsx`, `projects.tsx`,
  // `new-activity.tsx`, `capture.tsx` and `camera.tsx` all do the same, for
  // the same reason).
  if (status.state !== 'ready') {
    return (
      <Screen
        testID="records"
        spokenDescription={`Records. The database is ${status.state}.`}
      >
        <Type variant="title">Database {status.state}</Type>
        {status.error ? <Type dim>{status.error.message}</Type> : null}
      </Screen>
    )
  }

  return <RecordsBody />
}

/**
 * What this screen has settled on, or `null` while the first read is still
 * out. The two empty answers are separate members rather than one empty list
 * because they are different facts: "you have not chosen an activity" and
 * "this activity has nothing in it yet" are told apart below, and collapsing
 * them would tell her an activity is empty when she has not chosen one.
 */
type Listing =
  | { state: 'no-activity' }
  | { state: 'listed'; activityName: string; records: FieldRecord[] }

/**
 * A human sentence first, the technical cause subordinate (doctrine rule 6) —
 * the same shape as `projects.tsx`'s `messageFor`, and trailing sentence
 * punctuation is stripped from the cause for the same reason: a cause ending
 * in its own full stop, glued to this one uncorrected, reads "...is locked..
 * Try again."
 */
function messageFor(cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause)
  return `Your records could not be read: ${detail.replace(/[.?!…]+$/, '')}. Try again.`
}

/**
 * The number she reads, zero-padded so a column of them lines up and "7"
 * after "12" does not look like a mistake. Deliberately bare: the record kind
 * is `pin` today, and a label like "Pin 007" baked in here would be wrong the
 * first time a record of another kind is listed.
 *
 * The null branch is what the type permits and the schema refuses:
 * migration 003's `record_sequence_tracks_activity` makes activity and
 * sequence exist together, so nothing `listRecords` returns for an activity
 * can be unnumbered. A row from a database written before that constraint
 * still could be, and showing a dash is the honest answer — inventing a
 * number, or an `as number` to make the case disappear, would not be.
 */
function formatSequence(sequence: number | null): string {
  return sequence === null ? '—' : String(sequence).padStart(3, '0')
}

/** Doctrine rule 16: "007" read aloud is not a number, it is three digits. */
function sequenceLabel(sequence: number | null): string {
  return sequence === null
    ? 'Not numbered in this activity'
    : `Number ${String(sequence)} in this activity`
}

/** Doctrine rule 16: accurate to the exact state this screen is in. */
function describeRecords(listing: Listing | null, error: string | null): string {
  if (listing === null) {
    return error === null ? 'Records. Finding what you have recorded.' : `Records. ${error}`
  }

  if (listing.state === 'no-activity') {
    const sentence =
      'No activity is chosen, so there is nothing to list. Choose a project to go on.'
    return error === null ? `Records. ${sentence}` : `Records. ${sentence} ${error}`
  }

  const { activityName, records } = listing
  // "1 record", never "1 records" — the ledger already caught "1 unfiled
  // capture are waiting" once, and this is the same sentence one screen over.
  const head =
    records.length === 0
      ? `Records. Nothing recorded in ${activityName} yet.`
      : `Records in ${activityName}. ${String(records.length)} ` +
        `record${records.length === 1 ? '' : 's'}, newest first.`
  return error === null ? head : `${head} ${error}`
}

function RecordsBody() {
  const db = useDatabase()
  const router = useRouter()
  const [listing, setListing] = useState<Listing | null>(null)
  const [error, setError] = useState<string | null>(null)

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Which read the state currently belongs to — the same ticketed pattern
  // `projects.tsx` and `useCurrentContext.ts` use, and for the same reason:
  // launcher → capture → back → records happens in seconds, and an older
  // read finishing last must not put a vanished record back on screen.
  const generation = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    generation.current += 1
    const ticket = generation.current
    try {
      const context = await readCurrentContext(db)
      // Not `useCurrentContext`: that hook already calls `listRecords` for
      // the launcher's capture count, and going through it here would query
      // the same rows twice to render them once.
      const records = context === null ? [] : await listRecords(db, context.activity.id)
      if (!mounted.current || ticket !== generation.current) return
      setListing(
        context === null
          ? { state: 'no-activity' }
          : {
              state: 'listed',
              activityName: context.activity.name,
              // The order `listRecords` hands back — `captured_at DESC`,
              // newest first. This screen never re-sorts: a second ordering
              // here could disagree with the repository's, and then the two
              // would be right on different days.
              records,
            },
      )
      setError(null)
    } catch (cause) {
      if (!mounted.current || ticket !== generation.current) return
      // Deliberately leaves `listing` alone. What is on the screen was true a
      // moment ago, and replacing it with nothing because a later read failed
      // tells her less, not more (doctrine rule 20).
      setError(messageFor(cause))
    }
  }, [db])

  /**
   * Re-read on every focus, not once on mount: she comes here from a capture
   * and back again, and a record taken thirty seconds ago is the whole reason
   * she opened this screen.
   *
   * **`listing` is deliberately never set back to `null` here.** It marks the
   * first read only. A refresh that blanked the list would take her records
   * off the screen for as long as the query takes, every single time she came
   * back from a capture — the same bug the launcher's card had, and the
   * reason `useCurrentContext` never sets `loading` back to true either.
   */
  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )

  const title = listing !== null && listing.state === 'listed' ? listing.activityName : 'Records'

  return (
    <Screen testID="records" spokenDescription={describeRecords(listing, error)}>
      <ScrollView
        testID="records-scroll"
        contentContainerStyle={{ flexGrow: 1, gap: spacing.md }}
        showsVerticalScrollIndicator={false}
      >
        {/* Doctrine rule 6: the activity's name, never the id behind it. */}
        <Type testID="records-title" variant="title" numberOfLines={2}>
          {title}
        </Type>

        {error !== null ? (
          <View style={{ gap: spacing.sm }}>
            <Type testID="records-error">{error}</Type>
            <Button
              testID="records-retry"
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
          // indistinguishable from "this activity has nothing in it".
          error === null ? (
            <Type testID="records-loading" dim>
              Finding what you have recorded.
            </Type>
          ) : null
        ) : listing.state === 'no-activity' ? (
          <View style={{ gap: spacing.lg }}>
            <Type testID="records-no-activity">
              No activity is chosen, so there is nothing to list.
            </Type>
            <Button
              testID="records-choose-project"
              label="Choose a project"
              onPress={() => {
                router.push('/projects')
              }}
            />
          </View>
        ) : listing.records.length === 0 ? (
          <Type testID="records-empty" dim>
            Nothing recorded in {listing.activityName} yet.
          </Type>
        ) : (
          listing.records.map((record) => (
            /*
              A `Card`, not a `Pressable`. There is no record detail screen to
              open, and doctrine rule 18 is explicit that a control which looks
              tappable and does nothing is worse than no control at all — it
              teaches her the tap did not register when it did. When a detail
              screen exists, its `onPress` goes here, on a `Pressable` wrapped
              around this card the way `projects.tsx` wraps its rows.
            */
            <Card key={record.id} testID={`record-row-${record.id}`}>
              <View style={{ gap: spacing.xs }}>
                <View
                  style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}
                >
                  <Type
                    testID={`record-sequence-${record.id}`}
                    variant="mono"
                    accessibilityLabel={sequenceLabel(record.sequence)}
                  >
                    {formatSequence(record.sequence)}
                  </Type>
                  {/*
                    Doctrine rules 6 and 10: a record with no title says so in
                    a word rather than leaving a blank line where a name goes,
                    and a long one clamps at two lines so the rows below it do
                    not move.
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
                  The fix is `ContextStamp`'s to render and no one else's: its
                  chip already prints the accuracy in metres beside a
                  quality-specific glyph and border style (`◎ ±2.4 m` solid for
                  deliberate, `~ ±38 m · 4 min old` dashed for ambient,
                  `⚑ no position` for none), so there is no second accuracy
                  figure to print next to it. Restating spec §8.2's three
                  classes here would be a fourth statement of a rule that must
                  never be blurred.
                */}
                <ContextStamp fix={stampFixFor(record.fix)} />

                {/*
                  Elapsed time, the same rendering the launcher's "Carry on
                  with" card uses for when the activity started — two ways of
                  saying "how long ago" in one app would be worse than either.
                  A stopgap: the owner's design pass may well want something
                  denser than a sentence per row here.
                */}
                <Type variant="small" dim>
                  {formatElapsed(record.capturedAt)}
                </Type>
              </View>
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  )
}
