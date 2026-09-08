import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react-native'
import { darkTheme, touch } from '@corymbia/tokens'
import { ThemeProvider } from '../../theme'
import { InputAffordanceRow, INPUT_AFFORDANCE_ORDER } from '../InputAffordanceRow'

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>)

describe('InputAffordanceRow', () => {
  it('declares the four affordances in one fixed order (doctrine rule 5)', () => {
    expect(INPUT_AFFORDANCE_ORDER).toEqual(['title', 'description', 'voice', 'photo'])
  })

  // `getAllByRole` walks the rendered host-node tree in the same pre-order
  // traversal `@testing-library/react-native`'s own `test-renderer` produces
  // for the tree (see node_modules/@testing-library/react-native/dist/helpers/
  // find-all.js, which calls `root.queryAll` with no subsequent sort) — it
  // does not reorder matches by role, name, or anything else. `test-renderer`
  // is a modern, actively maintained replacement for Facebook's deprecated
  // `react-test-renderer`, not that package itself, but it walks the tree the
  // same way. For a single row of sibling Pressables that traversal order is
  // document order, so this assertion genuinely reads the rendered sequence
  // rather than assuming it.
  it('renders them in that order', async () => {
    await wrap(<InputAffordanceRow onPress={() => {}} />)
    const rendered = screen
      .getAllByRole('button')
      .map((node) => node.props.testID.replace('affordance-', ''))
    expect(rendered).toEqual([...INPUT_AFFORDANCE_ORDER])
  })

  it('reports which affordance was tapped', async () => {
    const onPress = jest.fn()
    await wrap(<InputAffordanceRow onPress={onPress} />)
    await fireEvent.press(screen.getByTestId('affordance-voice'))
    expect(onPress).toHaveBeenCalledWith('voice')
  })

  it('marks completed affordances without removing them', async () => {
    await wrap(<InputAffordanceRow onPress={() => {}} completed={['title']} />)
    expect(screen.getByTestId('affordance-title').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    )
    expect(screen.getByTestId('affordance-photo').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false }),
    )
  })

  it('gives every affordance a speakable name', async () => {
    await wrap(<InputAffordanceRow onPress={() => {}} />)
    expect(screen.getByTestId('affordance-voice').props.accessibilityLabel).toBe(
      'Record a voice note',
    )
    expect(screen.getByTestId('affordance-photo').props.accessibilityLabel).toBe('Take a photo')
  })

  // Every tile sets `flex: 1` in a `flexDirection: 'row'` parent to divide
  // the available width evenly, and `minHeight: touch.comfortable` for the
  // vertical minimum. Asserted against the rendered element (not restated
  // as a literal), and against the token rather than the number `56`, so a
  // change to the token is caught here too.
  it('meets the minimum touch target', async () => {
    await wrap(<InputAffordanceRow onPress={() => {}} />)
    expect(screen.getByTestId('affordance-title').props.style).toEqual(
      expect.objectContaining({ minHeight: touch.comfortable, flex: 1 }),
    )
  })

  // Doctrine rule 9 (see ContextStamp): colour never carries meaning alone.
  // Modelled on ContextStamp's ambient-vs-none test: the SAME affordance
  // ('title') is rerendered from incomplete to completed, holding the kind
  // constant, so any difference can't be blamed on comparing two different
  // tiles. A regression that made `done` differ only by `borderColor` would
  // still pass every other test in this file — accessibilityState and
  // accessibilityLabel are untouched by this fix — so this test is the one
  // that actually catches it: it asserts the border STYLE and the visible
  // label wording, neither of which is a colour, both change too, in
  // addition to (not instead of) the colour change.
  it('never relies on colour alone — completion changes more than colour', async () => {
    const { rerender } = await wrap(<InputAffordanceRow onPress={() => {}} completed={[]} />)
    const incompleteStyle = screen.getByTestId('affordance-title').props.style
    const incompleteLabel = screen.getByTestId('affordance-title-label').props.children

    await rerender(
      <ThemeProvider>
        <InputAffordanceRow onPress={() => {}} completed={['title']} />
      </ThemeProvider>,
    )
    const completeStyle = screen.getByTestId('affordance-title').props.style
    const completeLabel = screen.getByTestId('affordance-title-label').props.children

    expect(incompleteStyle.borderColor).toBe(darkTheme.colors.border)
    expect(completeStyle.borderColor).toBe(darkTheme.colors.accent)
    expect(completeStyle.borderColor).not.toEqual(incompleteStyle.borderColor)

    expect(completeStyle.borderStyle).not.toEqual(incompleteStyle.borderStyle)
    expect(completeLabel).not.toEqual(incompleteLabel)
  })

  it('shows how many of a kind are attached, not merely that some are', async () => {
    // Two different, non-zero counts on two different kinds in the same
    // render: a hardcoded `· 4` (or any other single literal) that ignores
    // the `count` prop can satisfy at most one of these two assertions, so
    // this bounds the same hardcoding risk finding 1's fix left open.
    await wrap(<InputAffordanceRow onPress={() => {}} counts={{ photo: 4, voice: 2 }} />)
    // `toHaveTextContent` defaults to an EXACT match in this RNTL version
    // (see the comment atop ContextStamp.test.tsx) — the label is
    // `Photo · 4`, not the bare digit, so this is a substring check.
    expect(screen.getByTestId('affordance-photo-label')).toHaveTextContent('4', { exact: false })
    expect(screen.getByTestId('affordance-voice-label')).toHaveTextContent('2', { exact: false })
  })

  it('says done without a number for a kind that can only happen once', async () => {
    // A record has one title. "Title · 1" is noise.
    await wrap(<InputAffordanceRow onPress={() => {}} completed={['title']} />)
    // `toHaveTextContent` defaults to an EXACT whole-string match in this RNTL
    // version (see the comment atop ContextStamp.test.tsx and the comment on
    // the sibling assertion above). Without `{ exact: false }`, `.not.toHaveTextContent('1')`
    // only fails if the label were the single character "1" — never true,
    // since the label always carries the kind name — so it cannot catch the
    // regression it is named for. `{ exact: false }` makes it a substring
    // check, which does catch it.
    expect(screen.getByTestId('affordance-title-label')).not.toHaveTextContent('1', {
      exact: false,
    })
  })

  it('refuses a second press while a kind is busy', async () => {
    // Saving a photo writes a file and a row. A second tap during that write is
    // a second attachment she did not ask for.
    const onPress = jest.fn()
    await wrap(<InputAffordanceRow onPress={onPress} busy={['photo']} />)
    await fireEvent.press(screen.getByTestId('affordance-photo'))
    expect(onPress).not.toHaveBeenCalled()
  })

  it('marks a busy affordance disabled to a screen reader, not merely dim', async () => {
    await wrap(<InputAffordanceRow onPress={() => {}} busy={['photo']} />)
    expect(screen.getByTestId('affordance-photo').props.accessibilityState.disabled).toBe(true)
  })

  it('leaves the other affordances live while one is busy', async () => {
    const onPress = jest.fn()
    await wrap(<InputAffordanceRow onPress={onPress} busy={['photo']} />)
    await fireEvent.press(screen.getByTestId('affordance-voice'))
    expect(onPress).toHaveBeenCalledWith('voice')
  })

  // Doctrine rule 9: `opacity: 0.6` is one visual channel, and the one most
  // likely to wash out in field glare. Modelled on the colour-alone test
  // above: the SAME tile ('photo') is rerendered from idle to busy, holding
  // the kind constant, so the difference can't be blamed on comparing two
  // different tiles.
  it('gives busy a word, not merely a dimmer look', async () => {
    const { rerender } = await wrap(<InputAffordanceRow onPress={() => {}} busy={[]} />)
    const idleLabel = screen.getByTestId('affordance-photo-label').props.children

    await rerender(
      <ThemeProvider>
        <InputAffordanceRow onPress={() => {}} busy={['photo']} />
      </ThemeProvider>,
    )
    const busyLabel = screen.getByTestId('affordance-photo-label').props.children

    expect(busyLabel).not.toEqual(idleLabel)
    expect(screen.getByTestId('affordance-photo-label')).toHaveTextContent('Saving', {
      exact: false,
    })
  })

  it('tells a screen-reader user a save is in flight, not merely disabled', async () => {
    await wrap(<InputAffordanceRow onPress={() => {}} busy={['photo']} />)
    expect(screen.getByTestId('affordance-photo').props.accessibilityLabel).toEqual(
      expect.stringContaining('saving'),
    )
  })

  it('tells a screen-reader user how many of a kind are already attached', async () => {
    await wrap(<InputAffordanceRow onPress={() => {}} counts={{ photo: 3 }} />)
    expect(screen.getByTestId('affordance-photo').props.accessibilityLabel).toEqual(
      expect.stringContaining('3'),
    )
  })
})
