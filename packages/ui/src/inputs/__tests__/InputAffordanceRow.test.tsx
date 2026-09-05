import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react-native'
import { ThemeProvider } from '../../theme'
import { InputAffordanceRow, INPUT_AFFORDANCE_ORDER } from '../InputAffordanceRow'

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>)

describe('InputAffordanceRow', () => {
  it('declares the four affordances in one fixed order (doctrine rule 5)', () => {
    expect(INPUT_AFFORDANCE_ORDER).toEqual(['title', 'description', 'voice', 'photo'])
  })

  // `getAllByRole` walks the rendered host-node tree in the same pre-order
  // traversal react-test-renderer uses for the tree itself (see
  // node_modules/@testing-library/react-native/dist/helpers/find-all.js,
  // which calls `root.queryAll` with no subsequent sort) — it does not
  // reorder matches by role, name, or anything else. For a single row of
  // sibling Pressables that traversal order is document order, so this
  // assertion genuinely reads the rendered sequence rather than assuming it.
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
})
