// Tests must import from specific modules (e.g. '../location/fake',
// '../classify'), never from the package barrel ('../index' or
// '@corymbia/geo'). The barrel statically re-exports the expo-location device
// adapter, and expo-location ships ESM that this plain config does not
// transform — importing the barrel from a test dies under Node with
// `SyntaxError: Unexpected token 'export'`. This is correct layering, not a
// workaround to route around: logic over the LocationSource port (e.g. the
// ambient cache) must not depend on the device adapter, so its tests
// shouldn't reach it either, even indirectly through the barrel.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
}
