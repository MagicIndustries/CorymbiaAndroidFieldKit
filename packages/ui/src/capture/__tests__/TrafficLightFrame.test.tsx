import React from 'react'
import { Text } from 'react-native'
import { render, screen } from '@testing-library/react-native'
import { darkTheme } from '@corymbia/tokens'
import { ThemeProvider } from '../../theme'
import { TrafficLightFrame } from '../TrafficLightFrame'

// render() is async in @testing-library/react-native v14+ (see
// ../../theme/__tests__/ThemeProvider.test.tsx), so every call site awaits it.
const renderFrame = (grade: 'good' | 'fair' | 'poor') =>
  render(
    <ThemeProvider>
      <TrafficLightFrame grade={grade}>
        <Text>contents</Text>
      </TrafficLightFrame>
    </ThemeProvider>,
  )

describe('TrafficLightFrame', () => {
  it('says the grade in a word, so colour never carries it alone', async () => {
    await renderFrame('good')
    expect(screen.getByText('GOOD FIX')).toBeTruthy()
  })

  it('says the other two grades too', async () => {
    await renderFrame('fair')
    expect(screen.getByText('FAIR FIX')).toBeTruthy()
  })

  it('says the poor grade too', async () => {
    await renderFrame('poor')
    expect(screen.getByText('POOR FIX')).toBeTruthy()
  })

  it('renders what it encloses, because the frame is a container not a widget', async () => {
    await renderFrame('good')
    expect(screen.getByText('contents')).toBeTruthy()
  })

  it('borders in the status colour for the grade', async () => {
    await renderFrame('good')
    expect(screen.getByTestId('traffic-light-border').props.style).toEqual(
      expect.objectContaining({ borderColor: darkTheme.colors.statusGood }),
    )
  })

  it('dashes the border when the fix is poor, so the grade survives greyscale', async () => {
    await renderFrame('poor')
    expect(screen.getByTestId('traffic-light-border').props.style).toEqual(
      expect.objectContaining({ borderStyle: 'dashed', borderColor: darkTheme.colors.statusPoor }),
    )
  })

  it('does not dash the border for a good fix', async () => {
    await renderFrame('good')
    expect(screen.getByTestId('traffic-light-border').props.style).toEqual(
      expect.objectContaining({ borderStyle: 'solid' }),
    )
  })
})
