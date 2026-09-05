import React from 'react'
import { Text } from 'react-native'
import { render, screen } from '@testing-library/react-native'
import { useLayout, type LayoutInfo } from '../useLayout'
import { mockWindowDimensions } from '../../test-utils'

function Probe() {
  const layout = useLayout()
  return <Text testID="layout">{JSON.stringify(layout)}</Text>
}

async function renderLayout(): Promise<LayoutInfo> {
  await render(<Probe />)
  return JSON.parse(screen.getByTestId('layout').props.children as string) as LayoutInfo
}

describe('useLayout', () => {
  it('classifies a Samsung S25/S24 in portrait as compact, portrait', async () => {
    mockWindowDimensions(412, 915)
    const layout = await renderLayout()
    expect(layout).toMatchObject({
      sizeClass: 'compact',
      orientation: 'portrait',
      width: 412,
      height: 915,
    })
  })

  it('classifies the same phone rotated as expanded by width, and landscape', async () => {
    mockWindowDimensions(915, 412)
    const layout = await renderLayout()
    expect(layout).toMatchObject({
      sizeClass: 'expanded',
      orientation: 'landscape',
      width: 915,
      height: 412,
    })
  })

  it('classifies a 10-inch tablet in portrait as medium, portrait', async () => {
    mockWindowDimensions(800, 1280)
    const layout = await renderLayout()
    expect(layout).toMatchObject({
      sizeClass: 'medium',
      orientation: 'portrait',
      width: 800,
      height: 1280,
    })
  })

  it('classifies a 10-inch tablet in landscape as expanded, landscape — the case the bug made unreachable', async () => {
    // Math.min(width, height) never changes on rotation, so sizeClassFor
    // could never see past `medium` for this device before this fix.
    mockWindowDimensions(1280, 800)
    const layout = await renderLayout()
    expect(layout).toMatchObject({
      sizeClass: 'expanded',
      orientation: 'landscape',
      width: 1280,
      height: 800,
    })
  })
})
