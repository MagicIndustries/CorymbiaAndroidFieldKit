import { fileURLToPath } from 'node:url'
import path from 'node:path'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'
import importPlugin from 'eslint-plugin-import'

// Repo root, derived from this file's own location rather than process.cwd().
// See the comment on RULE 3's `basePath` below for why that distinction matters.
const repoRoot = path.dirname(fileURLToPath(import.meta.url))

// Baseline configuration. Task 5 of the foundation plan adds the three
// architectural rules on top of this: semantic tokens only, size classes only,
// and no cross-tool imports.
//
// There must only ever be ONE ESLint config at the repo root. ESLint 9 resolves
// eslint.config.js ahead of eslint.config.mjs, so a stray .js file here would
// silently shadow this one and disable every rule below without an error.

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.expo/**',
      '**/android/**',
      '**/ios/**',
      '**/babel.config.js',
      '**/jest.config.js',
      '**/jest.setup.js',
    ],
  },

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        __DEV__: 'readonly',
      },
    },
    plugins: { '@typescript-eslint': tseslint, import: importPlugin },
    // eslint-plugin-import's default (node) resolver only looks for
    // .mjs/.js/.json/.node — with no `import/resolver` extensions it silently
    // fails to resolve any relative .ts/.tsx import, which makes import/*
    // rules (rule 3 below) never fire without ever reporting an error. Adding
    // .ts/.tsx here is what makes rule 3 able to see TypeScript imports at
    // all; verified as part of Task 5's rule-3 proof.
    settings: {
      'import/resolver': {
        node: { extensions: ['.js', '.jsx', '.ts', '.tsx'] },
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // RULE 1 — semantic tokens only.
  // Raw hex is permitted ONLY in the ramp. Everything else reads the semantic layer.
  {
    files: ['packages/**/*.{ts,tsx}', 'apps/**/*.{ts,tsx}'],
    // Two exemptions, both deliberate and both narrow:
    //  - ramp.ts is the raw material layer; the colours have to live somewhere.
    //  - the tokens package's own tests pin those values exactly. Asserting
    //    ramp against ramp would prove nothing, so this is the one place a
    //    literal is the point. Tests ANYWHERE ELSE assert against tokens.
    ignores: ['packages/tokens/src/ramp.ts', 'packages/tokens/src/__tests__/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/^#[0-9a-fA-F]{3,8}$/]',
          message:
            'Raw hex colours are not allowed. Use a semantic token from @corymbia/tokens ' +
            '(theme.colors.*). Add new colours to packages/tokens/src/ramp.ts and expose ' +
            'them through the semantic layer.',
        },
        {
          // A plain string literal (`Literal` above) is a different ESTree
          // node than a backtick string with no interpolation — that's a
          // `TemplateLiteral` with a single quasi and zero expressions.
          // `` `#FF0000` `` is functionally identical to `'#FF0000'` but was
          // slipping past the selector above untouched. This selector
          // matches only non-interpolated template literals (no
          // `${...}` parts) whose single quasi is a bare hex colour, so it
          // does not reach into legitimate interpolations such as
          // `` `${theme.colors.overlay}CC` `` (an appended alpha suffix on a
          // semantic token, which the design spec explicitly permits).
          selector:
            'TemplateLiteral[expressions.length=0][quasis.length=1][quasis.0.value.raw=/^#[0-9a-fA-F]{3,8}$/]',
          message:
            'Raw hex colours are not allowed, including as template literals. Use a semantic ' +
            'token from @corymbia/tokens (theme.colors.*). Add new colours to ' +
            'packages/tokens/src/ramp.ts and expose them through the semantic layer.',
        },
      ],
    },
  },

  // RULE 2 — size classes only.
  // Only useLayout.ts may read the window; everyone else branches on sizeClass.
  {
    files: ['packages/**/*.{ts,tsx}', 'apps/**/*.{ts,tsx}'],
    ignores: [
      'packages/ui/src/layout/useLayout.ts',
      // Test infrastructure that mocks the react-native hook itself (via
      // jest.mocked(useWindowDimensions)) so useLayout() can be tested at
      // specific sizes without a real window. It imports the hook to control
      // it, not to read a real window, so it is not the violation rule 2
      // exists to catch.
      'packages/ui/src/test-utils/mockWindowDimensions.ts',
      // TEMPORARY, and narrow to this one file: apps/fieldkit/app/index.tsx is
      // the Task 6 smoke screen proving the app boots and tokens resolve on
      // device. It reads useWindowDimensions directly to print a raw dp
      // readout. Task 12 replaces this file with the real gallery screen
      // (which does not read the window), at which point this exemption
      // should be deleted along with it — do not let it outlive that file.
      'apps/fieldkit/app/index.tsx',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native',
              importNames: ['useWindowDimensions', 'Dimensions'],
              message:
                'Do not read window dimensions directly. Use useLayout() from @corymbia/ui ' +
                'and branch on sizeClass (compact | medium | expanded).',
            },
          ],
          // `paths` above only keys on the exact specifier 'react-native', so
          // reaching the same APIs through a subpath import — e.g.
          // `import Dimensions from 'react-native/Libraries/Utilities/Dimensions'`
          // — bypassed it entirely. `patterns` closes that: both globs are
          // needed because a plain `*` does not cross a `/` segment boundary
          // (matches 'react-native/Libraries') while `**` is needed for the
          // deeper, real path (`react-native/Libraries/Utilities/Dimensions`).
          //
          // Limitation, not chased further: `require('react-native').Dimensions`
          // (CommonJS) cannot be caught by `no-restricted-imports` at all — the
          // rule only inspects ES `import` declarations, not arbitrary call
          // expressions. Catching that would need a separate `no-restricted-syntax`
          // selector on `CallExpression[callee.name='require']`, which isn't
          // worth the complexity/false-positive risk for a codebase that is
          // otherwise all ES modules; flagged here rather than silently gapped.
          patterns: [
            {
              group: ['react-native/*', 'react-native/**'],
              message:
                'Do not import react-native internals via a subpath (e.g. ' +
                'react-native/Libraries/Utilities/Dimensions) to read window dimensions. Use ' +
                'useLayout() from @corymbia/ui and branch on sizeClass (compact | medium | expanded).',
            },
          ],
        },
      ],
    },
  },

  // RULE 3 — no cross-tool imports.
  // A tool may import from packages and from itself, never from a sibling tool.
  //
  // apps/fieldkit/src/tools/ does not exist yet — tools arrive in a later plan.
  // This block's `files` glob therefore matches nothing today, so it is inert
  // until the first tool lands; it does not affect the current lint run.
  //
  // `import/no-restricted-paths` has no way to express "any sibling other than
  // my own directory" in one generic rule — `except` is a static path, not a
  // back-reference to `target` — so this needs one zone per tool, not one
  // rule that covers all of them. The zone below is for `capture`, the first
  // tool named in the product spec (docs/superpowers/specs — GPS pin capture
  // with title, description, photos and voice notes). When a second tool
  // (e.g. `survey`) is added under apps/fieldkit/src/tools/, add a mirrored
  // zone for it:
  //   {
  //     target: './apps/fieldkit/src/tools/survey',
  //     from: './apps/fieldkit/src/tools',
  //     except: ['./survey'],
  //     message: '...same message...',
  //   }
  // and so on for every tool after that.
  {
    files: ['apps/fieldkit/src/tools/**/*.{ts,tsx}'],
    rules: {
      'import/no-restricted-paths': [
        'error',
        {
          // `basePath` is mandatory here, not redundant defensive coding. The
          // plugin resolves `target`/`from` as `path.resolve(basePath, ...)`,
          // and its own default is `options.basePath || process.cwd()` — a
          // DIFFERENT anchor than the one ESLint uses to match this block's
          // `files` glob (always relative to this config file's directory,
          // i.e. the repo root, regardless of cwd).
          //
          // Every real lint invocation in this repo runs per-workspace: the
          // root `lint` script is `turbo run lint`, which fans out to each
          // workspace's own `lint` script (`eslint src`, `eslint app`, ...)
          // with THAT WORKSPACE as the process cwd. There is no invocation
          // path where lint runs with cwd = repo root. Without an explicit
          // `basePath`, the zone below would resolve against
          // `apps/fieldkit` (cwd during `fieldkit`'s lint script), doubling
          // the prefix into `apps/fieldkit/apps/fieldkit/src/tools/capture`
          // — a path nothing can ever match — silently disabling this rule
          // for every file, with no error to reveal it. Anchoring to
          // `repoRoot` (derived from this file's own location via
          // `import.meta.url`, not `process.cwd()`) makes the zone correct
          // no matter which workspace's script invoked ESLint. Do not
          // remove this thinking it's a no-op default.
          basePath: repoRoot,
          zones: [
            {
              target: './apps/fieldkit/src/tools/capture',
              from: './apps/fieldkit/src/tools',
              except: ['./capture'],
              message:
                'Tools must not import from sibling tools. Move shared code into a package ' +
                'under packages/ so the tool stays independently extractable (spec §3).',
            },
          ],
        },
      ],
    },
  },
]
