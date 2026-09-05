import React from 'react'
import { render, screen } from '@testing-library/react-native'
import { darkTheme } from '@corymbia/tokens'
import { ThemeProvider } from '../../theme'
import { Type } from '../Type'

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>)

describe('Type', () => {
  it('renders body text in the primary colour by default', async () => {
    await wrap(<Type testID="t">Hello</Type>)
    expect(screen.getByTestId('t').props.style).toEqual(
      expect.objectContaining({ fontSize: 14, color: darkTheme.colors.textPrimary }),
    )
  })

  it('renders dim text in the dim colour', async () => {
    await wrap(
      <Type testID="t" dim>
        Hello
      </Type>,
    )
    expect(screen.getByTestId('t').props.style).toEqual(
      expect.objectContaining({ color: darkTheme.colors.textDim }),
    )
  })

  it('applies the requested variant from the type scale', async () => {
    await wrap(
      <Type testID="t" variant="hero">
        4
      </Type>,
    )
    expect(screen.getByTestId('t').props.style).toEqual(
      expect.objectContaining({ fontSize: 62, fontWeight: '800' }),
    )
  })
})
