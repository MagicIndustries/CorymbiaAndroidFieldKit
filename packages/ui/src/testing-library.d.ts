// Pulls in the jest.Matchers global augmentation (toHaveTextContent, etc.) from
// @testing-library/react-native/extend-expect. jest.setup.js requires this at
// runtime for setupFilesAfterEnv, but tsc only sees ambient types reachable from
// something under `include`, so this file exists purely to surface the types.
import '@testing-library/react-native/extend-expect'
