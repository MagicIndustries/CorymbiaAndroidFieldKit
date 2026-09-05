import React from 'react'
import { render, screen } from '@testing-library/react-native'
import { darkTheme } from '@corymbia/tokens'
import { ThemeProvider } from '../../theme'
import { ContextStamp } from '../ContextStamp'

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>)

// `toHaveTextContent` in @testing-library/react-native v14 defaults to an
// EXACT match (`exact: true` — see node_modules/@testing-library/react-native/
// dist/matches.js), unlike jest-dom's always-substring behaviour the brief's
// test code assumed. The brief also asserts two different substrings against
// the same node (e.g. both '±38 m' and '4 min old' on one ambient chip),
// which cannot both be true under exact equality. Every call below passes
// `{ exact: false }` to restore the intended substring/contains semantics.
describe('ContextStamp', () => {
  it('shows a deliberate fix with its accuracy and a solid border', async () => {
    await wrap(<ContextStamp fix={{ quality: 'deliberate', accuracyM: 4 }} />)
    expect(screen.getByTestId('fix-chip')).toHaveTextContent('±4 m', { exact: false })
    expect(screen.getByTestId('fix-chip-box').props.style).toEqual(
      expect.objectContaining({ borderStyle: 'solid', borderColor: darkTheme.colors.statusGood }),
    )
  })

  it('shows an ambient fix with its age and a dashed border', async () => {
    await wrap(<ContextStamp fix={{ quality: 'ambient', accuracyM: 38, ageMinutes: 4 }} />)
    expect(screen.getByTestId('fix-chip')).toHaveTextContent('±38 m', { exact: false })
    expect(screen.getByTestId('fix-chip')).toHaveTextContent('4 min old', { exact: false })
    expect(screen.getByTestId('fix-chip-box').props.style).toEqual(
      expect.objectContaining({ borderStyle: 'dashed', borderColor: darkTheme.colors.statusFair }),
    )
  })

  it('states plainly when there is no position rather than guessing', async () => {
    await wrap(<ContextStamp fix={{ quality: 'none' }} />)
    expect(screen.getByTestId('fix-chip')).toHaveTextContent('no position', { exact: false })
    expect(screen.getByTestId('fix-chip-box').props.style).toEqual(
      expect.objectContaining({ borderStyle: 'dashed', borderColor: darkTheme.colors.textDim }),
    )
  })

  it('never relies on colour alone — each quality carries distinct text', async () => {
    const { rerender } = await wrap(<ContextStamp fix={{ quality: 'deliberate', accuracyM: 4 }} />)
    const deliberate = screen.getByTestId('fix-chip').props.children
    await rerender(
      <ThemeProvider>
        <ContextStamp fix={{ quality: 'ambient', accuracyM: 4, ageMinutes: 2 }} />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('fix-chip').props.children).not.toEqual(deliberate)
  })

  // The brief's version of this test only compares `deliberate` against
  // `ambient` — a pair whose border STYLE already differs (solid vs
  // dashed, asserted above), so text differing too is not proof that
  // colour alone is never load-bearing. The doctrine's actual risk pair is
  // `ambient` and `none`: both render a DASHED border, so if their text
  // ever collapsed to the same wording, colour (amber vs grey) would be
  // the only thing telling them apart — exactly what rule 9 forbids. This
  // test pins the pair that can actually fail that way, with equal
  // accuracy readings so text differences can't be blamed on the numbers.
  it('never relies on colour alone — ambient and none share a dashed border but never share text', async () => {
    const { rerender } = await wrap(
      <ContextStamp fix={{ quality: 'ambient', accuracyM: 4, ageMinutes: 2 }} />,
    )
    const ambientBox = screen.getByTestId('fix-chip-box').props.style
    const ambientText = screen.getByTestId('fix-chip').props.children

    await rerender(
      <ThemeProvider>
        <ContextStamp fix={{ quality: 'none' }} />
      </ThemeProvider>,
    )
    const noneBox = screen.getByTestId('fix-chip-box').props.style
    const noneText = screen.getByTestId('fix-chip').props.children

    expect(ambientBox).toEqual(expect.objectContaining({ borderStyle: 'dashed' }))
    expect(noneBox).toEqual(expect.objectContaining({ borderStyle: 'dashed' }))
    expect(ambientBox.borderColor).not.toEqual(noneBox.borderColor)
    expect(noneText).not.toEqual(ambientText)
  })

  it('shows the nearest known place with its distance', async () => {
    await wrap(
      <ContextStamp
        fix={{ quality: 'ambient', accuracyM: 38, ageMinutes: 4 }}
        place={{ name: 'Nth Reach', distanceM: 120 }}
      />,
    )
    expect(screen.getByTestId('place-chip')).toHaveTextContent('120 m from Nth Reach', { exact: false })
  })

  it('omits the distance when standing at the place', async () => {
    await wrap(<ContextStamp fix={{ quality: 'deliberate', accuracyM: 4 }} place={{ name: 'Nth Reach' }} />)
    expect(screen.getByTestId('place-chip')).toHaveTextContent('Nth Reach', { exact: false })
    expect(screen.getByTestId('place-chip')).not.toHaveTextContent('from', { exact: false })
  })

  it('distinguishes an activity it was filed to from one it merely happened during', async () => {
    const { rerender } = await wrap(
      <ContextStamp
        fix={{ quality: 'deliberate', accuracyM: 4 }}
        activity={{ name: 'Survey 3', wasFiled: true }}
      />,
    )
    expect(screen.getByTestId('activity-chip')).toHaveTextContent('Survey 3', { exact: false })
    expect(screen.getByTestId('activity-chip')).not.toHaveTextContent('during', { exact: false })

    await rerender(
      <ThemeProvider>
        <ContextStamp
          fix={{ quality: 'ambient', accuracyM: 38, ageMinutes: 4 }}
          activity={{ name: 'Survey 3', wasFiled: false }}
        />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('activity-chip')).toHaveTextContent('during Survey 3', { exact: false })
  })

  it('shows the device, since the user works across a tablet and a phone', async () => {
    await wrap(<ContextStamp fix={{ quality: 'none' }} device="field-s24" />)
    expect(screen.getByTestId('device-chip')).toHaveTextContent('field-s24', { exact: false })
  })
})
