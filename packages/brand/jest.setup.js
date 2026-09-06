// @testing-library/react-native v14+ registers its Jest matchers (toHaveTextContent,
// etc.) as a side effect of importing anything from the package itself — see
// node_modules/@testing-library/react-native/dist/index.js, which requires
// './matchers/extend-expect'. Test files already import from '@testing-library/react-native',
// so no separate setup is needed here (the old top-level 'extend-expect' entry point
// this file used to require was removed in v14).
//
// Unlike packages/ui, this package's component (CorymbiaMark) does not read
// useColorScheme or useWindowDimensions, so it needs none of the hook mocks
// that packages/ui/jest.setup.js registers. This file exists only because
// jest.config.js (copied from packages/ui) points setupFilesAfterEnv at it.
