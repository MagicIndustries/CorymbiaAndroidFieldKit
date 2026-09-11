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
