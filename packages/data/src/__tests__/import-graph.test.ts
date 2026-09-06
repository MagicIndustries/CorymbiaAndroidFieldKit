/// <reference types="node" />
import fs from 'node:fs'
import path from 'node:path'
import { builtinModules } from 'node:module'
import ts from 'typescript'

/**
 * Walks the static import graph reachable from this package's public entry
 * point and fails if any Node built-in is in it.
 *
 * This exists because a `import { AsyncLocalStorage } from 'node:async_hooks'`
 * sat in `src/db/expo.ts` — the ON-DEVICE adapter — through 252 passing tests
 * and a review. Nothing could have caught it: Jest runs on Node, so every test
 * in this package resolves `node:async_hooks` happily. Metro does not.
 * `openDatabase` is a static export of `src/index.ts`, so Metro must resolve
 * that module's imports the instant anything imports `@corymbia/data`, and the
 * outcome is a hard bundle failure — or worse, a lenient shim that leaves the
 * code running with a silently inert guard.
 *
 * That is a class of defect, not one bug. This package's barrel is scheduled to
 * grow media, export and camera code, all of which have tempting Node-shaped
 * equivalents (`node:fs`, `node:crypto`, `node:buffer`, `node:path`), and all
 * of which will pass Jest for exactly the same reason.
 *
 * Scope, deliberately: only files reachable from `src/index.ts` by an import
 * that SURVIVES COMPILATION. `import type` is erased before Metro ever sees it,
 * so a type-only import of a Node module is harmless and is not followed. Test
 * files are unreachable from the barrel by construction — this file's own
 * `node:fs` above is proof the walker is not simply scanning the directory.
 *
 * What it does not catch: a Node built-in reached through a third-party
 * package's own code (not walked — `expo-sqlite` is React Native's problem, not
 * ours), a runtime `require()` built from a computed string, and anything not
 * reachable from the barrel. Every syntactic form of a static import
 * specifier IS followed, including TypeScript's legacy `import x =
 * require('specifier')` (an `ImportEqualsDeclaration` wrapping an
 * `ExternalModuleReference`) — only a specifier assembled at runtime from a
 * non-literal expression can still hide from this walker. The barrel is the
 * boundary that matters, because the barrel is what the app imports.
 *
 * The walker also flags Node-only *globals* reached with no import at all:
 * `Buffer`, `__dirname`, `__filename`, and a bare `require(...)` call. This
 * closes a gap the specifier-only check above cannot: none of those need an
 * import statement to be reachable, so a specifier walk alone is blind to
 * them. `process` is treated differently from the other three rather than
 * banned outright — see `nodeGlobalReferences`'s doc comment for why. What
 * the global check does not catch: it does no real scope analysis, so a
 * local declaration (variable, parameter, destructured binding, or import)
 * spelled the same as a flagged global suppresses that name for the *whole
 * file*, not just the scope the declaration is actually in — see
 * `collectDeclaredNames`. It also does not follow destructuring
 * (`const { exit } = process` is invisible to it, unlike `process.exit`), and
 * a bare reference to `require` that is never called (passed around as a
 * value, say) is not flagged — only an actual `require(...)` call is.
 */

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..')
const ENTRY_POINT = path.join(PACKAGE_ROOT, 'src', 'index.ts')
const WORKSPACE_SCOPE = '@corymbia/'

/** Every Node built-in, in both spellings Metro would have to fail on. */
const NODE_BUILTINS = new Set<string>([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
])

/**
 * Native modules that are legal in Node and fatal in a React Native bundle for
 * the same reason a built-in is: Metro cannot resolve them on device. The
 * barrel deliberately does not re-export `openTestDatabase` for this reason,
 * and that omission is a comment today — this makes it a checked invariant.
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
 * because Metro never sees them.
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
 * itself: a local variable, parameter, destructured binding, or imported
 * name spelled `Buffer` is not a Node global, and flagging it would make the
 * guard cry wolf. This check is file-wide, not scope-aware — it has no
 * binder or type checker to consult, only the syntax tree — so a name
 * declared anywhere in the file suppresses every bare reference to that name
 * in the file, even outside where the declaration is actually in scope. That
 * trades a rare false negative (a real global access elsewhere in the same
 * file, coincidentally sharing a name with an unrelated local declared in a
 * different scope) for never crying wolf at a shadowed local. A guard that is
 * simple and honest about that limit was chosen over one that attempts real
 * scope resolution and gets it wrong.
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
 * ever sees it, same reasoning as the `import type` handling above) — so it
 * cannot be a Node global reference no matter what it is spelled.
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
 * bare `Buffer`, `__dirname` or `__filename`; a bare `require(...)` call
 * (any call to an identifier named `require`); and any `process.<member>`
 * access other than `process.env.<member>`.
 *
 * `process` is deliberately not just added to `NODE_ONLY_GLOBALS` and banned
 * outright: React Native supplies a real `process` shim, so the bare
 * identifier is not Node-only, and `process.env.NODE_ENV` specifically is
 * substituted by the bundler at build time, so it — and the rest of
 * `process.env` — is legitimate on device too. Everything else hanging off
 * `process` — `.cwd()`, `.exit()`, `.argv`, and so on — is not part of that
 * shim and is `undefined` at runtime, so it is flagged like any other
 * Node-only global.
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
    // proving nothing at all. These are the files the barrel demonstrably pulls
    // in, including the on-device adapter that carried the original defect.
    expect(walk.files).toEqual(expect.arrayContaining(['src/index.ts', 'src/db/expo.ts']))
    expect(walk.files).toEqual(
      expect.arrayContaining([
        'src/db/transactions.ts',
        'src/db/migrate.ts',
        'src/migrations/index.ts',
        'src/migrations/003-records.ts',
        'src/repositories/records.ts',
        'src/repositories/events.ts',
        'src/ids.ts',
        'src/time.ts',
        'src/kinds.ts',
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
})
