# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

A pnpm workspace orchestrated by Turborepo, containing five shared packages under
`packages/` (`@corymbia/tokens`, `@corymbia/brand`, `@corymbia/ui`,
`@corymbia/data`, `@corymbia/geo`) and the Expo application in `apps/fieldkit` —
six workspaces in all.

- `@corymbia/data` — SQLite schema, migrations and repositories. The record
  spine, the append-only event log, and the device registry.
- `@corymbia/geo` — the GPS engine: distance, accuracy grading, hold averaging,
  the ambient position cache, and the platform location adapters.

Commands, from the repository root:

- `pnpm turbo run test` — all tests (`packages/tokens`, `packages/brand`,
  `packages/ui`, `packages/data` and `packages/geo`; `apps/fieldkit` has no
  tests of its own yet)
- `pnpm turbo run lint` — ESLint across all six workspaces, including the three
  architectural rules described in `docs/ui-doctrine.md`
- `pnpm turbo run typecheck` — TypeScript across all six workspaces
- `pnpm run lint:verify-rules` — proves the three architectural lint rules actually
  fire under a real per-workspace invocation, not just that they are configured
- `cd apps/fieldkit && npx expo run:android` — build and run on a connected device
- `pnpm run generate:app-icons` — regenerates the launcher icons from
  `design/logo/logo.svg` (see below)

## Native builds

`apps/fieldkit/android/` is generated and git-ignored. Two things about it have
already cost time once each:

- **`expo run:android` never exits.** It keeps the Metro bundler alive by design, so
  waiting for the process to end waits forever. To tell whether an install actually
  landed, check `adb shell dumpsys package eco.corymbia.fieldkit | grep lastUpdateTime`.
- **Changes to `app.json` do not reach a build on their own.** `expo run:android`
  compiles whatever is already in `android/`; icons, the app name, orientation and
  similar config only get written into native resources by `npx expo prebuild
  --platform android`. Run it after editing `app.json`, then build. Prebuild also
  reports config that needs a package installed to work at all — it is worth reading
  its output rather than skipping past it.

A release build (`npx expo run:android --variant release`) embeds the JavaScript
bundle, so the APK runs with no development machine attached. That is the build to
use for judging the app in the field.

## Design and UI rules

`docs/ui-doctrine.md` holds the rules every screen and component is checked
against. Read it before building any UI. Add to it whenever a cross-screen
design decision is made.

`docs/gps-accuracy.md` explains how the reported GPS accuracy is derived
(inverse-variance weighting, the floor, spread, altitude) and why an optimistic
figure is harmful — read it before touching `packages/geo/src/average.ts`.

Three constraints are enforced by lint and must not be worked around:

1. Components consume semantic tokens from `@corymbia/tokens` only — never raw
   hex, never the raw ramp.
2. Only `packages/ui/src/layout/useLayout.ts` reads window dimensions.
   Everything else branches on `sizeClass` (compact/medium/expanded, which
   drives layout) or `deviceClass` (phone/tablet, which drives ergonomics such
   as reach zones) — never on a raw width or height.
3. A tool under `apps/fieldkit/src/tools/` may import from packages and from
   itself, never from a sibling tool. This rule needs an explicit `basePath` in
   `eslint.config.mjs` because Turborepo runs each workspace's `lint` script
   with that workspace as the working directory, not the repo root — do not
   "simplify" it away.

## Data and GPS rules

Two rules in `@corymbia/data` are not enforced by lint or by any type, and both
can be broken silently — the code goes on working and only the data is wrong.

- **Every adapter that opens this database must set `recursive_triggers = ON`.**
  The event log is append-only, enforced by two triggers (migration 003). With
  the pragma off — SQLite's default — `INSERT OR REPLACE INTO event` deletes the
  conflicting row to make room and SQLite *skips the BEFORE DELETE trigger for
  that deletion*, so the statement silently rewrites an existing event and
  returns success. That defeats the one table whose entire purpose is being
  tamper-evident. Both adapters set it (`src/db/better-sqlite3.ts`,
  `src/db/expo.ts`); a third one that forgets will pass every test that does not
  specifically try a REPLACE.

- **The three fix classes are enforced in three places, and all three change
  together.** Spec §8.2's deliberate/ambient/none distinction is stated by the
  `Fix` discriminated union in `src/repositories/records.ts` (so a malformed fix
  cannot be constructed), by the CHECK constraints in migration 003 (so one
  cannot be stored), and by `ContextStamp` in `@corymbia/ui` (so one cannot be
  shown wrongly). Adding a fourth class, or changing what a class must carry, in
  only one of the three leaves the other two disagreeing — and the disagreement
  surfaces as a `SQLITE_CONSTRAINT` failure mid-capture on a field device, or
  worse, as a row nobody refused.

## Project context

Corymbia EcoSciences (https://www.corymbia.eco) provides environmental DNA (eDNA) analysis — soil and water sampling plus next-gen sequencing to identify animals, plants, fungi, and microbes present on a site. Customer-facing framing (from `design/brochure/`) covers biosecurity, biodiversity monitoring, endangered-species protection, soil analysis, and agricultural/land-management use.

The repo name indicates the deliverable is an **Android field kit** — the on-site companion app for eDNA sample collection. Field conditions (offline capture, GPS/site metadata, sample chain-of-custody, later sync) are the design constraints.

This work is governed by an approved spec and plan:

- `docs/superpowers/specs/2026-09-05-corymbia-field-kit-design.md` — the design spec. Several source comments and `eslint.config.mjs` cite it by section number (e.g. `spec §3`); read the cited section before assuming a rule is arbitrary or "simplifiable".
- `docs/superpowers/plans/2026-09-05-foundation-and-design-system.md` — the implementation plan.

Both are currently untracked on feature branches — they land on `main` via a separate pull request rather than through this branch's own commits — so don't expect `git log`/`git blame` to show them, and don't assume their absence from a fresh clone means no spec exists. If they are genuinely missing from your checkout, ask before assuming requirements.

## Design assets

- `design/logo/` — logo in SVG, PNG (transparent/white/dark, 512 and 1500px), and layered PSD, including name+tagline lockups.
- `design/brochure/` — four-page eDNA marketing brochure (JPG). This is the best available source for brand voice, colour palette (deep teal/slate + light green accent), and how the product is described to customers.

Use `design/logo/logo.svg` for anything that needs a scalable mark; prefer the transparent PNGs for raster use.

## Agent skills

Skills are vendored, not installed globally. `.agents/skills/` holds the actual skill directories (mostly from the `mattpocock/skills` GitHub repo), `skills-lock.json` pins each one by source path and content hash, and `.claude/skills/` contains symlinks pointing back into `.agents/skills/` so Claude Code picks them up.

Consequences:

- Editing a skill under `.claude/skills/<name>/` edits the vendored copy in `.agents/skills/`, and its hash will no longer match `skills-lock.json`.
- Adding a skill means adding the directory under `.agents/skills/`, symlinking it into `.claude/skills/`, and recording it in `skills-lock.json`.
- The `setup-matt-pocock-skills` skill drives project-level configuration for this skill set. It has been run; its output is `docs/agents/*.md` and the sub-sections below. Re-run it only to switch issue trackers or start over.

### Issue tracker

Issues live as GitHub issues in `MagicIndustries/CorymbiaAndroidFieldKit`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, used verbatim as label strings. See `docs/agents/triage-labels.md`.

### Domain docs

Neither `CONTEXT.md` nor `docs/adr/` exists yet in this repo — they are created lazily,
the first time a domain term or architectural decision actually needs recording. See
`docs/agents/domain.md` for the convention (single-context layout: `CONTEXT.md` and
`docs/adr/` at the repo root) and how to consume them once they exist. Their absence is
expected, not a gap to flag or fill preemptively.

## Working agreements

- Never merge into `main`; open a PR and let the user merge.
- Do new work on a branch, and ask before creating one.
