/// <reference types="node" />
import fs from 'node:fs'
import path from 'node:path'
import { builtinModules } from 'node:module'
import ts from 'typescript'

/**
 * Walks the static import graph reachable from this package's public entry
 * point and fails if any Node built-in is in it, or if `@corymbia/media` is
 * reached as a *value* import.
 *
 * This is the same walker as `@corymbia/data`'s and `@corymbia/geo`'s (see
 * `packages/data/src/__tests__/import-graph.test.ts`), duplicated rather than
 * shared for the same reason those two are — so that neither package depends
 * on another for something this narrow — plus one addition neither sibling
 * needs: `@corymbia/ui`'s dependency on `@corymbia/media` (task 7, finding 1).
 *
 * `media/MediaStrip.tsx` imports `MediaKind` from `@corymbia/media` with
 * `import type`, specifically so nothing at runtime crosses that package
 * boundary — a type-only import is erased before Metro ever sees it. But
 * `@corymbia/media`'s barrel also re-exports `createExpoMediaStore`, built on
 * `expo-file-system` (`src/store/expo.ts`), and nothing in the language stops
 * a future contributor dropping the `type` keyword, or value-importing
 * something else from that package. If that ever happens, `@corymbia/ui`
 * would pull a native module into its own bundle — and from there into every
 * screen that imports anything from `@corymbia/ui`, which today is nearly the
 * whole app. That blast radius is larger than the Node-built-in case this
 * walker was modelled on, which is why the walk below adds a dedicated
 * assertion for it rather than leaving it to be caught, if at all, by the
 * generic external-specifier checks (`@corymbia/media` is a workspace
 * package, resolved by `resolveWorkspace`, not an external one — the
 * `NODE_BUILTINS`/`NODE_ONLY_PACKAGES` checks below never see it).
 *
 * Scope, deliberately: only files reachable from `src/index.ts` by an import
 * that SURVIVES COMPILATION. `import type` is erased before Metro ever sees
 * it, so a type-only import is harmless and is not followed. Test files are
 * unreachable from the barrel by construction — this file's own `node:fs`
 * above is proof the walker is not simply scanning the directory.
 *
 * What it does not catch: a Node built-in reached through a third-party
 * package's own code (not walked), a runtime `require()` built from a
 * computed string, and anything not reachable from the barrel. Every
 * syntactic form of a static import specifier IS followed, including
 * TypeScript's legacy `import x = require('specifier')` form — only a
 * specifier assembled at runtime from a non-literal expression can still hide
 * from this walker. The barrel is the boundary that matters, because the
 * barrel is what the app imports.
 *
 * The walker also flags Node-only *globals* reached with no import at all:
 * `Buffer`, `__dirname`, `__filename`, and a bare `require(...)` call. See
 * `nodeGlobalReferences`'s doc comment for the detail on scope and `process`.
 */

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..')
const ENTRY_POINT = path.join(PACKAGE_ROOT, 'src', 'index.ts')
const WORKSPACE_SCOPE = '@corymbia/'

/**
 * A module that is everything the walker is supposed to catch, walked
 * directly rather than through the barrel — including a value import of
 * `@corymbia/media`, which the sibling `@corymbia/data`/`@corymbia/geo`
 * fixtures don't need. See the canary describe block at the bottom.
 */
const CANARY_FIXTURE = path.join(__dirname, 'fixtures', 'node-shaped.ts.fixture')
const CANARY_IMPORTER = path.relative(PACKAGE_ROOT, CANARY_FIXTURE)

/** Every Node built-in, in both spellings Metro would have to fail on. */
const NODE_BUILTINS = new Set<string>([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
])

/**
 * Native modules that are legal in Node and fatal in a React Native bundle
 * for the same reason a built-in is. Carried over from the sibling walkers
 * for consistency even though nothing in `@corymbia/ui` reaches for
 * `better-sqlite3` today — the dedicated `@corymbia/media` check below is
 * this package's actual native-module risk (task 7, finding 1).
 */
const NODE_ONLY_PACKAGES = new Set<string>(['better-sqlite3'])

/** Where a specifier was found, so a failure names the file to open. */
interface Reference {
  readonly importer: string
  readonly specifier: string
}

/** A Node-only global `importer` reaches with no import needed to see it. */
interface GlobalHit {
  readonly importer: string
  readonly description: string
}

/**
 * The module specifiers in `file` whose imports survive compilation: value
 * imports and re-exports, `import()`, `require()`, and the legacy
 * `import x = require('specifier')` form. Type-only forms are excluded
 * because Metro never sees them. Works for `.ts` and `.tsx` alike —
 * `ts.createSourceFile` infers script kind from `file`'s own extension.
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
    } else if (ts.isImportEqualsDeclaration(node)) {
      // `import x = require('specifier')` parses as an ImportEqualsDeclaration
      // wrapping an ExternalModuleReference, not an ImportDeclaration or a
      // CallExpression — invisible to the branches above unless handled here.
      if (!node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) {
        record(node.moduleReference.expression)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return specifiers
}

/** Node-only globals that resolve to a bare identifier, with no import needed to reach them. */
const NODE_ONLY_GLOBALS = new Set<string>(['Buffer', '__dirname', '__filename'])

/**
 * Recursively collects every name a file declares as a local binding —
 * `const`/`let`/`var` (including destructured), function/class declarations
 * and expressions, parameters, and import bindings — anywhere in the file.
 *
 * Used only to decide whether a bare identifier spelled the same as a
 * Node-only global might actually be a local binding rather than the global
 * itself. This check is file-wide, not scope-aware — it has no binder or
 * type checker to consult, only the syntax tree — so a name declared
 * anywhere in the file suppresses every bare reference to that name in the
 * file, even outside where the declaration is actually in scope. That trades
 * a rare false negative for never crying wolf at a shadowed local.
 */
function collectDeclaredNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>()

  const addBindingName = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) {
      names.add(name.text)
      return
    }
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) addBindingName(element.name)
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
      addBindingName(node.name)
    } else if (
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isClassExpression(node)) &&
      node.name !== undefined
    ) {
      names.add(node.name.text)
    } else if (ts.isImportClause(node) && node.name !== undefined) {
      names.add(node.name.text)
    } else if (ts.isNamespaceImport(node) || ts.isImportSpecifier(node)) {
      names.add(node.name.text)
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return names
}

/**
 * True when `node` is an identifier position that cannot be a reference to
 * an outer binding at all — the name a declaration is introducing, a
 * property key, a statement label, or a type position (erased before Metro
 * ever sees it) — so it cannot be a Node global reference no matter what it
 * is spelled.
 */
function isNonValueIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent
  if (ts.isVariableDeclaration(parent) && parent.name === node) return true
  if (ts.isParameter(parent) && parent.name === node) return true
  if (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) {
    return true
  }
  if (
    (ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassExpression(parent)) &&
    parent.name === node
  ) {
    return true
  }
  if (ts.isImportClause(parent) && parent.name === node) return true
  if (ts.isNamespaceImport(parent) && parent.name === node) return true
  if (ts.isImportSpecifier(parent) && (parent.name === node || parent.propertyName === node)) {
    return true
  }
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true
  if (
    (ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent)) &&
    parent.name === node
  ) {
    return true
  }
  if (ts.isEnumMember(parent) && parent.name === node) return true
  if (ts.isLabeledStatement(parent) && parent.label === node) return true
  if ((ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === node) {
    return true
  }
  if (ts.isTypeReferenceNode(parent) && parent.typeName === node) return true
  if (ts.isQualifiedName(parent) && parent.right === node) return true
  if (ts.isTypeQueryNode(parent) && parent.exprName === node) return true
  return false
}

/**
 * The Node-only globals `file` reaches with no import statement at all: a
 * bare `Buffer`, `__dirname` or `__filename`; a bare `require(...)` call; and
 * any `process.<member>` access other than `process.env.<member>` (React
 * Native supplies a real `process` shim, and `process.env.NODE_ENV`
 * specifically is substituted by the bundler at build time).
 */
function nodeGlobalReferences(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  const declared = collectDeclaredNames(source)
  const hits: string[] = []

  const visit = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) &&
      NODE_ONLY_GLOBALS.has(node.text) &&
      !isNonValueIdentifier(node) &&
      !declared.has(node.text)
    ) {
      hits.push(node.text)
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isIdentifier(callee) && callee.text === 'require' && !declared.has('require')) {
        hits.push('require(...)')
      }
    } else if (ts.isPropertyAccessExpression(node)) {
      const target = node.expression
      if (ts.isIdentifier(target) && target.text === 'process' && !declared.has('process')) {
        if (node.name.text !== 'env') hits.push(`process.${node.name.text}`)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return hits
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
  /** Node-only globals reached with no import at all — see `nodeGlobalReferences`. */
  readonly globals: GlobalHit[]
}

function walkFrom(entry: string): Walk {
  const visited = new Set<string>()
  const external: Reference[] = []
  const unresolved: Reference[] = []
  const globals: GlobalHit[] = []
  const pending = [entry]

  while (pending.length > 0) {
    const file = pending.pop()
    if (file === undefined || visited.has(file)) continue
    visited.add(file)

    const importer = path.relative(PACKAGE_ROOT, file)

    for (const specifier of emittedSpecifiers(file)) {
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

    for (const description of nodeGlobalReferences(file)) {
      globals.push({ importer, description })
    }
  }

  return {
    files: [...visited].map((file) => path.relative(PACKAGE_ROOT, file)).sort(),
    external,
    unresolved,
    globals,
  }
}

const describeReference = ({ importer, specifier }: Reference): string =>
  `${importer} imports '${specifier}'`

const describeGlobalHit = ({ importer, description }: GlobalHit): string =>
  `${importer} references ${description}`

describe("the public entry point's import graph", () => {
  const walk = walkFrom(ENTRY_POINT)

  it('reaches the modules it is supposed to reach', () => {
    // A walker that resolved nothing would pass every assertion below while
    // proving nothing at all.
    expect(walk.files).toEqual(
      expect.arrayContaining([
        'src/index.ts',
        'src/media/MediaStrip.tsx',
        'src/media/index.ts',
        'src/layout/useLayout.ts',
        'src/theme/ThemeProvider.tsx',
        'src/capture/CaptureDial.tsx',
      ]),
    )
    expect(walk.unresolved).toEqual([])
  })

  it('does not reach this test file, so its own node: imports are not what it is measuring', () => {
    expect(walk.files).not.toContain(path.join('src', '__tests__', 'import-graph.test.ts'))
  })

  it('contains no Node built-in, because Metro cannot resolve one on device', () => {
    const offenders = walk.external.filter(({ specifier }) => NODE_BUILTINS.has(specifier))
    expect(offenders.map(describeReference)).toEqual([])
  })

  it('contains no Node-only native package, for the same reason', () => {
    const offenders = walk.external.filter(({ specifier }) => NODE_ONLY_PACKAGES.has(specifier))
    expect(offenders.map(describeReference)).toEqual([])
  })

  it('contains no reachable Node-only global — Buffer, __dirname, __filename, require(), or any process.<member> other than process.env', () => {
    expect(walk.globals.map(describeGlobalHit)).toEqual([])
  })

  it('does not reach @corymbia/media as a value import (task 7, finding 1)', () => {
    // `MediaStrip.tsx` imports `MediaKind` from `@corymbia/media` with
    // `import type`, specifically so nothing at runtime crosses that package
    // boundary. Neither `consistent-type-imports` nor `verbatimModuleSyntax`
    // is enabled repo-wide, so nothing stops that import losing its `type`
    // keyword, or a future caller value-importing something else from that
    // package's barrel — and `NODE_ONLY_PACKAGES` above doesn't cover it
    // either, because `@corymbia/media` is a workspace package resolved by
    // `resolveWorkspace`, not an external one. This asserts the one thing
    // none of the checks above do: that `@corymbia/media`'s own entry point
    // is never among the files this package's barrel reaches.
    const mediaEntry = path.relative(
      PACKAGE_ROOT,
      path.resolve(PACKAGE_ROOT, '..', 'media', 'src', 'index.ts'),
    )
    expect(walk.files).not.toContain(mediaEntry)
  })
})

/**
 * The positive canary.
 *
 * Every assertion above is of the form "this list is empty", and a list is
 * empty for two reasons: nothing offended, or the detector never produces a
 * hit at all. Break `emittedSpecifiers` so it returns `[]`, and the entire
 * guard above stays green while catching nothing — which is exactly the
 * failure the guard exists to prevent in the code it watches.
 *
 * So the walker is pointed at a fixture that genuinely contains every banned
 * thing — including a value import of `@corymbia/media` — and each detector
 * is required to report it. The fixture is a real file
 * (`fixtures/node-shaped.ts.fixture`) rather than a mutation of real source,
 * so nothing shipped has to be broken to prove the detector works, and the
 * fixture's extension keeps it out of `tsc`, ESLint and `testMatch`.
 */
describe('the walker itself, against a module that is everything it forbids', () => {
  const canary = walkFrom(CANARY_FIXTURE)

  it('reports the Node built-ins the fixture imports, in both syntactic forms', () => {
    const offenders = canary.external.filter(({ specifier }) => NODE_BUILTINS.has(specifier))
    expect(offenders.map(describeReference).sort()).toEqual([
      `${CANARY_IMPORTER} imports 'node:fs'`,
      `${CANARY_IMPORTER} imports 'node:path'`,
    ])
  })

  it('reports the Node-only native package the fixture imports', () => {
    const offenders = canary.external.filter(({ specifier }) => NODE_ONLY_PACKAGES.has(specifier))
    expect(offenders.map(describeReference)).toEqual([
      `${CANARY_IMPORTER} imports 'better-sqlite3'`,
    ])
  })

  it('reports every Node-only global the fixture reaches with no import at all', () => {
    expect(canary.globals.map(describeGlobalHit).sort()).toEqual(
      [
        `${CANARY_IMPORTER} references Buffer`,
        `${CANARY_IMPORTER} references __dirname`,
        `${CANARY_IMPORTER} references __filename`,
        `${CANARY_IMPORTER} references process.cwd`,
        `${CANARY_IMPORTER} references require(...)`,
      ].sort(),
    )
  })

  it('reaches @corymbia/media, proving the "not reached" assertion above is not vacuous', () => {
    const mediaEntry = path.relative(
      PACKAGE_ROOT,
      path.resolve(PACKAGE_ROOT, '..', 'media', 'src', 'index.ts'),
    )
    expect(canary.files).toContain(mediaEntry)
    expect(canary.unresolved).toEqual([])
  })

  it('reaches the fixture itself, so the assertions above are about a file it actually read', () => {
    expect(canary.files).toContain(CANARY_IMPORTER)
  })
})
