// Tests import specific modules ('../naming', '../store/memory'), never the
// package barrel. The barrel statically re-exports the expo-file-system
// adapter, and expo-file-system ships ESM this plain config does not transform
// — importing the barrel from a test dies under Node with
// `SyntaxError: Unexpected token 'export'`. The same layering `packages/geo`
// keeps for the same reason: logic over the MediaStore port must not depend on
// the device adapter, so its tests must not reach it either.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
}
