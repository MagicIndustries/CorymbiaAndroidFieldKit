import React from 'react'
import { act, render, fireEvent, screen, waitFor } from '@testing-library/react-native'
import { ThemeProvider } from '@corymbia/ui'
import type { Activity, CurrentContext, FieldRecord, Project, StoredFix } from '@corymbia/data'

/**
 * Tests for the Inbox (spec §10.2) — the screen the launcher's Inbox strip
 * opens, listing every record captured with no activity running and offering
 * to file each one.
 *
 * **The Inbox is a supported destination, not an error state.** Nothing on
 * this screen may read as a queue of mistakes, which is why the very first
 * test below is about wording rather than behaviour.
 *
 * WHAT IS AND IS NOT MOCKED. The six repository functions this screen calls
 * are (`listUnfiledRecords`, `fileRecord`, `listProjects`, `listActivities`,
 * `listRecords`, `readCurrentContext`) and nothing else is. Every one of them is already
 * proved in `packages/data` — `fileRecord`'s renumbering especially, which
 * this screen must call and must not reimplement. What is left for this file
 * is what the screen does with their answers: which destination it offers,
 * what it passes to `fileRecord`, what it shows when a filing fails, and
 * whether a refresh can blank a list that is already on the screen.
 *
 * `ContextStamp` is deliberately NOT mocked, for the same reason
 * `records.test.tsx` leaves it alone: spec §8.2's three fix classes are the
 * one thing that must never be blurred, and a stub would let this screen
 * render an ambient fix as a deliberate one with every test still green.
 */

const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  replace: jest.fn(),
}

/**
 * The focus effect the screen registers, kept so a test can fire a SECOND
 * focus by hand — she leaves the Inbox for a capture and comes back, and the
 * list must not blank while the re-read is in flight.
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

const mockDevice = {
  id: 'device-under-test',
  installId: 'install-1',
  label: 'test-handset',
  manufacturer: 'Test',
  brand: 'Test',
  modelName: 'Model',
  modelId: 'model-1',
  deviceType: 'phone' as const,
  osName: 'Android',
  osVersion: '15',
  isPhysical: true,
  appVersion: '1.0.0',
  appBuild: '1',
  firstSeenAt: '2026-09-07T00:00:00.000Z',
  lastSeenAt: '2026-09-07T00:00:00.000Z',
}

jest.mock('../../src/db/provider', () => ({
  useDatabase: () => mockDb,
  useDatabaseStatus: () => mockStatus,
  useDevice: () => mockDevice,
}))

/**
 * Typed against the real functions (`jest.fn<ReturnType<F>, Parameters<F>>()`
 * — the two-argument form, since the single-argument shorthand does not
 * compile under `@types/jest` 29), so a `mockResolvedValue` below can only
 * ever be handed a shape the real repository actually returns.
 */
const mockRepo = {
  listUnfiledRecords: jest.fn<
    ReturnType<typeof import('@corymbia/data').listUnfiledRecords>,
    Parameters<typeof import('@corymbia/data').listUnfiledRecords>
  >(),
  fileRecord: jest.fn<
    ReturnType<typeof import('@corymbia/data').fileRecord>,
    Parameters<typeof import('@corymbia/data').fileRecord>
  >(),
  listProjects: jest.fn<
    ReturnType<typeof import('@corymbia/data').listProjects>,
    Parameters<typeof import('@corymbia/data').listProjects>
  >(),
  listActivities: jest.fn<
    ReturnType<typeof import('@corymbia/data').listActivities>,
    Parameters<typeof import('@corymbia/data').listActivities>
  >(),
  /**
   * Read when she picks a destination in the chooser, for one fact: how many
   * records that activity already holds, which is what makes "1 to 5" sayable
   * beside the position field.
   */
  listRecords: jest.fn<
    ReturnType<typeof import('@corymbia/data').listRecords>,
    Parameters<typeof import('@corymbia/data').listRecords>
  >(),
  readCurrentContext: jest.fn<
    ReturnType<typeof import('@corymbia/data').readCurrentContext>,
    Parameters<typeof import('@corymbia/data').readCurrentContext>
  >(),
}

jest.mock('@corymbia/data', () => ({
  listUnfiledRecords: (...args: Parameters<typeof import('@corymbia/data').listUnfiledRecords>) =>
    mockRepo.listUnfiledRecords(...args),
  fileRecord: (...args: Parameters<typeof import('@corymbia/data').fileRecord>) =>
    mockRepo.fileRecord(...args),
  listProjects: (...args: Parameters<typeof import('@corymbia/data').listProjects>) =>
    mockRepo.listProjects(...args),
  listActivities: (...args: Parameters<typeof import('@corymbia/data').listActivities>) =>
    mockRepo.listActivities(...args),
  listRecords: (...args: Parameters<typeof import('@corymbia/data').listRecords>) =>
    mockRepo.listRecords(...args),
  readCurrentContext: (...args: Parameters<typeof import('@corymbia/data').readCurrentContext>) =>
    mockRepo.readCurrentContext(...args),
}))

// Plain aliases, matching the brief's own naming — not referenced from inside
// the `jest.mock` factories above, which are hoisted ahead of this.
const listUnfiledRecords = mockRepo.listUnfiledRecords
const fileRecord = mockRepo.fileRecord
const listProjects = mockRepo.listProjects
const listActivities = mockRepo.listActivities
const listRecords = mockRepo.listRecords
const readCurrentContext = mockRepo.readCurrentContext

// Imported after the mocks so it picks them up.
import InboxScreen from '../inbox'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_TAMBO: Project = {
  id: 'prj_tambo',
  name: 'Tambo River eDNA',
  shortLabel: null,
  description: null,
  clientId: 'client-internal',
  status: 'active',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
}

const PROJECT_MOORA: Project = {
  ...PROJECT_TAMBO,
  id: 'prj_moora',
  name: 'Moorabool wetlands',
  updatedAt: '2026-08-01T00:00:00.000Z',
}

/** The activity that was running when the fixture records were captured. */
const ACT_SURVEY: Activity = {
  id: 'act_survey',
  projectId: PROJECT_TAMBO.id,
  kind: 'survey',
  name: 'Reach 4 transect',
  shortLabel: null,
  startedAt: '2026-09-05T00:00:00.000Z',
  endedAt: null,
}

/** An activity in a different project, so the chooser's grouping is exercised. */
const ACT_SAMPLING: Activity = {
  id: 'act_sampling',
  projectId: PROJECT_MOORA.id,
  kind: 'sampling',
  name: 'Soil grid A',
  shortLabel: null,
  startedAt: '2026-09-03T00:00:00.000Z',
  endedAt: null,
}

const CONTEXT: CurrentContext = { activity: ACT_SURVEY, project: PROJECT_TAMBO }

/**
 * Forty minutes back from now, so a row reads "40 minutes ago" — the same
 * elapsed rendering the launcher's card and the records list use. Relative to
 * the clock rather than a pinned instant because `formatElapsed` reads
 * `Date.now()`, and this file deliberately runs on real timers (nothing here
 * animates or counts down).
 */
const FORTY_MINUTES_AGO = new Date(Date.now() - 40 * 60_000).toISOString()

/**
 * An unfiled record: no activity, no sequence, never filed. `captureNumber` is
 * the only number it has — in the Inbox that is its tube label and its whole
 * identity (spec §7.2).
 *
 * `contextActivityId` defaults to `act_survey` rather than null because the
 * common case is a capture taken while an activity was running and simply not
 * filed to it; the no-context case is asked for explicitly by the one test
 * about it.
 */
function unfiled(id: string, overrides: Partial<FieldRecord> = {}): FieldRecord {
  const fix: StoredFix = {
    quality: 'deliberate',
    latitude: -37.8136,
    longitude: 147.8302,
    accuracyM: 5,
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
    id,
    activityId: null,
    contextActivityId: ACT_SURVEY.id,
    kind: 'pin',
    captureNumber: 412,
    sequence: null,
    filedAt: null,
    title: 'Bank scrape',
    description: null,
    fix,
    capturedAt: FORTY_MINUTES_AGO,
    deviceId: 'dev_s25',
    attributes: {},
    ...overrides,
  }
}

/** The record `fileRecord` hands back — never read by the screen, but typed. */
function filed(id: string, activityId: string): FieldRecord {
  return unfiled(id, { activityId, sequence: 1, filedAt: new Date().toISOString() })
}

/**
 * `count` records already sitting in an activity. The screen reads exactly
 * one thing from `listRecords` — how many came back — so the ordinals here
 * are honest rather than load-bearing.
 *
 * Four by default across this file, which makes the offered range 1 to 5: one
 * past the end, because appending is a legal position.
 */
function holding(count: number, activityId: string): FieldRecord[] {
  return Array.from({ length: count }, (_unused, at) =>
    unfiled(`rec_held_${String(at + 1)}`, {
      activityId,
      sequence: at + 1,
      filedAt: '2026-09-05T01:00:00.000Z',
    }),
  )
}

/**
 * A promise a test resolves by hand, for the cases that are about a read or a
 * write still being in flight. `resolve` is given a no-op first so it has a
 * type before the executor — which runs synchronously — replaces it.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

async function renderInbox(): Promise<void> {
  await render(
    <ThemeProvider initial="dark">
      <InboxScreen />
    </ThemeProvider>,
  )
}

function spokenDescription(): unknown {
  return screen.getByTestId('inbox-spoken-description').props.accessibilityLabel
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
  listUnfiledRecords.mockReset()
  fileRecord.mockReset()
  listProjects.mockReset()
  listActivities.mockReset()
  listRecords.mockReset()
  readCurrentContext.mockReset()

  listUnfiledRecords.mockResolvedValue([])
  fileRecord.mockImplementation((_db, input) =>
    Promise.resolve(filed(input.recordId, input.activityId)),
  )
  listProjects.mockResolvedValue([PROJECT_TAMBO, PROJECT_MOORA])
  listActivities.mockImplementation((_db, projectId) =>
    Promise.resolve(
      projectId === PROJECT_TAMBO.id
        ? [ACT_SURVEY]
        : projectId === PROJECT_MOORA.id
          ? [ACT_SAMPLING]
          : [],
    ),
  )
  listRecords.mockImplementation((_db, activityId) => Promise.resolve(holding(4, activityId)))
  readCurrentContext.mockResolvedValue(CONTEXT)
})

describe('the Inbox', () => {
  // -------------------------------------------------------------------------
  // The brief's tests
  // -------------------------------------------------------------------------

  it('lists what is unfiled without calling it a problem', async () => {
    listUnfiledRecords.mockResolvedValue([unfiled('rec_a'), unfiled('rec_b')])
    await renderInbox()
    expect(screen.getAllByTestId(/^inbox-row-/)).toHaveLength(2)
    expect(screen.getByTestId('inbox')).not.toHaveTextContent(/error|problem|unassigned/i, {
      exact: false,
    })
  })

  it('files a record into the activity that was running when it was taken', async () => {
    // Spec §8.3: the context link exists so an unfiled record still knows
    // where she was. That makes one tap enough for the common case.
    listUnfiledRecords.mockResolvedValue([unfiled('rec_a', { contextActivityId: 'act_survey' })])
    await renderInbox()
    await fireEvent.press(screen.getByTestId('inbox-file-rec_a'))
    expect(fileRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recordId: 'rec_a', activityId: 'act_survey' }),
    )
  })

  it('appends by default rather than asking where', async () => {
    listUnfiledRecords.mockResolvedValue([unfiled('rec_a', { contextActivityId: 'act_survey' })])
    await renderInbox()
    await fireEvent.press(screen.getByTestId('inbox-file-rec_a'))
    expect(fileRecord.mock.calls[0]?.[1].position).toBeUndefined()
  })

  it('lets her file into a different activity', async () => {
    /*
      AMENDED FROM THE BRIEF, which pressed the activity alone and expected a
      filing. The brief's next test presses an activity, THEN types a
      position, THEN presses `inbox-confirm`, and expects the FIRST call to
      `fileRecord` to carry that position — which is only possible if pressing
      an activity does not file. The two tests cannot both hold, so the
      chooser resolves it the way that keeps both honest: pressing an activity
      selects it, and `inbox-confirm` — whose label names the destination —
      files. One tap is still one tap for the common case; that is what
      `inbox-file-<id>` above is for.
    */
    listUnfiledRecords.mockResolvedValue([unfiled('rec_a', { contextActivityId: 'act_survey' })])
    await renderInbox()
    await fireEvent.press(screen.getByTestId('inbox-choose-rec_a'))
    await fireEvent.press(screen.getByTestId('inbox-activity-act_sampling'))
    await fireEvent.press(screen.getByTestId('inbox-confirm'))
    expect(fileRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recordId: 'rec_a', activityId: 'act_sampling' }),
    )
  })

  it('offers a position when she wants one, and passes it through', async () => {
    listUnfiledRecords.mockResolvedValue([unfiled('rec_a', { contextActivityId: 'act_survey' })])
    await renderInbox()
    await fireEvent.press(screen.getByTestId('inbox-choose-rec_a'))
    await fireEvent.press(screen.getByTestId('inbox-activity-act_survey'))
    await fireEvent.changeText(screen.getByTestId('inbox-position'), '3')
    await fireEvent.press(screen.getByTestId('inbox-confirm'))
    expect(fileRecord.mock.calls[0]?.[1].position).toBe(3)
  })

  it('stops showing a record once it is filed', async () => {
    listUnfiledRecords.mockResolvedValueOnce([unfiled('rec_a')]).mockResolvedValueOnce([])
    await renderInbox()
    await fireEvent.press(screen.getByTestId('inbox-file-rec_a'))
    await waitFor(() => {
      expect(screen.queryByTestId('inbox-row-rec_a')).toBeNull()
    })
    expect(listUnfiledRecords).toHaveBeenCalledTimes(2)
  })

  it('says so and keeps the record when filing fails', async () => {
    // An optimistic removal would tell her it is filed while it is not, and
    // the records list would disagree.
    fileRecord.mockRejectedValue(new Error('database is locked'))
    listUnfiledRecords.mockResolvedValue([unfiled('rec_a', { contextActivityId: 'act_survey' })])
    await renderInbox()
    await fireEvent.press(screen.getByTestId('inbox-file-rec_a'))
    expect(screen.getByTestId('inbox-row-rec_a')).toBeTruthy()
    expect(screen.getByTestId('inbox-error')).toHaveTextContent(/could not be filed/i)
  })

  it('says so plainly when the Inbox is empty', async () => {
    listUnfiledRecords.mockResolvedValue([])
    await renderInbox()
    expect(screen.getByTestId('inbox-empty')).toHaveTextContent(/nothing waiting/i)
  })

  it('offers no one-tap filing for a record with no context activity', async () => {
    // A capture taken with no activity running has nothing to suggest, and a
    // button that guesses would file it somewhere she did not choose.
    listUnfiledRecords.mockResolvedValue([unfiled('rec_a', { contextActivityId: null })])
    await renderInbox()
    expect(screen.queryByTestId('inbox-file-rec_a')).toBeNull()
    expect(screen.getByTestId('inbox-choose-rec_a')).toBeTruthy()
  })

  // -------------------------------------------------------------------------
  // What a row says
  // -------------------------------------------------------------------------

  describe('a row', () => {
    it('shows the capture number, which in the Inbox is the only number it has', async () => {
      // Spec §7.2: two numbers, two questions. An unfiled record has no
      // sequence at all — it is in no activity to be an ordinal within — so
      // the capture number, the one safe to write on a tube, is what she
      // reads here.
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a', { captureNumber: 412 })])
      await renderInbox()
      expect(screen.getByTestId('inbox-row-rec_a')).toHaveTextContent('Capture 412', {
        exact: false,
      })
    })

    it('keeps the record id off the screen (doctrine rule 6)', async () => {
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a')])
      await renderInbox()
      expect(screen.getByTestId('inbox-row-rec_a')).not.toHaveTextContent('rec_a', { exact: false })
    })

    it('shows a record with no title without pretending it has one', async () => {
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a', { title: null })])
      await renderInbox()
      expect(screen.getByTestId('inbox-row-rec_a')).toHaveTextContent(/untitled/i)
    })

    it('does not dress an ambient fix up as a deliberate one', async () => {
      // Spec §8.2's distinction, which `ContextStamp` states and this screen
      // is only allowed to pass through. A screen that built its own chip
      // could show a cached position as a survey-grade reading and every
      // other test here would still pass.
      listUnfiledRecords.mockResolvedValue([
        unfiled('rec_a', {
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
      await renderInbox()
      expect(screen.getByTestId('inbox-row-rec_a')).toHaveTextContent('~ ±38 m · 4 min old', {
        exact: false,
      })
    })

    it('says when it was taken', async () => {
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a')])
      await renderInbox()
      expect(screen.getByTestId('inbox-row-rec_a')).toHaveTextContent('40 minutes ago', {
        exact: false,
      })
    })

    it('names the destination on the one-tap button rather than showing an id', async () => {
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a')])
      await renderInbox()
      expect(screen.getByTestId('inbox-file-rec_a')).toHaveTextContent('File into Reach 4 transect')
    })

    it('offers no one-tap filing into an activity that has since been deleted', async () => {
      // `fileRecord` refuses a soft-deleted destination, so a button offering
      // one is a control that can only ever produce a refusal — doctrine rule
      // 18's inert control, dressed as the primary action.
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a', { contextActivityId: 'act_gone' })])
      await renderInbox()
      expect(screen.queryByTestId('inbox-file-rec_a')).toBeNull()
      expect(screen.getByTestId('inbox-choose-rec_a')).toBeTruthy()
    })
  })

  // -------------------------------------------------------------------------
  // The chooser
  // -------------------------------------------------------------------------

  describe('the chooser', () => {
    it('is closed until she asks for it', async () => {
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a')])
      await renderInbox()
      expect(screen.queryByTestId('inbox-activity-act_sampling')).toBeNull()
      expect(screen.queryByTestId('inbox-position')).toBeNull()
      expect(screen.queryByTestId('inbox-confirm')).toBeNull()
    })

    it('lists every live activity across every project', async () => {
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a')])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-choose-rec_a'))
      expect(screen.getByTestId('inbox-activity-act_survey')).toBeTruthy()
      expect(screen.getByTestId('inbox-activity-act_sampling')).toBeTruthy()
    })

    it('names the project each activity belongs to', async () => {
      // Two projects can each have a "Reach 4 transect"; the activity name
      // alone does not say which survey she would be filing into.
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a')])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-choose-rec_a'))
      const chooser = screen.getByTestId('inbox-chooser-rec_a')
      expect(chooser).toHaveTextContent('Tambo River eDNA', { exact: false })
      expect(chooser).toHaveTextContent('Moorabool wetlands', { exact: false })
    })

    it('puts the activity she is in first, however the projects come back', async () => {
      // `listProjects` orders by status then recency, which has nothing to do
      // with where she is standing. The current activity is the likeliest
      // destination and must not be somewhere down the list.
      listProjects.mockResolvedValue([PROJECT_MOORA, PROJECT_TAMBO])
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a')])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-choose-rec_a'))
      expect(screen.getAllByTestId(/^inbox-activity-/).map((n) => n.props.testID)).toEqual([
        'inbox-activity-act_survey',
        'inbox-activity-act_sampling',
      ])
    })

    it('says which one is current in a word, not in a colour (doctrine rule 9)', async () => {
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a')])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-choose-rec_a'))
      expect(screen.getByTestId('inbox-activity-act_survey')).toHaveTextContent(/current/i)
      expect(screen.getByTestId('inbox-activity-act_sampling')).not.toHaveTextContent(/current/i, {
        exact: false,
      })
    })

    it('opens for one record at a time', async () => {
      // Two open choosers are two half-answered questions, and the position
      // field belongs to exactly one of them.
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a'), unfiled('rec_b')])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-choose-rec_a'))
      expect(screen.getByTestId('inbox-chooser-rec_a')).toBeTruthy()
      await fireEvent.press(screen.getByTestId('inbox-choose-rec_b'))
      expect(screen.getByTestId('inbox-chooser-rec_b')).toBeTruthy()
      expect(screen.queryByTestId('inbox-chooser-rec_a')).toBeNull()
    })

    it('says what is missing when there is no activity anywhere, rather than opening empty', async () => {
      /*
        A supported state, not a broken one: doctrine rule 4 lets her capture
        before she has set anything up, and this screen is where those
        captures land. An empty chooser is doctrine rule 18's inert control —
        a button that opens nothing — so it says what is missing and offers
        the one thing that fixes it.
      */
      listProjects.mockResolvedValue([])
      listActivities.mockResolvedValue([])
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a', { contextActivityId: null })])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-choose-rec_a'))

      expect(screen.getByTestId('inbox-no-activities')).toHaveTextContent(
        'There is no activity to file this into yet. Start one from a project.',
      )
      expect(screen.getByTestId('inbox-start-activity')).toBeTruthy()
      expect(screen.queryByTestId('inbox-confirm')).toBeNull()
      expect(screen.queryByTestId('inbox-position')).toBeNull()
    })

    it('sends her to the projects list to start one', async () => {
      listProjects.mockResolvedValue([])
      listActivities.mockResolvedValue([])
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a', { contextActivityId: null })])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-choose-rec_a'))
      await fireEvent.press(screen.getByTestId('inbox-start-activity'))
      expect(mockRouter.push).toHaveBeenCalledWith('/projects')
    })

    it('asks nothing further until she has chosen a destination', async () => {
      // Doctrine rule 18: a confirm button with nowhere to file to is a
      // control that can only swallow the tap.
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a')])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-choose-rec_a'))
      expect(screen.queryByTestId('inbox-confirm')).toBeNull()
      expect(screen.queryByTestId('inbox-position')).toBeNull()
    })

    it('names the destination on the button that files', async () => {
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a')])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-choose-rec_a'))
      await fireEvent.press(screen.getByTestId('inbox-activity-act_sampling'))
      expect(screen.getByTestId('inbox-confirm')).toHaveTextContent('File into Soil grid A')
    })

    it('closes once the record it belonged to has been filed', async () => {
      listUnfiledRecords
        .mockResolvedValueOnce([unfiled('rec_a'), unfiled('rec_b')])
        .mockResolvedValueOnce([unfiled('rec_b')])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-choose-rec_a'))
      await fireEvent.press(screen.getByTestId('inbox-activity-act_sampling'))
      await fireEvent.press(screen.getByTestId('inbox-confirm'))
      await waitFor(() => {
        expect(screen.queryByTestId('inbox-row-rec_a')).toBeNull()
      })
      expect(screen.queryByTestId('inbox-confirm')).toBeNull()
    })

    it('reads the activities once with the list, not again per opening', async () => {
      // There are few projects and few activities, and re-querying every time
      // she opens a chooser buys nothing but a pause before the list appears.
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a'), unfiled('rec_b')])
      await renderInbox()
      expect(listProjects).toHaveBeenCalledTimes(1)
      expect(listActivities).toHaveBeenCalledTimes(2)
      await fireEvent.press(screen.getByTestId('inbox-choose-rec_a'))
      await fireEvent.press(screen.getByTestId('inbox-choose-rec_b'))
      expect(listProjects).toHaveBeenCalledTimes(1)
      expect(listActivities).toHaveBeenCalledTimes(2)
    })
  })

  // -------------------------------------------------------------------------
  // The position
  // -------------------------------------------------------------------------

  describe('the position', () => {
    it('is blank to start with, because appending is the common case', async () => {
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a')])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-choose-rec_a'))
      await fireEvent.press(screen.getByTestId('inbox-activity-act_survey'))
      expect(screen.getByTestId('inbox-position').props.value).toBe('')
      await fireEvent.press(screen.getByTestId('inbox-confirm'))
      expect(fileRecord.mock.calls[0]?.[1].position).toBeUndefined()
    })

    it('takes a number, not a keyboard full of letters', async () => {
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a')])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-choose-rec_a'))
      await fireEvent.press(screen.getByTestId('inbox-activity-act_survey'))
      expect(screen.getByTestId('inbox-position').props.keyboardType).toBe('number-pad')
    })

    it('refuses something that is not a whole number, and does not write', async () => {
      // `fileRecord` would refuse it too, but its refusal arrives dressed as a
      // failure. This is not a failure — it is a field she has mistyped, and
      // it is said as one, before anything is written.
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a')])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-choose-rec_a'))
      await fireEvent.press(screen.getByTestId('inbox-activity-act_survey'))
      await fireEvent.changeText(screen.getByTestId('inbox-position'), 'third')
      await fireEvent.press(screen.getByTestId('inbox-confirm'))
      expect(fileRecord).not.toHaveBeenCalled()
      expect(screen.getByTestId('inbox-position-error')).toHaveTextContent(/whole number/i)
    })

    it('refuses a zero, because an activity starts at one', async () => {
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a')])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-choose-rec_a'))
      await fireEvent.press(screen.getByTestId('inbox-activity-act_survey'))
      await fireEvent.changeText(screen.getByTestId('inbox-position'), '0')
      await fireEvent.press(screen.getByTestId('inbox-confirm'))
      expect(fileRecord).not.toHaveBeenCalled()
      expect(screen.getByTestId('inbox-position-error')).toBeTruthy()
    })

    it('says which places are actually in the activity, before she types one', async () => {
      // Four records in it, so the places are 1 to 5 — one past the end,
      // because appending is a legal position and it is the one she gets by
      // leaving the field alone.
      listRecords.mockResolvedValue(holding(4, ACT_SURVEY.id))
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a')])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-choose-rec_a'))
      await fireEvent.press(screen.getByTestId('inbox-activity-act_survey'))
      expect(listRecords).toHaveBeenCalledWith(mockDb, 'act_survey')
      expect(screen.getByTestId('inbox-row-rec_a')).toHaveTextContent('1 TO 5', { exact: false })
    })

    it('refuses a position past the end of the activity without writing or naming an id', async () => {
      /*
        `fileRecord` would refuse this too — and its refusal reads "A position
        is a whole number from 1 to 5 in activity act_survey; got 9", which
        the failure sentence would put on screen verbatim: a raw activity id
        (doctrine rule 6), and a typo dressed as a failed write that then
        parks itself above the list under rule 20. It is a mistyped field, and
        it is said as one, before anything is written.
      */
      listRecords.mockResolvedValue(holding(4, ACT_SURVEY.id))
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a')])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-choose-rec_a'))
      await fireEvent.press(screen.getByTestId('inbox-activity-act_survey'))
      await fireEvent.changeText(screen.getByTestId('inbox-position'), '9')
      await fireEvent.press(screen.getByTestId('inbox-confirm'))

      expect(fileRecord).not.toHaveBeenCalled()
      expect(screen.getByTestId('inbox-position-error')).toHaveTextContent('1 to 5', {
        exact: false,
      })
      expect(screen.queryByTestId('inbox-error')).toBeNull()
      expect(screen.getByTestId('inbox')).not.toHaveTextContent('act_', { exact: false })
    })

    it('still takes the last place in the activity, which is one past its end', async () => {
      // The boundary the range is about: 5 is appending, and appending is
      // never a mistake.
      listRecords.mockResolvedValue(holding(4, ACT_SURVEY.id))
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a')])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-choose-rec_a'))
      await fireEvent.press(screen.getByTestId('inbox-activity-act_survey'))
      await fireEvent.changeText(screen.getByTestId('inbox-position'), '5')
      await fireEvent.press(screen.getByTestId('inbox-confirm'))
      expect(fileRecord.mock.calls[0]?.[1].position).toBe(5)
    })

    it('reads the range of the destination she actually picked', async () => {
      // Two activities of different lengths, and the range beside the field
      // has to belong to the one that is chosen.
      listRecords.mockImplementation((_db, activityId) =>
        Promise.resolve(holding(activityId === ACT_SAMPLING.id ? 1 : 4, activityId)),
      )
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a')])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-choose-rec_a'))
      await fireEvent.press(screen.getByTestId('inbox-activity-act_sampling'))
      expect(screen.getByTestId('inbox-row-rec_a')).toHaveTextContent('1 TO 2', { exact: false })
      await fireEvent.changeText(screen.getByTestId('inbox-position'), '3')
      await fireEvent.press(screen.getByTestId('inbox-confirm'))
      expect(fileRecord).not.toHaveBeenCalled()
      expect(screen.getByTestId('inbox-position-error')).toHaveTextContent('1 to 2', {
        exact: false,
      })
    })

    it('shows the field and the confirm disabled while the range is still being read', async () => {
      // Doctrine rule 18, and rule 10's reason for the "not hidden" half: a
      // field that appeared the instant a query came back would move the
      // confirm button as she reached for it.
      const pending = deferred<FieldRecord[]>()
      listRecords.mockReturnValue(pending.promise)
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a')])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-choose-rec_a'))
      await fireEvent.press(screen.getByTestId('inbox-activity-act_survey'))

      expect(screen.getByTestId('inbox-position').props.editable).toBe(false)
      expect(screen.getByTestId('inbox-confirm').props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: true }),
      )

      await act(async () => {
        pending.resolve(holding(4, ACT_SURVEY.id))
      })
      expect(screen.getByTestId('inbox-position').props.editable).toBe(true)
      expect(screen.getByTestId('inbox-confirm').props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: false }),
      )
    })

    it('still lets her file when the destination could not be read', async () => {
      // Nothing of hers has been touched — the screen simply could not find
      // out how long the activity is — so it asks for a whole number without
      // naming a range and lets `fileRecord` be the backstop it always was.
      listRecords.mockRejectedValue(new Error('database is locked'))
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a')])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-choose-rec_a'))
      await fireEvent.press(screen.getByTestId('inbox-activity-act_survey'))
      await fireEvent.changeText(screen.getByTestId('inbox-position'), '9')
      await fireEvent.press(screen.getByTestId('inbox-confirm'))
      expect(fileRecord.mock.calls[0]?.[1].position).toBe(9)
      expect(screen.queryByTestId('inbox-position-error')).toBeNull()
    })

    it('takes the refusal back the moment she corrects the field', async () => {
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a')])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-choose-rec_a'))
      await fireEvent.press(screen.getByTestId('inbox-activity-act_survey'))
      await fireEvent.changeText(screen.getByTestId('inbox-position'), 'third')
      await fireEvent.press(screen.getByTestId('inbox-confirm'))
      expect(screen.getByTestId('inbox-position-error')).toBeTruthy()
      await fireEvent.changeText(screen.getByTestId('inbox-position'), '3')
      expect(screen.queryByTestId('inbox-position-error')).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Filing
  // -------------------------------------------------------------------------

  describe('filing', () => {
    it('attributes the filing to this device', async () => {
      // Every event carries the device it happened on (spec §8.5); a filing
      // with no device is a chain-of-custody hole.
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a')])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-file-rec_a'))
      expect(fileRecord).toHaveBeenCalledWith(
        mockDb,
        expect.objectContaining({ deviceId: 'device-under-test' }),
      )
    })

    it('reports no position for the filing itself', async () => {
      // `fileRecord`'s `fix` stamps WHERE the filing happened. Filing in bulk
      // from a list is not a positioned act — she may be in the car — and a
      // fix invented for it would be a position nobody took.
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a')])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-file-rec_a'))
      expect(fileRecord.mock.calls[0]?.[1].fix).toBeUndefined()
    })

    it('ignores a second press while the first filing is still in flight', async () => {
      const pending = deferred<FieldRecord>()
      fileRecord.mockReturnValue(pending.promise)
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a')])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-file-rec_a'))
      await fireEvent.press(screen.getByTestId('inbox-file-rec_a'))
      expect(fileRecord).toHaveBeenCalledTimes(1)
      await act(async () => {
        pending.resolve(filed('rec_a', ACT_SURVEY.id))
      })
    })

    it('disables the row mid-filing rather than leaving it inert', async () => {
      // Doctrine rule 18: a control that looks pressable and swallows the tap
      // teaches her the tap did not register when it did.
      const pending = deferred<FieldRecord>()
      fileRecord.mockReturnValue(pending.promise)
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a')])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-file-rec_a'))
      expect(screen.getByTestId('inbox-file-rec_a').props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: true }),
      )
      expect(screen.getByTestId('inbox-choose-rec_a').props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: true }),
      )
      await act(async () => {
        pending.resolve(filed('rec_a', ACT_SURVEY.id))
      })
    })

    it('disables every other row too, because only one filing can be in flight', async () => {
      /*
        REVERSED FROM WHAT THIS FILE FIRST ASSERTED, which was that the other
        rows stayed pressable. They did — and pressing one did nothing:
        `file` takes a single lock and returns early, so every other row's
        button looked live, swallowed the tap and wrote nothing. That is
        exactly doctrine rule 18's inert control, and the rule is cited in
        `inbox.tsx` itself. One filing at a time is the design; the screen now
        says so on every row rather than on one.
      */
      const pending = deferred<FieldRecord>()
      fileRecord.mockReturnValue(pending.promise)
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a'), unfiled('rec_b')])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-file-rec_a'))
      expect(screen.getByTestId('inbox-file-rec_b').props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: true }),
      )
      expect(screen.getByTestId('inbox-choose-rec_b').props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: true }),
      )
      await act(async () => {
        pending.resolve(filed('rec_a', ACT_SURVEY.id))
      })
    })

    it('says in a word which row is the one filing, not in dimness alone', async () => {
      // Doctrine rule 9: the busy row is disabled like every other row, so
      // something other than the disabling has to tell them apart.
      const pending = deferred<FieldRecord>()
      fileRecord.mockReturnValue(pending.promise)
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a'), unfiled('rec_b')])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-file-rec_a'))
      expect(screen.getByTestId('inbox-file-rec_a')).toHaveTextContent(/filing/i)
      expect(screen.getByTestId('inbox-file-rec_b')).not.toHaveTextContent(/filing/i, {
        exact: false,
      })
      await act(async () => {
        pending.resolve(filed('rec_a', ACT_SURVEY.id))
      })
    })

    it('keeps the failure on screen until a filing actually succeeds', async () => {
      // Doctrine rule 20: this sentence is the only telling she gets that the
      // record did not move. Nothing but a successful filing answers it.
      fileRecord.mockRejectedValueOnce(new Error('database is locked'))
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a'), unfiled('rec_b')])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-file-rec_a'))
      expect(screen.getByTestId('inbox-error')).toBeTruthy()

      await fireEvent.press(screen.getByTestId('inbox-choose-rec_a'))
      expect(screen.getByTestId('inbox-error')).toBeTruthy()

      await fireEvent.press(screen.getByTestId('inbox-file-rec_b'))
      await waitFor(() => {
        expect(screen.queryByTestId('inbox-error')).toBeNull()
      })
    })

    it('names which capture it was that could not be filed', async () => {
      // Twelve rows and an unattributed sentence is a sentence about nothing.
      fileRecord.mockRejectedValue(new Error('database is locked'))
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a', { captureNumber: 412 })])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-file-rec_a'))
      expect(screen.getByTestId('inbox-error')).toHaveTextContent('Capture 412', { exact: false })
      expect(screen.getByTestId('inbox-error')).toHaveTextContent('database is locked', {
        exact: false,
      })
    })

    it('says the capture was already filed when the list it came from was stale', async () => {
      /*
        She is looking at a list read some seconds ago. `fileRecord` refuses a
        record that is already in an activity — "Record rec_a is already filed
        into activity act_survey" — and said as a failure that would tell her
        the capture is still waiting when it is not, with a raw id attached.
        The screen asks `listUnfiledRecords` which case it is rather than
        reading the error's wording.
      */
      fileRecord.mockRejectedValue(new Error('Record rec_a is already filed into act_survey.'))
      listUnfiledRecords
        .mockResolvedValueOnce([unfiled('rec_a', { captureNumber: 412 })])
        .mockResolvedValue([])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-file-rec_a'))

      await waitFor(() => {
        expect(screen.getByTestId('inbox-error')).toHaveTextContent(
          'Capture 412 was already filed, so it is no longer waiting here.',
        )
      })
      expect(screen.getByTestId('inbox-error')).not.toHaveTextContent(/still here/i, {
        exact: false,
      })
      expect(screen.getByTestId('inbox')).not.toHaveTextContent('act_', { exact: false })
      expect(screen.queryByTestId('inbox-row-rec_a')).toBeNull()
    })

    it('says the capture is still here when the re-read still finds it waiting', async () => {
      // The other branch of the same check, and the common one: the write
      // really did fail and the record really is still in the Inbox.
      fileRecord.mockRejectedValue(new Error('database is locked'))
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a', { captureNumber: 412 })])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-file-rec_a'))

      await waitFor(() => {
        expect(screen.getByTestId('inbox-error')).toHaveTextContent(/still here/i, {
          exact: false,
        })
      })
      expect(screen.getByTestId('inbox-error')).toHaveTextContent('database is locked', {
        exact: false,
      })
      expect(screen.getByTestId('inbox-row-rec_a')).toBeTruthy()
    })

    it('reports the capture as still here when the re-read fails as well', async () => {
      // The conservative half: a re-read that answers nothing is not evidence
      // the record moved, and the rest of the screen is still showing it.
      fileRecord.mockRejectedValue(new Error('database is locked'))
      listUnfiledRecords
        .mockResolvedValueOnce([unfiled('rec_a', { captureNumber: 412 })])
        .mockRejectedValue(new Error('database is locked'))
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-file-rec_a'))

      await waitFor(() => {
        expect(screen.getByTestId('inbox-error')).toHaveTextContent(/still here/i, {
          exact: false,
        })
      })
      expect(screen.getByTestId('inbox-row-rec_a')).toBeTruthy()
    })

    it('lets her try again after a failure', async () => {
      fileRecord.mockRejectedValueOnce(new Error('database is locked'))
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a')])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-file-rec_a'))
      await fireEvent.press(screen.getByTestId('inbox-file-rec_a'))
      expect(fileRecord).toHaveBeenCalledTimes(2)
    })
  })

  // -------------------------------------------------------------------------
  // Reading, refreshing and failing to read
  // -------------------------------------------------------------------------

  describe('reading the list', () => {
    it('says it is still looking rather than drawing an empty Inbox', async () => {
      const pending = deferred<FieldRecord[]>()
      listUnfiledRecords.mockReturnValue(pending.promise)
      await renderInbox()
      expect(screen.getByTestId('inbox-loading')).toBeTruthy()
      expect(screen.queryByTestId('inbox-empty')).toBeNull()
      await act(async () => {
        pending.resolve([])
      })
      expect(screen.queryByTestId('inbox-loading')).toBeNull()
    })

    it('re-reads when she comes back to it', async () => {
      listUnfiledRecords.mockResolvedValueOnce([unfiled('rec_a')]).mockResolvedValueOnce([
        unfiled('rec_a'),
        unfiled('rec_b'),
      ])
      await renderInbox()
      await refocus()
      expect(screen.getByTestId('inbox-row-rec_b')).toBeTruthy()
    })

    it('leaves the rows on screen while a slower re-read is in flight', async () => {
      // Returning from a capture re-reads. A re-read that blanked the list
      // first would take her Inbox off the screen for as long as the query
      // takes — the same bug the launcher's card had.
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a')])
      await renderInbox()
      expect(screen.getByTestId('inbox-row-rec_a')).toBeTruthy()

      const slow = deferred<FieldRecord[]>()
      listUnfiledRecords.mockReturnValue(slow.promise)
      await refocus()

      expect(screen.getByTestId('inbox-row-rec_a')).toBeTruthy()
      expect(screen.queryByTestId('inbox-loading')).toBeNull()
      expect(screen.queryByTestId('inbox-empty')).toBeNull()

      await act(async () => {
        slow.resolve([unfiled('rec_a'), unfiled('rec_b')])
      })
      expect(screen.getByTestId('inbox-row-rec_b')).toBeTruthy()
    })

    it('says so when the Inbox could not be read, instead of looking empty', async () => {
      listUnfiledRecords.mockRejectedValue(new Error('database is locked'))
      await renderInbox()
      expect(screen.getByTestId('inbox-load-error')).toHaveTextContent(/could not be read/i)
      expect(screen.queryByTestId('inbox-empty')).toBeNull()
    })

    it('keeps the rows it already had when a later read fails', async () => {
      // Doctrine rule 20: what is on the screen was true a moment ago, and
      // replacing it with nothing tells her less, not more.
      listUnfiledRecords.mockResolvedValueOnce([unfiled('rec_a')])
      await renderInbox()
      listUnfiledRecords.mockRejectedValueOnce(new Error('database is locked'))
      await refocus()
      expect(screen.getByTestId('inbox-row-rec_a')).toBeTruthy()
      expect(screen.getByTestId('inbox-load-error')).toBeTruthy()
    })

    it('re-reads when she presses Try again', async () => {
      // The one control on this screen whose whole job is a second attempt.
      // Without its `onPress` doing the read, the failure sentence is a dead
      // end she can only leave by navigating away.
      listUnfiledRecords.mockRejectedValueOnce(new Error('database is locked'))
      await renderInbox()
      expect(screen.getByTestId('inbox-load-error')).toBeTruthy()
      expect(listUnfiledRecords).toHaveBeenCalledTimes(1)

      listUnfiledRecords.mockResolvedValueOnce([unfiled('rec_a')])
      await fireEvent.press(screen.getByTestId('inbox-retry'))

      await waitFor(() => {
        expect(screen.getByTestId('inbox-row-rec_a')).toBeTruthy()
      })
      expect(listUnfiledRecords).toHaveBeenCalledTimes(2)
      expect(screen.queryByTestId('inbox-load-error')).toBeNull()
    })

    it('takes the failure back once a read succeeds', async () => {
      listUnfiledRecords.mockRejectedValueOnce(new Error('database is locked'))
      await renderInbox()
      expect(screen.getByTestId('inbox-load-error')).toBeTruthy()
      listUnfiledRecords.mockResolvedValueOnce([unfiled('rec_a')])
      await refocus()
      expect(screen.queryByTestId('inbox-load-error')).toBeNull()
      expect(screen.getByTestId('inbox-row-rec_a')).toBeTruthy()
    })
  })

  // -------------------------------------------------------------------------
  // The spoken description (doctrine rule 16)
  // -------------------------------------------------------------------------

  describe('the spoken description', () => {
    it('says how many are waiting, in the plural', async () => {
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a'), unfiled('rec_b')])
      await renderInbox()
      expect(spokenDescription()).toMatch(/2 captures waiting/)
    })

    it('says one capture in the singular', async () => {
      // The launcher's "1 unfiled capture are waiting" bug, in the one place
      // it could recur.
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a')])
      await renderInbox()
      expect(spokenDescription()).toMatch(/1 capture waiting/)
      expect(spokenDescription()).not.toMatch(/1 captures/)
    })

    it('says the Inbox is empty', async () => {
      listUnfiledRecords.mockResolvedValue([])
      await renderInbox()
      expect(spokenDescription()).toMatch(/nothing waiting/i)
    })

    it('says it is still looking', async () => {
      const pending = deferred<FieldRecord[]>()
      listUnfiledRecords.mockReturnValue(pending.promise)
      await renderInbox()
      expect(spokenDescription()).toMatch(/finding/i)
      await act(async () => {
        pending.resolve([])
      })
    })

    it('says so when the read failed', async () => {
      listUnfiledRecords.mockRejectedValue(new Error('database is locked'))
      await renderInbox()
      expect(spokenDescription()).toMatch(/could not be read/i)
    })

    it('says so when a filing failed', async () => {
      fileRecord.mockRejectedValue(new Error('database is locked'))
      listUnfiledRecords.mockResolvedValue([unfiled('rec_a')])
      await renderInbox()
      await fireEvent.press(screen.getByTestId('inbox-file-rec_a'))
      expect(spokenDescription()).toMatch(/could not be filed/i)
    })

    it('names the database state it is waiting on', async () => {
      mockStatus = { state: 'opening', error: null, applied: [] }
      await renderInbox()
      expect(spokenDescription()).toMatch(/opening/i)
      expect(screen.queryByTestId('inbox-empty')).toBeNull()
    })

    it('says so when the database failed, instead of looking like an empty Inbox', async () => {
      mockStatus = { state: 'failed', error: new Error('migration 003 failed'), applied: [] }
      await renderInbox()
      expect(screen.queryByTestId('inbox-empty')).toBeNull()
      expect(screen.getByTestId('inbox')).toHaveTextContent(/migration 003 failed/, {
        exact: false,
      })
      expect(listUnfiledRecords).not.toHaveBeenCalled()
    })
  })
})
