# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

This repo is a greenfield scaffold: **there is no application source code, no build system, and no commits on `main` yet.** Everything currently tracked is design collateral and agent-skill configuration.

Do not infer a stack, framework, or directory layout from this file — none has been committed. When the first implementation work starts, the choice of stack, package manager, test runner, and lint setup is still open, and this file should be updated with the real build/test/lint commands at that point.

## Project context

Corymbia EcoSciences (https://www.corymbia.eco) provides environmental DNA (eDNA) analysis — soil and water sampling plus next-gen sequencing to identify animals, plants, fungi, and microbes present on a site. Customer-facing framing (from `design/brochure/`) covers biosecurity, biodiversity monitoring, endangered-species protection, soil analysis, and agricultural/land-management use.

The repo name indicates the deliverable is an **Android field kit** — the on-site companion app for eDNA sample collection. Treat field conditions (offline capture, GPS/site metadata, sample chain-of-custody, later sync) as the likely design constraints, but confirm requirements with the user rather than assuming.

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

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Working agreements

- Never merge into `main`; open a PR and let the user merge.
- Do new work on a branch, and ask before creating one.
