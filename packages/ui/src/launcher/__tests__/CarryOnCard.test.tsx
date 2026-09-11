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

  it('names the kind of activity as well as its name', async () => {
    // Rendered but unasserted until now, so it could be deleted or
    // mistranslated — `survey: 'Sampling'` — with the whole suite green.
    // Kept rather than dropped because the type carries the kind and
    // discarding it silently would be the worse of the two mistakes.
    await wrap(<CarryOnCard carryOn={carryOn} {...handlers} testID="carry-on" />)
    expect(screen.getByTestId('carry-on')).toHaveTextContent(/Survey/, { exact: false })
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

  // Two tests rather than one, because one cannot tell correct wiring from a
  // swap. The original pressed BOTH buttons and then asserted BOTH handlers
  // had fired — which is true whichever button called which. Exchanging the
  // two `onPress` props passed it. Each button is now pressed alone, and the
  // other handler asserted silent.
  it('switches project from the button beneath the card', async () => {
    await wrap(<CarryOnCard carryOn={carryOn} {...handlers} testID="carry-on" />)
    await fireEvent.press(screen.getByTestId('carry-on-switch-project'))
    expect(handlers.onSwitchProject).toHaveBeenCalled()
    expect(handlers.onNewActivity).not.toHaveBeenCalled()
  })

  it('starts an activity from its own button, not the project one', async () => {
    await wrap(<CarryOnCard carryOn={carryOn} {...handlers} testID="carry-on" />)
    await fireEvent.press(screen.getByTestId('carry-on-new-activity'))
    expect(handlers.onNewActivity).toHaveBeenCalled()
    expect(handlers.onSwitchProject).not.toHaveBeenCalled()
  })

  it('says there is nothing to carry on with on a first run, and offers a way forward', async () => {
    // Not an error, and not a disabled CAPTURE — a control that looks
    // pressable and does nothing is what doctrine rule 18 forbids.
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
