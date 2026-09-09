import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react-native'
import { StyleSheet, type ViewStyle } from 'react-native'
import { touch } from '@corymbia/tokens'
import { ThemeProvider } from '../../theme'
import { ToolTiles } from '../ToolTiles'

// `useTheme()` throws outside a `ThemeProvider` — see CarryOnCard.test.tsx,
// ContextStamp.test.tsx, InputAffordanceRow.test.tsx, MediaStrip.test.tsx —
// every render in this file goes through this wrapper.
const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>)

// Same reasoning as CarryOnCard.test.tsx: `.props.style` on a rendered host
// element is typed `any`, so `flatten`'s generic is pinned to `ViewStyle`
// rather than needing an `as` cast at the call site.
const flatten = (style: ViewStyle | ViewStyle[] | undefined) => StyleSheet.flatten<ViewStyle>(style)

describe('ToolTiles', () => {
  it('floats capture and records for a survey', async () => {
    await wrap(
      <ToolTiles activityKind="survey" available={['capture', 'records', 'media']} onOpen={() => {}} testID="tools" />,
    )
    const order = screen.getAllByTestId(/^tool-/).map((t) => t.props.testID)
    expect(order.slice(0, 2)).toEqual(['tool-capture', 'tool-records'])
  })

  it('puts records first for sampling, where the log leads', async () => {
    // The exact order, not merely "not the default". `not.toEqual` on an
    // array is satisfied by ANY difference, including an accidental one — so
    // it would have accepted a third wrong order just as happily as the right
    // one, which is no guard at all for a table this test exists to protect.
    //
    // This pins a judgement rather than a spec line: §10.1 pins only the
    // survey row. That is the point of writing it down — if the order changes
    // it should change here too, deliberately, rather than drift.
    await wrap(
      <ToolTiles activityKind="sampling" available={['capture', 'records', 'media']} onOpen={() => {}} testID="tools" />,
    )
    const order = screen.getAllByTestId(/^tool-/).map((t) => t.props.testID)
    expect(order).toEqual(['tool-records', 'tool-capture', 'tool-media'])
  })

  it('renders nothing for a tool that does not exist yet', async () => {
    // Doctrine rule 18: an unbuilt destination must not have a live-looking tile.
    await wrap(<ToolTiles activityKind="survey" available={['capture', 'records']} onOpen={() => {}} testID="tools" />)
    expect(screen.queryByTestId('tool-batching')).toBeNull()
    expect(screen.queryByTestId('tool-media')).toBeNull()
  })

  // Two separate presses rather than pressing one and asserting only that
  // handler fired — a shared `onOpen(kind)` could still be wired to the
  // wrong tile and pass a looser check. Each press asserts the exact kind
  // argument and that it was the only call.
  it('opens the tool that was pressed', async () => {
    const onOpen = jest.fn<void, [tool: 'capture' | 'records' | 'media' | 'batching']>()
    await wrap(<ToolTiles activityKind="survey" available={['capture', 'records']} onOpen={onOpen} testID="tools" />)
    await fireEvent.press(screen.getByTestId('tool-records'))
    expect(onOpen).toHaveBeenCalledWith('records')
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('opens capture, not records, when capture is pressed', async () => {
    const onOpen = jest.fn<void, [tool: 'capture' | 'records' | 'media' | 'batching']>()
    await wrap(<ToolTiles activityKind="survey" available={['capture', 'records']} onOpen={onOpen} testID="tools" />)
    await fireEvent.press(screen.getByTestId('tool-capture'))
    expect(onOpen).toHaveBeenCalledWith('capture')
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('keeps a stable order when there is no activity to order by', async () => {
    await wrap(<ToolTiles activityKind={null} available={['capture', 'records']} onOpen={() => {}} testID="tools" />)
    expect(screen.getAllByTestId(/^tool-/).map((t) => t.props.testID)).toEqual(['tool-capture', 'tool-records'])
  })

  it('gives every tile a target big enough to hit while moving', async () => {
    await wrap(<ToolTiles activityKind="survey" available={['capture', 'records']} onOpen={() => {}} testID="tools" />)
    const style = flatten(screen.getByTestId('tool-capture').props.style)
    expect(style.minHeight).toBeGreaterThanOrEqual(touch.comfortable)
  })
})
