# Corymbia Field Kit — Foundation and Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the monorepo, the design token and theme system, the responsive layout system, the lint guardrails that keep them honest, and the shared component library — delivered as an Expo application that boots on a Samsung S25 and renders a component gallery in both dark and light mode.

**Architecture:** A pnpm workspace orchestrated by Turborepo. Design decisions live in data (`packages/tokens`) rather than in components; components consume only a semantic layer over that data, and only branch on named size classes. Three ESLint rules enforce those constraints mechanically so they cannot erode. The Expo application in `apps/fieldkit` is a thin shell that, in this plan, renders only a gallery screen used to review the library on real hardware.

**Tech Stack:** pnpm workspaces, Turborepo, Expo (development builds, EAS), React Native, TypeScript (strict), Jest with the `jest-expo` preset, React Native Testing Library, ESLint flat config, Prettier.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-09-05-corymbia-field-kit-design.md`. Every requirement below traces to it.
- **Expo SDK version:** use whatever `create-expo-app@latest` resolves to at implementation time, and record the resolved version in `README.md`. **Do not hand-pick an SDK version from memory** — pinning an unverified version is worse than recording the real one.
- **TypeScript strict mode on** in every package. No `any` in committed code.
- **Package namespace:** `@corymbia/<name>`. All packages are `"private": true`.
- **Dark mode is the default theme.** Light mode ships in this plan, not later.
- **Brand gradient (five stops, exact):** `#ABD246`, `#99D252`, `#6BD371`, `#22D5A3`, `#1CD5A7`.
- **Brand greens (discrete):** lime `#98D455`, grass `#84CF69`, mint `#55D28C`, teal `#30CF9F`.
- **Status colours:** amber `#E8B33D`, rust `#E86A4D`.
- **Minimum touch target 48dp**; field controls 72dp.
- **Colour never carries meaning alone** — every status colour is paired with text or a border style (doctrine rule 9).
- **Target devices:** Samsung S25 (development), Samsung S24 and a 10-inch tablet (user). Tablet layouts are Plan 6; this plan must not regress on `compact`.
- **Commit after every task.** Conventional commit prefixes (`feat:`, `test:`, `chore:`).

## Execution Order

Tasks are **not** executed in numeric order. Task 6 scaffolds the Expo application, and that
is what pins the React and React Native versions every other package must match. Building
`packages/ui` first would resolve those to arbitrary latest versions and then collide with
Expo's pins.

**Run in this order: 1, 2, 6, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13.**

Task 6 is therefore written to depend only on `@corymbia/tokens`, with a plain smoke screen;
Task 12 adds the `@corymbia/ui` and `@corymbia/brand` dependencies and wires the
`ThemeProvider` into the app shell.

---

## File Structure

```
pnpm-workspace.yaml
turbo.json
tsconfig.base.json
eslint.config.mjs
.prettierrc
package.json

packages/tokens/
  src/ramp.ts              raw colour ramps — the only file containing hex
  src/scales.ts            spacing, radii, type, touch, field sizing
  src/semantic.ts          SemanticColors type + dark and light theme objects
  src/index.ts             public surface
  src/__tests__/semantic.test.ts

packages/brand/
  src/CorymbiaMark.tsx     the logo as a React Native SVG component
  src/index.ts
  src/__tests__/CorymbiaMark.test.tsx

packages/ui/
  src/theme/ThemeProvider.tsx
  src/theme/useTheme.ts
  src/theme/index.ts
  src/layout/sizeClass.ts        pure: dp -> SizeClass
  src/layout/reach.ts            pure: reach zone resolution
  src/layout/useLayout.ts        the ONLY file allowed to read window dimensions
  src/layout/index.ts
  src/primitives/Screen.tsx
  src/primitives/Type.tsx
  src/primitives/Button.tsx
  src/primitives/Card.tsx
  src/names/shortLabel.ts        pure: short-label resolution
  src/names/ProjectName.tsx
  src/names/NameChip.tsx
  src/context-stamp/ContextStamp.tsx
  src/help/HelpAffordance.tsx
  src/inputs/InputAffordanceRow.tsx
  src/index.ts
  src/**/__tests__/*.test.tsx

apps/fieldkit/
  app/_layout.tsx
  app/index.tsx            gallery screen (development review surface)
  src/gallery/sections.tsx

docs/ui-doctrine.md
```

---

### Task 1: Monorepo skeleton

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.prettierrc`, `.npmrc`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: a workspace where `pnpm turbo run test lint typecheck` executes across all packages. Package namespace `@corymbia/*`. Base tsconfig at `tsconfig.base.json` for packages to extend.

- [ ] **Step 1: Initialise the workspace root**

```bash
cd /Users/tobytremayne/work/CorymbiaAndroidFieldKit
corepack enable
pnpm init
```

- [ ] **Step 2: Write the root `package.json`**

Replace the generated file entirely:

```json
{
  "name": "corymbia-field-kit",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "format": "prettier --write ."
  },
  "devDependencies": {
    "@types/jest": "^29.5.14",
    "@typescript-eslint/eslint-plugin": "^8.18.0",
    "@typescript-eslint/parser": "^8.18.0",
    "eslint": "^9.17.0",
    "eslint-plugin-import": "^2.31.0",
    "jest": "^29.7.0",
    "prettier": "^3.4.2",
    "turbo": "^2.3.3",
    "typescript": "^5.7.2"
  }
}
```

- [ ] **Step 3: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

- [ ] **Step 4: Write `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "test": { "dependsOn": ["^build"] },
    "lint": {},
    "typecheck": { "dependsOn": ["^build"] }
  }
}
```

- [ ] **Step 5: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  }
}
```

- [ ] **Step 6: Write `.prettierrc`**

```json
{
  "semi": false,
  "singleQuote": true,
  "printWidth": 100,
  "trailingComma": "all"
}
```

- [ ] **Step 7: Write `.npmrc`**

React Native requires a flat-ish layout for native module resolution:

```
node-linker=hoisted
```

- [ ] **Step 8: Extend `.gitignore`**

Append:

```
node_modules/
dist/
.turbo/
.expo/
*.tsbuildinfo
```

- [ ] **Step 9: Install and verify the workspace resolves**

Run: `pnpm install`
Expected: completes without error, creates `pnpm-lock.yaml`.

Run: `pnpm turbo run lint`
Expected: `No tasks were executed as part of this run.` — correct, there are no packages yet.

- [ ] **Step 10: Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json tsconfig.base.json .prettierrc .npmrc .gitignore pnpm-lock.yaml
git commit -m "chore: initialise pnpm workspace with turborepo"
```

---

### Task 2: The `tokens` package

**Files:**
- Create: `packages/tokens/package.json`, `packages/tokens/tsconfig.json`, `packages/tokens/jest.config.js`, `packages/tokens/src/ramp.ts`, `packages/tokens/src/scales.ts`, `packages/tokens/src/semantic.ts`, `packages/tokens/src/index.ts`
- Test: `packages/tokens/src/__tests__/semantic.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ramp` — raw colour ramps.
  - `spacing`, `radii`, `type`, `touch`, `field` — scales.
  - `type SemanticColors` — the 21 semantic colour keys.
  - `type Theme = { name: 'dark' | 'light'; colors: SemanticColors }`
  - `darkTheme: Theme`, `lightTheme: Theme`
  - `type ThemeName = 'dark' | 'light'`

**Why this task exists:** this is the only package permitted to contain hex literals — and within it, only `ramp.ts`. Everything downstream reads the semantic layer. The test enforces that dark and light expose an identical key set, which is what actually prevents light mode from shipping ninety percent complete.

**Note:** an earlier draft of this task put a handful of literals directly in `semantic.ts`, which contradicted that invariant and would have failed the lint rule in Task 5. Every colour now lives in `ramp.ts`; `semantic.ts` contains no hex at all. The code blocks below are the shipped versions.

- [ ] **Step 1: Create the package manifest**

`packages/tokens/package.json`:

```json
{
  "name": "@corymbia/tokens",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "jest",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@babel/preset-env": "^7.26.0",
    "@babel/preset-typescript": "^7.26.0",
    "babel-jest": "^29.7.0"
  }
}
```

- [ ] **Step 2: Create `packages/tokens/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/tokens/jest.config.js` and `packages/tokens/babel.config.js`**

`jest.config.js`:

```js
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
}
```

`babel.config.js`:

```js
module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    '@babel/preset-typescript',
  ],
}
```

- [ ] **Step 4: Write the failing test**

`packages/tokens/src/__tests__/semantic.test.ts`:

```ts
import { darkTheme, lightTheme, ramp, touch, field } from '../index'

describe('themes', () => {
  it('dark and light expose an identical set of semantic colour keys', () => {
    const darkKeys = Object.keys(darkTheme.colors).sort()
    const lightKeys = Object.keys(lightTheme.colors).sort()
    expect(lightKeys).toEqual(darkKeys)
  })

  it('every semantic colour resolves to a hex string', () => {
    for (const theme of [darkTheme, lightTheme]) {
      for (const [key, value] of Object.entries(theme.colors)) {
        expect(`${key}=${value}`).toMatch(/=#[0-9A-Fa-f]{6}$/)
      }
    }
  })

  it('names the themes', () => {
    expect(darkTheme.name).toBe('dark')
    expect(lightTheme.name).toBe('light')
  })

  it('carries the exact brand gradient from the logo', () => {
    expect(ramp.brandGradient).toEqual([
      '#ABD246',
      '#99D252',
      '#6BD371',
      '#22D5A3',
      '#1CD5A7',
    ])
  })

  it('meets the minimum and field touch target sizes from the spec', () => {
    expect(touch.min).toBe(48)
    expect(field.control).toBe(72)
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @corymbia/tokens test`
Expected: FAIL — `Cannot find module '../index'`.

- [ ] **Step 6: Write `packages/tokens/src/ramp.ts`**

```ts
/**
 * Raw colour ramps. THIS IS THE ONLY FILE IN THE REPO PERMITTED TO CONTAIN HEX
 * LITERALS. Everything else consumes the semantic layer in `semantic.ts`.
 * Values are taken from design/logo/logo.svg and design/brochure/.
 *
 * Entries here are named for what the colour IS, never for where it is used
 * or which theme it serves — that assignment happens in `semantic.ts`.
 */
export const ramp = {
  /** Five-stop gradient from the logo mark, left to right. */
  brandGradient: ['#ABD246', '#99D252', '#6BD371', '#22D5A3', '#1CD5A7'] as const,

  /** Discrete brand greens, from the logo's spore dots. */
  brand: {
    lime: '#98D455',
    limeDeep: '#4E9B22',
    grass: '#84CF69',
    mint: '#55D28C',
    teal: '#30CF9F',
  },

  /** Dark ground, derived from the brochure's slate. */
  slate: {
    950: '#0E1519',
    900: '#16212A',
    800: '#1E2C36',
    700: '#2C3E4A',
    600: '#3B4A57',
    500: '#2E3B47',
  },

  /** Light ground. */
  paper: {
    0: '#FFFFFF',
    50: '#F2F5F4',
    100: '#E4EAE8',
    200: '#CBD6D2',
    600: '#5F7480',
    900: '#16212A',
  },

  /** A deep, muted green — distinct from the brand greens above. */
  deepGreen: '#12996F',

  /** Amber, as named in the spec. */
  amber: '#E8B33D',
  /** A darker ochre variant of amber, for use on light grounds. */
  amberDark: '#9A6B10',

  /** Rust, as named in the spec. */
  rust: '#E86A4D',
  /** A darker brick-red variant of rust, for use on light grounds. */
  rustDark: '#B23A21',

  /** Pale green-grey. */
  paleGreenGrey: '#E6EDEA',
  /** Blue-grey. */
  blueGrey: '#8FA3AD',

  /** Plain black, used as a scrim/overlay base. */
  black: '#000000',

  /** Four near-black tints, one per hue, for text/ink pairings on saturated fills. */
  nearBlack: {
    green: '#12290A',
    teal: '#04231A',
    brown: '#2B1C05',
    red: '#2B0C05',
  },
} as const
```

- [ ] **Step 7: Write `packages/tokens/src/scales.ts`**

```ts
/** Spacing scale in dp. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const

export const radii = {
  sm: 8,
  md: 11,
  lg: 14,
  xl: 16,
  pill: 999,
} as const

/**
 * Type scale. Sizes are constant physical size across form factors —
 * tablets get more content, never larger widgets (spec §5.3).
 */
export const type = {
  hero: { size: 62, weight: '800', letterSpacing: -1.8 },
  title: { size: 20, weight: '800', letterSpacing: 0 },
  heading: { size: 16, weight: '800', letterSpacing: 0 },
  body: { size: 14, weight: '500', letterSpacing: 0 },
  small: { size: 12, weight: '500', letterSpacing: 0 },
  label: { size: 10, weight: '700', letterSpacing: 1.8 },
  mono: { size: 12, weight: '500', letterSpacing: 0 },
} as const

/** Standard touch targets in dp. */
export const touch = {
  /** Absolute minimum for any interactive element. */
  min: 48,
  comfortable: 56,
} as const

/**
 * Field sizing scale — deliberately oversized for gloved, moving, one-handed
 * use. Distinct from `touch`, which governs settings and review screens.
 */
export const field = {
  /** Primary field controls, e.g. the capture boxes. */
  control: 72,
  /** The traffic-light frame thickness. */
  frame: 5,
} as const
```

- [ ] **Step 8: Write `packages/tokens/src/semantic.ts`**

```ts
import { ramp } from './ramp'

/**
 * The semantic layer. Components consume ONLY these keys — never `ramp`,
 * never a raw hex value. Enforced by the `no-restricted-syntax` lint rule
 * added in Task 5.
 */
export type SemanticColors = {
  surface: string
  surfaceRaised: string
  surfaceSunken: string

  border: string
  borderStrong: string

  textPrimary: string
  textDim: string
  textOnAccent: string

  accent: string
  accentMuted: string

  captureFast: string
  captureFastInk: string
  captureAccurate: string
  captureAccurateInk: string

  statusGood: string
  statusGoodInk: string
  statusFair: string
  statusFairInk: string
  statusPoor: string
  statusPoorInk: string

  overlay: string
}

export type ThemeName = 'dark' | 'light'

export type Theme = {
  name: ThemeName
  colors: SemanticColors
}

export const darkTheme: Theme = {
  name: 'dark',
  colors: {
    surface: ramp.slate[950],
    surfaceRaised: ramp.slate[900],
    surfaceSunken: ramp.slate[800],

    border: ramp.slate[700],
    borderStrong: ramp.slate[600],

    textPrimary: ramp.paleGreenGrey,
    textDim: ramp.blueGrey,
    textOnAccent: ramp.nearBlack.teal,

    accent: ramp.brand.teal,
    accentMuted: ramp.brand.mint,

    captureFast: ramp.brand.lime,
    captureFastInk: ramp.nearBlack.green,
    captureAccurate: ramp.slate[900],
    captureAccurateInk: ramp.paleGreenGrey,

    statusGood: ramp.brand.teal,
    statusGoodInk: ramp.nearBlack.teal,
    statusFair: ramp.amber,
    statusFairInk: ramp.nearBlack.brown,
    statusPoor: ramp.rust,
    statusPoorInk: ramp.nearBlack.red,

    overlay: ramp.black,
  },
}

export const lightTheme: Theme = {
  name: 'light',
  colors: {
    surface: ramp.paper[50],
    surfaceRaised: ramp.paper[0],
    surfaceSunken: ramp.paper[100],

    border: ramp.paper[200],
    borderStrong: ramp.paper[600],

    textPrimary: ramp.paper[900],
    textDim: ramp.paper[600],
    textOnAccent: ramp.paper[0],

    accent: ramp.deepGreen,
    accentMuted: ramp.brand.mint,

    captureFast: ramp.brand.limeDeep,
    captureFastInk: ramp.paper[0],
    captureAccurate: ramp.paper[0],
    captureAccurateInk: ramp.paper[900],

    statusGood: ramp.deepGreen,
    statusGoodInk: ramp.paper[0],
    statusFair: ramp.amberDark,
    statusFairInk: ramp.paper[0],
    statusPoor: ramp.rustDark,
    statusPoorInk: ramp.paper[0],

    overlay: ramp.black,
  },
}
```

- [ ] **Step 9: Write `packages/tokens/src/index.ts`**

```ts
export { ramp } from './ramp'
export { spacing, radii, type, touch, field } from './scales'
export { darkTheme, lightTheme } from './semantic'
export type { SemanticColors, Theme, ThemeName } from './semantic'
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `pnpm --filter @corymbia/tokens test`
Expected: PASS — 5 tests.

- [ ] **Step 11: Commit**

```bash
git add packages/tokens pnpm-lock.yaml
git commit -m "feat(tokens): add brand ramps, scales, and dark/light semantic themes"
```

---

### Task 3: Theme provider and `useTheme`

**Files:**
- Create: `packages/ui/package.json`, `packages/ui/tsconfig.json`, `packages/ui/jest.config.js`, `packages/ui/babel.config.js`, `packages/ui/jest.setup.js`, `packages/ui/src/theme/ThemeProvider.tsx`, `packages/ui/src/theme/useTheme.ts`, `packages/ui/src/theme/index.ts`, `packages/ui/src/index.ts`
- Test: `packages/ui/src/theme/__tests__/ThemeProvider.test.tsx`

**Interfaces:**
- Consumes: `@corymbia/tokens` — `darkTheme`, `lightTheme`, `Theme`, `ThemeName`.
- Produces:
  - `<ThemeProvider initial?: ThemeName | 'system'>` — wraps the tree.
  - `useTheme(): { theme: Theme; name: ThemeName; setTheme(next: ThemeName | 'system'): void; preference: ThemeName | 'system' }`

**Behaviour:** default preference is `'system'`. When the system reports no preference, resolve to **dark** (spec §5.2: dark is the default).

- [ ] **Step 1: Create the package manifest**

`packages/ui/package.json`:

```json
{
  "name": "@corymbia/ui",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "jest",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@corymbia/tokens": "workspace:*"
  },
  "peerDependencies": {
    "react": "*",
    "react-native": "*"
  },
  "devDependencies": {
    "@testing-library/react-native": "^14.0.1",
    "jest-expo": "~57.0.0",
    "react": "19.2.3",
    "react-native": "0.86.3",
    "test-renderer": "^1.2.0"
  }
}
```

> These versions are Expo SDK 57's pins, resolved during Task 6 and recorded in `README.md`
> under `## Toolchain`. They must match the app exactly — a React version differing from the
> app's pin causes a duplicate-React failure at runtime that is miserable to diagnose. The
> `peerDependencies` above stay permissive; that is what peer ranges are for. After creating
> the package, run `pnpm install` from the repo root and confirm no peer dependency warnings
> for `react` or `react-native`.

- [ ] **Step 2: Create `packages/ui/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2022", "DOM"] },
  "include": ["src"]
}
```

- [ ] **Step 3: Create the Jest configuration**

`packages/ui/jest.config.js`:

```js
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testMatch: ['**/__tests__/**/*.test.tsx', '**/__tests__/**/*.test.ts'],
}
```

`packages/ui/jest.setup.js`:

```js
require('@testing-library/react-native/extend-expect')
```

`packages/ui/babel.config.js`:

```js
module.exports = { presets: ['babel-preset-expo'] }
```

- [ ] **Step 4: Write the failing test**

`packages/ui/src/theme/__tests__/ThemeProvider.test.tsx`:

```tsx
import React from 'react'
import { Text, Pressable } from 'react-native'
import { render, screen, fireEvent } from '@testing-library/react-native'
import { ThemeProvider, useTheme } from '../index'

function Probe() {
  const { theme, name, setTheme } = useTheme()
  return (
    <>
      <Text testID="name">{name}</Text>
      <Text testID="surface">{theme.colors.surface}</Text>
      <Pressable testID="toLight" onPress={() => setTheme('light')}>
        <Text>light</Text>
      </Pressable>
    </>
  )
}

describe('ThemeProvider', () => {
  it('defaults to dark', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('name')).toHaveTextContent('dark')
  })

  it('honours an explicit initial theme', () => {
    render(
      <ThemeProvider initial="light">
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('name')).toHaveTextContent('light')
  })

  it('switches theme and changes the resolved surface colour', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    const darkSurface = screen.getByTestId('surface').props.children
    fireEvent.press(screen.getByTestId('toLight'))
    const lightSurface = screen.getByTestId('surface').props.children
    expect(lightSurface).not.toBe(darkSurface)
    expect(screen.getByTestId('name')).toHaveTextContent('light')
  })

  it('throws a useful error when used outside a provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/useTheme must be used within a ThemeProvider/)
    spy.mockRestore()
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @corymbia/ui test`
Expected: FAIL — `Cannot find module '../index'`.

- [ ] **Step 6: Write `packages/ui/src/theme/ThemeProvider.tsx`**

```tsx
import React, { createContext, useCallback, useMemo, useState } from 'react'
import { useColorScheme } from 'react-native'
import { darkTheme, lightTheme, type Theme, type ThemeName } from '@corymbia/tokens'

export type ThemePreference = ThemeName | 'system'

export type ThemeContextValue = {
  theme: Theme
  name: ThemeName
  preference: ThemePreference
  setTheme: (next: ThemePreference) => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

/** Dark is the product default; light exists for glare (spec §5.2). */
function resolve(preference: ThemePreference, system: 'light' | 'dark' | null): ThemeName {
  if (preference !== 'system') return preference
  return system === 'light' ? 'light' : 'dark'
}

export function ThemeProvider({
  children,
  initial = 'system',
}: {
  children: React.ReactNode
  initial?: ThemePreference
}) {
  const system = useColorScheme()
  const [preference, setPreference] = useState<ThemePreference>(initial)

  const setTheme = useCallback((next: ThemePreference) => setPreference(next), [])

  const value = useMemo<ThemeContextValue>(() => {
    const name = resolve(preference, system ?? null)
    return {
      name,
      preference,
      theme: name === 'light' ? lightTheme : darkTheme,
      setTheme,
    }
  }, [preference, system, setTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
```

- [ ] **Step 7: Write `packages/ui/src/theme/useTheme.ts`**

```ts
import { useContext } from 'react'
import { ThemeContext, type ThemeContextValue } from './ThemeProvider'

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used within a ThemeProvider')
  return value
}
```

- [ ] **Step 8: Write the barrels**

`packages/ui/src/theme/index.ts`:

```ts
export { ThemeProvider, ThemeContext } from './ThemeProvider'
export type { ThemePreference, ThemeContextValue } from './ThemeProvider'
export { useTheme } from './useTheme'
```

`packages/ui/src/index.ts`:

```ts
export * from './theme'
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm --filter @corymbia/ui test`
Expected: PASS — 4 tests.

- [ ] **Step 10: Commit**

```bash
git add packages/ui pnpm-lock.yaml
git commit -m "feat(ui): add ThemeProvider and useTheme with system-aware dark default"
```

---

### Task 4: Size classes and reach zones

**Files:**
- Create: `packages/ui/src/layout/sizeClass.ts`, `packages/ui/src/layout/reach.ts`, `packages/ui/src/layout/useLayout.ts`, `packages/ui/src/layout/index.ts`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/layout/__tests__/sizeClass.test.ts`, `packages/ui/src/layout/__tests__/reach.test.ts`

**Interfaces:**
- Consumes: `useTheme` is not needed here.
- Produces:
  - `type SizeClass = 'compact' | 'medium' | 'expanded'`
  - `sizeClassFor(shortestSideDp: number): SizeClass`
  - `type Handedness = 'left' | 'right'`
  - `type ReachAnchor = 'bottomBand' | 'bottomCorners'`
  - `type Reach = { anchor: ReachAnchor; primarySide: Handedness }`
  - `resolveReach(input: { sizeClass: SizeClass; handedness: Handedness }): Reach`
  - `useLayout(): { sizeClass: SizeClass; orientation: 'portrait' | 'landscape'; width: number; height: number }`

**Why the logic is split from the hook:** the pure functions are testable without mocking a
window. `useLayout.ts` is the **only** file permitted to read window dimensions — enforced by
lint in Task 5.

**As built, this task produced five files, not three.** An earlier draft derived the size
class from `Math.min(width, height)`, which made `expanded` unreachable on a rigid tablet and
would have turned every landscape layout into dead code. The corrected design separates two
questions: `sizeClass` from the **current width** (orientation-dependent, drives layout) and
`deviceClass` from the **shortest side** (orientation-invariant, drives ergonomics), with
`orientationFor` extracted so the square case is documented rather than accidental. Reach is
resolved from device class and orientation, never from size class. See `deviceClass.ts` and
`orientation.ts` alongside the files below, and spec §5.3.

- [ ] **Step 1: Write the failing tests**

`packages/ui/src/layout/__tests__/sizeClass.test.ts`:

```ts
import { sizeClassFor } from '../sizeClass'

describe('sizeClassFor', () => {
  it('treats phones in portrait as compact', () => {
    // Galaxy S25 and S24 portrait are ~412dp wide.
    expect(sizeClassFor(412)).toBe('compact')
    expect(sizeClassFor(360)).toBe('compact')
  })

  it('treats a 10-inch tablet in portrait as medium', () => {
    expect(sizeClassFor(800)).toBe('medium')
    expect(sizeClassFor(600)).toBe('medium')
  })

  it('treats a 10-inch tablet in landscape as expanded', () => {
    expect(sizeClassFor(840)).toBe('expanded')
    expect(sizeClassFor(1280)).toBe('expanded')
  })

  it('uses inclusive lower bounds at the documented breakpoints', () => {
    expect(sizeClassFor(599)).toBe('compact')
    expect(sizeClassFor(839)).toBe('medium')
  })
})
```

`packages/ui/src/layout/__tests__/reach.test.ts`:

```ts
import { resolveReach } from '../reach'

describe('resolveReach', () => {
  it('uses a bottom band on compact, regardless of handedness', () => {
    expect(resolveReach({ sizeClass: 'compact', handedness: 'right' })).toEqual({
      anchor: 'bottomBand',
      primarySide: 'right',
    })
    expect(resolveReach({ sizeClass: 'compact', handedness: 'left' })).toEqual({
      anchor: 'bottomBand',
      primarySide: 'left',
    })
  })

  it('hugs the bottom corners on expanded, because the centre of a tablet is unreachable', () => {
    expect(resolveReach({ sizeClass: 'expanded', handedness: 'right' })).toEqual({
      anchor: 'bottomCorners',
      primarySide: 'right',
    })
  })

  it('mirrors the primary side for a left-handed user', () => {
    expect(resolveReach({ sizeClass: 'expanded', handedness: 'left' }).primarySide).toBe('left')
  })

  it('treats tablet portrait as a bottom band, since corners are far apart', () => {
    expect(resolveReach({ sizeClass: 'medium', handedness: 'right' }).anchor).toBe('bottomBand')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @corymbia/ui test layout`
Expected: FAIL — `Cannot find module '../sizeClass'`.

- [ ] **Step 3: Write `packages/ui/src/layout/sizeClass.ts`**

```ts
/**
 * Window size classes, mirroring Android's own `WindowWidthSizeClass`
 * convention (spec §5.3): compact under 600dp, medium 600–839dp, expanded
 * 840dp and up. Takes the **current window width** — this answers "how much
 * horizontal room is there right now?", which drives layout decisions like
 * "two panes side by side, or one pane you navigate between".
 *
 * This is orientation-*dependent* by design: rotating a device changes its
 * window width, so it can (and should) change size class. Components branch
 * on these names only — never on raw dimensions.
 *
 * Size class is a layout question, not an ergonomic one. For the
 * orientation-*invariant* "what kind of device is this?" question that
 * drives reach zones, see `deviceClassFor`.
 */
export type SizeClass = 'compact' | 'medium' | 'expanded'

export const BREAKPOINTS = { medium: 600, expanded: 840 } as const

export function sizeClassFor(widthDp: number): SizeClass {
  if (widthDp >= BREAKPOINTS.expanded) return 'expanded'
  if (widthDp >= BREAKPOINTS.medium) return 'medium'
  return 'compact'
}
```

- [ ] **Step 4: Write `packages/ui/src/layout/reach.ts`**

```ts
import type { DeviceClass } from './deviceClass'
import type { Orientation } from './orientation'

export type Handedness = 'left' | 'right'
export type ReachAnchor = 'bottomBand' | 'bottomCorners'

export type Reach = {
  anchor: ReachAnchor
  primarySide: Handedness
}

/**
 * Reach is an ergonomic question, not a width question (spec §5.4), so it is
 * decided from `deviceClass` and `orientation` — never from `SizeClass`.
 *
 * On a 10-inch tablet held in two hands in landscape, the corners are
 * easiest to reach and the centre is hardest — the inverse of phone
 * thinking — so only `tablet` + `landscape` gets bottom corners. Tablet
 * portrait keeps a bottom band because the corners are too far apart to
 * pair. A phone in landscape can be `expanded` by width (it's roughly
 * 915dp wide), but its corners are still only a few centimetres apart, so
 * it keeps the phone ergonomic — a bottom band — regardless of size class.
 *
 * Handedness only mirrors which side is primary; it never changes the
 * anchor.
 */
export function resolveReach({
  deviceClass,
  orientation,
  handedness,
}: {
  deviceClass: DeviceClass
  orientation: Orientation
  handedness: Handedness
}): Reach {
  return {
    anchor: deviceClass === 'tablet' && orientation === 'landscape' ? 'bottomCorners' : 'bottomBand',
    primarySide: handedness,
  }
}
```

- [ ] **Step 5: Write `packages/ui/src/layout/useLayout.ts`**

```ts
import { useWindowDimensions } from 'react-native'
import { sizeClassFor, type SizeClass } from './sizeClass'
import { deviceClassFor, type DeviceClass } from './deviceClass'
import { orientationFor, type Orientation } from './orientation'

export type LayoutInfo = {
  sizeClass: SizeClass
  deviceClass: DeviceClass
  orientation: Orientation
  width: number
  height: number
}

/**
 * THE ONLY PLACE IN THE REPO THAT READS WINDOW DIMENSIONS. Every other
 * component branches on the composed values below. Enforced by lint (Task 5).
 *
 * Pure composition, no logic of its own: `sizeClass` from the current width
 * (orientation-dependent — rotating the device can change it), `deviceClass`
 * from the shortest side (orientation-invariant — rotating the device can't
 * change it), `orientation` from both. Do not collapse these back into
 * `sizeClassFor(Math.min(width, height))` — that conflation is the bug this
 * module exists to prevent (a rigid device's shortest side never changes on
 * rotation, so it can never reach `expanded`).
 */
export function useLayout(): LayoutInfo {
  const { width, height } = useWindowDimensions()
  return {
    width,
    height,
    sizeClass: sizeClassFor(width),
    deviceClass: deviceClassFor(Math.min(width, height)),
    orientation: orientationFor(width, height),
  }
}
```

- [ ] **Step 6: Write the barrel and re-export**

`packages/ui/src/layout/index.ts`:

```ts
export { sizeClassFor, BREAKPOINTS } from './sizeClass'
export type { SizeClass } from './sizeClass'
export { resolveReach } from './reach'
export type { Handedness, ReachAnchor, Reach } from './reach'
export { useLayout } from './useLayout'
export type { LayoutInfo } from './useLayout'
```

Update `packages/ui/src/index.ts`:

```ts
export * from './theme'
export * from './layout'
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @corymbia/ui test`
Expected: PASS — 12 tests.

- [ ] **Step 8: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): add size classes, reach zone resolution, and useLayout"
```

---

### Task 5: Lint guardrails

**Files:**
- Create: `eslint.config.mjs`
- Create: `packages/ui/src/__fixtures__/lint-violations.txt` (documentation of what each rule catches)

**Interfaces:**
- Consumes: the package layout established in Tasks 2–4.
- Produces: three enforced constraints. No new runtime exports.

**The three rules, and why each exists:**

1. **Semantic tokens only** — no hex literal outside `packages/tokens/src/ramp.ts`. Without this, light mode rots.
2. **Size classes only** — no `useWindowDimensions` or `Dimensions` outside `packages/ui/src/layout/useLayout.ts`. Without this, ad-hoc pixel checks appear and the responsive model becomes fiction.
3. **No cross-tool imports** — a tool may import from packages and itself, never a sibling tool. This is what keeps extracting a tool into its own APK mechanical (spec §3).

- [ ] **Step 1: Write `eslint.config.mjs`**

```js
import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'
import importPlugin from 'eslint-plugin-import'

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.expo/**', '**/babel.config.js'] },

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { '@typescript-eslint': tseslint, import: importPlugin },
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
      ],
    },
  },

  // RULE 2 — size classes only.
  // Only useLayout.ts may read the window; everyone else branches on sizeClass.
  {
    files: ['packages/**/*.{ts,tsx}', 'apps/**/*.{ts,tsx}'],
    ignores: ['packages/ui/src/layout/useLayout.ts'],
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
        },
      ],
    },
  },

  // RULE 3 — no cross-tool imports.
  // A tool may import from packages and from itself, never from a sibling tool.
  {
    files: ['apps/fieldkit/src/tools/**/*.{ts,tsx}'],
    rules: {
      'import/no-restricted-paths': [
        'error',
        {
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
```

> **Note for the implementer:** rule 3's `zones` array needs one entry per tool. There is only one tool directory in this plan's scope (`capture`, created in Plan 2). When a second tool is added, add a mirrored zone for it. A comment to that effect belongs above the rule.

- [ ] **Step 2: Add a lint script to the root and to `tokens`**

Both package manifests already declare `"lint": "eslint src"`. Verify with:

Run: `pnpm turbo run lint`
Expected: PASS — no errors across `@corymbia/tokens` and `@corymbia/ui`.

- [ ] **Step 3: Prove rule 1 fires**

Temporarily add to `packages/ui/src/theme/useTheme.ts`:

```ts
const scratch = '#FF0000'
```

Run: `pnpm --filter @corymbia/ui lint`
Expected: FAIL — `Raw hex colours are not allowed.`

Remove the line. Re-run and expect PASS.

- [ ] **Step 4: Prove rule 2 fires**

Temporarily add to `packages/ui/src/layout/reach.ts`:

```ts
import { Dimensions } from 'react-native'
```

Run: `pnpm --filter @corymbia/ui lint`
Expected: FAIL — `Do not read window dimensions directly.`

Remove the line. Re-run and expect PASS.

- [ ] **Step 5: Record what the rules protect**

Create `packages/ui/src/__fixtures__/lint-violations.txt`:

```
These three constructs are rejected by eslint.config.mjs. Each was verified to
fire during Task 5 of the foundation plan.

1. A raw hex literal anywhere except packages/tokens/src/ramp.ts and the
   tokens package's own __tests__ (which pin those values exactly)
     const c = '#FF0000'
   Why: components must consume the semantic layer, or light mode rots.
   Tests outside the tokens package assert against tokens, not literals, so
   they do not break every time a colour is tuned.

2. Importing Dimensions or useWindowDimensions outside
   packages/ui/src/layout/useLayout.ts
     import { Dimensions } from 'react-native'
   Why: ad-hoc pixel checks make the responsive model fiction.

3. A tool importing from a sibling tool
     import { x } from '../survey/thing'
   Why: keeps a tool independently extractable into its own package or APK.
```

- [ ] **Step 6: Commit**

```bash
git add eslint.config.mjs packages/ui/src/__fixtures__/lint-violations.txt
git commit -m "chore: enforce semantic tokens, size classes, and tool boundaries via lint"
```

---

### Task 6: The Expo application shell

**Files:**
- Create: `apps/fieldkit/` (via `create-expo-app`), then modify `apps/fieldkit/package.json`, `apps/fieldkit/app.json`, `apps/fieldkit/app/_layout.tsx`, `apps/fieldkit/app/index.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: `@corymbia/ui` — `ThemeProvider`, `useTheme`, `useLayout`.
- Produces: a running Android application. `apps/fieldkit/app/index.tsx` is the gallery screen that Tasks 7–11 extend.

- [ ] **Step 1: Scaffold the Expo application**

```bash
cd apps
pnpm create expo-app@latest fieldkit --template blank-typescript
cd ..
```

- [ ] **Step 2: Record the resolved Expo SDK version**

```bash
node -p "require('./apps/fieldkit/package.json').dependencies.expo"
```

Write the result into `README.md` under a `## Toolchain` heading, alongside the Node and pnpm versions. **Do not skip this** — the rest of the plan refers to "the resolved SDK version".

- [ ] **Step 3: Add workspace dependencies to `apps/fieldkit/package.json`**

Add `"@corymbia/tokens": "workspace:*"` to `dependencies`, then:

```bash
cd apps/fieldkit && npx expo install expo-router react-native-svg && cd ../..
pnpm install
```

The `@corymbia/ui` and `@corymbia/brand` dependencies are added in Task 12, once those
packages exist.

- [ ] **Step 4: Record the React versions Expo pinned**

Every package built after this one depends on these, and they must match Expo's pins exactly
or React Native fails at runtime with a duplicate-React error that is miserable to diagnose.

```bash
node -e "const p=require('./apps/fieldkit/package.json');console.log(JSON.stringify({react:p.dependencies.react,'react-native':p.dependencies['react-native'],'react-test-renderer':p.devDependencies&&p.devDependencies['react-test-renderer']},null,2))"
```

Write the output into `README.md` under `## Toolchain`, beneath the Expo SDK version.
Tasks 3, 7 and 12 use these values verbatim.

- [ ] **Step 5: Configure `apps/fieldkit/app.json`**

Set these keys:

```json
{
  "expo": {
    "name": "Corymbia Field Kit",
    "slug": "corymbia-field-kit",
    "scheme": "corymbiafieldkit",
    "userInterfaceStyle": "automatic",
    "android": {
      "package": "eco.corymbia.fieldkit",
      "adaptiveIcon": { "foregroundImage": "./assets/adaptive-icon.png" }
    },
    "plugins": ["expo-router"]
  }
}
```

`userInterfaceStyle: "automatic"` is required for `useColorScheme` to report the system setting.

- [ ] **Step 6: Write `apps/fieldkit/app/_layout.tsx`**

Deliberately plain — `@corymbia/ui` does not exist yet. Task 12 wraps this in `ThemeProvider`.

```tsx
import { Slot } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaView } from 'react-native'
import { darkTheme } from '@corymbia/tokens'

export default function RootLayout() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: darkTheme.colors.surface }}>
      <StatusBar style="light" />
      <Slot />
    </SafeAreaView>
  )
}
```

- [ ] **Step 7: Write a placeholder `apps/fieldkit/app/index.tsx`**

A smoke screen proving the app boots and the tokens resolve on device. Task 12 replaces it
with the real gallery.

```tsx
import { View, Text, useWindowDimensions } from 'react-native'
import { darkTheme, spacing } from '@corymbia/tokens'

export default function Home() {
  const { width, height } = useWindowDimensions()
  const c = darkTheme.colors
  return (
    <View style={{ flex: 1, padding: spacing.lg, backgroundColor: c.surface }}>
      <Text style={{ color: c.textPrimary, fontSize: 20, fontWeight: '800' }}>
        Corymbia Field Kit
      </Text>
      <Text style={{ color: c.textDim, marginTop: spacing.sm }}>
        {Math.round(width)}x{Math.round(height)}dp - shortest side{' '}
        {Math.round(Math.min(width, height))}dp
      </Text>
      <Text style={{ color: c.accent, marginTop: spacing.lg, fontWeight: '700' }}>
        Tokens resolved
      </Text>
    </View>
  )
}
```

This is the one place `useWindowDimensions` is used outside `useLayout`, and Task 12 replaces
it before the lint rule forbidding that could ever apply.

- [ ] **Step 8: Run it on the S25**

Connect the S25 with USB debugging enabled, then:

```bash
cd apps/fieldkit && npx expo run:android
```

Expected: the application launches on a near-black slate background, title in pale green-grey,
"Tokens resolved" in brand teal.

Note the reported shortest side. On both Samsungs in portrait it must be well under 600dp —
that is what Task 4's `compact` size class keys on. If it reports 600 or more, the dp
conversion is wrong, and Task 4 would silently build the wrong layout for the primary device.

- [ ] **Step 9: Commit**

```bash
git add apps/fieldkit README.md packages/ui/package.json pnpm-lock.yaml
git commit -m "feat(app): scaffold Expo shell with theme provider and layout readout"
```

---

### Task 7: The `brand` package — the logo as a component

**Files:**
- Create: `packages/brand/package.json`, `packages/brand/tsconfig.json`, `packages/brand/jest.config.js`, `packages/brand/babel.config.js`, `packages/brand/src/CorymbiaMark.tsx`, `packages/brand/src/index.ts`
- Generate: `packages/brand/src/markPath.ts` (from `design/logo/logo.svg`, see Step 1)
- Test: `packages/brand/src/__tests__/CorymbiaMark.test.tsx`

**Testing note (applies to every remaining UI task):** `@testing-library/react-native` is on
v14, where `render` and `fireEvent` are **async** — `await` them. Matchers auto-register on
import, so there is no `extend-expect` entry point. `test-renderer` replaces the deprecated
`react-test-renderer`. To simulate what the OS reports for dark/light, use
`mockSystemColorScheme` from `@corymbia/ui`'s `src/test-utils` — the React Native jest preset
hard-mocks `useColorScheme`, so a test cannot set it any other way.

**Interfaces:**
- Consumes: `react-native-svg`.
- Produces: `<CorymbiaMark size?: number crop?: 'tight' | 'square' />` — defaults `size = 26`, `crop = 'tight'`.

**Source of truth:** `design/logo/logo.svg`. The mark is a eucalypt-leaf double helix with base-pair rungs plus eight spore dots, filled with the five-stop gradient. Two viewBoxes: `405 165 660 1205` (tight, for the app bar) and `0 0 1500 1500` (square, for the launcher icon).

- [ ] **Step 1: Generate the path constant directly from the source SVG**

The mark's outline is a 1950-character path. It is generated, never transcribed — a
transcription error is invisible until it renders wrong. The generator is committed at
`scripts/generate-brand-mark-path.mjs`; run `pnpm run generate:brand-mark`.

**As built, the tight viewBox in this task's original text was wrong.** It was derived from
transform arithmetic rather than measured, and clipped the leaf tips and the tail of the
helix. Rasterising `design/logo/logo.svg` at 1500x1500 gives a true bounding box of
x 420-1080, y 2-1498, so the tight crop is `414 0 672 1500` and the real aspect is 0.448.
The component is sized by `height`, not width, because an app bar constrains height. A test
asserts the viewBox contains those measured bounds, so a clipping crop fails.

```bash
mkdir -p packages/brand/src
python3 - <<'PY'
import re
s = open('design/logo/logo.svg').read()
d = re.search(r'<path[^>]*class="st4"[^>]*?\sd="([^"]+)"', s, re.S).group(1)
out = (
    "/* GENERATED from design/logo/logo.svg — do not edit by hand.\n"
    " * Regenerate with the script in Task 7 of\n"
    " * docs/superpowers/plans/2026-09-05-foundation-and-design-system.md */\n"
    f"export const MARK_PATH =\n  '{d}'\n"
)
open('packages/brand/src/markPath.ts', 'w').write(out)
print('wrote packages/brand/src/markPath.ts —', len(d), 'chars of path data')
PY
```

Expected: `wrote packages/brand/src/markPath.ts — 1950 chars of path data`.

The eight spore-dot circles, verbatim from the source (`cx`, `cy`, `r`, fill):

```
378, 805.96002, 39.82,  #84CF69
293.82001, 744.15997, 26.129999, #98D455
309.51001, 663.41998, 19.940001, #98D455
745.02002, 759.98999, 25.91,  #30CF9F
688.40997, 814.45001, 19.57,  #30CF9F
537.57001, 284.92001, 37.560001, #55D28C
584.82001, 376.81, 30.68,  #55D28C
523.03003, 437.92999, 21.08,  #55D28C
```

Group transform, verbatim: `matrix(1.2165365,0,0,1.2165365,141.72777,-162.40239)`

- [ ] **Step 2: Create the package manifest**

`packages/brand/package.json`:

```json
{
  "name": "@corymbia/brand",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "jest",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@corymbia/tokens": "workspace:*"
  },
  "peerDependencies": {
    "react": "*",
    "react-native": "*",
    "react-native-svg": "*"
  },
  "devDependencies": {
    "@testing-library/react-native": "^14.0.1",
    "jest-expo": "~57.0.0",
    "react": "19.2.3",
    "react-native": "0.86.3",
    "react-native-svg": "15.15.4",
    "test-renderer": "^1.2.0"
  }
}
```

Copy `tsconfig.json`, `jest.config.js` and `babel.config.js` from `packages/ui` verbatim.

**The mark takes its colours from `@corymbia/tokens`, not from literals.** The five gradient
stops are `ramp.brandGradient`, and all eight spore dots are exactly the four `ramp.brand`
greens. So this package needs no exemption from the hex lint rule, and the artwork and the
tokens cannot drift apart.

- [ ] **Step 3: Write the failing test**

`packages/brand/src/__tests__/CorymbiaMark.test.tsx`:

```tsx
import React from 'react'
import { render } from '@testing-library/react-native'
import { ramp } from '@corymbia/tokens'
import { CorymbiaMark, BRAND_GRADIENT_STOPS } from '../index'

describe('CorymbiaMark', () => {
  it('renders at the requested size', () => {
    const { getByTestId } = render(<CorymbiaMark size={40} />)
    const svg = getByTestId('corymbia-mark')
    expect(svg.props.width).toBe(40)
  })

  it('uses the tight crop by default, for the app bar', () => {
    const { getByTestId } = render(<CorymbiaMark />)
    expect(getByTestId('corymbia-mark').props.viewBox).toBe('405 165 660 1205')
  })

  it('uses the square crop when asked, for the launcher icon', () => {
    const { getByTestId } = render(<CorymbiaMark crop="square" />)
    expect(getByTestId('corymbia-mark').props.viewBox).toBe('0 0 1500 1500')
  })

  it('takes its gradient colours from the tokens, so artwork and theme cannot drift', () => {
    expect(BRAND_GRADIENT_STOPS.map((s) => s.color)).toEqual([...ramp.brandGradient])
  })

  it('places the five stops at the offsets from the source artwork', () => {
    expect(BRAND_GRADIENT_STOPS.map((s) => s.offset)).toEqual([
      '0',
      '0.1666',
      '0.4994',
      '0.9638',
      '1',
    ])
  })

  it('is labelled for screen readers and for the voiced mode to come', () => {
    const { getByLabelText } = render(<CorymbiaMark />)
    expect(getByLabelText('Corymbia')).toBeTruthy()
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @corymbia/brand test`
Expected: FAIL — `Cannot find module '../index'`.

- [ ] **Step 5: Write `packages/brand/src/CorymbiaMark.tsx`**

`MARK_PATH` comes from the generated file — there is nothing to paste.

```tsx
import React from 'react'
import Svg, { Circle, Defs, G, LinearGradient, Path, Stop } from 'react-native-svg'
import { ramp } from '@corymbia/tokens'
import { MARK_PATH } from './markPath'

/** Offsets are artwork geometry; colours come from the tokens. */
const STOP_OFFSETS = ['0', '0.1666', '0.4994', '0.9638', '1'] as const

export const BRAND_GRADIENT_STOPS = STOP_OFFSETS.map((offset, i) => ({
  offset,
  color: ramp.brandGradient[i] as string,
}))

/** The eight spore dots. Every fill is one of the four brand greens. */
const SPORES = [
  { cx: 378, cy: 805.96002, r: 39.82, fill: ramp.brand.grass },
  { cx: 293.82001, cy: 744.15997, r: 26.129999, fill: ramp.brand.lime },
  { cx: 309.51001, cy: 663.41998, r: 19.940001, fill: ramp.brand.lime },
  { cx: 745.02002, cy: 759.98999, r: 25.91, fill: ramp.brand.teal },
  { cx: 688.40997, cy: 814.45001, r: 19.57, fill: ramp.brand.teal },
  { cx: 537.57001, cy: 284.92001, r: 37.560001, fill: ramp.brand.mint },
  { cx: 584.82001, cy: 376.81, r: 30.68, fill: ramp.brand.mint },
  { cx: 523.03003, cy: 437.92999, r: 21.08, fill: ramp.brand.mint },
] as const

const VIEW_BOX = {
  // Full artwork height, ~6 units of horizontal breathing room either side. Verified
  // (by rasterising design/logo/logo.svg at 1500x1500 and measuring the non-transparent
  // bounding box) to contain the whole mark — see MEASURED_ARTWORK_BOUNDS in the test file.
  tight: '414 0 672 1500',
  square: '0 0 1500 1500',
} as const

/** width/height of each crop's viewBox, i.e. its true aspect ratio. */
const ASPECT = { tight: 672 / 1500, square: 1 } as const

export function CorymbiaMark({
  height = 32,
  crop = 'tight',
}: {
  /** Rendered height in dp. Width is derived from the crop's aspect ratio. */
  height?: number
  crop?: 'tight' | 'square'
}) {
  return (
    <Svg
      testID="corymbia-mark"
      accessibilityRole="image"
      accessibilityLabel="Corymbia"
      width={height * ASPECT[crop]}
      height={height}
      viewBox={VIEW_BOX[crop]}
    >
      <Defs>
        <LinearGradient
          id="corymbiaMark"
          gradientUnits="userSpaceOnUse"
          x1="229.0778"
          y1="750"
          x2="748.66553"
          y2="750"
        >
          {BRAND_GRADIENT_STOPS.map((s) => (
            <Stop key={s.offset} offset={s.offset} stopColor={s.color} />
          ))}
        </LinearGradient>
      </Defs>
      <G transform="matrix(1.2165365,0,0,1.2165365,141.72777,-162.40239)">
        {SPORES.map((s, i) => (
          <Circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill={s.fill} />
        ))}
        <Path fill="url(#corymbiaMark)" d={MARK_PATH} />
      </G>
    </Svg>
  )
}
```

- [ ] **Step 6: Confirm the brand package needs no lint exemption**

Because the mark draws its colours from `ramp`, no hex literal appears in this package.
Do **not** add an exemption to `eslint.config.mjs`.

Run: `pnpm --filter @corymbia/brand lint`
Expected: PASS with no errors. If it reports "Raw hex colours are not allowed", a colour was
hardcoded instead of taken from `ramp` — fix the source rather than the lint config.

- [ ] **Step 7: Write `packages/brand/src/index.ts`**

```ts
export { CorymbiaMark, BRAND_GRADIENT_STOPS } from './CorymbiaMark'
```

- [ ] **Step 8: Run the test and lint**

Run: `pnpm --filter @corymbia/brand test && pnpm turbo run lint`
Expected: PASS — 5 tests, no lint errors.

- [ ] **Step 9: Commit**

```bash
git add packages/brand pnpm-lock.yaml
git commit -m "feat(brand): add CorymbiaMark component extracted from logo.svg"
```

---

### Task 8: Core primitives — `Screen`, `Type`, `Button`, `Card`

**Files:**
- Create: `packages/ui/src/primitives/Screen.tsx`, `Type.tsx`, `Button.tsx`, `Card.tsx`, `packages/ui/src/primitives/index.ts`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/primitives/__tests__/Button.test.tsx`, `packages/ui/src/primitives/__tests__/Type.test.tsx`

**Interfaces:**
- Consumes: `useTheme`, `spacing`, `radii`, `type`, `touch`, `field`.
- Produces:
  - `<Screen padded?: boolean>` — themed page container.
  - `<Type variant?: keyof typeof type dim?: boolean numberOfLines?: number ellipsizeMode?>` — the only text component.
  - `<Button label kind?: 'primary' | 'secondary' | 'fast' | 'accurate' size?: 'standard' | 'field' onPress disabled? spokenLabel? testID?>`
  - `<Card raised?: boolean accent?: boolean>`

**Doctrine enforced here:** every button meets the 48dp minimum, field buttons 72dp (constraint list), and every button carries a `spokenLabel` that defaults to `label` — the voice-mode contract from doctrine rule 16, established now so Plan 7 is additive.

- [ ] **Step 1: Write the failing tests**

`packages/ui/src/primitives/__tests__/Button.test.tsx`:

```tsx
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react-native'
import { ThemeProvider } from '../../theme'
import { Button } from '../Button'

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>)

describe('Button', () => {
  it('meets the 48dp minimum touch target', () => {
    wrap(<Button label="Save" onPress={() => {}} testID="b" />)
    expect(screen.getByTestId('b').props.style).toEqual(
      expect.objectContaining({ minHeight: 48 }),
    )
  })

  it('uses the 72dp field size for field controls', () => {
    wrap(<Button label="Save now" size="field" onPress={() => {}} testID="b" />)
    expect(screen.getByTestId('b').props.style).toEqual(
      expect.objectContaining({ minHeight: 72 }),
    )
  })

  it('calls onPress', () => {
    const onPress = jest.fn()
    wrap(<Button label="Save" onPress={onPress} testID="b" />)
    fireEvent.press(screen.getByTestId('b'))
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('does not call onPress when disabled', () => {
    const onPress = jest.fn()
    wrap(<Button label="Save" onPress={onPress} disabled testID="b" />)
    fireEvent.press(screen.getByTestId('b'))
    expect(onPress).not.toHaveBeenCalled()
  })

  it('exposes a spoken label that defaults to the visible label', () => {
    wrap(<Button label="Save now" onPress={() => {}} testID="b" />)
    expect(screen.getByTestId('b').props.accessibilityLabel).toBe('Save now')
  })

  it('allows the spoken label to differ from the visible one', () => {
    wrap(
      <Button label="⚡ SAVE NOW" spokenLabel="Save now" onPress={() => {}} testID="b" />,
    )
    expect(screen.getByTestId('b').props.accessibilityLabel).toBe('Save now')
  })
})
```

`packages/ui/src/primitives/__tests__/Type.test.tsx`:

```tsx
import React from 'react'
import { render, screen } from '@testing-library/react-native'
import { darkTheme } from '@corymbia/tokens'
import { ThemeProvider } from '../../theme'
import { Type } from '../Type'

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>)

describe('Type', () => {
  it('renders body text in the primary colour by default', () => {
    wrap(<Type testID="t">Hello</Type>)
    expect(screen.getByTestId('t').props.style).toEqual(
      expect.objectContaining({ fontSize: 14, color: darkTheme.colors.textPrimary }),
    )
  })

  it('renders dim text in the dim colour', () => {
    wrap(
      <Type testID="t" dim>
        Hello
      </Type>,
    )
    expect(screen.getByTestId('t').props.style).toEqual(
      expect.objectContaining({ color: darkTheme.colors.textDim }),
    )
  })

  it('applies the requested variant from the type scale', () => {
    wrap(
      <Type testID="t" variant="hero">
        4
      </Type>,
    )
    expect(screen.getByTestId('t').props.style).toEqual(
      expect.objectContaining({ fontSize: 62, fontWeight: '800' }),
    )
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @corymbia/ui test primitives`
Expected: FAIL — `Cannot find module '../Button'`.

- [ ] **Step 3: Write `packages/ui/src/primitives/Type.tsx`**

```tsx
import React from 'react'
import { Text, type TextProps } from 'react-native'
import { type as typeScale } from '@corymbia/tokens'
import { useTheme } from '../theme'

export type TypeVariant = keyof typeof typeScale

export function Type({
  variant = 'body',
  dim = false,
  style,
  children,
  ...rest
}: TextProps & { variant?: TypeVariant; dim?: boolean }) {
  const { theme } = useTheme()
  const v = typeScale[variant]
  return (
    <Text
      {...rest}
      style={[
        {
          fontSize: v.size,
          fontWeight: v.weight,
          letterSpacing: v.letterSpacing,
          color: dim ? theme.colors.textDim : theme.colors.textPrimary,
        },
        style,
      ]}
    >
      {children}
    </Text>
  )
}
```

- [ ] **Step 4: Write `packages/ui/src/primitives/Button.tsx`**

```tsx
import React from 'react'
import { Pressable } from 'react-native'
import { radii, spacing, touch, field } from '@corymbia/tokens'
import { useTheme } from '../theme'
import { Type } from './Type'

export type ButtonKind = 'primary' | 'secondary' | 'fast' | 'accurate'

export function Button({
  label,
  spokenLabel,
  onPress,
  kind = 'primary',
  size = 'standard',
  disabled = false,
  testID,
}: {
  label: string
  /** Voice-mode contract (doctrine rule 16). Defaults to the visible label. */
  spokenLabel?: string
  onPress: () => void
  kind?: ButtonKind
  size?: 'standard' | 'field'
  disabled?: boolean
  testID?: string
}) {
  const { theme } = useTheme()
  const c = theme.colors

  const palette: Record<ButtonKind, { bg: string; ink: string; border: string }> = {
    primary: { bg: c.accent, ink: c.textOnAccent, border: c.accent },
    secondary: { bg: c.surfaceRaised, ink: c.textPrimary, border: c.border },
    fast: { bg: c.captureFast, ink: c.captureFastInk, border: c.captureFast },
    accurate: { bg: c.captureAccurate, ink: c.captureAccurateInk, border: c.accent },
  }
  const p = palette[kind]

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={spokenLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: size === 'field' ? field.control : touch.min,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: spacing.lg,
        borderRadius: radii.lg,
        borderWidth: 2,
        borderColor: p.border,
        backgroundColor: p.bg,
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <Type variant={size === 'field' ? 'heading' : 'body'} style={{ color: p.ink }}>
        {label}
      </Type>
    </Pressable>
  )
}
```

- [ ] **Step 5: Write `packages/ui/src/primitives/Screen.tsx` and `Card.tsx`**

`Screen.tsx`:

```tsx
import React from 'react'
import { View } from 'react-native'
import { spacing } from '@corymbia/tokens'
import { useTheme } from '../theme'

export function Screen({
  children,
  padded = true,
}: {
  children: React.ReactNode
  padded?: boolean
}) {
  const { theme } = useTheme()
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.colors.surface,
        padding: padded ? spacing.lg : 0,
      }}
    >
      {children}
    </View>
  )
}
```

`Card.tsx`:

```tsx
import React from 'react'
import { View } from 'react-native'
import { radii, spacing } from '@corymbia/tokens'
import { useTheme } from '../theme'

export function Card({
  children,
  accent = false,
}: {
  children: React.ReactNode
  accent?: boolean
}) {
  const { theme } = useTheme()
  return (
    <View
      style={{
        backgroundColor: theme.colors.surfaceRaised,
        borderRadius: radii.xl,
        borderWidth: 1,
        borderColor: accent ? theme.colors.accent : theme.colors.border,
        padding: spacing.md,
      }}
    >
      {children}
    </View>
  )
}
```

- [ ] **Step 6: Write the barrel and re-export**

`packages/ui/src/primitives/index.ts`:

```ts
export { Screen } from './Screen'
export { Type } from './Type'
export type { TypeVariant } from './Type'
export { Button } from './Button'
export type { ButtonKind } from './Button'
export { Card } from './Card'
```

Update `packages/ui/src/index.ts`:

```ts
export * from './theme'
export * from './layout'
export * from './primitives'
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @corymbia/ui test`
Expected: PASS — 21 tests.

- [ ] **Step 8: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): add Screen, Type, Button and Card primitives"
```

---

### Task 9: Name handling — `shortLabel`, `ProjectName`, `NameChip`

**Files:**
- Create: `packages/ui/src/names/shortLabel.ts`, `ProjectName.tsx`, `NameChip.tsx`, `packages/ui/src/names/index.ts`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/names/__tests__/shortLabel.test.ts`, `packages/ui/src/names/__tests__/names.test.tsx`

**Interfaces:**
- Consumes: `useTheme`, `Type`, `radii`, `spacing`.
- Produces:
  - `resolveDisplayName(input: { name: string; shortLabel?: string | null }): string`
  - `<ProjectName name shortLabel? testID?>` — hero treatment, clamps to two lines.
  - `<NameChip name shortLabel? testID?>` — compact treatment, middle truncation.

**Doctrine enforced here:** rules 10 (two-line clamp), 11 (middle truncation), 12 (optional short label), 14 (never animate a name).

**A refinement of the spec:** §7 says a blank short label is "derived automatically". The honest derivation is to fall back to the full name and let the component truncate it in the middle — no heuristic can shorten an ecologist's project name better than she can, and a bad guess is worse than a clean ellipsis. `resolveDisplayName` therefore returns `shortLabel` when present and `name` otherwise.

- [ ] **Step 1: Write the failing tests**

`packages/ui/src/names/__tests__/shortLabel.test.ts`:

```ts
import { resolveDisplayName } from '../shortLabel'

describe('resolveDisplayName', () => {
  it('prefers the short label when one is set', () => {
    expect(
      resolveDisplayName({
        name: 'Yarra Flats Riparian Restoration — North Reach Stage 2',
        shortLabel: 'Yarra Nth 2',
      }),
    ).toBe('Yarra Nth 2')
  })

  it('falls back to the full name when the short label is absent', () => {
    expect(resolveDisplayName({ name: 'Yarra Flats' })).toBe('Yarra Flats')
  })

  it('falls back to the full name when the short label is null or blank', () => {
    expect(resolveDisplayName({ name: 'Yarra Flats', shortLabel: null })).toBe('Yarra Flats')
    expect(resolveDisplayName({ name: 'Yarra Flats', shortLabel: '   ' })).toBe('Yarra Flats')
  })

  it('trims a short label', () => {
    expect(resolveDisplayName({ name: 'Yarra Flats', shortLabel: ' Yarra 2 ' })).toBe('Yarra 2')
  })
})
```

`packages/ui/src/names/__tests__/names.test.tsx`:

```tsx
import React from 'react'
import { render, screen } from '@testing-library/react-native'
import { ThemeProvider } from '../../theme'
import { ProjectName } from '../ProjectName'
import { NameChip } from '../NameChip'

const LONG = 'Yarra Flats Riparian Restoration — North Reach Stage 2'
const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>)

describe('ProjectName', () => {
  it('clamps to two lines so the card never grows (doctrine rule 10)', () => {
    wrap(<ProjectName name={LONG} testID="n" />)
    expect(screen.getByTestId('n').props.numberOfLines).toBe(2)
  })

  it('clips at the tail for hero text, which reads as prose', () => {
    wrap(<ProjectName name={LONG} testID="n" />)
    expect(screen.getByTestId('n').props.ellipsizeMode).toBe('tail')
  })

  it('shows the full name, not the short label — the hero has room', () => {
    wrap(<ProjectName name={LONG} shortLabel="Yarra Nth 2" testID="n" />)
    expect(screen.getByTestId('n')).toHaveTextContent(LONG)
  })
})

describe('NameChip', () => {
  it('truncates in the middle so the distinguishing tail survives (doctrine rule 11)', () => {
    wrap(<NameChip name={LONG} testID="c" />)
    expect(screen.getByTestId('c').props.ellipsizeMode).toBe('middle')
  })

  it('stays on one line', () => {
    wrap(<NameChip name={LONG} testID="c" />)
    expect(screen.getByTestId('c').props.numberOfLines).toBe(1)
  })

  it('prefers the short label when set (doctrine rule 12)', () => {
    wrap(<NameChip name={LONG} shortLabel="Yarra Nth 2" testID="c" />)
    expect(screen.getByTestId('c')).toHaveTextContent('Yarra Nth 2')
  })

  it('always speaks the full name even when the label is shortened', () => {
    wrap(<NameChip name={LONG} shortLabel="Yarra Nth 2" testID="c" />)
    expect(screen.getByTestId('c').props.accessibilityLabel).toBe(LONG)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @corymbia/ui test names`
Expected: FAIL — `Cannot find module '../shortLabel'`.

- [ ] **Step 3: Write `packages/ui/src/names/shortLabel.ts`**

```ts
/**
 * Doctrine rule 12: names carry an optional user-controlled short label.
 * When blank we fall back to the full name and let the component truncate it —
 * no heuristic shortens an ecologist's project name better than she does, and a
 * bad guess is worse than a clean ellipsis.
 */
export function resolveDisplayName({
  name,
  shortLabel,
}: {
  name: string
  shortLabel?: string | null
}): string {
  const trimmed = shortLabel?.trim()
  return trimmed ? trimmed : name
}
```

- [ ] **Step 4: Write `packages/ui/src/names/ProjectName.tsx`**

```tsx
import React from 'react'
import { Type } from '../primitives/Type'

/**
 * Hero treatment. Doctrine rule 10: clamps to two lines so the card never grows
 * and the primary action below it never moves. Doctrine rule 14: never animated.
 */
export function ProjectName({ name, testID }: { name: string; shortLabel?: string | null; testID?: string }) {
  return (
    <Type
      testID={testID}
      variant="title"
      numberOfLines={2}
      ellipsizeMode="tail"
      accessibilityLabel={name}
    >
      {name}
    </Type>
  )
}
```

- [ ] **Step 5: Write `packages/ui/src/names/NameChip.tsx`**

```tsx
import React from 'react'
import { View } from 'react-native'
import { radii, spacing } from '@corymbia/tokens'
import { useTheme } from '../theme'
import { Type } from '../primitives/Type'
import { resolveDisplayName } from './shortLabel'

/**
 * Compact treatment. Doctrine rule 11: middle truncation, because field project
 * names are front-loaded with the site and back-loaded with what actually tells
 * them apart. The full name always reaches assistive tech and the voiced mode.
 */
export function NameChip({
  name,
  shortLabel,
  testID,
}: {
  name: string
  shortLabel?: string | null
  testID?: string
}) {
  const { theme } = useTheme()
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        borderWidth: 1,
        borderColor: theme.colors.accent,
        borderRadius: radii.pill,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        maxWidth: 220,
      }}
    >
      <Type
        testID={testID}
        variant="small"
        numberOfLines={1}
        ellipsizeMode="middle"
        accessibilityLabel={name}
        style={{ color: theme.colors.accent }}
      >
        {resolveDisplayName({ name, shortLabel })}
      </Type>
    </View>
  )
}
```

- [ ] **Step 6: Write the barrel and re-export**

`packages/ui/src/names/index.ts`:

```ts
export { resolveDisplayName } from './shortLabel'
export { ProjectName } from './ProjectName'
export { NameChip } from './NameChip'
```

Add `export * from './names'` to `packages/ui/src/index.ts`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @corymbia/ui test`
Expected: PASS — 32 tests.

- [ ] **Step 8: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): add ProjectName and NameChip with middle truncation and short labels"
```

---

### Task 10: `ContextStamp`

**Files:**
- Create: `packages/ui/src/context-stamp/ContextStamp.tsx`, `packages/ui/src/context-stamp/index.ts`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/context-stamp/__tests__/ContextStamp.test.tsx`

**Interfaces:**
- Consumes: `useTheme`, `Type`, `radii`, `spacing`.
- Produces:
  - `type FixQuality = 'deliberate' | 'ambient' | 'none'`
  - `type ContextStampProps = { fix: { quality: FixQuality; accuracyM?: number; ageMinutes?: number }; place?: { name: string; distanceM?: number } | null; device?: string | null; activity?: { name: string; wasFiled: boolean } | null }`
  - `<ContextStamp {...ContextStampProps} testID?>`

**This is presentational only.** It takes plain props, not database rows, so `ui` never depends on `data`. Plan 2 maps rows onto these props.

**Doctrine enforced here:** rule 9 — colour never carries meaning alone. Deliberate is a **solid** border, ambient is **dashed** amber *with the word and the age in the text*, none is **dashed** grey with the word "no position".

- [ ] **Step 1: Write the failing test**

`packages/ui/src/context-stamp/__tests__/ContextStamp.test.tsx`:

```tsx
import React from 'react'
import { render, screen } from '@testing-library/react-native'
import { ThemeProvider } from '../../theme'
import { ContextStamp } from '../ContextStamp'

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>)

describe('ContextStamp', () => {
  it('shows a deliberate fix with its accuracy and a solid border', () => {
    wrap(<ContextStamp fix={{ quality: 'deliberate', accuracyM: 4 }} />)
    expect(screen.getByTestId('fix-chip')).toHaveTextContent('±4 m')
    expect(screen.getByTestId('fix-chip-box').props.style).toEqual(
      expect.objectContaining({ borderStyle: 'solid' }),
    )
  })

  it('shows an ambient fix with its age and a dashed border', () => {
    wrap(<ContextStamp fix={{ quality: 'ambient', accuracyM: 38, ageMinutes: 4 }} />)
    expect(screen.getByTestId('fix-chip')).toHaveTextContent('±38 m')
    expect(screen.getByTestId('fix-chip')).toHaveTextContent('4 min old')
    expect(screen.getByTestId('fix-chip-box').props.style).toEqual(
      expect.objectContaining({ borderStyle: 'dashed' }),
    )
  })

  it('states plainly when there is no position rather than guessing', () => {
    wrap(<ContextStamp fix={{ quality: 'none' }} />)
    expect(screen.getByTestId('fix-chip')).toHaveTextContent('no position')
  })

  it('never relies on colour alone — each quality carries distinct text', () => {
    const { rerender } = wrap(<ContextStamp fix={{ quality: 'deliberate', accuracyM: 4 }} />)
    const deliberate = screen.getByTestId('fix-chip').props.children
    rerender(
      <ThemeProvider>
        <ContextStamp fix={{ quality: 'ambient', accuracyM: 4, ageMinutes: 2 }} />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('fix-chip').props.children).not.toEqual(deliberate)
  })

  it('shows the nearest known place with its distance', () => {
    wrap(
      <ContextStamp
        fix={{ quality: 'ambient', accuracyM: 38, ageMinutes: 4 }}
        place={{ name: 'Nth Reach', distanceM: 120 }}
      />,
    )
    expect(screen.getByTestId('place-chip')).toHaveTextContent('120 m from Nth Reach')
  })

  it('omits the distance when standing at the place', () => {
    wrap(<ContextStamp fix={{ quality: 'deliberate', accuracyM: 4 }} place={{ name: 'Nth Reach' }} />)
    expect(screen.getByTestId('place-chip')).toHaveTextContent('Nth Reach')
    expect(screen.getByTestId('place-chip')).not.toHaveTextContent('from')
  })

  it('distinguishes an activity it was filed to from one it merely happened during', () => {
    const { rerender } = wrap(
      <ContextStamp
        fix={{ quality: 'deliberate', accuracyM: 4 }}
        activity={{ name: 'Survey 3', wasFiled: true }}
      />,
    )
    expect(screen.getByTestId('activity-chip')).toHaveTextContent('Survey 3')
    expect(screen.getByTestId('activity-chip')).not.toHaveTextContent('during')

    rerender(
      <ThemeProvider>
        <ContextStamp
          fix={{ quality: 'ambient', accuracyM: 38, ageMinutes: 4 }}
          activity={{ name: 'Survey 3', wasFiled: false }}
        />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('activity-chip')).toHaveTextContent('during Survey 3')
  })

  it('shows the device, since the user works across a tablet and a phone', () => {
    wrap(<ContextStamp fix={{ quality: 'none' }} device="field-s24" />)
    expect(screen.getByTestId('device-chip')).toHaveTextContent('field-s24')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @corymbia/ui test ContextStamp`
Expected: FAIL — `Cannot find module '../ContextStamp'`.

- [ ] **Step 3: Write `packages/ui/src/context-stamp/ContextStamp.tsx`**

```tsx
import React from 'react'
import { View } from 'react-native'
import { radii, spacing } from '@corymbia/tokens'
import { useTheme } from '../theme'
import { Type } from '../primitives/Type'

export type FixQuality = 'deliberate' | 'ambient' | 'none'

export type ContextStampProps = {
  fix: { quality: FixQuality; accuracyM?: number; ageMinutes?: number }
  place?: { name: string; distanceM?: number } | null
  device?: string | null
  activity?: { name: string; wasFiled: boolean } | null
  testID?: string
}

function Chip({
  testID,
  color,
  dashed = false,
  children,
}: {
  testID: string
  color: string
  dashed?: boolean
  children: string
}) {
  const { theme } = useTheme()
  return (
    <View
      testID={`${testID}-box`}
      style={{
        borderWidth: 1,
        borderStyle: dashed ? 'dashed' : 'solid',
        borderColor: color,
        borderRadius: radii.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
        backgroundColor: theme.colors.surfaceRaised,
      }}
    >
      <Type testID={testID} variant="label" style={{ color, letterSpacing: 0 }}>
        {children}
      </Type>
    </View>
  )
}

/**
 * Doctrine rule 9: colour never carries meaning alone. Each fix quality has a
 * distinct border style AND distinct text, so the three are told apart in
 * sunlight, with colour-vision deficiency, and by the voiced mode.
 */
function fixChip(fix: ContextStampProps['fix']): { text: string; dashed: boolean } {
  if (fix.quality === 'none') return { text: '⚑ no position', dashed: true }
  if (fix.quality === 'ambient') {
    const age = fix.ageMinutes === undefined ? '' : ` · ${fix.ageMinutes} min old`
    return { text: `~ ±${fix.accuracyM} m${age}`, dashed: true }
  }
  return { text: `◎ ±${fix.accuracyM} m`, dashed: false }
}

export function ContextStamp({ fix, place, device, activity, testID }: ContextStampProps) {
  const { theme } = useTheme()
  const c = theme.colors
  const { text, dashed } = fixChip(fix)

  const fixColor =
    fix.quality === 'deliberate' ? c.statusGood : fix.quality === 'ambient' ? c.statusFair : c.textDim

  return (
    <View
      testID={testID}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}
    >
      <Chip testID="fix-chip" color={fixColor} dashed={dashed}>
        {text}
      </Chip>

      {place ? (
        <Chip testID="place-chip" color={c.accentMuted}>
          {place.distanceM === undefined
            ? place.name
            : `${place.distanceM} m from ${place.name}`}
        </Chip>
      ) : null}

      {device ? (
        <Chip testID="device-chip" color={c.textDim}>
          {`▣ ${device}`}
        </Chip>
      ) : null}

      {activity ? (
        <Chip testID="activity-chip" color={c.textDim}>
          {activity.wasFiled ? activity.name : `during ${activity.name}`}
        </Chip>
      ) : null}
    </View>
  )
}
```

- [ ] **Step 4: Write the barrel and re-export**

`packages/ui/src/context-stamp/index.ts`:

```ts
export { ContextStamp } from './ContextStamp'
export type { ContextStampProps, FixQuality } from './ContextStamp'
```

Add `export * from './context-stamp'` to `packages/ui/src/index.ts`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @corymbia/ui test`
Expected: PASS — 40 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): add ContextStamp with deliberate, ambient and absent fix classes"
```

---

### Task 11: `HelpAffordance` and `InputAffordanceRow`

**Files:**
- Create: `packages/ui/src/help/HelpAffordance.tsx`, `packages/ui/src/inputs/InputAffordanceRow.tsx`, and barrels for both
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/help/__tests__/HelpAffordance.test.tsx`, `packages/ui/src/inputs/__tests__/InputAffordanceRow.test.tsx`

**Interfaces:**
- Consumes: `useTheme`, `Type`, `Button`, `touch`, `spacing`, `radii`.
- Produces:
  - `<HelpAffordance title body testID?>` — a 48dp tappable `?` opening a modal popover.
  - `type InputAffordanceKind = 'title' | 'description' | 'voice' | 'photo'`
  - `<InputAffordanceRow onPress: (kind: InputAffordanceKind) => void completed?: InputAffordanceKind[] testID?>`

**Doctrine enforced here:** rule 5 — text, voice and photo each get one visual signature used identically everywhere, **in a fixed order**. The order is defined here once: title, description, voice, photo. Rule 7 — help is a tap, never a hover.

- [ ] **Step 1: Write the failing tests**

`packages/ui/src/help/__tests__/HelpAffordance.test.tsx`:

```tsx
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react-native'
import { ThemeProvider } from '../../theme'
import { HelpAffordance } from '../HelpAffordance'

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>)

describe('HelpAffordance', () => {
  it('meets the minimum touch target', () => {
    wrap(<HelpAffordance title="Accuracy" body="How close the fix is." testID="h" />)
    expect(screen.getByTestId('h').props.style).toEqual(
      expect.objectContaining({ minHeight: 48, minWidth: 48 }),
    )
  })

  it('is hidden until tapped, then shows the explanation', () => {
    wrap(<HelpAffordance title="Accuracy" body="How close the fix is." testID="h" />)
    expect(screen.queryByText('How close the fix is.')).toBeNull()
    fireEvent.press(screen.getByTestId('h'))
    expect(screen.getByText('How close the fix is.')).toBeTruthy()
  })

  it('names what it explains, for screen readers and the voiced mode', () => {
    wrap(<HelpAffordance title="Accuracy" body="How close the fix is." testID="h" />)
    expect(screen.getByTestId('h').props.accessibilityLabel).toBe('Help with Accuracy')
  })
})
```

`packages/ui/src/inputs/__tests__/InputAffordanceRow.test.tsx`:

```tsx
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react-native'
import { ThemeProvider } from '../../theme'
import { InputAffordanceRow, INPUT_AFFORDANCE_ORDER } from '../InputAffordanceRow'

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>)

describe('InputAffordanceRow', () => {
  it('declares the four affordances in one fixed order (doctrine rule 5)', () => {
    expect(INPUT_AFFORDANCE_ORDER).toEqual(['title', 'description', 'voice', 'photo'])
  })

  it('renders them in that order', () => {
    wrap(<InputAffordanceRow onPress={() => {}} />)
    const rendered = screen
      .getAllByRole('button')
      .map((node) => node.props.testID.replace('affordance-', ''))
    expect(rendered).toEqual([...INPUT_AFFORDANCE_ORDER])
  })

  it('reports which affordance was tapped', () => {
    const onPress = jest.fn()
    wrap(<InputAffordanceRow onPress={onPress} />)
    fireEvent.press(screen.getByTestId('affordance-voice'))
    expect(onPress).toHaveBeenCalledWith('voice')
  })

  it('marks completed affordances without removing them', () => {
    wrap(<InputAffordanceRow onPress={() => {}} completed={['title']} />)
    expect(screen.getByTestId('affordance-title').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    )
    expect(screen.getByTestId('affordance-photo').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false }),
    )
  })

  it('gives every affordance a speakable name', () => {
    wrap(<InputAffordanceRow onPress={() => {}} />)
    expect(screen.getByTestId('affordance-voice').props.accessibilityLabel).toBe(
      'Record a voice note',
    )
    expect(screen.getByTestId('affordance-photo').props.accessibilityLabel).toBe('Take a photo')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @corymbia/ui test Affordance`
Expected: FAIL — `Cannot find module '../HelpAffordance'`.

- [ ] **Step 3: Write `packages/ui/src/help/HelpAffordance.tsx`**

```tsx
import React, { useState } from 'react'
import { Modal, Pressable, View } from 'react-native'
import { radii, spacing, touch } from '@corymbia/tokens'
import { useTheme } from '../theme'
import { Type } from '../primitives/Type'
import { Button } from '../primitives/Button'

/**
 * Doctrine rule 7: help is adjacent and tappable. Never a hover tooltip —
 * there is no hover on a tablet in the field.
 */
export function HelpAffordance({
  title,
  body,
  testID,
}: {
  title: string
  body: string
  testID?: string
}) {
  const { theme } = useTheme()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`Help with ${title}`}
        onPress={() => setOpen(true)}
        style={{
          minHeight: touch.min,
          minWidth: touch.min,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Type variant="heading" style={{ color: theme.colors.textDim }}>
          ?
        </Type>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            padding: spacing.xl,
            backgroundColor: `${theme.colors.overlay}CC`,
          }}
        >
          <View
            style={{
              backgroundColor: theme.colors.surfaceRaised,
              borderRadius: radii.xl,
              borderWidth: 1,
              borderColor: theme.colors.border,
              padding: spacing.lg,
              gap: spacing.md,
            }}
          >
            <Type variant="heading">{title}</Type>
            <Type dim>{body}</Type>
            <Button label="Got it" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  )
}
```

> The `${theme.colors.overlay}CC` concatenation appends an alpha channel to a semantic token. It is not a raw hex literal, so the lint rule permits it.

- [ ] **Step 4: Write `packages/ui/src/inputs/InputAffordanceRow.tsx`**

```tsx
import React from 'react'
import { Pressable, View } from 'react-native'
import { radii, spacing, touch } from '@corymbia/tokens'
import { useTheme } from '../theme'
import { Type } from '../primitives/Type'

export type InputAffordanceKind = 'title' | 'description' | 'voice' | 'photo'

/**
 * Doctrine rule 5: one visual signature per input kind, used identically
 * everywhere, ALWAYS IN THIS ORDER. Learned once, recognised forever.
 */
const AFFORDANCES: {
  kind: InputAffordanceKind
  glyph: string
  label: string
  spoken: string
}[] = [
  { kind: 'title', glyph: '✏️', label: 'Title', spoken: 'Add a title' },
  { kind: 'description', glyph: '🗒️', label: 'Notes', spoken: 'Add notes' },
  { kind: 'voice', glyph: '🎙️', label: 'Voice', spoken: 'Record a voice note' },
  { kind: 'photo', glyph: '📷', label: 'Photo', spoken: 'Take a photo' },
]

/** The canonical order, exported so it can be asserted without a test-only element. */
export const INPUT_AFFORDANCE_ORDER: InputAffordanceKind[] = AFFORDANCES.map((a) => a.kind)

export function InputAffordanceRow({
  onPress,
  completed = [],
  testID,
}: {
  onPress: (kind: InputAffordanceKind) => void
  completed?: InputAffordanceKind[]
  testID?: string
}) {
  const { theme } = useTheme()

  return (
    <View testID={testID} style={{ flexDirection: 'row', gap: spacing.sm }}>
      {AFFORDANCES.map((a) => {
        const done = completed.includes(a.kind)
        return (
          <Pressable
            key={a.kind}
            testID={`affordance-${a.kind}`}
            accessibilityRole="button"
            accessibilityLabel={a.spoken}
            accessibilityState={{ selected: done }}
            onPress={() => onPress(a.kind)}
            style={{
              flex: 1,
              minHeight: touch.comfortable,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radii.md,
              borderWidth: 2,
              borderColor: done ? theme.colors.accent : theme.colors.border,
              backgroundColor: theme.colors.surfaceRaised,
              paddingVertical: spacing.sm,
            }}
          >
            <Type variant="heading">{a.glyph}</Type>
            <Type variant="label" dim>
              {a.label}
            </Type>
          </Pressable>
        )
      })}
    </View>
  )
}
```

- [ ] **Step 5: Write the barrels and re-export**

`packages/ui/src/help/index.ts`:

```ts
export { HelpAffordance } from './HelpAffordance'
```

`packages/ui/src/inputs/index.ts`:

```ts
export { InputAffordanceRow, INPUT_AFFORDANCE_ORDER } from './InputAffordanceRow'
export type { InputAffordanceKind } from './InputAffordanceRow'
```

Add both to `packages/ui/src/index.ts`:

```ts
export * from './help'
export * from './inputs'
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @corymbia/ui test`
Expected: PASS — 47 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): add HelpAffordance and the fixed-order InputAffordanceRow"
```

---

### Task 12: The gallery screen, on hardware

**Files:**
- Create: `apps/fieldkit/src/gallery/sections.tsx`
- Modify: `apps/fieldkit/app/index.tsx`

**Interfaces:**
- Consumes: everything exported from `@corymbia/ui` and `@corymbia/brand`.
- Produces: no new exports. This is the review surface — the screen you look at on the S25 to judge whether the library is right.

**Why this task exists:** unit tests prove the components behave. Only the device proves they are legible in sunlight, reachable with a thumb, and correct in both themes. Doctrine and the spec both insist device review is not substitutable by an emulator.

- [ ] **Step 1: Write `apps/fieldkit/src/gallery/sections.tsx`**

```tsx
import React from 'react'
import { View } from 'react-native'
import { spacing } from '@corymbia/tokens'
import {
  Button,
  Card,
  ContextStamp,
  HelpAffordance,
  InputAffordanceRow,
  NameChip,
  ProjectName,
  Type,
  useLayout,
  useTheme,
} from '@corymbia/ui'
import { CorymbiaMark } from '@corymbia/brand'

const LONG_NAME = 'Yarra Flats Riparian Restoration — North Reach Stage 2'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.sm, marginBottom: spacing.xl }}>
      <Type variant="label" dim>
        {title.toUpperCase()}
      </Type>
      {children}
    </View>
  )
}

export function GallerySections() {
  const { name, setTheme } = useTheme()
  const { sizeClass, deviceClass, orientation, width, height } = useLayout()

  return (
    <View>
      <Section title="Brand bar">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <CorymbiaMark size={26} />
          <View>
            <Type variant="label" dim>
              CORYMBIA
            </Type>
            <Type variant="label">FIELD KIT</Type>
          </View>
        </View>
      </Section>

      <Section title="Layout">
        <Type dim>
          {sizeClass} · {deviceClass} · {orientation} · {Math.round(width)}×{Math.round(height)}dp
        </Type>
      </Section>

      <Section title="Theme">
        <Button
          label={`Switch to ${name === 'dark' ? 'light' : 'dark'}`}
          kind="secondary"
          onPress={() => setTheme(name === 'dark' ? 'light' : 'dark')}
        />
      </Section>

      <Section title="Names — long, to prove the clamping">
        <Card>
          <ProjectName name={LONG_NAME} />
          <View style={{ height: spacing.sm }} />
          <NameChip name={LONG_NAME} />
          <View style={{ height: spacing.xs }} />
          <NameChip name={LONG_NAME} shortLabel="Yarra Nth 2" />
        </Card>
      </Section>

      <Section title="Context stamps — all three fix classes">
        <Card>
          <View style={{ gap: spacing.sm }}>
            <ContextStamp
              fix={{ quality: 'deliberate', accuracyM: 4 }}
              place={{ name: 'Nth Reach' }}
              device="tablet"
              activity={{ name: 'Survey 3', wasFiled: true }}
            />
            <ContextStamp
              fix={{ quality: 'ambient', accuracyM: 38, ageMinutes: 4 }}
              place={{ name: 'Nth Reach', distanceM: 120 }}
              device="field-s24"
              activity={{ name: 'Survey 3', wasFiled: false }}
            />
            <ContextStamp fix={{ quality: 'none' }} device="field-s24" />
          </View>
        </Card>
      </Section>

      <Section title="Capture controls — field size, 72dp">
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button label="⚡ SAVE NOW" spokenLabel="Save now" kind="fast" size="field" onPress={() => {}} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label="◎ SHARPEN"
              spokenLabel="Sharpen the fix"
              kind="accurate"
              size="field"
              onPress={() => {}}
            />
          </View>
        </View>
      </Section>

      <Section title="Input affordances — fixed order">
        <InputAffordanceRow onPress={() => {}} completed={['title']} />
      </Section>

      <Section title="Help">
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Type>Accuracy</Type>
          <HelpAffordance
            title="Accuracy"
            body="How close this position is likely to be to where you are standing. Smaller is better. Under 5 m is good enough for a survey record."
          />
        </View>
      </Section>
    </View>
  )
}
```

- [ ] **Step 2: Add the workspace dependencies and wire the ThemeProvider**

The app shell has run on `@corymbia/tokens` alone since Task 6. Now it gains the library.

Add to `apps/fieldkit/package.json` `dependencies`:

```json
"@corymbia/ui": "workspace:*",
"@corymbia/brand": "workspace:*"
```

Run: `pnpm install`
Expected: both link as workspace packages, no peer warnings for `react` or `react-native`.

Replace `apps/fieldkit/app/_layout.tsx` — the status bar now follows the active theme, so a
light-mode screen does not get white-on-white status text:

```tsx
import { Slot } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaView } from 'react-native'
import { ThemeProvider, useTheme } from '@corymbia/ui'

function Frame() {
  const { theme, name } = useTheme()
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.surface }}>
      <StatusBar style={name === 'dark' ? 'light' : 'dark'} />
      <Slot />
    </SafeAreaView>
  )
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <Frame />
    </ThemeProvider>
  )
}
```

- [ ] **Step 3: Replace `apps/fieldkit/app/index.tsx`**

```tsx
import { ScrollView } from 'react-native'
import { Screen } from '@corymbia/ui'
import { GallerySections } from '../src/gallery/sections'

export default function Gallery() {
  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <GallerySections />
      </ScrollView>
    </Screen>
  )
}
```

- [ ] **Step 4: Run the full check**

Run: `pnpm turbo run test lint typecheck`
Expected: PASS across `@corymbia/tokens`, `@corymbia/ui`, `@corymbia/brand`.

The smoke screen's `useWindowDimensions` import is gone as of Step 3, so lint rule 2 now
applies cleanly to the whole app.

- [ ] **Step 5: Review on the S25**

```bash
cd apps/fieldkit && npx expo run:android
```

Check each of these and fix anything that fails before committing:

- [ ] The mark renders sharp at 26dp with its gradient intact — not a black silhouette.
- [ ] `Layout` reports `compact · portrait`.
- [ ] Switching theme changes every surface, every border and every text colour. **Nothing stays dark in light mode** — a stray element is a missing semantic token, not a styling bug.
- [ ] The long project name wraps to exactly two lines and clips.
- [ ] The unlabelled chip truncates in the **middle**; the short-labelled one shows `Yarra Nth 2`.
- [ ] The three context stamps are distinguishable **with the screen turned to greyscale** (Android: Settings → Accessibility → Colour correction → Greyscale). This is the real test of doctrine rule 9.
- [ ] The two capture buttons are comfortably thumb-reachable at the bottom of the screen and are visibly larger than the standard buttons.
- [ ] Tapping the help `?` opens the popover; the target is easy to hit without aiming.

- [ ] **Step 6: Take the device screenshots**

Capture both themes and store them for the record:

```bash
mkdir -p docs/design-review
adb exec-out screencap -p > docs/design-review/2026-09-05-gallery-dark.png
# switch the theme in the app, then:
adb exec-out screencap -p > docs/design-review/2026-09-05-gallery-light.png
```

- [ ] **Step 7: Commit**

```bash
git add apps/fieldkit docs/design-review pnpm-lock.yaml
git commit -m "feat(app): add component gallery and capture device review screenshots"
```

---

### Task 13: The UI doctrine document

**Files:**
- Create: `docs/ui-doctrine.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the living rules document. Every later plan adds to it.

**This is not documentation for its own sake.** The user asked at the outset for "rules for how screens and components should be created, so when we settle on a design it is shared among the apps or used in new apps". This file is that deliverable, and the note about enforcement is the part that makes it hold.

- [ ] **Step 1: Write `docs/ui-doctrine.md`**

Copy the sixteen rules verbatim from spec §6, then append this section:

```markdown
## How these rules are enforced

A rule enforced only by memory is a rule that erodes. Where a rule can be
enforced by a shared component or a lint rule, it must be.

| Rule | Enforced by |
| --- | --- |
| 5 — consistent input affordances | `InputAffordanceRow` — fixed order, asserted by test |
| 7 — help is adjacent, never hover | `HelpAffordance` — modal, no hover path exists |
| 8 — generous targets | `Button` — `touch.min` 48dp, `field.control` 72dp, asserted by test |
| 9 — colour never alone | `ContextStamp` — distinct border style and text per class |
| 10 — two-line clamp | `ProjectName` — `numberOfLines={2}`, asserted by test |
| 11 — middle truncation | `NameChip` — `ellipsizeMode="middle"`, asserted by test |
| 12 — optional short label | `resolveDisplayName` |
| 14 — never animate a name | No animation path exists in either name component |
| 16 — spoken labels | `Button.spokenLabel`, defaulting to the visible label |
| Semantic tokens only | ESLint rule 1 |
| Size classes only | ESLint rule 2 |
| Tool independence | ESLint rule 3 |

Rules 1, 2, 3, 4, 6, 13 and 15 are judgement calls that no linter can make.
They are checked at review, and every screen review checks all of them.

## Adding a rule

When a design decision is made that should hold across screens, add it here in
the same session it is made, and note how it will be enforced. If it cannot be
enforced by a component or a lint rule, say so explicitly — that is a signal to
watch it in review.
```

- [ ] **Step 2: Update `CLAUDE.md`**

The current file says the repository is a greenfield scaffold with no build system. Replace the **Repository state** section with:

```markdown
## Repository state

A pnpm workspace orchestrated by Turborepo, containing shared packages under
`packages/` and the Expo application in `apps/fieldkit`.

Commands, from the repository root:

- `pnpm turbo run test` — all tests
- `pnpm turbo run lint` — ESLint, including the three architectural rules
- `pnpm turbo run typecheck` — TypeScript across all packages
- `cd apps/fieldkit && npx expo run:android` — build and run on a connected device

## Design and UI rules

`docs/ui-doctrine.md` holds the rules every screen and component is checked
against. Read it before building any UI. Add to it whenever a cross-screen
design decision is made.

Three constraints are enforced by lint and must not be worked around:

1. Components consume semantic tokens from `@corymbia/tokens` only — never raw
   hex, never the raw ramp.
2. Only `packages/ui/src/layout/useLayout.ts` reads window dimensions.
   Everything else branches on `sizeClass`.
3. A tool may import from packages and from itself, never from a sibling tool.
```

- [ ] **Step 3: Verify the documented commands actually work**

Run each of the three commands from the repository root and confirm they behave as documented. A README that lies is worse than no README.

Run: `pnpm turbo run test lint typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/ui-doctrine.md CLAUDE.md
git commit -m "docs: add the UI doctrine and update repository guidance"
```

---

## Self-Review

**Spec coverage.** Every section of the spec that falls within this plan's scope maps to a task: §4 packages → Tasks 1–2, 3, 7; §5.1 brand → Task 7; §5.2 tokens and themes → Tasks 2–3; §5.3 responsive → Task 4; §5.4 reach zones → Task 4; §5.5 density → deferred to Plan 6 with the tablet pass, where it can be judged on hardware; §6 doctrine → Tasks 9–11, 13; §3 tool boundaries → Task 5; §13 testing → throughout.

Deliberately **not** in this plan, and each has a home: the domain model and the event log (Plan 2), fix acquisition and averaging (Plan 2), the capture screen and traffic-light frame (Plan 2), media (Plan 3), the launcher and Inbox (Plan 4), export (Plan 5), `SplitPane` and tablet layouts (Plan 6), voice mode (Plan 7).

**Two spec refinements made here, both recorded in the tasks:**

1. §7's "short label derived automatically when blank" is implemented as a fallback to the full name with middle truncation, rather than a shortening heuristic. Recorded in Task 9.
2. §5.5's density setting moves to Plan 6, because it can only be judged with a stylus on the tablet.

**Type consistency.** `SizeClass`, `Handedness`, `Reach`, `Theme`, `ThemeName`, `SemanticColors`, `FixQuality`, `ContextStampProps`, `InputAffordanceKind`, `ButtonKind` and `TypeVariant` are each defined once and referenced by the same name throughout. `resolveDisplayName` and `resolveReach` keep their signatures across tasks.

---

## What "done" looks like

An application that boots on the S25 and shows every component in the library, in both
themes, with the real logo, correct size-class reporting, and three visually distinct fix
classes that survive a greyscale screen. Three architectural constraints enforced by lint
rather than by discipline. Forty-seven tests passing. A doctrine document that the next plan
extends rather than reinvents.
