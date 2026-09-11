# The launcher, projects and the Inbox: the checks only the device can answer

This plan added the launcher (`app/index.tsx`), the project list and project creation, the
new-activity screen, the records list and the Inbox. Everything below is a question the test
suite cannot answer: wrapping that needs a real layout engine, an Android soft keyboard, a
process that is actually killed, and renumbering whose wrong answer is silent.

**The 10-inch tablet has still never run this app.** Every item below is written for the S25
and should be repeated on the tablet, and the ones that mention wrapping or reach are the
ones most likely to answer differently there.

## Before you start

`app.json` is unchanged on this branch — no new permissions, no new config plugin — so
**no `prebuild` is required for this plan**. (If that stops being true, read the prebuild
warning in `CLAUDE.md` before building: a plain prebuild over an existing `android/` can
leave the manifest stale.)

Take a **release** build (`npx expo run:android --variant release`) so the JavaScript bundle
is embedded and the phone needs no development machine attached. Several items below involve
force-quitting the app, which a debug build survives differently.

**Order matters for the first few.** Run item 1 (clear app data) first, then take item 4's
context-free captures while there is still no activity anywhere — once one exists, the
launcher always resumes something and there is no way back to an empty context — then item 2,
then everything else on top of what item 2 created.

## The checks

1. **A fresh install has no context.** Clear the app's data (Settings → Apps → Corymbia Field
   Kit → Storage → Clear data) and open it.
   *Expect:* the card says there is no project yet and offers **Choose a project** — and
   carries **no `CAPTURE` inside it**, because there is no activity to file one into. The
   Capture and Records tiles below the card are still live: capture from there and the record
   goes to the Inbox. That is §10.2's *Impatient* journey and it must work on a device that
   has never been set up.
   *Failure:* a dead `CAPTURE` in the card, a card that looks like the resumed one with its
   text missing, or no way off the screen at all.

2. **The whole methodical journey**: Switch project → Start a new project → type a name →
   Save → the project → name the activity → Start activity → `CAPTURE`.
   *Expect:* starting the activity returns you to the launcher with that activity showing in
   the card, and `CAPTURE` one tap away. §10.2 calls this three taps, and it is three taps
   from the launcher once a project with no activity exists — Switch project, the project,
   `CAPTURE` is what it collapses to once an activity is running.
   *Failure:* landing back on the project list rather than the launcher; the card still
   showing the previous activity; having to choose the activity you just started.

3. **A capture now lands in the activity, not the Inbox.** With that activity running, take a
   capture, then open Records from the tile.
   *Expect:* the record is listed, numbered within the activity, under the activity's name as
   the screen title. No Inbox strip appears on the launcher.
   *Failure:* the record is in the Inbox instead; or Records says "no activity is chosen"
   while the card plainly shows one.

4. **The Inbox strip appears only when something is unfiled — and disappears.** Note how to
   get an unfiled capture at all: `readCurrentContext` falls back to the most recently started
   activity, so once any activity exists on the device there is no context-free state to
   capture in. **Do this one straight after item 1, before item 2** — clear app data, take two
   or three captures with no project at all, and only then create a project and an activity to
   file them into. Return to the launcher, file them one at a time, and come back each time.
   *Expect:* the strip appears with the count, reads "1 unfiled capture" in the singular at
   one, and is **gone** the moment the last one is filed — not showing "0".
   *Failure:* a permanent strip reading zero; a count that does not change until the app is
   restarted; "1 unfiled captures".

5. **Filing with a position renumbers the rest.** Into an activity that already holds four
   records, file an Inbox capture at **position 2**. Then open Records.
   *Expect:* five rows, and the numbers 1, 2, 3, 4, 5 each appear **exactly once** — nothing
   repeated, nothing missing. This list is ordered by the activity sequence, highest first, so
   they should also read in order from the top: 5, 4, 3, 2, 1 down the screen, with the filed
   capture sitting at 2.
   *Failure:* two rows with the same number, a number missing, a row showing `—`, or the
   numbers not running down the screen in order. This is the one item whose wrong answer is
   completely silent — nothing on screen complains, the data is just wrong — so count them
   deliberately rather than glancing.

6. **Force-quit and reopen.** From the launcher showing a resumed activity, swipe the app off
   the recents list (a real kill, not Back), then open it again.
   *Expect:* the same activity in the card, the same capture count, and `CAPTURE` live. There
   may be a brief "One moment / Finding what you were last working on" — that is correct; a
   flash of "No project yet" is not.
   *Failure:* "No project yet" on reopen; a different activity resumed; the capture count
   reset.
   *Note:* a read that fails now says so in its own words — "The launcher could not read where
   you were: …" with a **Try again** beneath it — and never draws the first-run face. So "No
   project yet" on reopen means a lost selection and nothing else; report the failure sentence
   separately if it appears.

7. **The tablet.** Repeat items 1–6 on the 10.36-inch tablet, in both orientations.
   *Expect:* nothing surprising — but nothing here has ever been seen on it, so record what
   the launcher actually looks like at that width: whether the tool tiles stay two-up or
   spread, whether the card's hero name still clamps sensibly, and whether anything reaches
   awkwardly far from the hand.
   *Failure:* anything. Write down what you see, including "it looked fine", because that is
   also the first time anyone will have known it.

8. **The five activity-kind chips, wrapped.** On the new-activity screen on a 360dp-wide
   phone, look at the KIND row: five chips (Survey, Sampling, Collection, Workshop, Meeting)
   that cannot fit on one line.
   *Expect:* they wrap to two or three rows cleanly, and the selected one is still obviously
   selected — it carries a **✓** as well as the accent fill (doctrine rule 9), and the ✓ must
   be visible, not clipped by the chip's own bounds when the row is tight. Tapping a chip
   must not reflow the row under your thumb; the border is 2dp in both states for exactly
   that reason.
   *Failure:* a chip clipped at the screen edge; the ✓ missing or cut off, leaving colour as
   the only channel; the row jumping as you tap along it.

9. **The Inbox chooser, opened low in a long list.** Get eight or more captures into the
   Inbox, scroll to a row near the bottom, press **Choose an activity**, pick an activity, and
   then tap the POSITION field so the keyboard comes up.
   *Expect:* the keyboard does not cover the `File into …` button — and if it does, the
   screen scrolls so you can reach it. The **first** tap on that button must file; it must not
   merely dismiss the keyboard. (`keyboardShouldPersistTaps="handled"` on the Inbox's
   `ScrollView` is what makes that true, and no test can see it.)
   *Failure:* the confirm button unreachable behind the keyboard; a first tap that only closes
   the keyboard and a second that files — that is exactly the doctrine rule 19 failure this
   setting exists to prevent, and it will look like the app ignored you.

10. **A position past the end.** In that same chooser, with an activity holding, say, four
    records chosen, type **9** into POSITION and confirm.
    *Expect:* a refusal that **names the range** — "A position is a whole number from 1 to 5"
    — and nothing filed. The label above the field should already have said "POSITION, 1 TO 5
    (OPTIONAL)" before you typed. Check the whole screen for a raw id: no `rec_…`, no `act_…`,
    nowhere, in the refusal or anywhere else.
    *Failure:* the capture files anyway; a refusal that says only "invalid position"; or any
    message containing an id (that means the repository's own error reached the screen
    instead of this screen's, which breaks doctrine rule 6).

11. **A failed save on the new-activity screen.** Force the write to fail however you can
    reproduce it — a debug build with the database file made read-only over adb is the
    practical route; filling the device's storage is not. If you cannot force one, still do
    the **empty-name** half of this item, which needs nothing special, and say in your notes
    that the failed-save half went untested.
    *Expect, failed save:* the red sentence stays on screen and does not disappear on its own,
    it is spoken by TalkBack as part of the screen description, and **typing a name does not
    clear it** — only a successful save does. *Expect, empty name:* pressing Start activity
    with a blank name gives "An activity needs a name. Type one before saving.", and that
    sentence **does** clear the moment you start typing.
    *Failure:* the failed-save sentence vanishing when you type (that is doctrine rule 20
    broken — the only telling she gets that the write did not land, wiped by an unrelated
    keystroke); or the empty-name refusal still sitting there while she looks at the name she
    just typed.

## What to do with the answers

Item 5's is the one to record in writing whatever it says, because nobody will notice it
later. Item 7's belongs in the design-review record (`docs/design-review/`) — the tablet's
first sighting of these screens is a design fact, not just a pass or a fail.

## Where the reasoning lives

- `docs/ui-doctrine.md` — rule 9 (colour never alone, item 8), rule 18 (nothing pressable and
  inert), rule 19 (text entry's own surface and the first-tap trap, item 9), rule 20 (a
  message she cannot reconstruct, item 11) and rule 21 (no tile for an unbuilt destination).
- Spec §10.1 (the launcher assumes rather than asks), §10.2 (the four journeys and the
  Inbox), §10.3 (project creation), §8.3 (the two links to an activity, which is what makes
  the Inbox's one-tap default possible) and §7.2 (capture number versus sequence, item 5).
- `packages/data/src/repositories/records.ts` — `fileRecord`'s renumbering, and the SQLite
  trap it works around. Item 5 is the device-side check on it; do not reimplement it.
- `docs/media-hardware-checklist.md` — the same shape, for the media capture plan.
