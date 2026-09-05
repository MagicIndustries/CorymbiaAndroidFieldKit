#!/usr/bin/env node
/**
 * Regenerates packages/brand/src/markPath.ts from the source artwork.
 *
 * The mark's outline is a ~1950-character SVG path. Transcribing it by hand
 * would render as subtly wrong artwork that no test could catch, so it is
 * generated from design/logo/logo.svg instead.
 *
 * Run after the artwork changes:  pnpm run generate:brand-mark
 *
 * The colours are NOT generated — they live in @corymbia/tokens (ramp.brandGradient
 * and ramp.brand.*) and are wired up by hand in CorymbiaMark.tsx, so the artwork
 * and the theme cannot drift apart.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(repoRoot, 'design/logo/logo.svg')
const target = join(repoRoot, 'packages/brand/src/markPath.ts')

const svg = readFileSync(source, 'utf8')

// The mark's outline is the single path carrying class "st4" (the gradient fill).
// The eight spore dots are <circle> elements and are declared in CorymbiaMark.tsx.
const match = svg.match(/<path[^>]*class="st4"[^>]*?\sd="([^"]+)"/s)
if (!match) {
  console.error(`No path with class="st4" found in ${source}.`)
  console.error('The artwork structure changed — check the SVG before editing this script.')
  process.exit(1)
}

const path = match[1]
writeFileSync(
  target,
  `/* GENERATED from design/logo/logo.svg — do not edit by hand.\n` +
    ` * Regenerate with: pnpm run generate:brand-mark\n` +
    ` * (scripts/generate-brand-mark-path.mjs) */\n` +
    `export const MARK_PATH =\n  '${path}'\n`,
)

console.log(`Wrote ${target} — ${path.length} chars of path data.`)
