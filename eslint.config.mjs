import { fileURLToPath } from 'node:url'
import path from 'node:path'
import js from '@eslint/js'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'
import importPlugin from 'eslint-plugin-import'
import reactHooksPlugin from 'eslint-plugin-react-hooks'

// typescript-eslint's own flat/recommended config ships as three config
// objects (base languageOptions, a step that disables core ESLint rules TS
// already covers better, and the actual @typescript-eslint/* rules) rather
// than one flat rules object. Pulled out by `name` (not array index) so this
// keeps working if a future version reorders them.
const tsFlatRecommended = tseslint.configs['flat/recommended']
const tsEslintRecommendedOverrides = tsFlatRecommended.find(
  (c) => c.name === 'typescript-eslint/eslint-recommended',
).rules
const tsRecommendedRules = tsFlatRecommended.find((c) => c.name === 'typescript-eslint/recommended').rules

// Repo root, derived from this file's own location rather than process.cwd().
// See the comment on RULE 3's `basePath` below for why that distinction matters.
const repoRoot = path.dirname(fileURLToPath(import.meta.url))

// The 147 CSS extended colour keywords (from the `color-name` npm package,
// which encodes the CSS Color spec's keyword table) plus `transparent`,
// which is a valid colour value but not itself a "named colour" in that
// table. These are matched ONLY as the value of a colour-bearing style
// property (see COLOR_PROPERTY_KEYS below) — NOT as a blanket string-literal
// ban the way the hex selectors are. Unlike a hex string, a word like
// `orange`, `olive`, `coral`, `indigo` or `salmon` is entirely plausible as
// ordinary text in an eDNA/biodiversity app (species and site names:
// "orange-bellied parrot", "olive python", "coral reef", "indigo bunting").
// Banning those words everywhere would produce constant false positives on
// domain content; scoping to known style-colour keys keeps the rule aimed at
// the thing it exists to catch.
const NAMED_COLOR_KEYWORDS = [
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque', 'black',
  'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue', 'chartreuse',
  'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'cyan', 'darkblue', 'darkcyan',
  'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki', 'darkmagenta',
  'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon', 'darkseagreen',
  'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise', 'darkviolet', 'deeppink',
  'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen',
  'fuchsia', 'gainsboro', 'ghostwhite', 'gold', 'goldenrod', 'gray', 'green', 'greenyellow',
  'grey', 'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory', 'khaki', 'lavender',
  'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral', 'lightcyan',
  'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey', 'lightpink', 'lightsalmon',
  'lightseagreen', 'lightskyblue', 'lightslategray', 'lightslategrey', 'lightsteelblue',
  'lightyellow', 'lime', 'limegreen', 'linen', 'magenta', 'maroon', 'mediumaquamarine',
  'mediumblue', 'mediumorchid', 'mediumpurple', 'mediumseagreen', 'mediumslateblue',
  'mediumspringgreen', 'mediumturquoise', 'mediumvioletred', 'midnightblue', 'mintcream',
  'mistyrose', 'moccasin', 'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab', 'orange',
  'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise', 'palevioletred',
  'papayawhip', 'peachpuff', 'peru', 'pink', 'plum', 'powderblue', 'purple', 'rebeccapurple',
  'red', 'rosybrown', 'royalblue', 'saddlebrown', 'salmon', 'sandybrown', 'seagreen', 'seashell',
  'sienna', 'silver', 'skyblue', 'slateblue', 'slategray', 'slategrey', 'snow', 'springgreen',
  'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'turquoise', 'violet', 'wheat', 'white',
  'whitesmoke', 'yellow', 'yellowgreen', 'transparent',
]

// Functional colour notations. `.*` inside the parens is deliberately loose
// (not parsing arguments) — the point is to catch the construct at all, not
// to validate it; a malformed rgba() would fail at runtime anyway.
const FUNCTIONAL_COLOR_PATTERN = '(?:rgba?|hsla?|hwb|lab|lch|color)\\(.*\\)'

const NAMED_OR_FUNCTIONAL_COLOR_REGEX = `/^(?:${NAMED_COLOR_KEYWORDS.join('|')}|${FUNCTIONAL_COLOR_PATTERN})$/i`

// React Native style properties whose value is a colour. Deliberately an
// explicit list rather than a `/color/i` substring match on the key name, so
// the rule's reach is exactly the properties known to carry colours, not
// anything that happens to contain the letters "color".
const COLOR_PROPERTY_KEYS = [
  'color', 'backgroundColor', 'borderColor', 'borderTopColor', 'borderBottomColor',
  'borderLeftColor', 'borderRightColor', 'borderStartColor', 'borderEndColor',
  'shadowColor', 'tintColor', 'overlayColor', 'textShadowColor', 'textDecorationColor',
  'selectionColor', 'underlineColorAndroid', 'placeholderTextColor', 'statusBarColor',
  'navigationBarColor', 'outlineColor', 'rippleColor',
]
const COLOR_PROPERTY_KEY_PATTERN = `/^(?:${COLOR_PROPERTY_KEYS.join('|')})$/`

// The four "consume the semantic layer, never a raw colour" selectors,
// shared between RULE 1's main block and its packages/brand exemption below.
// Pulled into one constant so the two blocks cannot drift apart — see the
// long comment on the exemption block for why there have to be two blocks
// at all (a single flat-config `rules` key is fully replaced, not merged,
// by the last matching block, so a selector that needs a DIFFERENT ignore
// scope than its neighbours cannot simply live in the same array with a
// shared `ignores`).
const SEMANTIC_TOKEN_SYNTAX_SELECTORS = [
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
  {
    // Named ('white', 'transparent', ...) and functional ('rgba(...)',
    // 'hsl(...)', ...) colours, as a plain string literal, assigned
    // directly to a colour-bearing style property. Scoped to
    // COLOR_PROPERTY_KEYS (see the constant above) rather than every
    // string literal in the codebase — see that constant's comment for
    // why a blanket ban would misfire on ordinary domain text.
    selector: `Property[key.name=${COLOR_PROPERTY_KEY_PATTERN}] > Literal[value=${NAMED_OR_FUNCTIONAL_COLOR_REGEX}]`,
    message:
      "Named ('white') and functional ('rgba(...)') colours are not allowed on a colour " +
      'style property. Use a semantic token from @corymbia/tokens (theme.colors.*). Add ' +
      'new colours to packages/tokens/src/ramp.ts and expose them through the semantic layer.',
  },
  {
    // Same as above, template-literal form (`` `white` ``), same
    // reasoning as the hex TemplateLiteral selector for why this is a
    // distinct ESTree node from the plain-string case.
    selector: `Property[key.name=${COLOR_PROPERTY_KEY_PATTERN}] > TemplateLiteral[expressions.length=0][quasis.length=1][quasis.0.value.raw=${NAMED_OR_FUNCTIONAL_COLOR_REGEX}]`,
    message:
      "Named ('white') and functional ('rgba(...)') colours are not allowed on a colour " +
      'style property, including as template literals. Use a semantic token from ' +
      '@corymbia/tokens (theme.colors.*). Add new colours to packages/tokens/src/ramp.ts ' +
      'and expose them through the semantic layer.',
  },
]

// Bans importing the raw `ramp` export from `@corymbia/tokens` — see the
// long comment on RULE 1's block below for why this exists and why
// packages/brand is exempt. Matches `import { ramp } from '@corymbia/tokens'`
// (aliased or not — `imported.name` is the name on the far side of `as`,
// not the local binding). Note this cannot fire inside packages/tokens
// itself: its own files reach `ramp` via a RELATIVE import (`from './ramp'`),
// never via the package specifier `'@corymbia/tokens'`, so no exemption for
// packages/tokens is needed here — the selector structurally cannot match
// there.
const RAMP_IMPORT_SELECTOR = {
  selector: "ImportDeclaration[source.value='@corymbia/tokens'] > ImportSpecifier[imported.name='ramp']",
  message:
    'Do not import the raw colour ramp. Consume the semantic layer (theme.colors.*) instead. ' +
    '`ramp` is exposed only for packages/tokens itself and packages/brand, whose artwork is ' +
    'deliberately theme-invariant.',
}

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
      // No `globals` block here on purpose. One used to declare
      // console/process/__DEV__, but `no-undef` — the only rule that reads
      // `globals` — was never enabled, so it was dead configuration that
      // looked like coverage it didn't provide. `no-undef` stays off
      // deliberately now that a real recommended baseline is enabled below:
      // typescript-eslint's own `flat/recommended` config turns it off too
      // (see `tsEslintRecommendedOverrides`), because TypeScript's compiler
      // (`tsc --noEmit`, run by every workspace's `typecheck` script)
      // already catches undefined identifiers, more accurately than
      // `no-undef` can — `no-undef` doesn't understand TS-only constructs
      // (ambient globals like `__DEV__` from react-native's types, global
      // augmentation, etc.) and would misfire on them.
    },
    plugins: {
      '@typescript-eslint': tseslint,
      import: importPlugin,
      'react-hooks': reactHooksPlugin,
    },
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
      // Recommended baseline: core ESLint recommended rules, then
      // typescript-eslint's own step that turns off the subset TypeScript
      // supersedes (see the `no-undef` comment above), then the actual
      // @typescript-eslint/* recommended rules. Spread in that order so
      // later spreads (and the project-specific overrides below) win.
      ...js.configs.recommended.rules,
      ...tsEslintRecommendedOverrides,
      ...tsRecommendedRules,

      // React hooks: rules-of-hooks catches conditional/looped hook calls
      // (breaks hook call order between renders); exhaustive-deps catches
      // stale closures from an incomplete effect dependency array. Both are
      // 'warn' in the plugin's own recommended config — bumped to 'error'
      // here because a warning does not fail `eslint <dir>` (no
      // `--max-warnings`), so a 'warn' in this repo is enforcement in name
      // only, the exact failure mode this finding exists to close. This is
      // precisely the bug class GPS subscriptions and fix-averaging (the
      // next plan) will generate if left unchecked.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',

      // Project-specific overrides/re-assertions, listed last so they are
      // never shadowed by a spread above.
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
      // `RAMP_IMPORT_SELECTOR` closes a gap the four literal-matching
      // selectors above it cannot: a component that imports `ramp` and
      // reads a raw value off it (`ramp.brand.teal`) is not a `Literal`
      // node at all. packages/brand needs an exemption from JUST this one
      // selector (its artwork colours are deliberately theme-invariant, see
      // the "RULE 1 exemption" block right below) while still being subject
      // to the other four — which is exactly why that exemption has to be
      // its own block rather than an entry in this one's `ignores`: a flat
      // config `ignores` applies to the WHOLE block, every selector in it,
      // not to one selector within it.
      'no-restricted-syntax': ['error', ...SEMANTIC_TOKEN_SYNTAX_SELECTORS, RAMP_IMPORT_SELECTOR],
    },
  },

  // RULE 1 exemption — packages/brand may import `ramp`, but is still bound
  // by every other semantic-token selector.
  //
  // packages/brand (`CorymbiaMark.tsx`) is the one legitimate consumer of
  // `ramp` outside packages/tokens itself: the logo's gradient and spore
  // colours are the brand mark's fixed artwork, identical in light and dark
  // mode by design, so they are not supposed to re-theme — reading them
  // from the semantic layer (which DOES re-theme) would be wrong. Everyone
  // else must go through `theme.colors`, or light mode silently rots the
  // day someone reaches for `ramp` instead.
  //
  // This has to be a separate block, positioned AFTER "RULE 1" above, and it
  // has to re-list the other four selectors rather than just the omission:
  // in ESLint flat config, when two config objects both match a file and
  // both set the same rule key, the LAST one wins *completely* — the two
  // do not merge their selector arrays. Configuring `no-restricted-syntax`
  // here with only "the four, minus the ramp one" is what makes brand files
  // end up with exactly that array instead of losing colour-literal checking
  // entirely (which is what happened, silently, the first time this was
  // written as a same-shaped block using `no-restricted-imports` for a
  // *different* rule — see RULE 2 immediately below, which shares that rule
  // ID: that version was overwritten wholesale by RULE 2's own
  // `no-restricted-imports` config for every file both blocks matched,
  // because they collided on the same key. Proven with a fixture as part of
  // this change; `SEMANTIC_TOKEN_SYNTAX_SELECTORS` is shared with RULE 1
  // above specifically so these two arrays cannot drift apart.
  {
    files: ['packages/brand/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...SEMANTIC_TOKEN_SYNTAX_SELECTORS],
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
