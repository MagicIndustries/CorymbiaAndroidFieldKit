import React from 'react'
import { Text } from 'react-native'
import { render, screen } from '@testing-library/react-native'
import { useLayout, type LayoutInfo } from '../useLayout'
import { resolveReach } from '../reach'
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
  it('classifies a Samsung S25/S24 in portrait as compact, phone, portrait', async () => {
    mockWindowDimensions(412, 915)
    const layout = await renderLayout()
    expect(layout).toMatchObject({
      sizeClass: 'compact',
      deviceClass: 'phone',
      orientation: 'portrait',
      width: 412,
      height: 915,
    })
  })

  it('classifies the same phone rotated as expanded by width, but still phone and landscape', async () => {
    // This is the case that proves the split was necessary: at ~915dp wide
    // the phone is `expanded` by size class, but it must stay `phone` (its
    // shortest side, 412dp, hasn't changed) and therefore keep a bottom
    // band, not corners.
    mockWindowDimensions(915, 412)
    const layout = await renderLayout()
    expect(layout).toMatchObject({
      sizeClass: 'expanded',
      deviceClass: 'phone',
      orientation: 'landscape',
      width: 915,
      height: 412,
    })
    expect(
      resolveReach({
        deviceClass: layout.deviceClass,
        orientation: layout.orientation,
        handedness: 'right',
      }).anchor,
    ).toBe('bottomBand')
  })

  it('classifies a 10-inch tablet in portrait as medium, tablet, portrait', async () => {
    mockWindowDimensions(800, 1280)
    const layout = await renderLayout()
    expect(layout).toMatchObject({
      sizeClass: 'medium',
      deviceClass: 'tablet',
      orientation: 'portrait',
      width: 800,
      height: 1280,
    })
  })

  it('classifies a 10-inch tablet in landscape as expanded, tablet, landscape, and bottom corners', async () => {
    // This is the case the bug made unreachable: Math.min(width, height)
    // never changes on rotation, so sizeClassFor could never see past
    // `medium` for this device.
    mockWindowDimensions(1280, 800)
    const layout = await renderLayout()
    expect(layout).toMatchObject({
      sizeClass: 'expanded',
      deviceClass: 'tablet',
      orientation: 'landscape',
      width: 1280,
      height: 800,
    })
    expect(
      resolveReach({
        deviceClass: layout.deviceClass,
        orientation: layout.orientation,
        handedness: 'right',
      }).anchor,
    ).toBe('bottomCorners')
  })
})
