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
})
