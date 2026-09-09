import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react-native'
import { ThemeProvider } from '@corymbia/ui'
import type { CarryOn } from '@corymbia/ui'

/**
 * Tests for the launcher (spec §10.1) — the first thing she sees when she
 * opens the application.
 *
 * WHAT IS AND IS NOT MOCKED. `useCurrentContext` is, and nothing else is.
 * Which queries answer which question, and what happens when one is slow, are
 * that hook's own tests (`src/context/__tests__/useCurrentContext.test.ts`);
 * what is left for this file is what the screen does with the answer — which
 * of the three states it draws, whether the Inbox strip is there at all, and
 * where each control actually goes. Mocking the hook is what lets a state
 * like "four unfiled captures and no project" be rendered at all, which is
 * otherwise several repository fixtures away.
 *
 * `CarryOnCard` and `ToolTiles` are the real components: this screen's whole
 * job is assembling them, and a test against stubbed ones could not tell a
 * card that was handed the resumed activity from one that was handed nothing.
 */

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
}

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return {
    useRouter: () => mockRouter,
    // The launcher itself registers none — its freshness lives in
    // `useCurrentContext`, which is mocked here — but `Screen` and the
    // components below are rendered inside a tree that must not blow up if
    // one appears.
    useFocusEffect: (effect: () => void) => {
      useEffect(() => {
        effect()
      }, [effect])
    },
  }
})

type MockStatus =
  | { state: 'opening'; error: null; applied: string[] }
  | { state: 'ready'; error: null; applied: string[] }
  | { state: 'failed'; error: Error; applied: string[] }

/**
 * `let`, not `const`: the two guard tests below set this for their one render.
 * Every other test leaves it alone, and `beforeEach` puts it back rather than
 * trusting a test to.
 */
let mockStatus: MockStatus = { state: 'ready', error: null, applied: ['001-projects'] }

const mockDb = { handle: 'not a real database' }

jest.mock('../../src/db/provider', () => ({
  useDatabase: () => mockDb,
  useDatabaseStatus: () => mockStatus,
}))

/**
 * The context hook's answer for one render, replaced per test by
 * `renderLauncher`. Typed against the real hook, so a state this screen is
 * asked to draw is always a state the hook can actually produce.
 */
let mockContext: ReturnType<typeof import('../../src/context/useCurrentContext').useCurrentContext>

jest.mock('../../src/context/useCurrentContext', () => ({
  useCurrentContext: () => mockContext,
}))

// Imported after the mocks so it picks them up.
import Launcher from '../index'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CARRY_ON: CarryOn = {
  projectName: 'Yarra Flats eDNA',
  activityName: 'Reach 3 transect',
  activityKind: 'survey',
  startedAt: '2026-09-10T00:20:00.000Z',
  captureCount: 7,
  clientName: 'Parks Victoria',
}

async function renderLauncher(
  options: {
    carryOn?: CarryOn | null
    activityId?: string | null
    unfiledCount?: number
    loading?: boolean
  } = {},
): Promise<void> {
  const carryOn = options.carryOn === undefined ? CARRY_ON : options.carryOn
  mockContext = {
    carryOn,
    activityId:
      options.activityId === undefined
        ? carryOn === null
          ? null
          : 'act_survey'
        : options.activityId,
    unfiledCount: options.unfiledCount ?? 0,
    loading: options.loading ?? false,
    refresh: () => Promise.resolve(),
  }

  // @testing-library/react-native v14 is async throughout: `render` and
  // `fireEvent.*` both return promises, and an unawaited one lands its work in
  // the middle of the next assertion. The theme is pinned to dark, the product
  // default (spec §5.2), rather than left to resolve from a headless host's
  // reported colour scheme.
  await render(
    <ThemeProvider initial="dark">
      <Launcher />
    </ThemeProvider>,
  )
}

/** The tool tiles that were rendered, in the order they were rendered in. */
function toolTileIds(): unknown[] {
  return screen.getAllByTestId(/^tool-/).map((tile) => tile.props.testID)
}

/** The screen's spoken description, read the way every other screen test reads it. */
function spokenDescription(): unknown {
  return screen.getByTestId('launcher-spoken-description').props.accessibilityLabel
}

beforeEach(() => {
  mockStatus = { state: 'ready', error: null, applied: ['001-projects'] }
  mockRouter.push.mockClear()
  mockRouter.replace.mockClear()
  mockRouter.back.mockClear()
})

describe('the launcher', () => {
  it('shows the card and the tools once a context is resumed', async () => {
    await renderLauncher()
    expect(screen.getByTestId('launcher-carry-on')).toBeTruthy()
    expect(screen.getByTestId('launcher-tools')).toBeTruthy()
  })

  it('hands the card the activity that was resumed, not a placeholder', async () => {
    await renderLauncher()
    const card = screen.getByTestId('launcher-carry-on')
    // Regexes rather than strings: `toHaveTextContent` defaults to an EXACT
    // match on a string, and the text content of a card is every one of its
    // Texts concatenated with no separator — so a string matcher here could
    // only ever be the whole card. The `(?<!\d)` is what stops `17 captures`
    // satisfying an assertion about 7.
    expect(card).toHaveTextContent(/Reach 3 transect/)
    expect(card).toHaveTextContent(/Yarra Flats eDNA/)
    expect(card).toHaveTextContent(/(?<!\d)7 captures/)
  })

  it('shows the Inbox strip only when something is unfiled', async () => {
    await renderLauncher({ unfiledCount: 0 })
    expect(screen.queryByTestId('launcher-inbox')).toBeNull()
  })

  it('shows the Inbox strip, and how many, when there is something in it', async () => {
    await renderLauncher({ unfiledCount: 4 })
    expect(screen.getByTestId('launcher-inbox')).toHaveTextContent(/(?<!\d)4 unfiled captures/)
  })

  it('says one unfiled capture in the singular', async () => {
    await renderLauncher({ unfiledCount: 1 })
    // `(?!s)` is what makes this fail on "1 unfiled captures" — the whole
    // point of the test. A word boundary could not do it: `s` is a word
    // character, so there is no boundary between `capture` and `s`.
    expect(screen.getByTestId('launcher-inbox')).toHaveTextContent(/(?<!\d)1 unfiled capture(?!s)/)
  })

  it('goes straight to capture from the card', async () => {
    await renderLauncher()
    await fireEvent.press(screen.getByTestId('carry-on-capture'))
    expect(mockRouter.push).toHaveBeenCalledWith('/capture')
    // One press, one destination. Asserting the count is what tells a correct
    // wiring from a swapped one: a card whose CAPTURE opened the Inbox would
    // satisfy "push was called" just as well.
    expect(mockRouter.push).toHaveBeenCalledTimes(1)
  })

  it('opens the Inbox from the strip, and nothing else', async () => {
    await renderLauncher({ unfiledCount: 4 })
    await fireEvent.press(screen.getByTestId('launcher-inbox'))
    expect(mockRouter.push).toHaveBeenCalledWith('/inbox')
    expect(mockRouter.push).toHaveBeenCalledTimes(1)
  })

  it('opens the project list from Switch project, and nothing else', async () => {
    await renderLauncher()
    await fireEvent.press(screen.getByTestId('carry-on-switch-project'))
    expect(mockRouter.push).toHaveBeenCalledWith('/projects')
    expect(mockRouter.push).toHaveBeenCalledTimes(1)
  })

  it('starts a new activity in the project she is already in', async () => {
    await renderLauncher()
    await fireEvent.press(screen.getByTestId('carry-on-new-activity'))
    expect(mockRouter.push).toHaveBeenCalledWith('/new-activity')
    expect(mockRouter.push).toHaveBeenCalledTimes(1)
  })

  it('opens capture from the capture tile, and nothing else', async () => {
    await renderLauncher()
    await fireEvent.press(screen.getByTestId('tool-capture'))
    expect(mockRouter.push).toHaveBeenCalledWith('/capture')
    expect(mockRouter.push).toHaveBeenCalledTimes(1)
  })

  it('opens the records list from the records tile, and nothing else', async () => {
    await renderLauncher()
    await fireEvent.press(screen.getByTestId('tool-records'))
    expect(mockRouter.push).toHaveBeenCalledWith('/records')
    expect(mockRouter.push).toHaveBeenCalledTimes(1)
  })

  it('orders the tiles for the activity she is actually in', async () => {
    await renderLauncher()
    // A survey floats capture to the top (spec §10.1). The exact array, not a
    // "different from something else" assertion: any wrong order satisfies
    // that, including the one this is meant to catch.
    expect(toolTileIds()).toEqual(['tool-capture', 'tool-records'])
  })

  it('reorders them when the activity is a different kind', async () => {
    await renderLauncher({ carryOn: { ...CARRY_ON, activityKind: 'workshop' } })
    // Indoors, with no site to fix a position on, records leads. This is what
    // makes the test above a statement about the activity rather than about
    // the order the tiles happen to be declared in: a launcher that passed no
    // activity kind at all would pass that one and fail this one.
    expect(toolTileIds()).toEqual(['tool-records', 'tool-capture'])
  })

  it('offers no tile for a tool that does not exist yet', async () => {
    await renderLauncher()
    // Doctrine: a control that looks pressable and does nothing is worse than
    // no control. Neither batching nor a media library is built, so neither
    // gets a tile — not a dimmed one, not one with a badge explaining itself.
    expect(screen.queryByTestId('tool-batching')).toBeNull()
    expect(screen.queryByTestId('tool-media')).toBeNull()
  })

  it('carries a spoken description that names the state it is in', async () => {
    // Doctrine rule 16, and the empty case is the one that matters.
    await renderLauncher({ carryOn: null })
    expect(spokenDescription()).toMatch(/no project/i)
  })

  it('names the resumed project and activity in the spoken description', async () => {
    // The other half of rule 16: the description has to be accurate to THIS
    // state, not merely to the empty one. A single sentence that always said
    // "no project yet" would pass the test above on its own.
    await renderLauncher()
    expect(spokenDescription()).toMatch(/Reach 3 transect/)
    expect(spokenDescription()).toMatch(/Yarra Flats eDNA/)
    expect(spokenDescription()).not.toMatch(/no project/i)
  })

  it('says how many are in the Inbox when it says there is an Inbox', async () => {
    await renderLauncher({ unfiledCount: 4 })
    expect(spokenDescription()).toMatch(/4 unfiled captures/)
  })

  it('does not mention an Inbox that is empty', async () => {
    await renderLauncher({ unfiledCount: 0 })
    expect(spokenDescription()).not.toMatch(/unfiled/i)
  })

  it('offers the way forward, and no CAPTURE, on a first run', async () => {
    await renderLauncher({ carryOn: null })
    expect(screen.getByTestId('carry-on-switch-project')).toBeTruthy()
    // Nothing to capture into and nothing to carry on with: a CAPTURE here
    // would be a control offering a destination that does not exist.
    expect(screen.queryByTestId('carry-on-capture')).toBeNull()
  })

  it('does not claim there is no project while it is still finding out', async () => {
    // The first read takes a moment. Saying "no project yet" during it would
    // be a description of a state the device may not be in — rule 16 asks the
    // sentence to be accurate, and "still looking" is the accurate one.
    await renderLauncher({ carryOn: null, loading: true })
    expect(spokenDescription()).not.toMatch(/no project/i)
    expect(screen.queryByTestId('launcher-carry-on')).toBeNull()
  })

  it('says Capture is reachable on a first run, not merely that there is one control', async () => {
    // The screen actually carries a live Capture tile and a live Records tile
    // on a first run — `AVAILABLE_TOOLS` is unconditional — which is exactly
    // spec §10.2's Impatient journey: Open → CAPTURE → lands in the Inbox,
    // one tap. A description that says "one control, which chooses a
    // project" is a description of the card alone, not of the screen, and a
    // screen-reader user reading it never learns Capture is one tap away.
    await renderLauncher({ carryOn: null })
    expect(spokenDescription()).toMatch(/capture/i)
    expect(screen.getByTestId('tool-capture')).toBeTruthy()
  })

  it('says one unfiled capture is waiting, not "are", in the spoken description', async () => {
    // The visible strip already gets the verb right two lines away; every
    // other spoken-description test uses 4, which cannot catch a verb that
    // agrees only with the plural.
    await renderLauncher({ unfiledCount: 1 })
    expect(spokenDescription()).toMatch(/(?<!\d)1 unfiled capture is waiting(?!s)/)
    expect(spokenDescription()).not.toMatch(/1 unfiled capture are waiting/)
  })

  it('names how many are unfiled in the Inbox strip’s spoken label, not merely its visible text', async () => {
    // The visible count is pinned by two tests above; the spoken one — the
    // accessibility label a screen-reader user actually hears — by none.
    await renderLauncher({ unfiledCount: 4 })
    expect(screen.getByTestId('launcher-inbox').props.accessibilityLabel).toMatch(
      /4 unfiled captures/,
    )
  })

  it('reaches the component gallery without competing with the work', async () => {
    await renderLauncher()
    await fireEvent.press(screen.getByTestId('launcher-gallery'))
    expect(mockRouter.push).toHaveBeenCalledWith('/gallery')
    expect(mockRouter.push).toHaveBeenCalledTimes(1)
  })

  it('says the database is still opening rather than drawing an empty launcher', async () => {
    mockStatus = { state: 'opening', error: null, applied: [] }
    await renderLauncher()
    expect(screen.queryByTestId('launcher-carry-on')).toBeNull()
    expect(spokenDescription()).toMatch(/opening/i)
  })

  it('says so when the database failed, instead of looking like a first run', async () => {
    mockStatus = { state: 'failed', error: new Error('migration 003 failed'), applied: [] }
    await renderLauncher()
    expect(screen.queryByTestId('launcher-carry-on')).toBeNull()
    expect(screen.getByTestId('launcher')).toHaveTextContent(/migration 003 failed/)
  })
})
