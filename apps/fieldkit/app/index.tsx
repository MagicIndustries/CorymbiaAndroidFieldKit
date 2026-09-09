import React from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { spacing, touch } from '@corymbia/tokens'
import {
  Card,
  CarryOnCard,
  HelpAffordance,
  Screen,
  ToolTiles,
  Type,
  type CarryOn,
  type ToolKind,
} from '@corymbia/ui'
import { useDatabaseStatus } from '../src/db/provider'
import { useCurrentContext } from '../src/context/useCurrentContext'

/**
 * The launcher (spec §10.1) — the first thing she sees, and the screen the
 * application opens on.
 *
 * **It assumes rather than asks.** There is no "what are you doing today?"
 * prompt: `useCurrentContext` resumes the activity she was last working in
 * and this screen shows it, with `CAPTURE` live inside the card. In a hurry
 * is one tap (§10.2), and it is one tap because nothing here stands in front
 * of it.
 *
 * Three states, and each is drawn as itself rather than as a degraded version
 * of the resumed one:
 *
 *  - **Still opening.** The database, then the first read. Neither is a state
 *    to draw the card in — "No project yet" while the answer is still coming
 *    back is a sentence about a device this might not be (doctrine rule 16),
 *    and a screen reader would say it out loud.
 *  - **Resumed.** The card, the tool tiles beneath it, and the Inbox strip
 *    when — and only when — something is unfiled.
 *  - **A genuine first run.** No context has ever existed. `CarryOnCard`
 *    draws its own first-run face here: no `CAPTURE`, because there is
 *    nowhere for it to go, and the one way forward instead.
 */
export default function Launcher() {
  const status = useDatabaseStatus()

  // `useDatabase` throws before the database is open, and `useCurrentContext`
  // calls it — so the guard has to come before the body that uses the hook,
  // hence the split into two components rather than an early return inside
  // one (`capture.tsx` and `diagnostics.tsx` do the same, for the same
  // reason).
  if (status.state !== 'ready') {
    return (
      <Screen
        testID="launcher"
        spokenDescription={`Corymbia Field Kit. The database is ${status.state}.`}
      >
        <Type variant="title">Database {status.state}</Type>
        {status.error ? <Type dim>{status.error.message}</Type> : null}
      </Screen>
    )
  }

  return <LauncherBody />
}

/**
 * The tools that have somewhere to go on this device.
 *
 * **This list is doctrine made structural, not a preference.** `ToolTiles`
 * renders only the kinds named here, so a tool with no destination gets no
 * tile at all — not a dimmed one, not one with a "coming soon" badge. A
 * control that looks pressable and does nothing is worse than no control,
 * and a badge explaining the silence is still a control that swallows a tap.
 *
 * Batching and a media library are the two kinds `ToolTiles` knows about that
 * are not built; they are absent for that reason and for no other. Add a kind
 * here on the day its route exists, and not before — the tiles' own ordering
 * table (`ToolTiles.tsx`) already knows where each one goes.
 *
 * Module-level, so it is identity-stable across the renders a focus refresh
 * causes.
 */
const AVAILABLE_TOOLS: ToolKind[] = ['capture', 'records']

/** "1 unfiled capture", "4 unfiled captures" — singular only at exactly one. */
function formatUnfiled(count: number): string {
  return `${count} unfiled capture${count === 1 ? '' : 's'}`
}

/**
 * The screen, said out loud (doctrine rule 16).
 *
 * **Accurate to the state it is actually in**, which is why there are three
 * sentences and not one with holes punched in it. The first-run case is the
 * one that matters: a description that named a project when there is none
 * would be worse than no description at all, because the person who cannot
 * see the screen has nothing else to correct it with. The Inbox is mentioned
 * only when there is one, for the same reason the strip is only rendered
 * then.
 */
function describeLauncher(carryOn: CarryOn | null, unfiledCount: number): string {
  const inbox =
    unfiledCount === 0 ? '' : ` ${formatUnfiled(unfiledCount)} are waiting in the Inbox.`

  if (carryOn === null) {
    return (
      'Corymbia Field Kit. No project yet, so there is nothing to carry on with — one control, ' +
      `which chooses a project.${inbox} The component gallery is at the bottom.`
    )
  }

  const captures =
    carryOn.captureCount === 1 ? '1 capture so far' : `${carryOn.captureCount} captures so far`
  return (
    `Corymbia Field Kit. Carrying on with ${carryOn.activityName}, in ${carryOn.projectName} ` +
    `for ${carryOn.clientName}, ${captures}. Capture is one tap from here. Beneath it, tiles ` +
    `for the tools this activity leans on.${inbox} The component gallery is at the bottom.`
  )
}

function LauncherBody() {
  const router = useRouter()
  const { carryOn, unfiledCount, loading } = useCurrentContext()

  /**
   * The first read, which takes a few milliseconds and is not a state to
   * guess in. `useCurrentContext` reports `loading` only for that first read
   * — a later refresh replaces the numbers when it lands and blanks nothing
   * — so this is drawn once per launch and never again.
   */
  if (loading) {
    return (
      <Screen
        testID="launcher"
        spokenDescription="Corymbia Field Kit is opening. Finding what you were last working on."
      >
        <Type variant="title">One moment</Type>
        <Type dim>Finding what you were last working on.</Type>
      </Screen>
    )
  }

  return (
    <Screen testID="launcher" spokenDescription={describeLauncher(carryOn, unfiledCount)}>
      {/*
        It scrolls, for the reason every screen in this application does:
        rotation is unlocked and a phone in landscape has roughly 360dp of
        height, against a card, a strip, two rows of tiles and a help row.
        `flexGrow: 1` means the container grows past the viewport when the
        content is taller than it, so nothing is clipped off the bottom.
      */}
      <ScrollView
        testID="launcher-scroll"
        contentContainerStyle={{ flexGrow: 1, gap: spacing.md }}
        showsVerticalScrollIndicator={false}
      >
        {/* Doctrine rule 7: a tappable help affordance per screen, never a hover. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <Type variant="label" dim>
            WHERE YOU ARE
          </Type>
          <HelpAffordance
            testID="launcher-help"
            title="Where a capture goes"
            // Plain language for the process (doctrine rule 6): no "context",
            // no "sync", and no ids.
            body={
              'The app opens on whatever you were last working in, so you can capture straight ' +
              'away without choosing anything first.\n\n' +
              'A capture taken here is filed into that activity. If nothing is running, it goes ' +
              'to the Inbox instead — that is a normal way to work, not a mistake, and you can ' +
              'file from the Inbox whenever it suits you.\n\n' +
              'Switch project or New activity change what the next capture is filed into. ' +
              'Nothing already captured moves.'
            }
          />
        </View>

        {/*
          The card sits in a slot named for the launcher, while the card
          itself is named for what it is. That is not decoration: `CarryOnCard`
          builds its children's testIDs from its own — `carry-on-capture`,
          `carry-on-switch-project` — so the two names answer two different
          questions, "is the launcher showing a card here" and "which control
          inside the card was pressed".
        */}
        <View testID="launcher-carry-on">
          <CarryOnCard
            testID="carry-on"
            carryOn={carryOn}
            onCapture={() => {
              router.push('/capture')
            }}
            onSwitchProject={() => {
              router.push('/projects')
            }}
            onNewActivity={() => {
              router.push('/new-activity')
            }}
          />
        </View>

        {/*
          THE INBOX STRIP, WHICH APPEARS WHEN UNFILED ITEMS EXIST AND ONLY
          THEN (spec §10.1). An empty Inbox is not a thing to report: a strip
          reading "0 unfiled captures" is a permanent row of nothing on the
          screen she opens most, and it would teach her to stop reading the
          one place that tells her something is waiting.

          It does not scold (§10.2). Capturing without an activity running is
          a supported way to work, so the strip says what is there and offers
          to open it — nothing here reads as a queue of mistakes.
        */}
        {unfiledCount > 0 ? (
          <Pressable
            testID="launcher-inbox"
            accessibilityRole="button"
            accessibilityLabel={`Open the Inbox, ${formatUnfiled(unfiledCount)}`}
            onPress={() => {
              router.push('/inbox')
            }}
            style={({ pressed }) => ({ minHeight: touch.comfortable, opacity: pressed ? 0.7 : 1 })}
          >
            <Card accent>
              <View style={{ gap: spacing.xs }}>
                <Type variant="label" dim>
                  INBOX ·
                </Type>
                <Type variant="heading">{`${formatUnfiled(unfiledCount)}.`}</Type>
                <Type variant="small" dim>
                  Captured with no activity running. File them whenever it suits you.
                </Type>
              </View>
            </Card>
          </Pressable>
        ) : null}

        <ToolTiles
          testID="launcher-tools"
          // Null with no context, which is what `ToolTiles` takes to mean "no
          // activity to order by" and answers with its stable default order.
          activityKind={carryOn === null ? null : carryOn.activityKind}
          available={AVAILABLE_TOOLS}
          onOpen={(tool) => {
            router.push(tool === 'capture' ? '/capture' : '/records')
          }}
        />

        {/*
          THE COMPONENT GALLERY, HERE AND DELIBERATELY NOWHERE BETTER.

          It is a development instrument, not field work: the place every
          component is judged at its real size on a real device, and for
          several of them the only place they can be seen at all. So it keeps
          a route, and this is the whole of its presence on the launcher —
          last in reading order, below every control that does real work, in
          the smallest type on the screen with no tile, no icon and no card
          around it. It cannot be mistaken for one of the tools, and it costs
          nothing but one line of a screen she scrolls anyway.

          It is not a tool tile, and that is the point: a tile would put a
          design instrument in the same row as CAPTURE.
        */}
        <Pressable
          testID="launcher-gallery"
          accessibilityRole="button"
          accessibilityLabel="Open the component gallery, for design review"
          onPress={() => {
            router.push('/gallery')
          }}
          style={({ pressed }) => ({
            minHeight: touch.min,
            justifyContent: 'center',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Type variant="small" dim>
            Component gallery
          </Type>
        </Pressable>
      </ScrollView>
    </Screen>
  )
}
