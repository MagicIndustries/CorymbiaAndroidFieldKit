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

  // Finding 4 (final-review round b): the `mono` variant exists so live GPS
  // coordinates don't visually jitter as digits update — that only works if
  // it actually renders in a monospace face. Pinning the literal family name
  // here means a future edit that quietly drops it (e.g. "simplifying" the
  // token) fails this test instead of shipping a proportional font.
  it('renders the mono variant in a monospace font, so live GPS digits do not jitter', async () => {
    await wrap(
      <Type testID="t" variant="mono">
        -37.8136, 144.9631
      </Type>,
    )
    expect(screen.getByTestId('t').props.style).toEqual(
      expect.objectContaining({ fontFamily: 'monospace' }),
    )
  })

  it('does not force a font family on other variants', async () => {
    await wrap(
      <Type testID="t" variant="body">
        Hello
      </Type>,
    )
    expect(screen.getByTestId('t').props.style.fontFamily).toBeUndefined()
  })
})
