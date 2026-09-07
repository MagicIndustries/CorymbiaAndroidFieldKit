# Corymbia Field Kit — Design

**Date:** 2026-09-05
**Status:** Approved, ready for implementation planning

---

## 1. What this is

A monorepo containing a shared design system, a shared component and logic library, and a
React Native Android application — **Corymbia Field Kit** — for Corymbia EcoSciences.

The primary user is a biotech scientist and applied field ecologist working on-site in
Victoria, Australia. She is not a technical user. She works on a 10-inch Android tablet and
a Samsung Galaxy S24, often offline, often in a hurry, often in poor conditions. She has
small hands and will use a stylus for precision work.

The purpose of every tool in the kit is the same: **capture information quickly and in
several formats while in the field, so it can be collated, reviewed, and submitted
elsewhere later.**

### 1.1 Naming

The brand is **Corymbia EcoSciences**, per the brochure and logo assets. The application is
**Corymbia Field Kit**.

---

## 2. Scope

### In scope for the first implementation

- Monorepo foundation, shared packages, and build/release tooling.
- The design system: tokens, themes (dark and light), responsive layout system, and the
  shared component library.
- The UI doctrine document, established as a living artefact.
- The domain model: clients, projects, locations, activities, records, media, batches,
  and the event log.
- The capture tool: GPS pin recording with title, description, photos, and voice notes.
- The launcher and context-switching flow, including the Inbox.
- Media library with playback, sharing, and soft-delete.
- Export profiles: CSV bundle, GPX, KMZ, and ZIP.
- Destination research spike.

### Explicitly deferred

- **Voice mode** (spoken readback and voice commands). Designed for from the start —
  see §11 — but built last.
- **Tool pinning and manual ordering** on the launcher. Version 2.
- Separate APKs per tool. See §3.
- Any server backend, multi-device sync, or team features.
- On-device transcription of voice notes.
- Destination-specific export profiles, until the research spike lands.

---

## 3. Topology

**One application, with tools as internal modules.** The launcher home screen presents
tools as tiles; all tools share a single SQLite database.

This was chosen over separate APKs because the requirement that surveys attach to sample
records, and that batches span both, is a data-sharing requirement. On Android, sharing
data between separate applications requires a native ContentProvider, share intents, or a
server — all significant cost for no articulated benefit, and all worse for a non-technical
user who would then install and update several applications.

**The boundary is preserved in the package structure rather than in the binary.** Each tool
is a directory under the application, and may import only from shared packages and from
itself — never from a sibling tool. This is enforced by lint. Extracting a tool into its own
package, and later its own APK, is therefore a mechanical move rather than a rewrite.

---

## 4. Repository and package architecture

**pnpm workspaces with Turborepo.** Turborepo over Nx: a single maintainer does not need
Nx's ceremony.

**Expo with development builds**, using EAS for APK production. Expo provides first-party,
maintained modules for every native capability required — location, camera, audio,
SQLite, filesystem, sharing — and `expo-updates` allows pushing fixes to a field device
without sideloading a new APK, which matters when the device is remote.

### Shared packages

| Package | Responsibility |
| --- | --- |
| `tokens` | Colour, type scale, spacing, radii, elevation, motion, touch-target and field sizing scales; the dark and light theme definitions. Pure data, no React, no dependencies. |
| `icons` | The icon set, including the standardised input affordances. |
| `brand` | Logo, wordmark, splash, adaptive launcher icon, generated from `design/logo`. |
| `ui` | The component library: layout primitives, form controls, and field-specific components. |
| `geo` | Fix acquisition, accuracy tracking, hold-averaging, datum handling, proximity and duplicate detection, the ambient position cache. |
| `media` | Photo and audio capture, file naming and lifecycle, soft-delete. |
| `data` | SQLite schema, migrations, and the repository layer. |
| `export` | Export profiles as pure transforms. |

### Application

`apps/fieldkit` — the Expo shell. Owns navigation, the launcher, settings, and wiring.
Tools live under it as directories.

---

## 5. Design system

### 5.1 Brand

Extracted from `design/logo/logo.svg` and `design/brochure/`.

- **Mark:** a eucalypt-leaf double helix with base-pair rungs and spore dots, filled with a
  five-stop horizontal gradient: `#ABD246` → `#99D252` → `#6BD371` → `#22D5A3` → `#1CD5A7`.
  Used in the app bar cropped tight, and at full square for the launcher icon.
- **Discrete brand greens** (the spore dots): `#98D455`, `#84CF69`, `#55D28C`, `#30CF9F`.
- **Slate ground**, from the brochure: `#2E3B47` and darker for the application's dark mode.
- **Status colours**, outside the brand because they are semantic: amber `#E8B33D`,
  rust `#E86A4D`.

The application chrome carries a persistent brand bar — mark, `CORYMBIA / FIELD KIT`
wordmark, and the current context — so she always knows what she is recording into.

### 5.2 Two-layer tokens

Underneath, the raw ramps: the brand greens, the slate scale, the status colours.

On top, a **semantic layer**: `surface`, `surfaceRaised`, `textPrimary`, `textDim`,
`accent`, `statusGood` / `statusFair` / `statusPoor`, `captureFast`, `captureAccurate`, and
so on. Dark and light are two objects resolving the same semantic keys.

**Rule: components may only consume semantic tokens.** No raw hex, no reaching into a ramp.
Enforced by lint. This is what guarantees light mode is genuinely complete rather than
ninety percent right, and what allows the whole suite to be restyled from one file.

Implementation is a `ThemeProvider` and a `useTheme()` hook over React Native `StyleSheet`.
No Tamagui, no NativeWind.

**Dark mode is the default.** Light mode exists for glare — a bright overcast sky can defeat
a dark screen. The theme follows the system setting with a manual override in settings.

**Preferences persist.** An override that resets at every launch is not an override. Theme,
handedness, capture-control order and density are stored locally and survive a restart —
which means the application needs a small settings store, described in §7.6.

### 5.3 Responsive layout

Devices: Samsung S25 (development reference), Samsung S24 and a 10-inch tablet (the user's).

**Phone-first, tablet-enhanced.** The canonical layout for every screen is designed at phone
width and must be complete on its own. Tablet layouts add space and adjacency, never
features.

Two separate questions, which an earlier draft of this spec wrongly collapsed into one.

**How much horizontal room is there right now?** Orientation-dependent, and it drives layout
— two panes side by side, or one pane you navigate between. Answered by **size class**, from
the current window width, mirroring Android's `WindowWidthSizeClass`:

| Class | Current width | When |
| --- | --- | --- |
| `compact` | < 600dp | Either phone, portrait |
| `medium` | 600–839dp | 10-inch tablet, portrait |
| `expanded` | ≥ 840dp | 10-inch tablet landscape, and either phone in landscape |

**What kind of device is this?** Orientation-invariant, and it drives ergonomics. Answered by
**device class**, from the shortest side: under 600dp is a `phone`, 600 and above a `tablet`.

The distinction is load-bearing. Deriving both answers from one number is unworkable: keying
on the shortest side means a rigid tablet can never become `expanded` by rotating, so every
landscape layout is dead code; keying on width alone means a phone in landscape — genuinely
915dp wide — inherits the tablet's reach ergonomics, and the capture controls end up in
corners the user's thumbs cannot reach.

Components branch on these named classes only, never on raw dimensions, via a `useLayout()`
hook reporting size class, device class and orientation. Same discipline as the semantic
tokens: one vocabulary, enforced by lint.

**Type sizes and touch targets stay at roughly constant physical size across devices.**
Extra tablet space becomes more content or calmer spacing — never larger widgets. Scaling
everything up is the most common tablet mistake and reads as an enlarged phone application.

### 5.4 Reach zones

On a 10-inch tablet held in two hands, the centre of the screen is hardest to reach and the
corners are easiest. This inverts phone thinking.

- Interactive controls live in the bottom third by default, and hug the bottom corners only
  on a **tablet in landscape** — the one case where the thumbs actually rest near the
  corners. A phone in landscape keeps the bottom band despite being `expanded` by width.
- **There is one capture control, so there is no side to choose.** This bullet formerly made
  which of two boxes took the dominant side a preference — `SAVE NOW` being the frequent
  action and `SHARPEN` the effortful one, with no way to know from a desk which deserved the
  stronger thumb. §9.1 has since replaced the pair with a single control, and a choice
  between one thing is not a choice. Handedness still drives placement — which corner the
  working column occupies, and which side the control sits on — it simply no longer has a
  second box to trade against.
- **`capturePrimary` stays in the schema, unread.** The setting and its column are left
  exactly where they are rather than migrated away: removing a settings column costs a
  migration, and the underlying question — what the dominant thumb should be given on the
  real capture screen — is still open, merely no longer answerable by swapping two boxes.
  Plan 3 decides whether it acquires a new meaning or is retired. Until then it is stored,
  displayed on the diagnostics screen as the persistence proof it has always doubled as, and
  read by nothing.
- Readouts occupy the centre — looked at, not touched.
- **Reach zones are user-configurable.** A handedness and anchor setting determines which
  corner the working column occupies and which side primary actions sit on. Changing it
  mirrors the entire layout, not one screen.
- Given the user's small hands, the phone's primary action band is bottom-anchored on every
  screen, and destructive actions never appear in the top corners.

### 5.5 Stylus and density

The base S25 has no S Pen, so stylus presence cannot be assumed; the tablet likely has one.
Rather than attempting stylus detection — unreliable in React Native — hit areas are
generous for everything, and form-heavy screens offer a **density setting**: comfortable by
default, compact when a stylus makes precision easy and more rows are wanted.

---

## 6. UI doctrine

A living document, `docs/ui-doctrine.md`, added to as decisions are made. Every screen and
component is checked against it. Where a rule can be enforced by a shared component rather
than by memory, it must be.

### Established rules

1. **Single-focus field screens.** One job per screen, one obvious primary action,
   everything else subordinate or off-screen.
2. **Capture is a mode, not a form.** Entering it is visually unmistakable — the screen
   changes enough that there is no doubt a capture is in progress.
3. **Progressive disclosure with a floor of zero.** GPS-only is a complete, valid record.
   Title is an easy next step; description and media a step beyond. Every level is a
   legitimate stopping point.
4. **Nothing blocks capture.** No modal question, no required field, no waiting on a fix,
   ever stands between opening the application and recording a position.
5. **Consistent input affordances.** Text, voice and photo each have one visual signature,
   used identically everywhere, in the same order.
6. **Plain language for process, technical language for science.** Ecology, surveying and
   biology terms are correct and welcome. Software terms are not.
7. **Help is always adjacent.** A tappable help affordance per field, or per screen where
   per-field would be noise. Popovers, never hover — there is no hover in the field.
8. **Generous targets.** Sized for gloves, movement, and small hands.
9. **Colour never carries meaning alone.** Every status colour is backed by a word, a
   number, or a border style. Required for colour-vision deficiency and for direct sunlight.
10. **Hero names clamp to two lines, then clip.** Cards never grow with their content, so
    primary actions never move.
11. **Chips truncate in the middle, not the end.** Field project names are front-loaded with
    the site and back-loaded with what distinguishes them; tail truncation discards the
    useful half.
12. **Long names get an optional short label**, user-controlled, derived automatically when
    blank, used in app bars, chips, batch lists and exported filenames.
13. **The full name is always one tap away**, via the standard help popover.
14. **Never scroll or animate a name.** Marquee text is unreadable while walking.
15. **Destructive actions are soft and reversible.** Deletion flags; files survive until a
    deliberate purge in settings.
16. **Every screen carries a spoken description, every action a speakable name.** See §11.

---

## 7. Domain model

The hierarchy is **Client → Project → Activity → Record → Media**, with locations attached
to projects.

### 7.1 Entities

| Entity | Notes |
| --- | --- |
| `client` | Name, contact detail. Selected by typeahead over existing, or typed new. |
| `project` | Name, optional short label, optional description, client, one or more locations, status. |
| `location` | Named place with coordinates. Added by text lookup or coordinate lookup — see §10.3. |
| `activity` | Typed unit of work within a project: survey, sampling, collection, workshop, meeting. Name, optional short label, start and end. |
| `record` | The capture spine. See below. |
| `media` | Photo or voice note attached to a record. Kind, internal filename, duration, byte size, ordering, soft-delete flag. |
| `record_link` | Generic from / to / relation. Lets a survey attach to a sample record. |
| `batch` / `batch_item` | A named batch spanning one or more days, bound to a project and a destination, with export status. |
| `event` | Append-only log. See §8.3. |

### 7.2 The record spine

**A single `record` table with a `kind` discriminator.** It carries everything common and
positional: activity, capture number, activity sequence, title, optional short label,
description, latitude,
longitude, accuracy, altitude, datum, fix quality class, capture timestamps, capture method,
soft-delete flag and audit timestamps. Kind-specific fields — a sample's medium, depth,
volume and tube ID; an observation's species and abundance — live in a JSON attributes
column validated by a per-kind TypeScript schema.

**Kinds are extensible; the first implementation defines exactly one.** `pin` — a GPS
capture with title, description, photos and voice notes. `sample` and any later kind are
added by defining a schema and a form, which is the point of the design. No kind other than
`pin` is built in the first implementation.

**A record carries two numbers, because they answer two different questions.**

**The capture number is the stable one.** It is assigned the moment anything is recorded, is
unique across the whole database, and is never changed again — not by filing, not by
reordering, not by deletion. This is the number that is safe to write in marker on a water or
soil sample tube, because the label will still match the record months later. Some captures
are only coordinates and notes; some are physical samples that have to be labelled, and the
app cannot tell which at capture time, so every record gets one.

**The activity sequence is the meaningful-in-context one, and it moves.** It is the ordinal
within an activity — she sees "Pin 023" in the context of the survey she is running, and
numbering that restarts with each activity is what makes that label meaningful in the field.
It is **per activity, not per project**. A record that is not in an activity does not have
one at all: the Inbox (§10.2) is a supported destination, and a record filed there has no
position in a survey to be the 23rd of. The sequence is assigned when the record enters an
activity, and it changes when records are inserted around it — filing into the middle of a
survey renumbers everything at and after that position, and reordering within a survey is
the same operation. That is why nothing durable may be keyed to it.

**A record can be moved between activities, and the activity it leaves closes the gap.**
Misfilings happen — a record captured into whichever survey was running, or filed into the
wrong one from the Inbox — so refiling is supported. It is the same renumbering run twice in
one transaction: the destination opens a slot at the position the record lands in, and the
**source renumbers so it stays 1, 2, 3 with no hole** where the record used to be. Leaving a
gap was considered and rejected: a survey showing 1, 2, 4, 5 invites the reading that
something was lost, and the sequence is presentation order that is already expected to shift
on every insertion. The capture number does not move, so a tube already labelled in marker
stays correct — which is the whole reason the ordinal is allowed to.

**Filing is visible after the fact.** A record filed into an activity later carries the time
it was filed, alongside the `filed` entry in the event log (§8.5) that records where and on
which device it happened. A list can therefore show which of its records arrived by filing
without asking the log a question per row. The timestamp is about the activity the record is
in **now**: refiling overwrites it, because a record does not arrive in its new activity at
capture either, and a `filed` entry that names the activity it came from is what makes the
move auditable. Reordering within one activity leaves it alone.

**Renumbering writes no event per shifted record.** Filing, reordering and refiling all move
other records' `sequence` values as a side effect of placing one record — the "shifted
record" cost of every insertion described above. None of that shifting is logged. The record
that was actually filed, moved or refiled gets its one event; the records that merely had
their ordinal bumped to make room do not. This is deliberate, not an oversight: the capture
number is what stays stable, and an event for every shifted row would flood the log with an
entry per insertion into a busy survey, for a fact (the new ordinal) that is already visible
by re-reading the record. §8.5 makes the event log the chain of custody for what happened to
*this* record; a row's ordinal changing because a different record moved past it is not
something that happened to it in that sense.

**Activity ordinals are contiguous by construction, and that is a repository invariant, not
a schema one.** Every operation that touches `sequence` — filing, moving, refiling — leaves
an activity numbered 1, 2, 3 with no gap, but nothing in migration 003 requires this:
`idx_record_sequence` and `record_sequence_positive` would equally accept an activity
numbered 1, 2, 5. The schema enforces uniqueness and positivity; contiguity is upheld only by
the three functions always shifting the records between a change and the end of the activity,
never leaving a hole open. If a gap ever appeared — a bug, a restored backup, a sync conflict
not yet designed — the current operations would only partly repair it: each of the three
closes exactly the gap it might otherwise open at the position it touches (`fileRecord`'s
insertion point, `moveRecord`'s departure and arrival, `refileRecord`'s departure from the
source), but none of them scans an activity end to end looking for a gap sitting elsewhere in
it. A repair pass is a follow-up, not yet built.

**Trade-off accepted.** Two numbers is more to explain than one, and a screen showing both
would be confusing. The alternative was worse: one number cannot be both immutable enough to
write on a tube and re-orderable enough to mean "the 23rd pin in this survey", and the single
number the first draft specified made filing from the Inbox impossible without collisions.

**Rationale.** Batching, exporting, media handling, map display and the capture screen then
work for any kind of record. Adding a tool means defining a schema and a form, not new
tables plus new export code plus new gallery code.

**Trade-off accepted.** JSON columns are not directly indexable. SQLite's JSON functions
cover most needs, and the escape hatch is to promote an attribute to a real column the
moment it must be filtered on.

### 7.3 Required-but-defaulted fields

Every project structurally has a client and at least one location, but **neither is ever
asked for at creation**. A skipped client becomes `Corymbia (internal)`; a skipped location
becomes the default `Office / Lab`. She types a name and moves on; the data is still
well-formed and can be corrected later from the project screen.

Only the project name is required, and the same applies to activities.

### 7.4 Fix provenance on records

Store the **fix summary, not every reading**: sample count, spread, and hold duration on the
record itself. This is the provenance that would be defended in a dataset, without thousands
of junk rows.

Store **GPS time alongside device time**. Field tablets drift; a satellite fix carries an
authoritative clock. Storing both costs nothing and rescues a dataset when the tablet clock
is wrong.

Record the **datum explicitly**, and record the one actually measured. Android's location
API returns **WGS84**, and the application performs no datum transformation, so WGS84 is what
every device-derived position is stored as. Stamping a position with a datum it was not
measured in is a lie of roughly 1.8 m — larger than the uncertainty of a good fix, in the very
field whose purpose is honesty about uncertainty.

**GDA2020 is not a valid destination datum**, contrary to an earlier draft of this section.
The Victorian Biodiversity Atlas accepts exactly three — GDA94, AGD66 and WGS84 — so the
stored vocabulary matches the destination's, and export becomes a lookup rather than a
conversion. See `docs/research/2026-09-06-victorian-biodiversity-destinations.md` §5.3.

### 7.5 The device registry, and what a fix must remember

Two devices are in play — a 10-inch tablet and a Samsung phone — and a coordinate taken on one
is not interchangeable with a coordinate taken on the other. GNSS hardware differs, and so does
what it can achieve. A dataset that cannot say which device produced a record cannot explain
why two fixes from the same morning disagree.

**Fixed device characteristics are recorded once, in a `device` table**, not repeated on every
row: manufacturer, brand, model name and model identifier, device type, OS name and version,
whether it is physical hardware or an emulator, the application version and build that was
running, and a stable installation identifier. A short human label — `field-s24`, `tablet` —
is what the interface shows. Records and events reference the device by key.

**Per-fix conditions are recorded on the record**, because they change from one capture to the
next. Beyond position and horizontal accuracy: vertical accuracy, whether the position was
reported as mocked, and the location provider where the platform exposes it.

Three conventions are stored explicitly rather than assumed, because each is a number whose
meaning cannot be recovered later from the number alone:

- **The accuracy convention.** Android's accuracy is the radius of 68% confidence — one sigma,
  not a maximum error. A destination asking for 95% confidence wants a different figure. Storing
  which convention produced the number is what makes that conversion possible.
- **The altitude reference.** Android reports altitude above the WGS84 ellipsoid, which differs
  from mean sea level by several metres in Victoria. An altitude with no stated reference is
  not a measurement.
- **The datum**, per §7.4.

**A mocked position must be distinguishable from a real one.** A record that cannot prove it
was not spoofed has no chain of custody worth the name, and the platform tells us — so we
store it.

**What the platform does not expose is not modelled at all, rather than modelled as unknown.**
Satellite counts, which constellations contributed, and whether the receiver was dual-frequency
all bear on how much to trust a fix, and none is available through the location API without
native work. They are therefore not nullable columns waiting to be filled — they are absent,
and arrive with a migration when a native module makes them real. A column that could only ever
hold a guess is worse than no column, because a null in a provenance field reads as "measured
and found to be nothing" rather than "never asked".

That distinction is not pedantry: adding a column to SQLite later costs one line, while
tightening a constraint later requires rebuilding the table. Absence is cheap to reverse;
a wrong guess recorded as data is not.

### 7.6 Settings

A small key-value store, in the same database, holding what the user has chosen rather than
what she has recorded. Distinct from the domain tables on purpose: these are preferences, not
observations, and they never appear in an export.

What it holds today: the theme override, handedness, and the form density. Each has a
default, so an unset key is not an error and a fresh install behaves correctly before
anything is written.

It also still holds **`capturePrimary`**, which is no longer live settings content. It chose
which of two capture boxes took the dominant side, and §9.1 replaced the pair with a single
control, so there is nothing left for it to choose. The key and its column stay exactly where
they are rather than being migrated away (§5.4): it is stored, shown on the diagnostics
screen as the persistence proof it has always doubled as, and read by nothing. Plan 3 decides
whether it acquires a new meaning or is retired.

The reason it exists at all is that an override which resets at every launch is not an
override — and the field conditions these settings exist for do not change between launches.

---

## 8. Context stamping and provenance

### 8.1 The stamp

Every record, every media item, and every change writes a context stamp: device time and GPS
time, a best-effort position, the device it happened on, the project and activity active at
that moment, and a derived place name.

### 8.2 Deliberate versus ambient positioning

This distinction is load-bearing and must never be blurred.

| Class | Behaviour | Appearance |
| --- | --- | --- |
| **Deliberate** | Taken on the capture screen. Accuracy-gated, averaged if held. Survey-grade. | Solid teal chip, `◎ ±4 m` |
| **Ambient** | Whatever position is available immediately. Never waits, never blocks, never gates. | Dashed amber chip, `~ ±38 m · 4 min old` |
| **None** | Indoors, cold start, or GPS off. Recorded as absent, never guessed. | Dashed grey chip, `⚑ no position` |

**Exports label ambient coordinates explicitly.** An ambient stamp must never leave the
application looking like a survey-grade coordinate.

**Ambient fixes come from a cached last-known position and carry their age.** Firing the GPS
on every write would exhaust the battery over a field day. The cache refreshes
opportunistically — whenever the capture screen is used, and at low frequency while an
activity is running — and the stamp records how old the fix was.

### 8.3 Two links to an activity

- **Context activity** — where she *was*. Captured automatically, always.
- **Filed activity** — what it is filed *to*. A deliberate decision, initially empty.

A stray voice note therefore reads "recorded during Survey 3, near Yarra Flats — North
Reach, 120 m away", and the Inbox offers Survey 3 as a one-tap default. She gets the benefit
of context without the application having silently filed anything.

### 8.4 Place names work offline

The named location derives from proximity to the project's own known locations, with the
distance shown. Reverse geocoding is an opportunistic bonus when a connection exists, cached
— never depended upon.

### 8.5 The event log

Append-only. Records creation, edits, media added, filing, playback and deletion, each with
its own context stamp. This is what makes chain-of-custody real rather than aspirational,
and it is cheap to write now and expensive to retrofit.

---

## 9. The capture interaction

### 9.1 One control: tap to record, then stand still

**This supersedes the two-control design**, which was `⚡ SAVE NOW` beside `◎ SHARPEN` — tap
the left box to save at once, press and hold the right one to average readings and release
to save, with which box took the dominant side a preference. That design was built and taken
outdoors, and it failed on hardware for two reasons, neither of which was visible from a
desk:

- **Pressing and holding moves the device.** A sustained press shifts a phone in the hand,
  and shifts a 10-inch tablet held one-handed a great deal more. That movement is precisely
  the error the averaging exists to remove, so the gesture was fighting its own purpose.
- **The feedback was nowhere near the thumb.** Everything that responded to a hold —
  accuracy, sample count, the verdict — sat in a panel far above the control, so while her
  thumb was on the button the only part of the screen that moved was somewhere else
  entirely.

It is not forgotten and it is not deferred: it is replaced. There is now **one control**.

1. **One tap records the current fix immediately.** A real row on disk, not a draft held in
   memory. If the app is killed, the battery goes, or she simply walks away, the capture
   survives with the fix it had; only the sharpening is lost. This also makes the hurried
   path exactly one tap, which is what the second box existed for.
2. **The screen then counts down while she stands still**, showing the accuracy now, how
   much it has improved since the tap, how many readings have gone into it, and how many
   seconds remain. All of that sits inside the traffic-light frame with the button, within
   sight of the thumb pressing it. **That adjacency is a requirement, not a layout
   preference** — it is the specific defect this supersession exists to fix, and a design
   that puts the countdown readout in a panel above the control has not implemented this
   section.
3. **When the countdown completes, the saved record is refined in place** with the averaged
   fix. `refineRecordFix` writes the new fix and appends an `'edited'` event carrying **both
   the previous and the new accuracy**, so the chain of custody shows a ±6 m fix that was
   stood over and sharpened to ±3 m, rather than a record that was always ±3 m. The capture
   number and the capture time do not move — the capture happened at the tap, and the number
   may already be written on a tube.
4. **An override accepts whatever has accumulated and ends the wait.** It is the same
   control: during a countdown the button reads `ACCEPT NOW`. So exactly one action is ever
   live, and the override is reachable at every moment the countdown is running.
5. **A plateau ends the countdown, and the override is live throughout.** When the fix has
   stopped improving, the screen says so, makes the override prominent, and finishes the
   wait. This reverses an earlier position — "nothing auto-completes on a trend" — which was
   held because `holdVerdict` was not yet trustworthy: it judged each reading's own accuracy
   estimate, which jitters half a metre between consecutive samples, and had no minimum
   sample count, so on the measured Samsung S25 run it declared `plateaued` at the second
   reading, 0.6 s after the tap, when the averaged fix was ±5.2 m and waiting reaches
   ±1.4 m. A signal like that allowed to end a capture would have ended it four times worse
   than the fix she was standing there for.

   That defect is fixed rather than tolerated (§9.3), and the signal now fires at 13 samples
   — about 12 s — on the same run. So the countdown ending itself is the intended behaviour:
   she waits as long as the fix needs and no longer. What has *not* changed is that she can
   always end it herself; the override is reachable at every moment a countdown is running,
   and a plateau never blocks anything.

**A tap before the receiver has a lock still records.** Doctrine rule 4: nothing blocks
capture. The row is written with an honest `'none'` position, and the countdown that follows
is what gives it one — `refineRecordFix` accepts a refinement *from* no position for exactly
this case, while refusing one *to* no position.

**The countdown default is fifteen seconds, and it is a cap, not an expected duration.**
`holdVerdict` (`packages/geo/src/trend.ts`) ending the wait on a plateau is the normal way a
capture finishes — on the measured hardware below that is about twelve seconds after the
tap. The countdown length is the safety net for a run whose fix never settles, chosen
generously so it is almost never the thing that actually ends a capture, and it is not tuned
against the plateau threshold: that threshold comes from where the measured data itself
bends (`packages/geo/src/trend.ts`), with no reference to how long the countdown runs.

Stored captures on a Samsung S25 outdoors, readings at 1 Hz, each row a real capture:

| wait | readings | accuracy |
|------|----------|----------|
| ~4 s | 5 | ±1.6 m |
| ~6 s | 7 | ±1.5 m |
| ~11 s | 12 | ±1.2 m |
| ~15 s | 16 | ±1.3 m |
| 20 s | 21 | ±1.0 to ±1.4 m across several runs |
| 60 s | 61 | ±1.1 m |

This is one device, one site, one session under clear sky — a starting point for this
hardware, not an established property of Android GPS. The curve is flat from about ten
seconds. Sixty seconds was **no better** than twenty — ±1.1 m sits inside the ±1.0–1.4 m the
twenty-second runs themselves span — not worse, as an earlier version of this section
claimed. The mechanism is the floor in `averageReadings`: once enough samples accumulate the
reported accuracy is exactly a third of the best single reading, so further samples are
inert and only a better individual reading helps (`docs/gps-accuracy.md` §5).

An earlier version of this section also claimed a longer wait actively degrades the honesty
check, from a single twenty-second/sixty-second spread comparison. That claim does not
survive the rest of the stored records: the twenty-second runs alone span spreads of ±0.3 m,
±0.6 m, ±1.0 m, ±2.2 m and ±2.6 m, and the sixty-second run's ±1.3 m sits inside that range.
It is withdrawn. The finding the same records do support, and more strongly: **run-to-run
variance at a fixed duration exceeds the difference between durations.** Two twenty-second
captures in the same session produced accuracies of ±1.0 m and ±2.8 m — a wider gap than any
measured difference between twenty seconds and sixty. Conditions and satellite geometry at
the moment of capture dominate the result, and waiting longer cannot rescue a fix that
started out bad, which argues for a short cap on its own terms, without needing a spread
claim the data does not support.

So fifteen seconds is not a compromise between what she will tolerate and what the receiver
needs, and it is not fitted to the plateau threshold either. It is a generous cap on top of a
self-ending wait that, on this hardware, finished itself three seconds sooner on the one run
measured.
The diagnostics screen keeps the chooser — 5, 15, 20, 30 and 60 seconds — so the comparison
can be run again on other hardware, in other sky, before the number is fixed for the field
app.

Placement follows the reach zone setting: a bottom band by default, and the bottom corner
under the dominant thumb on a tablet in landscape. Handedness still drives that. Which
control takes the dominant side no longer means anything, because there is one (§5.4).

### 9.2 The traffic-light frame

A coloured frame, live at all times, doing two jobs:

- **Fix quality**, continuously — green, amber, red. Readable from peripheral vision in
  glare, with gloves, while moving.
- **Countdown progress**, charging around the perimeter as the wait runs down.

Two things changed with §9.1 and are stated here rather than left to be inferred:

- **The frame is around the capture block, not around the whole screen.** It encloses the
  readout and the control together, because §9.1.2 requires them to be one object within
  sight of the thumb. A frame around the entire screen would put its own perimeter as far
  from the button as the old readout panel was, which is the defect being fixed.
- **The perimeter shows the countdown, not accumulated readings.** Under the superseded
  press-and-hold model the only measure of progress was how many readings a hold had
  gathered. There is now a fixed wait with a known end, so the perimeter is the honest
  progress of *that* — it empties as the seconds run down and completes when the countdown
  does. Sample count is still shown, as a number, inside the frame.

Always backed by the word in the chip (`GOOD FIX` / `FAIR FIX` / `POOR FIX`), the numeric
readout, and a dashed border when poor. Colour never carries the meaning alone.

**The frame itself pulses slowly while the fix is still being refined**, and stops when the
point is recorded — motion is what says "still working, stand still" from peripheral vision,
where a word cannot be read. It must respect the system's reduced-motion setting, rendering
steady and running no animation when that is on.

The whole frame breathes, not a secondary ring inside it. The prototype pulsed an inset ring
because that was the easy way to keep the grade colour at full strength — a naive pulse of
the frame's own colour would make a good fix look worse at the bottom of every cycle, which
is the one thing this frame must never do. Both properties are required: the frame is what
moves, *and* the fix quality stays honestly readable at every point in the cycle. Solving
that is Plan 3's, and it is a real constraint, not a preference.

**There is no separate `SHARPENING…` state.** That chip existed because a hold produced a
provisional number that was not yet the saved one. Under §9.1 the record is already on disk
and the countdown is refining it, so at every instant the frame grades the fix that would
actually be stored if the wait ended now — which is a real graded fix, not a pending one.
The countdown is shown by the seconds remaining and the perimeter, not by replacing the
grade with a status word.

### 9.3 What the countdown says in words

**The verdict is derived from the observed trend, not from a hardware estimate.** While
accuracy is still falling across recent readings: "Still improving — keep standing still."
Once it plateaus: "About as sharp as it gets here — accepting now costs nothing." This is
honest, computable, and answers the only question she actually has.

**The trend is the averaged accuracy, not each reading's own estimate**, and the rule is
calibrated against measured hardware rather than reasoned out. This replaces the earlier
position that the sentence "suggests and never decides", which existed because the signal
misfired; it does not misfire now, and §9.1.5 says what changed.

On a measured Samsung S25 run at 1 Hz the raw per-reading accuracy jitters — 7.5, 7.2, 6.8,
6.7, 6.3 m — while the averaged accuracy the frame prints and the record stores falls
smoothly and monotonically — 7.5, 5.2, 4.1, 3.5, 3.1 m, reaching 1.4 m by the twenty-first
reading. Judging the raw column produced a `plateaued` at the second reading and then
alternated verdicts through ten seconds of fast, monotonic improvement. Judging the averaged
column does neither.

Three constants, each derived from that data and documented in `packages/geo/src/trend.ts`
against the figure it came from:

- **Ten samples minimum before a plateau can be claimed at all.** The measured curve is flat
  from about ten seconds (§9.1) and measurably improving below it, so a plateau claim before
  then is false by construction. This is the guard that makes the n=2 misfire impossible.
- **A trailing window of four readings**, so the verdict is about the last four seconds and
  an improvement from ten seconds ago cannot claim to be happening now.
- **0.5 m of improvement across that window** to count as still improving, chosen from the
  measured bracket alone, with no reference to the countdown length. The measured window
  improvements fall through 0.549 m at the twelfth reading and 0.444 m at the thirteenth, and
  0.5 m is the midpoint of that open bracket, so it is the threshold furthest from either
  neighbouring measurement. The verdict crosses at the thirteenth reading on this run, about
  12 s after the tap.

**The verdict latches.** Once it has said `plateaued` it is never taken back, because with
the countdown ending on the signal a withdrawable verdict would be a statement about a
capture that no longer exists.

Beside it, in words rather than a bar: **how much sharper the fix is than it was at the
tap**. A countdown that went badly is the single most useful thing this interaction could
report, and a readout that could only ever show improvement would hide it.

**That number cannot report it, and an earlier version of this section wrongly said it
could.** It described the delta as signed, on the reasoning that a worsening countdown must
be visible. It is right about the requirement and wrong about the instrument: the delta is
structurally incapable of going negative, which was established by fuzzing twenty thousand
trials against the real `averageReadings` rather than argued from the code. Inverse-variance
weighting is monotonic in the sample set, and the tap's own reading is always a member of
it, so every reading that arrives can only shrink the combined accuracy. A capture that went
badly and one that went well produce the same shape of number.

**The spread is what reports it**, and is shown beside the improvement for exactly that
reason. Spread is the greatest distance from any reading to the averaged position, it is
already computed and already stored on the record as provenance, and unlike the accuracy it
genuinely worsens when a capture goes wrong — she moved, the sky closed in, the receiver
wandered between readings. A tight spread with a good accuracy is a fix to trust; a good
accuracy with a wide spread is the case the accuracy number alone would quietly hide.

So the pair is the readout: **how much sharper, and how far apart.** The first can only
improve and is described that way rather than as signed; the second is the honesty check on
it.

**The hatched gap bar is gone.** It drew a solid bar for current accuracy and a hatched
extension for what a hold *could* add — a prediction about a future the app cannot make. It
belonged to a model in which the saved fix did not exist yet. Now the fix is on disk from the
tap and the question is not "what might I gain" but "has this stopped improving", which is
the observed trend and is answered in the sentence above.

### 9.4 Supporting readouts

Satellites, datum, altitude, and live coordinates in monospace. These are context about the
receiver, are not about the convergence of the capture in hand, and may sit anywhere on the
screen.

**The accuracy and the seconds remaining are not among them, and are not sized like them.**
They are the two numbers she is standing still for, and in the acquiring state they are the
largest things on the screen — legible at arm's length, in glare, without leaning in. The
diagnostics prototype rendered them at the same weight as the rest of its instrument
readouts, which is correct for an instrument and wrong for the field. Plan 3 sizes them as
the primary content of that state, and everything else on the acquiring screen is
subordinate to them.

This is a specific instance of the doctrine's single-focus rule: a screen she looks at while
holding a phone still over a point should answer *how good is it* and *how much longer*
before it answers anything else.

**Readings averaged and the improvement delta are not supporting readouts.** They live
inside the traffic-light frame with the control (§9.1.2). Separating them from the button is
the exact defect §9.1 exists to fix, and this section previously prescribed that separation.

**A countdown transcript**, on the diagnostics screen while the countdown length is still
being settled: one row per reading collected since the tap, carrying the elapsed seconds,
that reading's own accuracy, the sample count, the running averaged accuracy, and the
verdict — each as it stood at the moment that reading arrived, so the rows are literally what
the control was showing. It survives the countdown and stays until the next tap.

It is a distinct thing from a live reading tail, and both exist because neither does the
other's job: a tail is trimmed, shows raw per-reading accuracy, and has no marker of where a
countdown began or ended, so it cannot corroborate the averaged number the operator was
watching or the improvement claimed about it. Establishing when the plateau signal actually
fires on real hardware was the whole reason for the field measurements that set §9.1's
default and §9.3's constants, and the transcript is what carried that evidence home. It
stays for the same reason the chooser does — the numbers hold for one device under one sky
and want re-measuring under another.

### 9.5 Duplicate guard

A warning when a new pin lands within a configurable threshold of the previous one —
defaulting to 5 m. It **warns and offers to continue; it never blocks**, per doctrine rule 4.
Accidental double-capture is a real field failure, but so is refusing a legitimate
close-spaced pin.

### 9.6 After the pin

A saved confirmation naming the activity, then the four standard affordances: location
(already complete), title, voice note, photo. Identical icons, identical order, everywhere
in the application.

---

## 10. Navigation and journeys

### 10.1 The launcher assumes rather than asks

A blocking "what are you doing today?" prompt directly opposes "open the application and
capture as fast as possible". Instead the application resumes the last context and shows it,
with `CAPTURE` live on the launch screen.

The **Carry on with** card shows project, activity, when it started, capture count, and
client, with `CAPTURE` inside it and `Switch project` / `New activity` beneath.

Below it, the tool tiles, **reordered by activity type** — a survey floats capture and
records to the top and dims batching. Pinning and manual ordering are version 2.

An **Inbox** strip appears when unfiled items exist.

### 10.2 The four journeys

| Journey | Path | Cost |
| --- | --- | --- |
| In a hurry | Open → `CAPTURE` | 1 tap |
| Methodical | Open → Switch project → New activity → `CAPTURE` | 3 taps |
| Impatient | Open → `CAPTURE` → lands in Inbox → file later in bulk | 1 tap |
| New project | Open → Start new project → type a name → `CAPTURE` | name only |

**The Inbox is a supported destination, not an error state.** Capturing without context is a
legitimate way to work.

### 10.3 Project creation

Projects are listed with the most recent in-progress highlighted, and a prominent
**Start a new project**. Creation asks for a name and nothing else. Optional on the same
screen: description, locations, and client (typeahead over existing, or typed new). Defaults
per §7.3.

**Location lookup must work offline.** Text lookup searches saved locations already in the
database; coordinate lookup accepts typed coordinates or drops the device's current
position. Online geocoding is an opportunistic enhancement when a connection exists, cached
— never a dependency.

### 10.4 Tablet workspace

`expanded` layouts pair the working column, anchored to the configured reach zone, with a
tabbed companion panel filling the space she looks at but does not touch. Tabs are per
activity type — a survey gets Records, Today, and Documents.

**A Map tab is not in the first implementation.** It depends on an offline tile strategy
that is unresolved (§15), and an online-only map is useless to this user. It is added once
that is settled.

List-detail screens — records, media, batches — become two-pane on `expanded` and collapse
to a push flow on `compact`, handled by a single `SplitPane` primitive so no tool implements
it twice.

---

## 11. Voice mode (deferred, designed for)

Built last, but constrained for from the first line of code.

**Every screen carries a spoken description; every action carries a speakable name.** This
is a contract in the component library, not a later retrofit. With it, adding spoken
readback and voice commands is additive. Without it, it is a rewrite.

Scope when built: an icon and a voice command to enter a voiced mode that reads directions,
instructions and data aloud.

---

## 12. Media, storage and export

### 12.1 Storage

Files live in **app-owned storage** under a project directory, named by record UUID plus an
index.

**Not a public shared folder.** Scoped storage on Android 10+ prevents free writes to
arbitrary public directories, and anything placed there is swept into the gallery and cloud
backup — undesirable for chain-of-custody.

**Human-readable names are applied at export time** — project, sequence, title slug — so
titles can be edited freely without orphaning database links. Naming stored files by title,
as originally proposed, breaks on duplicate titles, renames, blank titles, and slashes.

**Deletion is soft.** The row is flagged; the file survives until a deliberate purge in
settings.

### 12.2 Export profiles

Pure functions in `export`, therefore properly testable.

| Profile | Contents |
| --- | --- |
| CSV bundle | A records file plus a media manifest, so photo and audio references resolve. |
| GPX | Waypoints. Near-universally accepted by mapping tools. |
| KMZ | For map portals; can carry photos inside the archive. |
| ZIP | The CSVs, the media directory, and a plain-language readme. The one to hand to a colleague. |

Out via the Android share sheet, and to a user-chosen folder through the system file picker.

### 12.3 Batch and send

Records from one or more days are grouped into a named batch, bound to a project, with a
destination chosen and export status tracked.

### 12.4 Destinations — resolved

The spike is complete. Findings, with sources, are in
`docs/research/2026-09-06-victorian-biodiversity-destinations.md`.

**Only one of the three systems ingests anything.**

| System | What it accepts |
| --- | --- |
| MapShareVic | Nothing. No writable service exists, and it carries no biodiversity layers. |
| DEECA NatureKit | Nothing. An anonymous viewer over a weekly VBA snapshot; its shapefile upload is a browser-session overlay only. |
| Victorian Biodiversity Atlas | The sole ingestion point. A DEECA-approved account, then either the web form or a macro-enabled `.xlsm` batch template obtained by emailing `vba.help@deeca.vic.gov.au`. |

**There is no public submission API**, and DEECA's own mobile tool, VBA Go, has been offline
since December 2023. A correctly-shaped file the user uploads is therefore not a fallback —
it is the mechanism.

**Two findings change the design.**

*The VBA already models this application's central distinction.* It carries a mandatory
`Positional accuracy (metres)` field and an explicit `GPS used (y, n)` flag. Deliberate fixes
export as `y` with their measured accuracy; ambient ones export as `n`. The application must
never emit `y` beside an optimistic accuracy.

*And the distinction has consequences beyond this application.* DEECA splits its public
extracts by spatial accuracy, and the flagship layers — the ones feeding habitat models and
native-vegetation regulation — are explicitly "for sites with high spatial accuracy". An
opportunistic fix passing as survey-grade does not merely weaken one record; it can drop that
record out of the datasets that get used, or contaminate them. This is the evidence behind
§8.2 being treated as load-bearing rather than fastidious.

**Export targets, in the order they earn their place:** a VBA batch-template-shaped export;
the generic CSV bundle, GPX and KMZ for everything else. The VBA template's exact column set,
code lists and validation rules are transcribed in the research document.

**A browser extension remains ruled out.** Chrome on Android supports no extensions, and with
no API to drive there is nothing for one to automate that a correctly-shaped file does not
already solve.

**Still unresolved, and requiring DEECA rather than more reading:** whether southern-hemisphere
latitude is entered unsigned in the template's decimal-degree form (its validation range and
sample row suggest so), and the exact requiredness of the `GPS used` flag. Both are listed in
the research document with what would settle them. Neither blocks building the generic
profiles.

---

## 13. Testing

- **`geo`, `export` and `data` carry the real test value** — they are pure or near-pure and
  hold the logic that would silently corrupt a dataset. Unit tests, thorough.
- **`ui`** — component tests via React Native Testing Library, focused on the rules the
  components exist to enforce: name clamping and truncation, size-class branching, reach
  zone mirroring, and that no component reads a raw token.
- **Lint rules as tests**: semantic tokens only, size classes only, no cross-tool imports.
- **Device testing is not optional and not substitutable by an emulator.** Thumb reach,
  glare legibility and glove operation only reveal themselves on hardware.

---

## 14. Build order

1. **Destination research spike** (§12.4) — runs first, in parallel with foundation work.
2. **Monorepo foundation** — workspaces, Turborepo, Expo application shell, lint rules, CI.
3. **`tokens` and the theme system** — including light mode from the outset, not retrofitted.
4. **`ui` primitives** — layout, size classes, reach zones, the standard input affordances,
   the help popover, `ProjectName` / `NameChip` / `ContextStamp`.
5. **`data`** — schema, migrations, repositories, the event log.
6. **`geo`** — fix acquisition, averaging, the ambient cache, proximity.
7. **Capture tool** — the capture screen, escalation, duplicate guard.
8. **`media`** — photo and voice capture, storage lifecycle, the library and detail views.
9. **Launcher, projects, activities, and the Inbox.**
10. **`export` and Batch and send.**
11. **Tablet pass** — a distinct phase with its own review on the 10-inch device.
12. **Voice mode.**

**Milestone 1 — the first genuinely usable field build — is items 1 through 9.** At that
point she can open the application, pick or create a project and activity, capture pins with
photos and voice notes, and review them. Export and the tablet pass follow. This is the
natural point to put it on a device and use it for a real day's work before building
further, because a day in the field will change the priorities of everything after it.

Development and review happen on the **S25 first**; the tablet pass is separate and
hardware-reviewed, because emulator testing reveals nothing useful about reach.

---

## 15. Open questions and version 2

- Destination formats — resolved by the spike.
- Tool pinning and manual ordering on the launcher.
- On-device transcription of voice notes.
- Whether any tool warrants extraction into a standalone APK — an explicit decision to
  revisit once real field usage exists.
- Map tile strategy for the tablet companion panel when offline.
