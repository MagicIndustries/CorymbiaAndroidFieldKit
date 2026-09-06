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

  // Doctrine rule 16 (final-review round b, Finding 5): a screen carries a
  // spoken description via an accessible node, not by making the whole
  // screen container `accessible` (which would swallow every child into one
  // opaque focus stop instead of letting a screen reader traverse it).
  it('carries a spoken description as an accessibility label, without swallowing its children', async () => {
    await wrap(
      <Screen testID="s" spokenDescription="Capture screen for Survey 3">
        <Text testID="content">Content</Text>
      </Screen>,
    )
    const description = screen.getByTestId('s-spoken-description')
    expect(description.props.accessible).toBe(true)
    expect(description.props.accessibilityLabel).toBe('Capture screen for Survey 3')
    // The real content is still present and independently reachable.
    expect(screen.getByTestId('content')).toBeTruthy()
  })

  it('renders no spoken-description node when none is given', async () => {
    await wrap(
      <Screen testID="s">
        <Text>Content</Text>
      </Screen>,
    )
    expect(screen.queryByTestId('s-spoken-description')).toBeNull()
  })
})
