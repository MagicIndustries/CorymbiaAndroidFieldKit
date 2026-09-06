import fs from 'node:fs'
import path from 'node:path'
import { builtinModules } from 'node:module'
import ts from 'typescript'

/**
 * Walks the static import graph reachable from this package's public entry
 * point and fails if any Node built-in is in it.
 *
 * This guard exists because of a defect in the sibling `@corymbia/data`
 * package: `import { AsyncLocalStorage } from 'node:async_hooks'` sat in its
 * ON-DEVICE adapter through 252 passing tests and a review, uncaught, because
 * Jest runs on Node and every test there resolved `node:async_hooks` happily.
 * Metro does not. That adapter was a static export of the package's barrel,
 * so Metro would have had to resolve it the instant anything imported the
 * package — a hard bundle failure on device.
 *
 * `@corymbia/geo` now carries the same shape of risk: `src/index.ts`
 * statically exports `createExpoLocationSource` from `src/location/expo.ts`,
 * which is this package's first platform-dependent file. The same class of
 * defect — a tempting Node-shaped import (`node:crypto`, `node:buffer`,
 * `node:path`) landing in a file the barrel re-exports — would pass every
 * test here for the identical reason. This walker is deliberately the same
 * approach as `@corymbia/data`'s (see
 * `packages/data/src/__tests__/import-graph.test.ts`), duplicated rather than
 * shared, so that neither package depends on the other for something this
 * narrow.
 *
 * Scope, deliberately: only files reachable from `src/index.ts` by an import
 * that SURVIVES COMPILATION. `import type` is erased before Metro ever sees
 * it, so a type-only import of a Node module is harmless and is not followed.
 * Test files are unreachable from the barrel by construction — this file's
 * own `node:fs` above is proof the walker is not simply scanning the
 * directory.
 *
 * What it does not catch: a Node built-in reached through a third-party
 * package's own code (not walked — `expo-location` is React Native's problem,
 * not ours), a runtime `require()` built from a computed string, and anything
 * not reachable from the barrel. The barrel is the boundary that matters,
 * because the barrel is what the app imports.
 */

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..')
const ENTRY_POINT = path.join(PACKAGE_ROOT, 'src', 'index.ts')
const WORKSPACE_SCOPE = '@corymbia/'

/** Every Node built-in, in both spellings Metro would have to fail on. */
const NODE_BUILTINS = new Set<string>([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
])

/** Where a specifier was found, so a failure names the file to open. */
interface Reference {
  readonly importer: string
  readonly specifier: string
}

/**
 * The module specifiers in `file` whose imports survive compilation: value
 * imports and re-exports, `import()`, and `require()`. Type-only forms are
 * excluded because Metro never sees them.
 */
function emittedSpecifiers(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  const specifiers: string[] = []

  const record = (node: ts.Expression | undefined): void => {
    if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text)
  }

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      // `import type X from` / `import type { X } from` are erased; a clause of
      // `{ type A, b }` is not, and neither is a bare `import 'side-effect'`.
      if (node.importClause?.isTypeOnly !== true) record(node.moduleSpecifier)
    } else if (ts.isExportDeclaration(node)) {
      if (!node.isTypeOnly) record(node.moduleSpecifier)
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require'
      if (isDynamicImport || isRequire) record(node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return specifiers
}

/** Resolves a relative specifier the way a bundler would, or null if it is not a file. */
function resolveRelative(importer: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(importer), specifier)
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}

/** Resolves `@corymbia/<pkg>` to that workspace's entry file, so the walk crosses packages. */
function resolveWorkspace(specifier: string): string | null {
  const packageDir = path.resolve(PACKAGE_ROOT, '..', specifier.slice(WORKSPACE_SCOPE.length))
  const manifest = path.join(packageDir, 'package.json')
  if (!fs.existsSync(manifest)) return null
  const parsed: unknown = JSON.parse(fs.readFileSync(manifest, 'utf8'))
  const main =
    typeof parsed === 'object' && parsed !== null && 'main' in parsed
      ? (parsed as { main?: unknown }).main
      : undefined
  const entry = path.join(packageDir, typeof main === 'string' ? main : 'src/index.ts')
  return fs.existsSync(entry) ? entry : null
}

interface Walk {
  /** Every first-party file the entry point can reach, as repo-relative paths. */
  readonly files: string[]
  /** Every non-relative specifier those files import, with the file that imports it. */
  readonly external: Reference[]
  /** Specifiers that looked first-party but could not be resolved to a file. */
  readonly unresolved: Reference[]
}

function walkFrom(entry: string): Walk {
  const visited = new Set<string>()
  const external: Reference[] = []
  const unresolved: Reference[] = []
  const pending = [entry]

  while (pending.length > 0) {
    const file = pending.pop()
    if (file === undefined || visited.has(file)) continue
    visited.add(file)

    for (const specifier of emittedSpecifiers(file)) {
      const importer = path.relative(PACKAGE_ROOT, file)
      if (specifier.startsWith('.')) {
        const resolved = resolveRelative(file, specifier)
        if (resolved === null) unresolved.push({ importer, specifier })
        else pending.push(resolved)
      } else if (specifier.startsWith(WORKSPACE_SCOPE)) {
        const resolved = resolveWorkspace(specifier)
        if (resolved === null) unresolved.push({ importer, specifier })
        else pending.push(resolved)
      } else {
        external.push({ importer, specifier })
      }
    }
  }

  return {
    files: [...visited].map((file) => path.relative(PACKAGE_ROOT, file)).sort(),
    external,
    unresolved,
  }
}

const describeReference = ({ importer, specifier }: Reference): string =>
  `${importer} imports '${specifier}'`

describe("the public entry point's import graph", () => {
  const walk = walkFrom(ENTRY_POINT)

  it('reaches the modules it is supposed to reach', () => {
    // A walker that resolved nothing would pass every assertion below while
    // proving nothing at all. `src/location/expo.ts` is the file that carries
    // this package's first platform dependency, and the one this guard exists
    // to watch.
    expect(walk.files).toEqual(
      expect.arrayContaining([
        'src/index.ts',
        'src/location/expo.ts',
        'src/location/fake.ts',
        'src/classify.ts',
        'src/average.ts',
        'src/distance.ts',
      ]),
    )
    expect(walk.unresolved).toEqual([])
    // `src/location/port.ts` exports only types, so every import of it
    // (including the barrel's own `export type { ... } from './location/port'`)
    // is type-only and erased before Metro would ever see it. It is correctly
    // NOT in walk.files — that is the walker proving it tells value imports
    // apart from type-only ones, not a gap in what it reaches.
    expect(walk.files).not.toContain('src/location/port.ts')
  })

  it('does not reach this test file, so its own node: imports are not what it is measuring', () => {
    expect(walk.files).not.toContain(path.join('src', '__tests__', 'import-graph.test.ts'))
  })

  it('contains no Node built-in, because Metro cannot resolve one on device', () => {
    const offenders = walk.external.filter(({ specifier }) => NODE_BUILTINS.has(specifier))
    expect(offenders.map(describeReference)).toEqual([])
  })
})
