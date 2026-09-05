import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react-native'
import { ThemeProvider } from '../../theme'
import { HelpAffordance } from '../HelpAffordance'

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>)

describe('HelpAffordance', () => {
  it('meets the minimum touch target', async () => {
    await wrap(<HelpAffordance title="Accuracy" body="How close the fix is." testID="h" />)
    expect(screen.getByTestId('h').props.style).toEqual(
      expect.objectContaining({ minHeight: 48, minWidth: 48 }),
    )
  })

  it('is hidden until tapped, then shows the explanation', async () => {
    await wrap(<HelpAffordance title="Accuracy" body="How close the fix is." testID="h" />)
    expect(screen.queryByText('How close the fix is.')).toBeNull()
    await fireEvent.press(screen.getByTestId('h'))
    expect(screen.getByText('How close the fix is.')).toBeTruthy()
  })

  // Point 2 of the review: a modal that renders its body eagerly (and only
  // hides it visually) would leak the help text into screen readers and,
  // later, into the voiced mode — even while visibly "closed". This checks
  // the reverse direction the brief's test didn't: dismissing the modal must
  // remove the explanation from the tree again, not just hide it, and the
  // affordance must be re-openable afterwards.
  it('removes the explanation from the tree again once dismissed, and can be reopened', async () => {
    await wrap(<HelpAffordance title="Accuracy" body="How close the fix is." testID="h" />)

    await fireEvent.press(screen.getByTestId('h'))
    expect(screen.getByText('How close the fix is.')).toBeTruthy()

    await fireEvent.press(screen.getByText('Got it'))
    expect(screen.queryByText('How close the fix is.')).toBeNull()

    await fireEvent.press(screen.getByTestId('h'))
    expect(screen.getByText('How close the fix is.')).toBeTruthy()
  })

  it('names what it explains, for screen readers and the voiced mode', async () => {
    await wrap(<HelpAffordance title="Accuracy" body="How close the fix is." testID="h" />)
    expect(screen.getByTestId('h').props.accessibilityLabel).toBe('Help with Accuracy')
  })
})
