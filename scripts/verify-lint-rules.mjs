#!/usr/bin/env node
/**
 * Proves each of eslint.config.mjs's three architectural rules actually
 * fires when lint runs the way it really runs in this repo, and separately
 * checks that RULE 3's per-tool zone configuration hasn't drifted out of
 * sync with the real tool directories (Finding 2, final-review round b —
 * see `findToolZoneCoverageGaps` below for why that check exists).
 *
 * Why this exists: `import/no-restricted-paths` (rule 3) was silently inert
 * for months because its zone paths were anchored against `process.cwd()`
 * (the plugin's default `basePath`) while ESLint's own `files`/`ignores`
 * globs are anchored against the config file's directory. Those two anchors
 * only agree when ESLint runs with cwd = repo root — and nothing in this
 * repo ever does that. The root `lint` script is `turbo run lint`, which
 * fans out to each workspace's own `lint` script (`eslint src`, `eslint
 * app`, ...) with THAT WORKSPACE as the process cwd. A rule proof that
 * doesn't reproduce that cwd proves nothing about the real lint run — which
 * is exactly how this defect survived unnoticed.
 *
 * So every case below runs `new ESLint({ cwd: <workspaceDir> })` with no
 * explicit config path, letting ESLint auto-discover eslint.config.mjs by
 * walking up from that workspace directory — identical to what `pnpm
 * --filter <workspace> lint` actually does.
 *
 * SAFETY: two cases write fixtures under `apps/fieldkit/src/tools/`, a real
 * source directory a later plan populates with real tool code (starting
 * with `apps/fieldkit/src/tools/capture/`). An earlier version of this
 * script computed a single "cleanup root" per case and `rmSync`'d it
 * recursively — safe only by accident, while `src/tools` happened not to
 * exist yet. The moment real files landed under it, that same cleanup would
 * have deleted them along with the fixtures and reported success. This
 * version never deletes a directory it did not itself create, and never
 * writes over a file that already exists: see `writeFile` and the cleanup
 * pass at the bottom.
 *
 * Usage: node scripts/verify-lint-rules.mjs
 * Exits non-zero if any rule fails to fire as expected.
 */

import { ESLint } from 'eslint'
import { fileURLToPath, pathToFileURL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Finding 2 (final-review round b): RULE 3 in eslint.config.mjs needs one
 * `import/no-restricted-paths` zone PER TOOL directory, because the plugin's
 * `except` is a static path, not a back-reference to `target` — there is no
 * way to express "any sibling other than my own directory" in a single
 * generic zone. That means adding a second tool (e.g. `survey`) requires a
 * human to remember to mirror the zone in eslint.config.mjs. Forgetting is
 * silent: the new tool simply isn't protected, and nothing errors.
 *
 * This turns that "remember to edit the config" into a loud, checked
 * invariant: enumerate the real directories under
 * apps/fieldkit/src/tools/ and confirm eslint.config.mjs's RULE 3 block has
 * a zone for each one (`target` pointing at that tool, `except` naming it).
 * It imports eslint.config.mjs itself (rather than re-parsing/regexing the
 * file's text) so this check reads the actual configuration ESLint will run
 * with, not a second description of it that could itself drift.
 *
 * Deliberately read-only: this function only inspects `apps/fieldkit/src/tools/`,
 * it never creates or deletes anything there — the manual proof for this
 * check (a temporary `survey/` tool with no zone, confirmed to fail, then
 * removed) is done by hand outside this script, not baked in as a
 * self-cleaning fixture, so that a tool directory found by this function is
 * always unambiguously real.
 */
async function findToolZoneCoverageGaps() {
  const toolsDir = path.join(repoRoot, 'apps/fieldkit/src/tools')
  if (!fs.existsSync(toolsDir)) {
    // Matches the RULE 3 comment in eslint.config.mjs: the directory doesn't
    // exist yet in this repo, so there is nothing to be missing a zone.
    return { toolDirs: [], missing: [] }
  }

  const toolDirs = fs
    .readdirSync(toolsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  const eslintConfigUrl = pathToFileURL(path.join(repoRoot, 'eslint.config.mjs')).href
  const { default: config } = await import(eslintConfigUrl)

  const rule3Block = config.find(
    (block) =>
      Array.isArray(block.files) && block.files.includes('apps/fieldkit/src/tools/**/*.{ts,tsx}'),
  )
  if (!rule3Block) {
    throw new Error(
      'Could not find the RULE 3 block (files: ["apps/fieldkit/src/tools/**/*.{ts,tsx}"]) in ' +
        'eslint.config.mjs. It may have been renamed or restructured — update this check to match.',
    )
  }

  const restrictedPathsRule = rule3Block.rules?.['import/no-restricted-paths']
  const zones = restrictedPathsRule?.[1]?.zones ?? []

  const missing = toolDirs.filter((tool) => {
    const expectedTarget = `./apps/fieldkit/src/tools/${tool}`
    const expectedExcept = `./${tool}`
    return !zones.some(
      (zone) => zone.target === expectedTarget && Array.isArray(zone.except) && zone.except.includes(expectedExcept),
    )
  })

  return { toolDirs, missing }
}

// Tracks exactly what this run created, so cleanup can be precise instead
// of guessing at a "root" to delete recursively.
const createdFiles = new Set()
const createdDirs = new Set()

/**
 * Writes a fixture file, refusing outright if that path already contains
 * real content — this script must never silently clobber or later delete
 * something it didn't create. Only the directories that do not yet exist
 * are recorded as created-by-us; any directory that already exists (e.g. a
 * real `src/tools/capture/` from other work) is left completely alone,
 * fixture files inside it are added individually, and removed individually.
 */
function writeFile(absPath, content) {
  if (fs.existsSync(absPath)) {
    throw new Error(
      `Refusing to write fixture over existing file: ${absPath}\n` +
        `This is either real content or a leftover from a previous run — ` +
        `aborting without touching it.`,
    )
  }

  // Walk up from the target's parent, recording every ancestor directory
  // that does not exist yet. Only those get created (and later removed).
  let dir = path.dirname(absPath)
  const missingDirs = []
  while (!fs.existsSync(dir)) {
    missingDirs.push(dir)
    dir = path.dirname(dir)
  }

  fs.mkdirSync(path.dirname(absPath), { recursive: true })
  for (const d of missingDirs) createdDirs.add(d)

  fs.writeFileSync(absPath, content)
  createdFiles.add(absPath)
}

async function lint(workspaceDir, filePaths) {
  // Passing `cwd` to the ESLint constructor is not enough to reproduce the
  // real invocation: it steers ESLint's own config auto-discovery and glob
  // resolution, but `import/no-restricted-paths` reads `process.cwd()`
  // directly (`options.basePath || process.cwd()`), bypassing that option
  // entirely. The only way to make the rule see the same cwd the real
  // per-workspace `lint` scripts give it is to actually chdir the process,
  // the way `pnpm --filter <workspace> lint` (via turbo) does. This is the
  // crux of Finding 1 and Finding 2: a proof that only passed `cwd` to the
  // constructor without chdir'ing would never have observed the defect.
  const originalCwd = process.cwd()
  process.chdir(workspaceDir)
  try {
    const eslint = new ESLint({ cwd: workspaceDir })
    const results = await eslint.lintFiles(filePaths)
    return results.flatMap((r) => r.messages)
  } finally {
    process.chdir(originalCwd)
  }
}

function hasRuleId(messages, ruleId) {
  return messages.some((m) => m.ruleId === ruleId)
}

/**
 * Each case: sets up its own fixture(s), lints them the real way, asserts
 * on the presence/absence of a ruleId, then reports back for cleanup.
 */
const cases = [
  {
    name: 'Rule 3 zone coverage: every real tool directory has a mirrored zone (Finding 2)',
    // Deliberately runs FIRST, before any other case writes a fixture under
    // apps/fieldkit/src/tools/ — see the two cross-tool-import cases below,
    // which create temporary `capture/` and `survey/` fixture files. If this
    // check ran after those, it would see its own temporary `survey/`
    // fixture directory and misreport it as a real, unprotected tool.
    async run() {
      const { toolDirs, missing } = await findToolZoneCoverageGaps()
      if (missing.length > 0) {
        return {
          ok: false,
          messages: missing.map((tool) => ({
            ruleId: 'lint:verify-rules/zone-coverage',
            message:
              `apps/fieldkit/src/tools/${tool} has no mirrored import/no-restricted-paths zone ` +
              `in eslint.config.mjs's RULE 3 block. Add one (target: './apps/fieldkit/src/tools/${tool}', ` +
              `except: ['./${tool}']) so this tool is protected from cross-tool imports.`,
          })),
        }
      }
      return {
        ok: true,
        messages:
          toolDirs.length === 0
            ? [{ ruleId: null, message: 'apps/fieldkit/src/tools/ does not exist yet — nothing to check.' }]
            : [{ ruleId: null, message: `All ${toolDirs.length} tool(s) covered: ${toolDirs.join(', ')}` }],
      }
    },
  },
  {
    name: 'Rule 1 (no-restricted-syntax): raw hex string literal is rejected',
    async run() {
      const dir = path.join(repoRoot, 'packages/ui/src/__lint_verify_tmp__')
      const file = path.join(dir, 'rule1-literal.ts')
      writeFile(file, "export const scratch = '#FF0000'\nconsole.log(scratch)\n")
      const messages = await lint(path.join(repoRoot, 'packages/ui'), [file])
      return { ok: hasRuleId(messages, 'no-restricted-syntax'), messages }
    },
  },
  {
    name: 'Rule 1 (no-restricted-syntax): raw hex TEMPLATE literal is rejected (Finding 3 gap)',
    async run() {
      const dir = path.join(repoRoot, 'packages/ui/src/__lint_verify_tmp__')
      const file = path.join(dir, 'rule1-template.ts')
      writeFile(file, 'export const scratch = `#FF0000`\nconsole.log(scratch)\n')
      const messages = await lint(path.join(repoRoot, 'packages/ui'), [file])
      return { ok: hasRuleId(messages, 'no-restricted-syntax'), messages }
    },
  },
  {
    name: "Rule 1 (no-restricted-syntax): named colour 'white' on backgroundColor is rejected (Finding 1, final-review round b)",
    async run() {
      const dir = path.join(repoRoot, 'packages/ui/src/__lint_verify_tmp__')
      const file = path.join(dir, 'rule1-named-color.tsx')
      writeFile(
        file,
        "import { View } from 'react-native'\n" +
          "export const Scratch = () => <View style={{ backgroundColor: 'white' }} />\n",
      )
      const messages = await lint(path.join(repoRoot, 'packages/ui'), [file])
      return { ok: hasRuleId(messages, 'no-restricted-syntax'), messages }
    },
  },
  {
    name: "Rule 1 (no-restricted-syntax): importing `ramp` from '@corymbia/tokens' is rejected outside packages/tokens and packages/brand (Finding 1, final-review round b)",
    async run() {
      const dir = path.join(repoRoot, 'packages/ui/src/__lint_verify_tmp__')
      const file = path.join(dir, 'rule1-ramp-import.ts')
      writeFile(file, "import { ramp } from '@corymbia/tokens'\nconsole.log(ramp)\n")
      const messages = await lint(path.join(repoRoot, 'packages/ui'), [file])
      return { ok: hasRuleId(messages, 'no-restricted-syntax'), messages }
    },
  },
  {
    name: 'Rule 1 exemption (no-restricted-syntax): importing `ramp` is still ALLOWED inside packages/brand (Finding 1, final-review round b)',
    async run() {
      // Inverted case, same purpose as the capture/capture case for RULE 3
      // below: proves the packages/brand exemption is scoped to the ramp
      // selector specifically, not a rule too broad to mean anything (e.g.
      // one that accidentally turned off ALL of RULE 1 for brand, hex
      // literals included — see the next case).
      const dir = path.join(repoRoot, 'packages/brand/src/__lint_verify_tmp__')
      const file = path.join(dir, 'rule1-ramp-import-allowed.ts')
      writeFile(file, "import { ramp } from '@corymbia/tokens'\nconsole.log(ramp)\n")
      const messages = await lint(path.join(repoRoot, 'packages/brand'), [file])
      return { ok: !hasRuleId(messages, 'no-restricted-syntax'), messages }
    },
  },
  {
    name: 'Rule 1 exemption (no-restricted-syntax): packages/brand is still bound by the raw hex selector',
    async run() {
      // The other half of the previous case's point: packages/brand's ramp
      // exemption must not have silently dropped the hex-literal check too.
      const dir = path.join(repoRoot, 'packages/brand/src/__lint_verify_tmp__')
      const file = path.join(dir, 'rule1-hex-still-checked.ts')
      writeFile(file, "export const scratch = '#FF0000'\nconsole.log(scratch)\n")
      const messages = await lint(path.join(repoRoot, 'packages/brand'), [file])
      return { ok: hasRuleId(messages, 'no-restricted-syntax'), messages }
    },
  },
  {
    name: "Rule 2 (no-restricted-imports): named import of 'react-native' Dimensions is rejected",
    async run() {
      const dir = path.join(repoRoot, 'packages/ui/src/__lint_verify_tmp__')
      const file = path.join(dir, 'rule2-named.ts')
      writeFile(file, "import { Dimensions } from 'react-native'\nconsole.log(Dimensions)\n")
      const messages = await lint(path.join(repoRoot, 'packages/ui'), [file])
      return { ok: hasRuleId(messages, 'no-restricted-imports'), messages }
    },
  },
  {
    name: 'Rule 2 (no-restricted-imports): react-native SUBPATH import is rejected (Finding 3 gap)',
    async run() {
      const dir = path.join(repoRoot, 'packages/ui/src/__lint_verify_tmp__')
      const file = path.join(dir, 'rule2-subpath.ts')
      writeFile(
        file,
        "import Dimensions from 'react-native/Libraries/Utilities/Dimensions'\nconsole.log(Dimensions)\n",
      )
      const messages = await lint(path.join(repoRoot, 'packages/ui'), [file])
      return { ok: hasRuleId(messages, 'no-restricted-imports'), messages }
    },
  },
  {
    name: 'Rule 3 (import/no-restricted-paths): cross-tool import (capture -> survey) is rejected',
    async run() {
      const toolsDir = path.join(repoRoot, 'apps/fieldkit/src/tools')
      writeFile(
        path.join(toolsDir, 'survey/__lint_verify_tmp__helper.ts'),
        "export const helper = 'survey helper'\n",
      )
      const file = path.join(toolsDir, 'capture/__lint_verify_tmp__index.ts')
      writeFile(file, "import { helper } from '../survey/__lint_verify_tmp__helper'\nconsole.log(helper)\n")
      // cwd = the fieldkit app directory, matching its real `lint` script
      // ("eslint app"), which is invoked with the app as cwd, never the
      // repo root. This is the exact case Finding 1 fixes.
      const messages = await lint(path.join(repoRoot, 'apps/fieldkit'), [file])
      return { ok: hasRuleId(messages, 'import/no-restricted-paths'), messages }
    },
  },
  {
    name: 'Rule 3 (import/no-restricted-paths): same-tool import (capture -> capture) is still ALLOWED',
    async run() {
      const toolsDir = path.join(repoRoot, 'apps/fieldkit/src/tools')
      writeFile(
        path.join(toolsDir, 'capture/__lint_verify_tmp__sibling.ts'),
        "export const helper = 'capture sibling'\n",
      )
      const file = path.join(toolsDir, 'capture/__lint_verify_tmp__self.ts')
      writeFile(file, "import { helper } from './__lint_verify_tmp__sibling'\nconsole.log(helper)\n")
      const messages = await lint(path.join(repoRoot, 'apps/fieldkit'), [file])
      // Inverted assertion: a rule that rejects every import would pass the
      // case above for the wrong reason. This case is what rules that out.
      return { ok: !hasRuleId(messages, 'import/no-restricted-paths'), messages }
    },
  },
]

let allOk = true

for (const testCase of cases) {
  process.stdout.write(`\n=== ${testCase.name} ===\n`)
  let result
  try {
    result = await testCase.run()
  } catch (err) {
    allOk = false
    console.error('  ERRORED:', err)
    continue
  }
  if (result.ok) {
    console.log('  PASS')
    for (const m of result.messages ?? []) {
      console.log(`    ${m.message}`)
    }
  } else {
    allOk = false
    console.log('  FAIL — messages observed:')
    for (const m of result.messages) {
      console.log(`    ${m.ruleId ?? '(no ruleId)'}: ${m.message}`)
    }
    if (result.messages.length === 0) {
      console.log('    (no messages at all)')
    }
  }
}

// Cleanup: remove exactly the files this run wrote, then remove exactly the
// directories this run created — deepest first, and only if now empty. A
// directory that pre-existed (e.g. a real `src/tools/capture/`) was never
// added to `createdDirs`, so it is never touched here even though fixture
// files were written inside it. No recursive/force delete of anything.
for (const file of createdFiles) {
  fs.rmSync(file, { force: true })
}
const dirsDeepestFirst = [...createdDirs].sort((a, b) => b.length - a.length)
for (const dir of dirsDeepestFirst) {
  try {
    fs.rmdirSync(dir)
  } catch (err) {
    if (err.code !== 'ENOTEMPTY' && err.code !== 'ENOENT') throw err
    // Non-empty means this directory holds something this run did not
    // create (e.g. a real file that lives alongside our fixtures) — leave
    // it exactly as found instead of forcing a recursive delete.
  }
}

console.log(`\n${allOk ? 'All rules verified.' : 'One or more rules FAILED to fire as expected.'}`)
process.exit(allOk ? 0 : 1)
