import { useWindowDimensions } from 'react-native'

const mockedUseWindowDimensions = jest.mocked(useWindowDimensions)

// Captures whatever jest.setup.js configured as the default return value so
// we can restore it after a test overrides it.
const defaultWindowDimensions = mockedUseWindowDimensions()

/**
 * Simulates what `useWindowDimensions()` reports for the current window, so
 * `useLayout()` can be tested against a specific device size and
 * orientation without a real window to measure.
 *
 * Mirrors `mockSystemColorScheme` for the same preset-mocking problem: the
 * override is automatically restored to the harness default after the test
 * that set it, so callers don't need to reset it themselves.
 */
export function mockWindowDimensions(width: number, height: number): void {
  mockedUseWindowDimensions.mockReturnValue({ width, height, scale: 1, fontScale: 1 })
}

afterEach(() => {
  mockedUseWindowDimensions.mockReturnValue(defaultWindowDimensions)
})
