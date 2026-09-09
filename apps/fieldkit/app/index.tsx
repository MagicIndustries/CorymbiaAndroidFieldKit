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
 *    draws its own first-run face here: no `CAPTURE` inside the card, because
 *    there is nothing to carry on with, and the one way forward — choosing a
 *    project — instead. **That is not the same as no `CAPTURE` on the
 *    screen.** `AVAILABLE_TOOLS` is unconditional, so the Capture and Records
 *    tiles render below the card regardless of `carryOn`, exactly as spec
 *    §10.2's *Impatient* journey requires: Open → `CAPTURE` → lands in the
 *    Inbox, one tap, with no project chosen first.
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
 * **`records` is the one exception, and it is a scheduling fact rather than a
 * rule broken.** `/records` does not exist at this commit — Task 8 of this
 * plan builds it — but Task 8 lands on this same branch before it ships, so
 * the tile is correct by the time anyone can tap it. `router.push` at the
 * call site below carries the same note.
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
 * one that matters most, and matters for the opposite reason it used to: this
 * sentence used to say "one control, which chooses a project" — true of the
 * card alone, false of the screen. `AVAILABLE_TOOLS` puts a live Capture tile
 * and a live Records tile on screen unconditionally (spec §10.2's *Impatient*
 * journey: Open → `CAPTURE` → lands in the Inbox, one tap), and a
 * screen-reader user told there is "one control" never learns Capture is
 * reachable at all. So this branch names every control actually on screen —
 * the help affordance, Choose a project, and the two tiles — rather than
 * naming only the card's own. The Inbox is mentioned only when there is one,
 * for the same reason the strip is only rendered then.
 */
function describeLauncher(carryOn: CarryOn | null, unfiledCount: number): string {
  const inbox =
    unfiledCount === 0
      ? ''
      : ` ${formatUnfiled(unfiledCount)} ${unfiledCount === 1 ? 'is' : 'are'} waiting in the Inbox.`

  if (carryOn === null) {
    return (
      'Corymbia Field Kit. No project yet, so there is nothing to carry on with. Choose a ' +
      'project to see what to carry on with — or capture straight away: Capture and Records ' +
      `are both live below, and a capture taken now goes to the Inbox.${inbox} The component ` +
      'gallery is at the bottom.'
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
              // `/projects` does not exist at this commit. Task 6 of this
              // plan builds it — the control is correct now, not latent.
              router.push('/projects')
            }}
            onNewActivity={() => {
              // `/new-activity` does not exist at this commit. Task 7 of
              // this plan builds it.
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
              // `/inbox` does not exist at this commit. Task 9 of this plan
              // builds it.
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
            // `/records` does not exist at this commit. Task 8 of this plan
            // builds it — the tile is correct now, not a badge over a gap.
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
