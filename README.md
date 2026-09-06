# Corymbia Field Kit

Offline-first Android field-data app for eDNA sample collection, built as a pnpm/Turborepo
monorepo on Expo + React Native.

## Toolchain

- Node: v22.12.0
- pnpm: 9.12.0 (pinned via `packageManager` in the root `package.json`)
- Expo SDK: `~57.0.20` (resolved into `apps/fieldkit/package.json` by `create-expo-app`)
- React: `19.2.3`
- React Native: `0.86.3`
- react-test-renderer: not yet pinned — no test runner has been wired into
  `apps/fieldkit` yet. When one is added, pin `react-test-renderer` to `19.2.3` to match
  the `react` version above; a mismatch causes a duplicate-React runtime error.

These are the exact versions Expo resolved when `apps/fieldkit` was scaffolded. Every later
package that depends on React or React Native must match these versions exactly, or React
Native fails at runtime with a duplicate-React error.
