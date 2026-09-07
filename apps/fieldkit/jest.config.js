// The app had no test harness until the diagnostics screen got one. `jest-expo`
// (the same preset packages/data and packages/ui use) is what makes the Expo
// module registry, the React Native preset and `babel-preset-expo` available;
// without it, `app/diagnostics.tsx` cannot even be parsed, let alone rendered.
//
// There is deliberately no babel.config.js in this workspace. jest-expo falls
// back to `expo/internal/babel-preset` when a project has none (see
// jest-expo/src/resolveBabelOptions.js), which is exactly the preset the real
// build uses — so the test harness needs no config file of its own, and adding
// one purely for Jest would put a file the native build also reads into the
// tree for a reason unrelated to the native build.
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testMatch: ['**/__tests__/**/*.test.tsx', '**/__tests__/**/*.test.ts'],
  // `android/` is generated, git-ignored, and full of JavaScript that belongs
  // to the native build rather than to this app's source.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/android/', '<rootDir>/.expo/'],
}
