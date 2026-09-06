import React from 'react'
import { render } from '@testing-library/react-native'
import { ramp } from '@corymbia/tokens'
import { CorymbiaMark, BRAND_GRADIENT_STOPS } from '../index'

// Measured fact, not a guess: rasterised design/logo/logo.svg at 1500x1500 and found the
// non-transparent bounding box of the drawn artwork (path + spore circles) at these pixel
// coordinates, in the SVG's own 0..1500 coordinate space.
const MEASURED_ARTWORK_BOUNDS = { minX: 420, maxX: 1080, minY: 2, maxY: 1498 } as const

describe('CorymbiaMark', () => {
  it('renders at the requested height', async () => {
    const { getByTestId } = await render(<CorymbiaMark height={40} />)
    const svg = getByTestId('corymbia-mark')
    expect(svg.props.height).toBe(40)
  })

  // The rendered width must preserve the viewBox's own aspect ratio, or the mark
  // renders squashed/stretched — the most visible possible defect in this package,
  // and one no other assertion here would catch.
  it('scales width to match the tight viewBox aspect ratio, so the mark is not squashed', async () => {
    const { getByTestId } = await render(<CorymbiaMark height={40} />)
    expect(getByTestId('corymbia-mark').props.width).toBeCloseTo((40 * 672) / 1500)
  })

  it('scales width to match the square viewBox aspect ratio, so the icon is not stretched', async () => {
    const { getByTestId } = await render(<CorymbiaMark height={40} crop="square" />)
    expect(getByTestId('corymbia-mark').props.width).toBe(40)
  })

  // react-native-svg parses the `viewBox` string prop into minX/minY/vbWidth/vbHeight
  // before it reaches the underlying host component, so the literal string is not
  // observable on the node `getByTestId` returns — assert on the parsed values instead.
  it('uses the tight crop by default, for the app bar', async () => {
    const { getByTestId } = await render(<CorymbiaMark />)
    expect(getByTestId('corymbia-mark').props).toMatchObject({
      minX: 414,
      minY: 0,
      vbWidth: 672,
      vbHeight: 1500,
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

  // The whole reason a clipping crop shipped once is that no test looked at what the
  // viewBox actually contains — every prior assertion checked the viewBox string against
  // itself. This computes containment from the rendered viewBox numbers against the
  // measured artwork bounds, so a crop that clips the mark fails here.
  it('contains the full measured artwork bounds within the tight viewBox, so nothing is clipped', async () => {
    const { getByTestId } = await render(<CorymbiaMark />)
    const { minX, minY, vbWidth, vbHeight } = getByTestId('corymbia-mark').props as {
      minX: number
      minY: number
      vbWidth: number
      vbHeight: number
    }
    const maxX = minX + vbWidth
    const maxY = minY + vbHeight

    expect(minX).toBeLessThanOrEqual(MEASURED_ARTWORK_BOUNDS.minX)
    expect(maxX).toBeGreaterThanOrEqual(MEASURED_ARTWORK_BOUNDS.maxX)
    expect(minY).toBeLessThanOrEqual(MEASURED_ARTWORK_BOUNDS.minY)
    expect(maxY).toBeGreaterThanOrEqual(MEASURED_ARTWORK_BOUNDS.maxY)
  })

  it('keeps the tight crop at the artwork aspect ratio, so it is not squashed or stretched', async () => {
    const { getByTestId } = await render(<CorymbiaMark />)
    const { vbWidth, vbHeight } = getByTestId('corymbia-mark').props as {
      vbWidth: number
      vbHeight: number
    }
    expect(vbWidth / vbHeight).toBeCloseTo(672 / 1500)
  })

  it('keeps the square crop square, so the launcher icon is not squashed or stretched', async () => {
    const { getByTestId } = await render(<CorymbiaMark crop="square" />)
    const { vbWidth, vbHeight } = getByTestId('corymbia-mark').props as {
      vbWidth: number
      vbHeight: number
    }
    expect(vbWidth / vbHeight).toBeCloseTo(1)
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
