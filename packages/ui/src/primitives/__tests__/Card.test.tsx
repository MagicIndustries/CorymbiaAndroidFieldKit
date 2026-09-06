import React from 'react'
import { Text } from 'react-native'
import { render, screen } from '@testing-library/react-native'
import { darkTheme, elevation } from '@corymbia/tokens'
import { ThemeProvider } from '../../theme'
import { Card } from '../Card'

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>)

describe('Card', () => {
  it('rests flush with the page by default', async () => {
    await wrap(
      <Card testID="c">
        <Text>Content</Text>
      </Card>,
    )
    expect(screen.getByTestId('c').props.style).toEqual(
      expect.objectContaining(elevation.resting),
    )
  })

  it('takes on the raised elevation level when raised', async () => {
    await wrap(
      <Card testID="c" raised>
        <Text>Content</Text>
      </Card>,
    )
    expect(screen.getByTestId('c').props.style).toEqual(
      expect.objectContaining(elevation.raised),
    )
  })

  it('reads its shadow colour from the theme, not a literal', async () => {
    await wrap(
      <Card testID="c" raised>
        <Text>Content</Text>
      </Card>,
    )
    expect(screen.getByTestId('c').props.style).toEqual(
      expect.objectContaining({ shadowColor: darkTheme.colors.overlay }),
    )
  })

  it('borders in the default colour when not accented', async () => {
    await wrap(
      <Card testID="c">
        <Text>Content</Text>
      </Card>,
    )
    expect(screen.getByTestId('c').props.style).toEqual(
      expect.objectContaining({ borderColor: darkTheme.colors.border }),
    )
  })

  it('borders in the accent colour when accented', async () => {
    await wrap(
      <Card testID="c" accent>
        <Text>Content</Text>
      </Card>,
    )
    expect(screen.getByTestId('c').props.style).toEqual(
      expect.objectContaining({ borderColor: darkTheme.colors.accent }),
    )
  })
})
