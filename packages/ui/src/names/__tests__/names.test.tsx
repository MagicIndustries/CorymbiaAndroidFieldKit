import React from 'react'
import { render, screen } from '@testing-library/react-native'
import { ThemeProvider } from '../../theme'
import { ProjectName } from '../ProjectName'
import { NameChip } from '../NameChip'

const LONG = 'Yarra Flats Riparian Restoration — North Reach Stage 2'
const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>)

// A project record as it comes off the data model: `name` plus an optional
// `shortLabel`. `ProjectNameProps` deliberately does not declare
// `shortLabel` (Finding 1), so this is passed via spread, not as a named
// JSX attribute — spreading is exactly the convenience the type omission
// preserves.
const project = { name: LONG, shortLabel: 'Yarra Nth 2' }

describe('ProjectName', () => {
  it('clamps to two lines so the card never grows (doctrine rule 10)', async () => {
    await wrap(<ProjectName name={LONG} testID="n" />)
    expect(screen.getByTestId('n').props.numberOfLines).toBe(2)
  })

  it('clips at the tail for hero text, which reads as prose', async () => {
    await wrap(<ProjectName name={LONG} testID="n" />)
    expect(screen.getByTestId('n').props.ellipsizeMode).toBe('tail')
  })

  it('shows the full name, not the short label — the hero has room', async () => {
    // Spread, not a named `shortLabel` attribute: `ProjectNameProps` has no
    // `shortLabel` field, so a caller passing a whole project record still
    // compiles via spread while the component simply ignores the field.
    await wrap(<ProjectName {...project} testID="n" />)
    expect(screen.getByTestId('n')).toHaveTextContent(LONG)
  })
})

describe('NameChip', () => {
  it('truncates in the middle so the distinguishing tail survives (doctrine rule 11)', async () => {
    await wrap(<NameChip name={LONG} testID="c" />)
    expect(screen.getByTestId('c').props.ellipsizeMode).toBe('middle')
  })

  it('stays on one line', async () => {
    await wrap(<NameChip name={LONG} testID="c" />)
    expect(screen.getByTestId('c').props.numberOfLines).toBe(1)
  })

  it('prefers the short label when set (doctrine rule 12)', async () => {
    await wrap(<NameChip name={LONG} shortLabel="Yarra Nth 2" testID="c" />)
    expect(screen.getByTestId('c')).toHaveTextContent('Yarra Nth 2')
  })

  it('always speaks the full name even when the label is shortened', async () => {
    await wrap(<NameChip name={LONG} shortLabel="Yarra Nth 2" testID="c" />)
    expect(screen.getByTestId('c').props.accessibilityLabel).toBe(LONG)
  })
})
