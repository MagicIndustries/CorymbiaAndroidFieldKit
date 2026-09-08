import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react-native'
import { darkTheme, field, spacing, touch } from '@corymbia/tokens'
import { ThemeProvider } from '../../theme'
import { MediaStrip, mediaStripLabel, type MediaStripItem } from '../MediaStrip'

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

  it('names each attachment to a screen reader by kind and position within that kind', async () => {
    // The fixture is two photos and ONE voice note, deliberately. The
    // earlier one-of-each fixture could not fail: with a photo first and a
    // voice note second, "1 of 2" and "2 of 2" are what the correct
    // within-kind numbering AND the flat `index + 1 of items.length` both
    // produce, so it codified the bug it was supposed to catch. A record
    // with ten photos and three voice notes announced its last tile as
    // "Voice note 13 of 13" — a position in a list nobody is looking at, and
    // the fifth appearance of the same photo/voice conflation this branch
    // corrected four times in the noun alone.
    await wrap(
      <MediaStrip
        items={[photo('a'), photo('c'), voice('b', 4000)]}
        onPress={() => {}}
        testID="strip"
      />,
    )
    expect(screen.getByTestId('media-tile-a').props.accessibilityLabel).toBe('Photo 1 of 2')
    expect(screen.getByTestId('media-tile-c').props.accessibilityLabel).toBe('Photo 2 of 2')
    expect(screen.getByTestId('media-tile-b').props.accessibilityLabel).toBe('Voice note 1 of 1')
  })

  it('numbers a kind by its own order, not by where its tiles sit in the strip', async () => {
    // Interleaved, so within-kind position and strip position disagree for
    // every tile after the first: the second photo is the THIRD tile.
    await wrap(
      <MediaStrip
        items={[photo('a'), voice('b', 4000), photo('c'), voice('d', 5000)]}
        onPress={() => {}}
        testID="strip"
      />,
    )
    expect(screen.getByTestId('media-tile-c').props.accessibilityLabel).toBe('Photo 2 of 2')
    expect(screen.getByTestId('media-tile-d').props.accessibilityLabel).toBe('Voice note 2 of 2')
  })

  it('names an attachment the same way for a caller as it does on the tile', async () => {
    // `capture.tsx`'s removal confirmation asks "Remove photo 2 of 2?" using
    // this exported function, and the strip labels its own tiles with it too
    // — one numbering, not two that could drift apart and point her at the
    // wrong thumbnail.
    const items = [photo('a'), photo('c'), voice('b', 4000)]
    expect(mediaStripLabel(items, 'c')).toBe('Photo 2 of 2')
    expect(mediaStripLabel(items, 'b')).toBe('Voice note 1 of 1')
    expect(mediaStripLabel(items, 'gone')).toBeNull()
  })

  it('marks the tile a removal question is open for', async () => {
    // Ten photos, roughly five visible in a scrolling strip of near-identical
    // 64dp thumbnails that resets to offset 0 on every refresh, and no undo
    // anywhere in the app: a confirmation that does not point at its own
    // subject is a coin toss.
    await wrap(
      <MediaStrip items={[photo('a'), photo('c')]} onRemove={() => {}} pendingRemovalId="c" testID="strip" />,
    )
    const marked = screen.getByTestId('media-tile-c')
    const other = screen.getByTestId('media-tile-a')
    expect(marked.props.style.borderColor).toBe(darkTheme.colors.statusFair)
    expect(other.props.style.borderColor).toBe(darkTheme.colors.border)
    // Doctrine rule 9: never the colour alone. The border is also thicker,
    // and the spoken name says which tile the question is about.
    expect(marked.props.style.borderWidth).toBeGreaterThan(other.props.style.borderWidth)
    expect(marked.props.accessibilityLabel).toBe(
      'Photo 2 of 2, the attachment the removal question is about',
    )
    expect(other.props.accessibilityLabel).toBe('Photo 1 of 2')
  })

  it('marks nothing when no removal is pending', async () => {
    await wrap(<MediaStrip items={[photo('a'), photo('c')]} onRemove={() => {}} testID="strip" />)
    expect(screen.getByTestId('media-tile-a').props.style.borderColor).toBe(
      darkTheme.colors.border,
    )
    expect(screen.getByTestId('media-tile-c').props.style.borderColor).toBe(
      darkTheme.colors.border,
    )
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

  it('names the remove control to a screen reader by kind, not always "photo"', async () => {
    // `MediaStrip`'s own remove control builds its `accessibilityLabel` from
    // `KIND_LABEL` the same way the tile label above does, but nothing here
    // had read it: hardcoding `"Remove photo"` would pass every other test in
    // this file, including the five above that press the remove control
    // without ever inspecting what it says. A screen reader announcing
    // "Remove photo" over a voice tile is the same defect `capture.tsx`'s
    // removal confirmation was fixed for, one layer up from where it is
    // fixed here.
    await wrap(
      <MediaStrip items={[photo('a'), voice('b', 4000)]} onRemove={() => {}} testID="strip" />,
    )
    expect(screen.getByTestId('media-remove-a').props.accessibilityLabel).toBe('Remove photo')
    expect(screen.getByTestId('media-remove-b').props.accessibilityLabel).toBe(
      'Remove voice note',
    )
  })

  it('paints the remove control as a small badge, not a lid over the photo', async () => {
    // A 48dp painted circle in a 64dp tile's corner covers 56% of the
    // thumbnail — a coloured square standing in for the photo it is meant
    // to identify. `field.mediaTileRemove` (24dp) is what actually gets
    // painted; `touch.min` is met a different way (below), so pinning this
    // half alone against `touch.min` — the pre-fix regression — must fail.
    await wrap(<MediaStrip items={[photo('a')]} onRemove={() => {}} testID="strip" />)
    const control = screen.getByTestId('media-remove-a')
    const style = Array.isArray(control.props.style)
      ? Object.assign({}, ...control.props.style)
      : control.props.style
    expect(style.minWidth).toBe(field.mediaTileRemove)
    expect(style.minHeight).toBe(field.mediaTileRemove)
  })

  it('gives the remove control a real touch target via hitSlop, not by painting it', async () => {
    // `hitSlop` expands only the *responder* area, never what is painted
    // (React Native's `normalizeRect`, `Libraries/StyleSheet/Rect.js`: a
    // numeric `hitSlop` becomes `{top, bottom, left, right}` all equal to
    // that number). The effective target is the painted box plus hitSlop on
    // both opposing edges per axis, and that — not the painted box alone —
    // is what `touch.min` (48dp, "Absolute minimum for any interactive
    // element") actually measures.
    //
    // This fails if `hitSlop` is removed (insets fall to 0, effective size
    // collapses to the painted 24dp) and fails independently of the
    // previous test if the painted box alone were changed without updating
    // `hitSlop` to compensate, since it recomputes the total from both
    // props rather than trusting either one alone.
    await wrap(<MediaStrip items={[photo('a')]} onRemove={() => {}} testID="strip" />)
    const control = screen.getByTestId('media-remove-a')
    const style = Array.isArray(control.props.style)
      ? Object.assign({}, ...control.props.style)
      : control.props.style

    const hitSlop: unknown = control.props.hitSlop
    const insets =
      typeof hitSlop === 'number'
        ? { top: hitSlop, bottom: hitSlop, left: hitSlop, right: hitSlop }
        : {
            top: (hitSlop as { top?: number } | undefined)?.top ?? 0,
            bottom: (hitSlop as { bottom?: number } | undefined)?.bottom ?? 0,
            left: (hitSlop as { left?: number } | undefined)?.left ?? 0,
            right: (hitSlop as { right?: number } | undefined)?.right ?? 0,
          }

    // Pinned to the exact figure, not just "at least touch.min": a hitSlop
    // that undershoots by even 2dp is the finding this replaces, not a pass.
    expect(insets).toEqual({ top: spacing.md, bottom: spacing.md, left: spacing.md, right: spacing.md })
    expect(style.minWidth + insets.left + insets.right).toBe(touch.min)
    expect(style.minHeight + insets.top + insets.bottom).toBe(touch.min)
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
