import React from 'react'
import { Text, Pressable } from 'react-native'
import { render, screen, fireEvent } from '@testing-library/react-native'
import { ThemeProvider, useTheme } from '../index'
import { mockSystemColorScheme } from '../../test-utils'

function Probe() {
  const { theme, name, setTheme } = useTheme()
  return (
    <>
      <Text testID="name">{name}</Text>
      <Text testID="surface">{theme.colors.surface}</Text>
      <Pressable testID="toLight" onPress={() => setTheme('light')}>
        <Text>light</Text>
      </Pressable>
    </>
  )
}

describe('ThemeProvider', () => {
  it('defaults to dark', async () => {
    await render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('name')).toHaveTextContent('dark')
  })

  it('honours an explicit initial theme', async () => {
    await render(
      <ThemeProvider initial="light">
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('name')).toHaveTextContent('light')
  })

  it('switches theme and changes the resolved surface colour', async () => {
    await render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    const darkSurface = screen.getByTestId('surface').props.children
    await fireEvent.press(screen.getByTestId('toLight'))
    const lightSurface = screen.getByTestId('surface').props.children
    expect(lightSurface).not.toBe(darkSurface)
    expect(screen.getByTestId('name')).toHaveTextContent('light')
  })

  it('throws a useful error when used outside a provider', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    // render() is async in @testing-library/react-native v14+, so a synchronous
    // render-phase throw surfaces as a rejected promise, not a thrown call.
    await expect(render(<Probe />)).rejects.toThrow(/useTheme must be used within a ThemeProvider/)
    spy.mockRestore()
  })

  describe('follows the system setting when preference is "system"', () => {
    it('resolves to light when the OS reports light', async () => {
      mockSystemColorScheme('light')
      await render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      )
      expect(screen.getByTestId('name')).toHaveTextContent('light')
    })

    it('resolves to dark when the OS reports dark', async () => {
      mockSystemColorScheme('dark')
      await render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      )
      expect(screen.getByTestId('name')).toHaveTextContent('dark')
    })

    it('resolves to dark when the OS reports unspecified (the product default)', async () => {
      mockSystemColorScheme('unspecified')
      await render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      )
      expect(screen.getByTestId('name')).toHaveTextContent('dark')
    })
  })
})
