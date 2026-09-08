import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react-native'
import { touch } from '@corymbia/tokens'
import { ThemeProvider } from '../../theme'
import { MediaStrip, type MediaStripItem } from '../MediaStrip'

// `useTheme()` throws outside a `ThemeProvider` (see ContextStamp.test.tsx
// and InputAffordanceRow.test.tsx) — every render in this file goes through
// this wrapper rather than the bare `render` the brief sketched.
const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>)

const photo = (id: string): MediaStripItem => ({
  id,
  kind: 'photo',
  uri: `file:///${id}.jpg`,
  durationMs: null,
})
const voice = (id: string, ms: number): MediaStripItem => ({
  id,
  kind: 'voice',
  uri: `file:///${id}.m4a`,
  durationMs: ms,
})

describe('MediaStrip', () => {
  it('renders nothing at all when there is nothing attached', async () => {
    // An empty strip is a frame around a void: it costs vertical space on a
    // phone and says only that a thing she did not do has not been done.
    await wrap(<MediaStrip items={[]} testID="strip" />)
    expect(screen.queryByTestId('strip')).toBeNull()
  })

  it('renders one tile per attachment, in the order given', async () => {
    await wrap(<MediaStrip items={[photo('a'), voice('b', 4000), photo('c')]} testID="strip" />)
    expect(screen.getAllByTestId(/^media-tile-/).map((t) => t.props.testID)).toEqual([
      'media-tile-a',
      'media-tile-b',
      'media-tile-c',
    ])
  })

  it('shows a voice note as a length, because there is nothing to look at', async () => {
    await wrap(<MediaStrip items={[voice('b', 8200)]} testID="strip" />)
    expect(screen.getByTestId('media-tile-b')).toHaveTextContent('0:08')
  })

  it('rounds a length to whole seconds rather than showing milliseconds', async () => {
    await wrap(<MediaStrip items={[voice('b', 65400)]} testID="strip" />)
    expect(screen.getByTestId('media-tile-b')).toHaveTextContent('1:05')
  })

  // The brief's two duration examples (8200ms, 65400ms) both carry a
  // fractional second below one half (.2, .4), so `Math.floor` and
  // `Math.round` agree on both and a floor-not-round implementation would
  // still pass them — "rounds ... rather than showing milliseconds" would
  // be true only by accident. 8700ms (.7s) is the case that tells them
  // apart: floor gives `0:08`, round gives the `0:09` this pins.
  it('rounds up, not down, when the fractional second is at least a half', async () => {
    await wrap(<MediaStrip items={[voice('b', 8700)]} testID="strip" />)
    expect(screen.getByTestId('media-tile-b')).toHaveTextContent('0:09')
  })

  it('shows a photo as the photo, not as a filename', async () => {
    await wrap(<MediaStrip items={[photo('a')]} testID="strip" />)
    expect(screen.getByTestId('media-thumb-a').props.source).toEqual({ uri: 'file:///a.jpg' })
  })

  it('gives every tile a touch target big enough to hit while moving', async () => {
    // Doctrine: field controls are sized for gloved, one-handed use. A
    // thumbnail strip is still a control.
    await wrap(<MediaStrip items={[photo('a')]} onPress={() => {}} testID="strip" />)
    const tile = screen.getByTestId('media-tile-a')
    const style = Array.isArray(tile.props.style) ? Object.assign({}, ...tile.props.style) : tile.props.style
    expect(style.minHeight).toBeGreaterThanOrEqual(touch.comfortable)
  })

  it('names each attachment to a screen reader by kind and position', async () => {
    await wrap(<MediaStrip items={[photo('a'), voice('b', 4000)]} onPress={() => {}} testID="strip" />)
    expect(screen.getByTestId('media-tile-a').props.accessibilityLabel).toMatch(/photo 1 of 2/i)
    expect(screen.getByTestId('media-tile-b').props.accessibilityLabel).toMatch(/voice note 2 of 2/i)
  })

  it('offers removal only when a handler is given', async () => {
    await wrap(<MediaStrip items={[photo('a')]} testID="strip" />)
    expect(screen.queryByTestId('media-remove-a')).toBeNull()
  })

  it('reports which attachment is to be removed', async () => {
    const onRemove = jest.fn()
    await wrap(<MediaStrip items={[photo('a'), photo('c')]} onRemove={onRemove} testID="strip" />)
    await fireEvent.press(screen.getByTestId('media-remove-c'))
    expect(onRemove).toHaveBeenCalledWith('c')
  })

  it('gives the remove control a real touch target, not half of one', async () => {
    // `touch.min` (48dp) is documented as "Absolute minimum for any
    // interactive element" — a `Pressable` used gloved and one-handed is not
    // exempt from that floor. Pinned directly against the token rather than
    // an arithmetic derivation of it, so the size stays a decision someone
    // made rather than something that can silently drift.
    await wrap(<MediaStrip items={[photo('a')]} onRemove={() => {}} testID="strip" />)
    const control = screen.getByTestId('media-remove-a')
    const style = Array.isArray(control.props.style)
      ? Object.assign({}, ...control.props.style)
      : control.props.style
    expect(style.minWidth).toBe(touch.min)
    expect(style.minHeight).toBe(touch.min)
  })

  it('does not also trigger the tile when the remove control inside it is pressed', async () => {
    // Task 12 wires `onPress` (playback) and `onRemove` up simultaneously,
    // and the remove control is a `Pressable` nested inside the tile's own
    // `Pressable`. On a voice tile, removing an attachment and starting to
    // play it in the same tap would be a real, damaging bug — this pins
    // that pressing remove fires only `onRemove`.
    const onPress = jest.fn()
    const onRemove = jest.fn()
    await wrap(
      <MediaStrip items={[voice('b', 4000)]} onPress={onPress} onRemove={onRemove} testID="strip" />,
    )
    await fireEvent.press(screen.getByTestId('media-remove-b'))
    expect(onRemove).toHaveBeenCalledWith('b')
    expect(onPress).not.toHaveBeenCalled()
  })

  // Pins that a Pressable is never rendered with no handler at all — a
  // regression that always wrapped tiles in Pressable (ignoring the
  // "plain View otherwise" rule) would still pass every test above, since
  // none of them inspects `onStartShouldSetResponder`/role when `onPress`
  // is absent. `accessibilityRole` is RNTL's own observable proxy for
  // "is this actually pressable" without reaching into RN internals: a
  // plain `View` never carries it, whereas `Pressable` renders with
  // `accessibilityRole="button"` once one is set.
  it('does not make a tile pressable when no onPress is given', async () => {
    await wrap(<MediaStrip items={[photo('a')]} testID="strip" />)
    expect(screen.getByTestId('media-tile-a').props.accessibilityRole).toBeUndefined()
  })
})
