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
