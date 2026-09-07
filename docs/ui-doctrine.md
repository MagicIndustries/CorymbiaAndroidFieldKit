# UI doctrine

A living document, added to as design decisions are made. Every screen and component in the
Corymbia Field Kit is checked against the rules below. This is the answer to the question the
whole design system exists to serve: how screens and components should be built so that, once
a design is settled, it is shared across tools within this app and reused in any future
Corymbia app rather than reinvented per screen.

## Established rules

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
12. **Long names get an optional short label**, user-controlled. When left blank, the full
    name is used as-is (and truncated by the component, per rules 10/11) rather than
    shortened automatically — no heuristic shortens an ecologist's project name better than
    she does, and a bad automatic guess is worse than a clean ellipsis. Used in app bars,
    chips, batch lists and exported filenames.
13. **The full name is always one tap away**, via the standard help popover.
14. **Never scroll or animate a name.** Marquee text is unreadable while walking.
15. **Destructive actions are soft and reversible.** Deletion flags; files survive until a
    deliberate purge in settings.
16. **Every screen carries a spoken description, every action a speakable name.**
17. **A capture is three states, not one screen with extra widgets.** *Ready* is the
    screen's ordinary self. *Acquiring* — from the tap until the fix is settled — collapses
    to a single-focus view: the position, its grade, the time remaining, the frame, the
    words saying what is happening, and the one control. Nothing else is on screen.
    *Recorded* returns the fuller view in a state that reads as finished: what was saved,
    its final accuracy, that it will not change again, and the two ways onward — capture
    again, or leave. This is rules 1 and 2 made concrete for the one interaction the
    product exists for; a capture screen that merely grows a countdown readout has not
    entered a mode, it has added a widget.

## How these rules are enforced

A rule enforced only by memory is a rule that erodes. Where a rule can be enforced by a
shared component or a lint rule, it must be, and the table below is checked against the code
as of this writing — see the commit history of this file for what changed and why.

| Rule | Enforced by |
| --- | --- |
| 5 — consistent input affordances | `InputAffordanceRow` (`packages/ui/src/inputs/InputAffordanceRow.tsx`) renders the four affordances in a fixed order taken from the exported `INPUT_AFFORDANCE_ORDER` constant, so the order cannot drift screen to screen; asserted by test. |
| 7 — help is adjacent, never hover | `HelpAffordance` (`packages/ui/src/help/HelpAffordance.tsx`) is a tappable `?` that opens a modal. There is no `onHover`/tooltip code path in the component at all, so a hover-only help affordance cannot be built with it. |
| 8 — generous targets | `Button` (`packages/ui/src/primitives/Button.tsx`) sets `minHeight` from the token scale: `touch.min` (48dp) for standard buttons, `field.control` (72dp) for field-sized ones. Both minimums are asserted by test. |
| 9 — colour never alone | `ContextStamp` (`packages/ui/src/context-stamp/ContextStamp.tsx`) gives each of the three fix classes — deliberate, ambient, none — a distinct border style (solid vs dashed) *and* distinct wording, never colour alone; its `fix` prop is a discriminated union on `quality`, so an accuracy-less or wrongly-shaped fix cannot even be constructed. `InputAffordanceRow` applies the same two-channel pattern to completion state: a solid border plus a check mark appended to the label, not a colour change alone. |
| 10 — two-line clamp | `ProjectName` (`packages/ui/src/names/ProjectName.tsx`) sets `numberOfLines={2}`; asserted by test. |
| 11 — middle truncation | `NameChip` (`packages/ui/src/names/NameChip.tsx`) sets `ellipsizeMode="middle"`; asserted by test. |
| 12 — optional short label | `resolveDisplayName` (`packages/ui/src/names/shortLabel.ts`) returns the trimmed short label when present and falls back to the full name — including its truncation — when blank, rather than attempting to shorten it automatically. |
| 14 — never animate a name | Neither `ProjectName` nor `NameChip` has an animation path: both render a single static `Type` element with no `Animated` wrapper, so there is nothing to opt out of. |
| 17 — three capture states | Review only, and it needs to stay a review check: nothing a component can enforce distinguishes "the screen hid its panels" from "the screen had no panels". `apps/fieldkit/app/diagnostics.tsx` is the reference implementation — a `phase` of `ready`/`acquiring`/`recorded` chooses between two layouts and three sets of words for one shared capture frame — and its tests assert the transitions directly: that a tap hides the panels, the logs, the choosers and the record list; that completing brings them back; and that taking another reading hides them again. A capture screen added later without those assertions has not met this rule. One thing the reference implementation gets right that is easy to get wrong: the countdown transcript is hidden during *Acquiring* but visible the instant the point is recorded, because it is an artefact the work produces, and a state model that loses a measurement to a tidier layout has failed at the thing it was for. |
| 16 — spoken labels | `Button` (`packages/ui/src/primitives/Button.tsx`) carries a `spokenLabel` prop used as the `accessibilityLabel`, defaulting to the visible `label` when not given. `Screen` (`packages/ui/src/primitives/Screen.tsx`) carries an optional `spokenDescription` prop, rendered on a dedicated zero-size `accessible` node rather than the screen's own container (which would collapse every child into one opaque focus stop) — the component-library support for the "every screen carries a spoken description" half of this rule; the voiced mode itself is a later plan. `ContextStamp` (`packages/ui/src/context-stamp/ContextStamp.tsx`) exports `composeContextStampSpokenLabel`, which turns its glyph-prefixed chips (`◎ ±4 m`, `~ ±38 m · 4 min old`, `⚑ no position`, `▣ field-s24`) into one readable sentence set as the component's `accessibilityLabel`, covering all three fix classes plus the optional place, device and activity; asserted verbatim by test, including the spec's worked example ("recorded during Survey 3, near Yarra Flats — North Reach, 120 m away"). |
| Semantic tokens only | ESLint rule 1 in `eslint.config.mjs` (`no-restricted-syntax`) rejects raw hex colours — as plain string literals and as non-interpolated template literals — anywhere under `packages/` and `apps/` except `packages/tokens/src/ramp.ts` (the raw material layer itself) and the tokens package's own tests (which pin those raw values on purpose). The same rule also rejects named (`'white'`, `'transparent'`, ...) and functional (`'rgba(...)'`, `'hsl(...)'`, ...) colour literals, scoped to colour-bearing style properties (`backgroundColor`, `borderColor`, `color`, ...) rather than every string literal in the codebase — a blanket ban would misfire on ordinary domain text in an eDNA/biodiversity app (species and site names like "orange-bellied parrot" or "coral reef"). A fifth selector on the same rule closes the remaining gap: a component reaching into `ramp` directly (e.g. `ramp.brand.teal`) is not a colour literal at all, so no literal-matching selector can catch it; importing `ramp` from `@corymbia/tokens` is rejected everywhere except `packages/tokens` itself (structurally exempt — its own files reach `ramp` via a relative import, never the package specifier) and `packages/brand`, whose logo artwork is deliberately theme-invariant and is not supposed to re-theme with the semantic layer. `packages/brand`'s exemption from just that one selector needs its own config block (re-declaring the other four) rather than an entry in RULE 1's `ignores`, because a flat-config `ignores` exempts a file from every selector in the block, not one selector within it — and because two blocks matching the same file can never each contribute a different subset of the same rule's array; the later block replaces the earlier one's entirely. |
| Size class and device class only | ESLint rule 2 in `eslint.config.mjs` (`no-restricted-imports`) rejects `useWindowDimensions` and `Dimensions` from `react-native`, both as a named import and via a `react-native/*` subpath import, everywhere except `packages/ui/src/layout/useLayout.ts` — the one function permitted to read the window — and the test mock that stands in for it. `useLayout()` derives two separate vocabularies from that one reading: `sizeClass` (compact/medium/expanded, from current width) drives layout, and `deviceClass` (phone/tablet, from the shortest side) drives ergonomics. Reach zones (`packages/ui/src/layout/reach.ts`) resolve from `deviceClass` and orientation only, never from `sizeClass` — a tablet's corners don't get easier to reach because the window happens to be `expanded`. |
| Tool independence | ESLint rule 3 in `eslint.config.mjs` (`import/no-restricted-paths`) rejects imports from a sibling tool under `apps/fieldkit/src/tools/`. It is given an explicit `basePath` (the repo root, derived from the config file's own location) because Turborepo runs each workspace's `lint` script with that workspace as the process's working directory, not the repo root — the plugin resolves its zone paths against `process.cwd()` by default, so without an explicit `basePath` the rule silently matches nothing under a real `turbo run lint` invocation and no error would ever reveal it. This rule needs one zone per tool directory (`except` is a static path, not a back-reference to `target`), which means a human has to remember to mirror the zone when a second tool is added — `scripts/verify-lint-rules.mjs` now enumerates the real directories under `apps/fieldkit/src/tools/` and fails loudly if any lacks a matching zone, so a forgotten mirror is a check failure instead of a silent gap. This rule is currently inert in the sense that no second tool exists yet to violate it — `apps/fieldkit/src/tools/` is not yet populated — but it fires correctly against a fixture, see below. |
| Rotation stays unlocked | `apps/fieldkit/app.json` deliberately has no `"orientation"` key. Expo bakes that setting into the Android manifest for every device class; locking it to `portrait` (as the create-expo-app scaffold does by default) would make `sizeClass: 'expanded'` and the `bottomCorners` reach anchor — both produced by `useLayout`/`resolveReach` above, and load-bearing for the tablet workspace — unreachable on a shipped 10-inch tablet build, since that device class only enters `expanded` in landscape. Device verification on a phone would not catch this, because a phone never reaches `expanded` either way. Do not re-add `"orientation": "portrait"` for tidiness. |

All three ESLint rules above are proven to actually fire under the real invocation — not just
configured and assumed to work — by `scripts/verify-lint-rules.mjs`, run with
`pnpm run lint:verify-rules`. It writes small fixture files and lints them by `chdir`-ing into
each workspace directory the way Turborepo's per-workspace `lint` script really does, then
asserts each rule reports what it should: a rejected raw hex literal (string and template
form), a rejected `Dimensions` import (named and subpath form), a rejected cross-tool import,
and — the inverted case that catches a rule too broad to mean anything — an import between two
files in the *same* tool that must still be allowed. This script is itself part of how these
rules are enforced: a lint rule that has never been proven to fire under the real invocation is
no more trustworthy than a rule enforced by memory.

The same script also enumerates the real directories under `apps/fieldkit/src/tools/` and fails
if any lacks a mirrored `import/no-restricted-paths` zone in RULE 3 — the config-drift check for
the "one zone per tool" limitation described in the Tool independence row above. This check is
read-only against the real config and directory tree (it imports `eslint.config.mjs` itself
rather than re-describing it), separate from the fixture-based rule-firing cases.

Beyond the three architectural rules, `eslint.config.mjs` also enables a standard baseline
(ESLint's own `recommended` rules plus `@typescript-eslint`'s `recommended` rules) and
`eslint-plugin-react-hooks`'s `rules-of-hooks` and `exhaustive-deps`, both bumped from the
plugin's default `warn` to `error` — a warning does not fail `eslint <dir>` in this repo (there
is no `--max-warnings`), so leaving them at `warn` would have been the same "configured but not
enforced" gap this document exists to close. Hook-order and effect-dependency bugs are exactly
the class this repo is about to start writing once GPS subscriptions and fix averaging land, so
this baseline is checked before that work begins, not after the first bug report.

Rules 1, 2, 3, 4, 6, 13 and 15 are judgement calls that no linter can make. They are checked at
review, and every screen review checks all of them.

## Adding a rule

When a design decision is made that should hold across screens, add it here in the same
session it is made, and note how it will be enforced. If it cannot be enforced by a component
or a lint rule, say so explicitly — that is a signal to watch it in review.
