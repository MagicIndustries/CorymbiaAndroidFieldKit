import React from 'react'
import { Text } from 'react-native'
import { render, screen } from '@testing-library/react-native'
import { darkTheme, spacing } from '@corymbia/tokens'
import { ThemeProvider } from '../../theme'
import { Screen } from '../Screen'

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>)

describe('Screen', () => {
  it('pads with the large spacing token by default', async () => {
    await wrap(
      <Screen testID="s">
        <Text>Content</Text>
      </Screen>,
    )
    expect(screen.getByTestId('s').props.style).toEqual(
      expect.objectContaining({ padding: spacing.lg }),
    )
  })

  it('removes padding when not padded', async () => {
    await wrap(
      <Screen testID="s" padded={false}>
        <Text>Content</Text>
      </Screen>,
    )
    expect(screen.getByTestId('s').props.style).toEqual(
      expect.objectContaining({ padding: 0 }),
    )
  })

  it('fills the surface with the themed background colour', async () => {
    await wrap(
      <Screen testID="s">
        <Text>Content</Text>
      </Screen>,
    )
    expect(screen.getByTestId('s').props.style).toEqual(
      expect.objectContaining({ backgroundColor: darkTheme.colors.surface }),
    )
  })
})
