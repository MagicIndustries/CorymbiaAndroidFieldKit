import React from 'react'
import { render } from '@testing-library/react-native'
import { ramp } from '@corymbia/tokens'
import { CorymbiaMark, BRAND_GRADIENT_STOPS } from '../index'

describe('CorymbiaMark', () => {
  it('renders at the requested size', async () => {
    const { getByTestId } = await render(<CorymbiaMark size={40} />)
    const svg = getByTestId('corymbia-mark')
    expect(svg.props.width).toBe(40)
  })

  // The rendered height must preserve the viewBox's own aspect ratio, or the mark
  // renders squashed/stretched — the most visible possible defect in this package,
  // and one no other assertion here would catch.
  it('scales height to match the tight viewBox aspect ratio, so the mark is not squashed', async () => {
    const { getByTestId } = await render(<CorymbiaMark size={40} />)
    expect(getByTestId('corymbia-mark').props.height).toBeCloseTo((40 * 1205) / 660)
  })

  it('scales height to match the square viewBox aspect ratio, so the icon is not stretched', async () => {
    const { getByTestId } = await render(<CorymbiaMark size={40} crop="square" />)
    expect(getByTestId('corymbia-mark').props.height).toBe(40)
  })

  // react-native-svg parses the `viewBox` string prop into minX/minY/vbWidth/vbHeight
  // before it reaches the underlying host component, so the literal string is not
  // observable on the node `getByTestId` returns — assert on the parsed values instead.
  it('uses the tight crop by default, for the app bar', async () => {
    const { getByTestId } = await render(<CorymbiaMark />)
    expect(getByTestId('corymbia-mark').props).toMatchObject({
      minX: 405,
      minY: 165,
      vbWidth: 660,
      vbHeight: 1205,
    })
  })

  it('uses the square crop when asked, for the launcher icon', async () => {
    const { getByTestId } = await render(<CorymbiaMark crop="square" />)
    expect(getByTestId('corymbia-mark').props).toMatchObject({
      minX: 0,
      minY: 0,
      vbWidth: 1500,
      vbHeight: 1500,
    })
  })

  it('takes its gradient colours from the tokens, so artwork and theme cannot drift', () => {
    expect(BRAND_GRADIENT_STOPS.map((s) => s.color)).toEqual([...ramp.brandGradient])
  })

  it('places the five stops at the offsets from the source artwork', () => {
    expect(BRAND_GRADIENT_STOPS.map((s) => s.offset)).toEqual([
      '0',
      '0.1666',
      '0.4994',
      '0.9638',
      '1',
    ])
  })

  it('is labelled for screen readers and for the voiced mode to come', async () => {
    const { getByLabelText } = await render(<CorymbiaMark />)
    expect(getByLabelText('Corymbia')).toBeTruthy()
  })
})
