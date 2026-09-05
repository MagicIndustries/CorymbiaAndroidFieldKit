import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react-native'
import { ThemeProvider } from '../../theme'
import { Button } from '../Button'

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>)

describe('Button', () => {
  it('meets the 48dp minimum touch target', async () => {
    await wrap(<Button label="Save" onPress={() => {}} testID="b" />)
    expect(screen.getByTestId('b').props.style).toEqual(
      expect.objectContaining({ minHeight: 48 }),
    )
  })

  it('uses the 72dp field size for field controls', async () => {
    await wrap(<Button label="Save now" size="field" onPress={() => {}} testID="b" />)
    expect(screen.getByTestId('b').props.style).toEqual(
      expect.objectContaining({ minHeight: 72 }),
    )
  })

  it('calls onPress', async () => {
    const onPress = jest.fn()
    await wrap(<Button label="Save" onPress={onPress} testID="b" />)
    await fireEvent.press(screen.getByTestId('b'))
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('does not call onPress when disabled', async () => {
    const onPress = jest.fn()
    await wrap(<Button label="Save" onPress={onPress} disabled testID="b" />)
    await fireEvent.press(screen.getByTestId('b'))
    expect(onPress).not.toHaveBeenCalled()
  })

  it('exposes a spoken label that defaults to the visible label', async () => {
    await wrap(<Button label="Save now" onPress={() => {}} testID="b" />)
    expect(screen.getByTestId('b').props.accessibilityLabel).toBe('Save now')
  })

  it('allows the spoken label to differ from the visible one', async () => {
    await wrap(
      <Button label="⚡ SAVE NOW" spokenLabel="Save now" onPress={() => {}} testID="b" />,
    )
    expect(screen.getByTestId('b').props.accessibilityLabel).toBe('Save now')
  })

  it('announces a disabled button as disabled', async () => {
    await wrap(<Button label="Save" onPress={() => {}} disabled testID="b" />)
    expect(screen.getByTestId('b').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    )
  })

  it('does not announce an enabled button as disabled', async () => {
    await wrap(<Button label="Save" onPress={() => {}} testID="b" />)
    expect(screen.getByTestId('b').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: false }),
    )
  })
})
