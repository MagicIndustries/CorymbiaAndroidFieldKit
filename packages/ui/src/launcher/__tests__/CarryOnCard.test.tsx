import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react-native'
import { StyleSheet, type ViewStyle } from 'react-native'
import { field } from '@corymbia/tokens'
import { ThemeProvider } from '../../theme'
import { CarryOnCard, type CarryOn } from '../CarryOnCard'

// `useTheme()` throws outside a `ThemeProvider` (see ContextStamp.test.tsx,
// InputAffordanceRow.test.tsx, MediaStrip.test.tsx) — every render in this
// file goes through this wrapper rather than the bare `render` the brief
// sketched.
const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>)

// `.props.style` on a rendered host element is typed `{ [propName: string]: any }`
// by @types/react-test-renderer, so passing it here needs no `as` cast — the
// generic on `flatten` itself is pinned to `ViewStyle` instead, since
// `StyleSheet.flatten` is generic and would otherwise infer `unknown` with
// nothing at the call site to fix `T`.
const flatten = (style: ViewStyle | ViewStyle[] | undefined) => StyleSheet.flatten<ViewStyle>(style)

const handlers = {
  onCapture: jest.fn<void, []>(),
  onSwitchProject: jest.fn<void, []>(),
  onNewActivity: jest.fn<void, []>(),
}

afterEach(() => {
  handlers.onCapture.mockClear()
  handlers.onSwitchProject.mockClear()
  handlers.onNewActivity.mockClear()
})

const carryOn: CarryOn = {
  projectName: 'Tambo River eDNA',
  activityName: 'Reach 3 transect',
  activityKind: 'survey',
  startedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
  captureCount: 12,
  clientName: 'DEECA',
}

describe('CarryOnCard', () => {
  it('shows everything §10.1 asks for', async () => {
    await wrap(<CarryOnCard carryOn={carryOn} {...handlers} testID="carry-on" />)
    const card = screen.getByTestId('carry-on')
    expect(card).toHaveTextContent(/Tambo River eDNA/)
    expect(card).toHaveTextContent(/Reach 3 transect/)
    expect(card).toHaveTextContent(/DEECA/)
    expect(card).toHaveTextContent(/12/)
  })

  it('says how long ago it started, not when', async () => {
    // Mid-survey she needs elapsed time. A timestamp is arithmetic homework.
    await wrap(<CarryOnCard carryOn={carryOn} {...handlers} testID="carry-on" />)
    expect(screen.getByTestId('carry-on-started')).toHaveTextContent('40 minutes ago')
  })

  it('reads hours once it has been running that long', async () => {
    // One example value would let '40 minutes ago' be hardcoded.
    const older = { ...carryOn, startedAt: new Date(Date.now() - 3 * 3_600_000).toISOString() }
    await wrap(<CarryOnCard carryOn={older} {...handlers} testID="carry-on" />)
    expect(screen.getByTestId('carry-on-started')).toHaveTextContent('3 hours ago')
  })

  it('counts one capture in the singular', async () => {
    const one = { ...carryOn, captureCount: 1 }
    await wrap(<CarryOnCard carryOn={one} {...handlers} testID="carry-on" />)
    expect(screen.getByTestId('carry-on-captures')).toHaveTextContent('1 capture')
  })

  it('offers CAPTURE from inside the card', async () => {
    await wrap(<CarryOnCard carryOn={carryOn} {...handlers} testID="carry-on" />)
    await fireEvent.press(screen.getByTestId('carry-on-capture'))
    expect(handlers.onCapture).toHaveBeenCalled()
  })

  it('offers switching project and starting an activity beneath it', async () => {
    await wrap(<CarryOnCard carryOn={carryOn} {...handlers} testID="carry-on" />)
    await fireEvent.press(screen.getByTestId('carry-on-switch-project'))
    await fireEvent.press(screen.getByTestId('carry-on-new-activity'))
    expect(handlers.onSwitchProject).toHaveBeenCalled()
    expect(handlers.onNewActivity).toHaveBeenCalled()
  })

  it('says there is nothing to carry on with on a first run, and offers a way forward', async () => {
    // Not an error, and not a disabled CAPTURE — a control that looks
    // pressable and does nothing is what doctrine rule 3 forbids.
    await wrap(<CarryOnCard carryOn={null} {...handlers} testID="carry-on" />)
    expect(screen.queryByTestId('carry-on-capture')).toBeNull()
    expect(screen.getByTestId('carry-on')).toHaveTextContent(/no project/i)
    expect(screen.getByTestId('carry-on-switch-project')).toBeTruthy()
  })

  it('gives CAPTURE a field-sized target', async () => {
    await wrap(<CarryOnCard carryOn={carryOn} {...handlers} testID="carry-on" />)
    const style = flatten(screen.getByTestId('carry-on-capture').props.style)
    expect(style.minHeight).toBeGreaterThanOrEqual(field.control)
  })
})
