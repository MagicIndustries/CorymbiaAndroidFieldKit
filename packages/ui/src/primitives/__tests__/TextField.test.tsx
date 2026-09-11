import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react-native'
import { ThemeProvider } from '../../theme'
import { TextField } from '../TextField'

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>)

describe('TextField', () => {
  it('renders its label above the input', async () => {
    await wrap(<TextField label="NAME" value="" onChangeText={() => {}} testID="f" />)
    expect(screen.getByText('NAME')).toBeTruthy()
  })

  it('meets the 48dp minimum touch target', async () => {
    await wrap(<TextField label="NAME" value="" onChangeText={() => {}} testID="f" />)
    expect(screen.getByTestId('f').props.style).toEqual(expect.objectContaining({ minHeight: 48 }))
  })

  it('forwards what she types', async () => {
    const onChangeText = jest.fn()
    await wrap(<TextField label="NAME" value="" onChangeText={onChangeText} testID="f" />)
    await fireEvent.changeText(screen.getByTestId('f'), 'Reach 4 transect')
    expect(onChangeText).toHaveBeenCalledWith('Reach 4 transect')
  })

  it('shows the value it is given', async () => {
    await wrap(
      <TextField label="NAME" value="Tambo River eDNA" onChangeText={() => {}} testID="f" />,
    )
    expect(screen.getByTestId('f').props.value).toBe('Tambo River eDNA')
  })

  it('gives a multiline field the taller box, with the text starting at the top', async () => {
    await wrap(<TextField label="NOTES" value="" onChangeText={() => {}} multiline testID="f" />)
    const input = screen.getByTestId('f')
    expect(input.props.multiline).toBe(true)
    expect(input.props.style).toEqual(
      expect.objectContaining({ minHeight: 72, textAlignVertical: 'top' }),
    )
  })

  it('leaves a single-line field alone', async () => {
    await wrap(<TextField label="NAME" value="" onChangeText={() => {}} testID="f" />)
    expect(screen.getByTestId('f').props.style).not.toEqual(
      expect.objectContaining({ textAlignVertical: 'top' }),
    )
  })

  it('raises the ordinary keyboard unless asked for another', async () => {
    await wrap(<TextField label="NAME" value="" onChangeText={() => {}} testID="f" />)
    expect(screen.getByTestId('f').props.keyboardType).toBe('default')
  })

  it('raises a number pad for a field that can only hold digits', async () => {
    await wrap(
      <TextField
        label="POSITION"
        value=""
        onChangeText={() => {}}
        keyboardType="number-pad"
        testID="f"
      />,
    )
    expect(screen.getByTestId('f').props.keyboardType).toBe('number-pad')
  })

  it('is typeable unless it is told otherwise', async () => {
    await wrap(<TextField label="NAME" value="" onChangeText={() => {}} testID="f" />)
    const input = screen.getByTestId('f')
    expect(input.props.editable).toBe(true)
    expect(input.props.accessibilityState).toEqual(expect.objectContaining({ disabled: false }))
  })

  it('refuses the keyboard when it is not ready to be typed into', async () => {
    // Doctrine rule 18: a box that looks typeable and discards what she types
    // is worse than one that plainly is not. Two channels under rule 9 — the
    // spoken state and the dimming — not dimness alone.
    await wrap(<TextField label="POSITION" value="" onChangeText={() => {}} disabled testID="f" />)
    const input = screen.getByTestId('f')
    expect(input.props.editable).toBe(false)
    expect(input.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }))
    expect(input.props.style).toEqual(expect.objectContaining({ opacity: 0.35 }))
  })

  it('carries the spoken name it is given, distinct from the label', async () => {
    await wrap(
      <TextField
        label="NAME"
        accessibilityLabel="Activity name"
        value=""
        onChangeText={() => {}}
        testID="f"
      />,
    )
    expect(screen.getByTestId('f').props.accessibilityLabel).toBe('Activity name')
  })
})
