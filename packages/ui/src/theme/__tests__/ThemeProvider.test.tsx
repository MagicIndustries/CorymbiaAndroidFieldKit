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
  it('defaults to dark', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('name')).toHaveTextContent('dark')
  })

  it('honours an explicit initial theme', () => {
    render(
      <ThemeProvider initial="light">
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('name')).toHaveTextContent('light')
  })

  it('switches theme and changes the resolved surface colour', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    const darkSurface = screen.getByTestId('surface').props.children
    fireEvent.press(screen.getByTestId('toLight'))
    const lightSurface = screen.getByTestId('surface').props.children
    expect(lightSurface).not.toBe(darkSurface)
    expect(screen.getByTestId('name')).toHaveTextContent('light')
  })

  it('throws a useful error when used outside a provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/useTheme must be used within a ThemeProvider/)
    spy.mockRestore()
  })

  describe('follows the system setting when preference is "system"', () => {
    it('resolves to light when the OS reports light', () => {
      mockSystemColorScheme('light')
      render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      )
      expect(screen.getByTestId('name')).toHaveTextContent('light')
    })

    it('resolves to dark when the OS reports dark', () => {
      mockSystemColorScheme('dark')
      render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      )
      expect(screen.getByTestId('name')).toHaveTextContent('dark')
    })

    it('resolves to dark when the OS reports unspecified (the product default)', () => {
      mockSystemColorScheme('unspecified')
      render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      )
      expect(screen.getByTestId('name')).toHaveTextContent('dark')
    })
  })
})
