import { useColorScheme, type ColorSchemeName } from 'react-native'

const mockedUseColorScheme = jest.mocked(useColorScheme)

// Captures whatever jest.setup.js configured as the default return value
// (currently `null`) so we can restore it after a test overrides it.
const defaultSystemColorScheme = mockedUseColorScheme()

/**
 * Simulates what the OS reports through `useColorScheme()`.
 *
 * `@react-native/jest-preset` (pulled in by `jest-expo`) hard-mocks
 * `useColorScheme()` to always return `'light'`, and `jest.setup.js`
 * re-mocks it again, globally, to `null` so the product's "no system
 * preference falls back to dark" default is reachable at all under the
 * preset. Neither of those global mocks can be produced by rendering
 * differently — a test that wants to simulate an explicit OS preference
 * (including the real-world "no preference" value, `'unspecified'`) has to
 * reach into that same mock and change what it returns.
 *
 * This is that mechanism, factored out so every test of `useTheme` — and
 * every future test of a component that reads the system colour scheme —
 * can reuse it instead of rediscovering `jest.mocked(useColorScheme)` from
 * scratch. The override is automatically restored to the harness default
 * after the test that set it, so callers don't need to reset it themselves.
 */
export function mockSystemColorScheme(scheme: ColorSchemeName): void {
  mockedUseColorScheme.mockReturnValue(scheme)
}

afterEach(() => {
  mockedUseColorScheme.mockReturnValue(defaultSystemColorScheme)
})
