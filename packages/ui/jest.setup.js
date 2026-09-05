// @testing-library/react-native v14+ registers its Jest matchers (toHaveTextContent,
// etc.) as a side effect of importing anything from the package itself — see
// node_modules/@testing-library/react-native/dist/index.js, which requires
// './matchers/extend-expect'. Test files already import from '@testing-library/react-native',
// so no separate setup is needed here (the old top-level 'extend-expect' entry point
// this file used to require was removed in v14).

// @react-native/jest-preset unconditionally mocks useColorScheme() to return
// 'light' (see node_modules/@react-native/jest-preset/jest/mocks/useColorScheme.js),
// which never represents "the system reports no preference". That collides with
// ThemeProvider's documented default (spec §5.2: dark is the default when the OS
// has no preference) and makes it untestable. Re-mock it here to null so the
// default ("system", no OS preference) path is what tests exercise; an individual
// test can still jest.spyOn/mock it locally to simulate an explicit OS choice.
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => null),
}))

// `useLayout()` composes its result entirely from `useWindowDimensions()`,
// so its tests need to pin that hook to a specific device size and
// orientation per case rather than depend on whatever untouched, non-native
// `Dimensions` happens to report in the test environment. Mock it here,
// globally (mirroring the `useColorScheme` mock above), so `mockWindowDimensions()`
// (packages/ui/src/test-utils) can always assume it's already a jest.fn — the
// mock must be registered before `useLayout.ts` (or anything importing
// `react-native`) is first required, which `setupFilesAfterEnv` guarantees.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 412, height: 915, scale: 3, fontScale: 1 })),
}))
