import React from 'react'
import { render, screen } from '@testing-library/react-native'
import { darkTheme } from '@corymbia/tokens'
import { ThemeProvider } from '../../theme'
import { ContextStamp, composeContextStampSpokenLabel } from '../ContextStamp'

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>)

// `toHaveTextContent` in @testing-library/react-native v14 defaults to an
// EXACT match (`exact: true` — see node_modules/@testing-library/react-native/
// dist/matches.js), unlike jest-dom's always-substring behaviour the brief's
// test code assumed. The brief also asserts two different substrings against
// the same node (e.g. both '±38 m' and '4 min old' on one ambient chip),
// which cannot both be true under exact equality. `{ exact: false }` is used
// only where it's genuinely needed: the icon-prefixed fix and device chips
// (`◎ ±4 m`, `~ ±38 m · 4 min old`, `⚑ no position`, `▣ field-s24`) and the
// negative "does not contain" assertions. The place and activity chips have
// no prefix and a fully known rendered string, so those assertions match
// exactly — an accidental prefix or suffix on them will now fail the test.
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
    expect(screen.getByTestId('place-chip')).toHaveTextContent('120 m from Nth Reach')
  })

  it('omits the distance when standing at the place', async () => {
    await wrap(<ContextStamp fix={{ quality: 'deliberate', accuracyM: 4 }} place={{ name: 'Nth Reach' }} />)
    expect(screen.getByTestId('place-chip')).toHaveTextContent('Nth Reach')
  })

  // `distanceM: 0` is a legitimate reading (standing right at the place's
  // marker) and must render distinctly from "no distance known" (`undefined`,
  // covered above). The component checks `=== undefined` rather than
  // truthiness specifically so this case renders "0 m from X" rather than
  // silently falling back to the bare place name — pin that here so a future
  // refactor to `if (place.distanceM)` regresses loudly.
  it('renders a zero distance rather than treating it as absent', async () => {
    await wrap(
      <ContextStamp
        fix={{ quality: 'deliberate', accuracyM: 4 }}
        place={{ name: 'Nth Reach', distanceM: 0 }}
      />,
    )
    expect(screen.getByTestId('place-chip')).toHaveTextContent('0 m from Nth Reach')
  })

  it('distinguishes an activity it was filed to from one it merely happened during', async () => {
    const { rerender } = await wrap(
      <ContextStamp
        fix={{ quality: 'deliberate', accuracyM: 4 }}
        activity={{ name: 'Survey 3', wasFiled: true }}
      />,
    )
    expect(screen.getByTestId('activity-chip')).toHaveTextContent('Survey 3')
    expect(screen.getByTestId('activity-chip')).not.toHaveTextContent('during', { exact: false })

    await rerender(
      <ThemeProvider>
        <ContextStamp
          fix={{ quality: 'ambient', accuracyM: 38, ageMinutes: 4 }}
          activity={{ name: 'Survey 3', wasFiled: false }}
        />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('activity-chip')).toHaveTextContent('during Survey 3')
  })

  it('shows the device, since the user works across a tablet and a phone', async () => {
    await wrap(<ContextStamp fix={{ quality: 'none' }} device="field-s24" />)
    expect(screen.getByTestId('device-chip')).toHaveTextContent('field-s24', { exact: false })
  })

  it('renders no place, device, or activity chip when each is absent', async () => {
    await wrap(<ContextStamp fix={{ quality: 'none' }} device={null} activity={null} />)
    expect(screen.queryByTestId('place-chip')).toBeNull()
    expect(screen.queryByTestId('device-chip')).toBeNull()
    expect(screen.queryByTestId('activity-chip')).toBeNull()
  })
})

// Doctrine rule 16, second half (final-review round b, Finding 5): the
// voiced mode needs one spoken sentence, not four glyph-prefixed chip
// fragments read aloud in sequence. These pin the exact wording — the
// wording IS the deliverable here, so every case asserts a literal string,
// not a substring or a "contains" check.
describe('composeContextStampSpokenLabel', () => {
  it('speaks a deliberate fix plainly, with activity and place composed — the spec\'s worked example', () => {
    // Exact sentence from the spec: "recorded during Survey 3, near Yarra
    // Flats — North Reach, 120 m away".
    expect(
      composeContextStampSpokenLabel({
        fix: { quality: 'deliberate', accuracyM: 4 },
        activity: { name: 'Survey 3', wasFiled: false },
        place: { name: 'Yarra Flats — North Reach', distanceM: 120 },
      }),
    ).toBe('recorded during Survey 3, near Yarra Flats — North Reach, 120 m away')
  })

  it('speaks an ambient fix with its approximate accuracy and age', () => {
    expect(
      composeContextStampSpokenLabel({
        fix: { quality: 'ambient', accuracyM: 38, ageMinutes: 4 },
      }),
    ).toBe('recorded approximately, accurate to about 38 metres, 4 minutes old')
  })

  it('speaks an ambient fix with unknown age by omitting it, rather than guessing', () => {
    expect(
      composeContextStampSpokenLabel({
        fix: { quality: 'ambient', accuracyM: 38 },
      }),
    ).toBe('recorded approximately, accurate to about 38 metres')
  })

  it('speaks a missing fix plainly, in words rather than silence', () => {
    expect(composeContextStampSpokenLabel({ fix: { quality: 'none' } })).toBe('no position recorded')
  })

  it('composes an activity filed to, a place, a device, and a fix together', () => {
    expect(
      composeContextStampSpokenLabel({
        fix: { quality: 'none' },
        activity: { name: 'Survey 3', wasFiled: true },
        place: { name: 'Nth Reach' },
        device: 'field-s24',
      }),
    ).toBe('no position recorded for Survey 3, near Nth Reach, on field-s24')
  })

  it('pluralises a single minute correctly', () => {
    expect(
      composeContextStampSpokenLabel({
        fix: { quality: 'ambient', accuracyM: 10, ageMinutes: 1 },
      }),
    ).toBe('recorded approximately, accurate to about 10 metres, 1 minute old')
  })
})

describe('ContextStamp accessibility label', () => {
  it('sets the composed sentence as the accessibility label on the outer, accessible node', async () => {
    await wrap(
      <ContextStamp
        testID="stamp"
        fix={{ quality: 'deliberate', accuracyM: 4 }}
        activity={{ name: 'Survey 3', wasFiled: false }}
        place={{ name: 'Yarra Flats — North Reach', distanceM: 120 }}
      />,
    )
    const stamp = screen.getByTestId('stamp')
    expect(stamp.props.accessible).toBe(true)
    expect(stamp.props.accessibilityLabel).toBe(
      'recorded during Survey 3, near Yarra Flats — North Reach, 120 m away',
    )
  })
})
