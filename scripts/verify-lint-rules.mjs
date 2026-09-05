#!/usr/bin/env node
/**
 * Proves each of eslint.config.mjs's three architectural rules actually
 * fires when lint runs the way it really runs in this repo.
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
 * Usage: node scripts/verify-lint-rules.mjs
 * Exits non-zero if any rule fails to fire as expected.
 */

import { ESLint } from 'eslint'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Returns the shallowest path along `targetPath` that does not yet exist. */
function firstMissingAncestor(targetPath) {
  let current = targetPath
  let missing = targetPath
  while (!fs.existsSync(current)) {
    missing = current
    current = path.dirname(current)
  }
  return missing
}

function writeFile(absPath, content) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true })
  fs.writeFileSync(absPath, content)
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
    name: 'Rule 1 (no-restricted-syntax): raw hex string literal is rejected',
    async run() {
      const dir = path.join(repoRoot, 'packages/ui/src/__lint_verify_tmp__')
      const cleanupRoot = firstMissingAncestor(dir)
      const file = path.join(dir, 'rule1-literal.ts')
      writeFile(file, "export const scratch = '#FF0000'\nconsole.log(scratch)\n")
      const messages = await lint(path.join(repoRoot, 'packages/ui'), [file])
      return { cleanupRoot, ok: hasRuleId(messages, 'no-restricted-syntax'), messages }
    },
  },
  {
    name: 'Rule 1 (no-restricted-syntax): raw hex TEMPLATE literal is rejected (Finding 3 gap)',
    async run() {
      const dir = path.join(repoRoot, 'packages/ui/src/__lint_verify_tmp__')
      const cleanupRoot = firstMissingAncestor(dir)
      const file = path.join(dir, 'rule1-template.ts')
      writeFile(file, 'export const scratch = `#FF0000`\nconsole.log(scratch)\n')
      const messages = await lint(path.join(repoRoot, 'packages/ui'), [file])
      return { cleanupRoot, ok: hasRuleId(messages, 'no-restricted-syntax'), messages }
    },
  },
  {
    name: "Rule 2 (no-restricted-imports): named import of 'react-native' Dimensions is rejected",
    async run() {
      const dir = path.join(repoRoot, 'packages/ui/src/__lint_verify_tmp__')
      const cleanupRoot = firstMissingAncestor(dir)
      const file = path.join(dir, 'rule2-named.ts')
      writeFile(file, "import { Dimensions } from 'react-native'\nconsole.log(Dimensions)\n")
      const messages = await lint(path.join(repoRoot, 'packages/ui'), [file])
      return { cleanupRoot, ok: hasRuleId(messages, 'no-restricted-imports'), messages }
    },
  },
  {
    name: 'Rule 2 (no-restricted-imports): react-native SUBPATH import is rejected (Finding 3 gap)',
    async run() {
      const dir = path.join(repoRoot, 'packages/ui/src/__lint_verify_tmp__')
      const cleanupRoot = firstMissingAncestor(dir)
      const file = path.join(dir, 'rule2-subpath.ts')
      writeFile(
        file,
        "import Dimensions from 'react-native/Libraries/Utilities/Dimensions'\nconsole.log(Dimensions)\n",
      )
      const messages = await lint(path.join(repoRoot, 'packages/ui'), [file])
      return { cleanupRoot, ok: hasRuleId(messages, 'no-restricted-imports'), messages }
    },
  },
  {
    name: 'Rule 3 (import/no-restricted-paths): cross-tool import (capture -> survey) is rejected',
    async run() {
      const toolsDir = path.join(repoRoot, 'apps/fieldkit/src/tools')
      const cleanupRoot = firstMissingAncestor(toolsDir)
      writeFile(
        path.join(toolsDir, 'survey/helper.ts'),
        "export const helper = 'survey helper'\n",
      )
      const file = path.join(toolsDir, 'capture/index.ts')
      writeFile(
        file,
        "import { helper } from '../survey/helper'\nconsole.log(helper)\n",
      )
      // cwd = the fieldkit app directory, matching its real `lint` script
      // ("eslint app"), which is invoked with the app as cwd, never the
      // repo root. This is the exact case Finding 1 fixes.
      const messages = await lint(path.join(repoRoot, 'apps/fieldkit'), [file])
      return { cleanupRoot, ok: hasRuleId(messages, 'import/no-restricted-paths'), messages }
    },
  },
  {
    name: 'Rule 3 (import/no-restricted-paths): same-tool import (capture -> capture) is still ALLOWED',
    async run() {
      const toolsDir = path.join(repoRoot, 'apps/fieldkit/src/tools')
      const cleanupRoot = firstMissingAncestor(toolsDir)
      writeFile(
        path.join(toolsDir, 'capture/sibling.ts'),
        "export const helper = 'capture sibling'\n",
      )
      const file = path.join(toolsDir, 'capture/self.ts')
      writeFile(file, "import { helper } from './sibling'\nconsole.log(helper)\n")
      const messages = await lint(path.join(repoRoot, 'apps/fieldkit'), [file])
      // Inverted assertion: a rule that rejects every import would pass the
      // case above for the wrong reason. This case is what rules that out.
      return { cleanupRoot, ok: !hasRuleId(messages, 'import/no-restricted-paths'), messages }
    },
  },
]

let allOk = true
const cleanupRoots = new Set()

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
  cleanupRoots.add(result.cleanupRoot)
  if (result.ok) {
    console.log('  PASS')
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

// Cleanup: each cleanupRoot is the shallowest directory this run created,
// so removing it recursively cannot touch anything that pre-existed.
for (const root of cleanupRoots) {
  fs.rmSync(root, { recursive: true, force: true })
}

console.log(`\n${allOk ? 'All rules verified.' : 'One or more rules FAILED to fire as expected.'}`)
process.exit(allOk ? 0 : 1)
