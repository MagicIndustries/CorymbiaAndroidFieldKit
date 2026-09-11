import React from 'react'
import { act, render, fireEvent, screen } from '@testing-library/react-native'
import { ThemeProvider } from '@corymbia/ui'
import type { Activity, CurrentContext, FieldRecord, Project, StoredFix } from '@corymbia/data'

/**
 * Tests for the records list (spec §7.2, §10.1) — the screen the owner went
 * looking for after capturing and could not find, reached from the
 * launcher's Records tile.
 *
 * WHAT IS AND IS NOT MOCKED. `readCurrentContext` and `listRecords` are, and
 * nothing else is. Both are already proved in `packages/data`; what is left
 * for this file is what the screen does with their answers — which number it
 * puts in front of her (the sequence within the activity, never the capture
 * number written on a tube), whether "no activity chosen" and "this activity
 * is empty" stay distinct, and whether coming back from a capture can blank
 * a list that was already on the screen.
 *
 * `ContextStamp` is deliberately NOT mocked: the fix chip is the one thing
 * spec §8.2 says must never be blurred, and a stub would let this screen
 * render a deliberate fix as an ambient one with every test still green.
 */

const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  replace: jest.fn(),
}

/**
 * The focus effect the screen registers, kept so a test can fire a SECOND
 * focus by hand. `projects.test.tsx`'s mock runs the effect once through
 * `useEffect` and cannot re-run it, which is exactly the case the refresh
 * test below needs: she leaves for a capture and comes back.
 */
const mockFocus: { effect: (() => void) | null } = { effect: null }

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (effect: () => void) => {
      mockFocus.effect = effect
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

let mockStatus: MockStatus = { state: 'ready', error: null, applied: ['001_initial'] }
const mockDb = { handle: 'not a real database' }

jest.mock('../../src/db/provider', () => ({
  useDatabase: () => mockDb,
  useDatabaseStatus: () => mockStatus,
}))

/**
 * Typed against the real functions (`jest.fn<ReturnType<F>, Parameters<F>>()`
 * — the two-argument form, since the single-argument shorthand does not
 * compile under `@types/jest` 29), so a `mockResolvedValue` below can only
 * ever be handed a shape the real repository actually returns.
 */
const mockRepo = {
  readCurrentContext: jest.fn<
    ReturnType<typeof import('@corymbia/data').readCurrentContext>,
    Parameters<typeof import('@corymbia/data').readCurrentContext>
  >(),
  listRecords: jest.fn<
    ReturnType<typeof import('@corymbia/data').listRecords>,
    Parameters<typeof import('@corymbia/data').listRecords>
  >(),
}

jest.mock('@corymbia/data', () => ({
  readCurrentContext: (...args: Parameters<typeof import('@corymbia/data').readCurrentContext>) =>
    mockRepo.readCurrentContext(...args),
  listRecords: (...args: Parameters<typeof import('@corymbia/data').listRecords>) =>
    mockRepo.listRecords(...args),
}))

// Plain aliases, matching the brief's own naming — not referenced from inside
// the `jest.mock` factories above, which are hoisted ahead of this.
const readCurrentContext = mockRepo.readCurrentContext
const listRecords = mockRepo.listRecords

// Imported after the mocks so it picks them up.
import RecordsScreen from '../records'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACTIVITY: Activity = {
  id: 'act_reach4',
  projectId: 'prj_tambo',
  kind: 'sampling',
  name: 'Reach 4 transect',
  shortLabel: null,
  startedAt: '2026-09-05T00:00:00.000Z',
  endedAt: null,
}

const PROJECT: Project = {
  id: 'prj_tambo',
  name: 'Tambo River eDNA',
  shortLabel: null,
  description: null,
  clientId: 'client-internal',
  status: 'active',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
}

const CONTEXT: CurrentContext = { activity: ACTIVITY, project: PROJECT }

/**
 * Forty minutes back from now, so the row reads "40 minutes ago" — the same
 * elapsed rendering the launcher's card uses. Relative to the clock rather
 * than a pinned instant because `formatElapsed` reads `Date.now()`, and this
 * file deliberately runs on real timers (nothing here animates or counts
 * down). Forty is also chosen to contain neither of the digits the
 * sequence-versus-capture-number test looks for.
 */
const FORTY_MINUTES_AGO = new Date(Date.now() - 40 * 60_000).toISOString()

/**
 * A complete, typed `FieldRecord`, overridable in part — the same shape as
 * `diagnostics.test.tsx`'s `recordFrom`. `accuracyM` is lifted out of the
 * fix because that is what the brief's tests vary, and burying it would make
 * every accuracy case restate fourteen fields of positional provenance.
 */
function recordRow(overrides: Partial<FieldRecord> & { accuracyM?: number } = {}): FieldRecord {
  const { accuracyM, ...rest } = overrides
  const fix: StoredFix = {
    quality: 'deliberate',
    latitude: -37.8136,
    longitude: 147.8302,
    accuracyM: accuracyM ?? 5,
    datum: 'WGS84',
    holdMs: 8000,
    accuracyConvention: 'radius68',
    verticalAccuracyM: null,
    isMocked: false,
    provider: 'gps',
    gpsTime: null,
    altitudeM: null,
    altitudeReference: null,
    sampleCount: 1,
    spreadM: null,
  }
  return {
    id: 'rec_x',
    activityId: ACTIVITY.id,
    contextActivityId: ACTIVITY.id,
    kind: 'pin',
    captureNumber: 1,
    sequence: 1,
    filedAt: null,
    title: 'Bank scrape',
    description: null,
    fix,
    capturedAt: FORTY_MINUTES_AGO,
    deviceId: 'dev_s25',
    attributes: {},
    ...rest,
  }
}

/**
 * A promise a test resolves by hand, for the two cases that are about a read
 * still being in flight. `resolve` is given a no-op first so it has a type
 * before the executor — which runs synchronously — replaces it.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

async function renderRecords(): Promise<void> {
  await render(
    <ThemeProvider initial="dark">
      <RecordsScreen />
    </ThemeProvider>,
  )
}

function spokenDescription(): unknown {
  return screen.getByTestId('records-spoken-description').props.accessibilityLabel
}

/** Fires the focus effect again, as returning from a capture would. */
async function refocus(): Promise<void> {
  const effect = mockFocus.effect
  if (effect === null) throw new Error('The screen never registered a focus effect.')
  await act(async () => {
    effect()
  })
}

beforeEach(() => {
  mockStatus = { state: 'ready', error: null, applied: ['001_initial'] }
  mockFocus.effect = null
  mockRouter.push.mockClear()
  mockRouter.back.mockClear()
  mockRouter.replace.mockClear()
  mockRepo.readCurrentContext.mockReset()
  mockRepo.listRecords.mockReset()
  mockRepo.readCurrentContext.mockResolvedValue(CONTEXT)
  mockRepo.listRecords.mockResolvedValue([])
})

describe('the records list', () => {
  it('lists the records in the activity, in the order the repository returns', async () => {
    // `listRecords` orders `captured_at DESC` — newest first. The screen shows
    // that order and never re-sorts: a second ordering here could disagree
    // with the repository's, and the two would be right on different days.
    // So the fixture is handed back newest-first, as the real query would,
    // and the assertion is that it survives to the screen unchanged.
    listRecords.mockResolvedValue([
      recordRow({ id: 'rec_b', sequence: 2, capturedAt: new Date(Date.now() - 5 * 60_000).toISOString() }),
      recordRow({ id: 'rec_a', sequence: 1 }),
    ])
    await renderRecords()
    expect(screen.getAllByTestId(/^record-row-/).map((r) => r.props.testID)).toEqual([
      'record-row-rec_b',
      'record-row-rec_a',
    ])
  })

  it('lists the records of the current activity, not of some other one', async () => {
    listRecords.mockResolvedValue([recordRow({ id: 'rec_a' })])
    await renderRecords()
    expect(listRecords).toHaveBeenCalledWith(mockDb, 'act_reach4')
  })

  it('shows the sequence within the activity, not the capture number', async () => {
    // Spec §7.2: two numbers, two questions. This list answers "where in this
    // survey", and the capture number is the one written on a tube.
    listRecords.mockResolvedValue([recordRow({ id: 'rec_a', sequence: 7, captureNumber: 412 })])
    await renderRecords()
    const row = screen.getByTestId('record-row-rec_a')
    // '7' alone would also match inside '017' or '27' — '007' is what the
    // zero-padded sequence actually renders, and only that proves this is the
    // sequence rather than a substring of something else.
    expect(row).toHaveTextContent('007', { exact: false })
    expect(row).not.toHaveTextContent('412', { exact: false })
  })

  it('says the sequence in words for the voiced mode', async () => {
    listRecords.mockResolvedValue([recordRow({ id: 'rec_a', sequence: 7 })])
    await renderRecords()
    expect(screen.getByTestId('record-sequence-rec_a').props.accessibilityLabel).toBe(
      'Number 7 in this activity',
    )
  })

  it('keeps the record id off the screen (doctrine rule 6)', async () => {
    listRecords.mockResolvedValue([recordRow({ id: 'rec_a', sequence: 1 })])
    await renderRecords()
    expect(screen.getByTestId('record-row-rec_a')).not.toHaveTextContent('rec_a', { exact: false })
  })

  it('shows a record with no title without pretending it has one', async () => {
    listRecords.mockResolvedValue([recordRow({ id: 'rec_a', sequence: 1, title: null })])
    await renderRecords()
    expect(screen.getByTestId('record-row-rec_a')).toHaveTextContent(/untitled/i)
  })

  it('shows how good each fix was', async () => {
    listRecords.mockResolvedValue([recordRow({ id: 'rec_a', sequence: 1, accuracyM: 2.4 })])
    await renderRecords()
    expect(screen.getByTestId('record-row-rec_a')).toHaveTextContent('2.4', { exact: false })
  })

  it('rounds a real GPS float to one decimal rather than showing it raw', async () => {
    // 4.728091239929199 is the shape an actual reading arrives in — far more
    // precision than the reading ever earned (docs/gps-accuracy.md). The row
    // must read "4.7", never the long form.
    listRecords.mockResolvedValue([
      recordRow({ id: 'rec_a', sequence: 1, accuracyM: 4.728091239929199 }),
    ])
    await renderRecords()
    const row = screen.getByTestId('record-row-rec_a')
    expect(row).toHaveTextContent('4.7', { exact: false })
    expect(row).not.toHaveTextContent('4.728091239929199', { exact: false })
  })

  it('does not dress an ambient fix up as a deliberate one', async () => {
    // Spec §8.2's distinction, which `ContextStamp` states and this screen is
    // only allowed to pass through. A screen that built its own chip could
    // show a cached position as a survey-grade reading and every other test
    // here would still pass.
    listRecords.mockResolvedValue([
      recordRow({
        id: 'rec_a',
        sequence: 1,
        fix: {
          quality: 'ambient',
          ageSeconds: 240,
          latitude: -37.8136,
          longitude: 147.8302,
          accuracyM: 38,
          datum: 'WGS84',
          verticalAccuracyM: null,
          accuracyConvention: 'unknown',
          isMocked: false,
          provider: 'fused',
          gpsTime: null,
          altitudeM: null,
          altitudeReference: null,
        },
      }),
    ])
    await renderRecords()
    const row = screen.getByTestId('record-row-rec_a')
    expect(row).toHaveTextContent('~ ±38 m · 4 min old', { exact: false })
  })

  it('says when each record was taken', async () => {
    listRecords.mockResolvedValue([recordRow({ id: 'rec_a', sequence: 1 })])
    await renderRecords()
    expect(screen.getByTestId('record-row-rec_a')).toHaveTextContent('40 minutes ago', {
      exact: false,
    })
  })

  it('says so plainly when the activity has no records yet', async () => {
    listRecords.mockResolvedValue([])
    await renderRecords()
    expect(screen.getByTestId('records-empty')).toHaveTextContent(/nothing recorded/i)
    expect(screen.getByTestId('records-empty')).toHaveTextContent(/Reach 4 transect/)
  })

  it('says so when there is no activity to list records for', async () => {
    // A different empty state from the one above, and conflating them would
    // tell her an activity is empty when she has not chosen one.
    readCurrentContext.mockResolvedValue(null)
    await renderRecords()
    expect(screen.getByTestId('records-no-activity')).toBeTruthy()
    expect(screen.queryByTestId('records-empty')).toBeNull()
    expect(listRecords).not.toHaveBeenCalled()
  })

  it('offers the one way forward when there is no activity', async () => {
    readCurrentContext.mockResolvedValue(null)
    await renderRecords()
    await fireEvent.press(screen.getByTestId('records-choose-project'))
    expect(mockRouter.push).toHaveBeenCalledWith('/projects')
  })

  it('names the activity it is listing', async () => {
    listRecords.mockResolvedValue([recordRow({ id: 'rec_a' })])
    await renderRecords()
    expect(screen.getByTestId('records-title')).toHaveTextContent('Reach 4 transect')
  })

  it('says the records are still being found rather than drawing an empty list', async () => {
    const pending = deferred<CurrentContext>()
    readCurrentContext.mockReturnValue(pending.promise)
    await renderRecords()
    expect(screen.getByTestId('records-loading')).toBeTruthy()
    expect(screen.queryByTestId('records-empty')).toBeNull()
    expect(screen.queryByTestId('records-no-activity')).toBeNull()
    await act(async () => {
      pending.resolve(CONTEXT)
    })
    expect(screen.queryByTestId('records-loading')).toBeNull()
  })

  it('says so when the records could not be read, instead of looking empty', async () => {
    listRecords.mockRejectedValue(new Error('database is locked'))
    await renderRecords()
    expect(screen.getByTestId('records-error')).toHaveTextContent(/could not be read/i)
    expect(screen.queryByTestId('records-empty')).toBeNull()
  })

  it('leaves the rows on screen while a slower re-read is in flight', async () => {
    // Returning from a capture re-reads. A re-read that blanked the list
    // first would take her records off the screen for as long as the query
    // takes — the same bug the launcher's card had, and the reason
    // `useCurrentContext` never sets `loading` back to true.
    listRecords.mockResolvedValue([recordRow({ id: 'rec_a', sequence: 1 })])
    await renderRecords()
    expect(screen.getByTestId('record-row-rec_a')).toBeTruthy()

    const slow = deferred<FieldRecord[]>()
    listRecords.mockReturnValue(slow.promise)
    await refocus()

    expect(screen.getByTestId('record-row-rec_a')).toBeTruthy()
    expect(screen.queryByTestId('records-loading')).toBeNull()

    await act(async () => {
      slow.resolve([recordRow({ id: 'rec_a', sequence: 1 }), recordRow({ id: 'rec_b', sequence: 2 })])
    })
    expect(screen.getByTestId('record-row-rec_b')).toBeTruthy()
  })

  it('does not make a row pressable when there is nowhere for it to go', async () => {
    // Doctrine rule 18: no record detail screen exists, so a row that looked
    // tappable would swallow the tap and teach her it did not register.
    listRecords.mockResolvedValue([recordRow({ id: 'rec_a', sequence: 1 })])
    await renderRecords()
    const row = screen.getByTestId('record-row-rec_a')
    expect(row.props.onStartShouldSetResponder).toBeUndefined()

    // Not just the row's own host element: a `Pressable` wrapped AROUND the
    // row (rather than something on the row itself) would leave the row's own
    // props untouched and still pass the assertion above. Walk every ancestor
    // up to the render root and check none of them either.
    for (let node = row.parent; node !== null; node = node.parent) {
      expect(node.props.onStartShouldSetResponder).toBeUndefined()
      expect(node.props.onPress).toBeUndefined()
      expect(node.props.onClick).toBeUndefined()
      expect(node.props.accessibilityRole).not.toBe('button')
    }

    expect(screen.queryByRole('button', { name: /Bank scrape/ })).toBeNull()
  })

  describe('the spoken description (doctrine rule 16)', () => {
    it('says how many records, in the plural', async () => {
      listRecords.mockResolvedValue([
        recordRow({ id: 'rec_a', sequence: 1 }),
        recordRow({ id: 'rec_b', sequence: 2 }),
      ])
      await renderRecords()
      expect(spokenDescription()).toMatch(/2 records/)
      expect(spokenDescription()).toMatch(/Reach 4 transect/)
    })

    it('says one record in the singular', async () => {
      // The ledger's "1 unfiled capture are waiting" bug, in the one place it
      // could recur.
      listRecords.mockResolvedValue([recordRow({ id: 'rec_a', sequence: 1 })])
      await renderRecords()
      expect(spokenDescription()).toMatch(/1 record\b/)
      expect(spokenDescription()).not.toMatch(/1 records/)
    })

    it('says the activity is empty, naming it', async () => {
      listRecords.mockResolvedValue([])
      await renderRecords()
      expect(spokenDescription()).toMatch(/nothing recorded/i)
      expect(spokenDescription()).toMatch(/Reach 4 transect/)
    })

    it('says no activity is chosen, not that one is empty', async () => {
      readCurrentContext.mockResolvedValue(null)
      await renderRecords()
      expect(spokenDescription()).toMatch(/no activity/i)
      expect(spokenDescription()).not.toMatch(/nothing recorded/i)
    })

    it('says the records are still being found', async () => {
      const pending = deferred<CurrentContext>()
      readCurrentContext.mockReturnValue(pending.promise)
      await renderRecords()
      expect(spokenDescription()).toMatch(/finding/i)
      await act(async () => {
        pending.resolve(CONTEXT)
      })
    })

    it('says so when the read failed', async () => {
      listRecords.mockRejectedValue(new Error('database is locked'))
      await renderRecords()
      expect(spokenDescription()).toMatch(/could not be read/i)
    })

    it('names the database state it is waiting on', async () => {
      mockStatus = { state: 'opening', error: null, applied: [] }
      await renderRecords()
      expect(spokenDescription()).toMatch(/opening/i)
      expect(screen.queryByTestId('records-empty')).toBeNull()
    })

    it('says so when the database failed, instead of looking like an empty activity', async () => {
      mockStatus = { state: 'failed', error: new Error('migration 003 failed'), applied: [] }
      await renderRecords()
      expect(screen.queryByTestId('records-empty')).toBeNull()
      expect(screen.getByTestId('records')).toHaveTextContent(/migration 003 failed/, {
        exact: false,
      })
    })
  })
})
