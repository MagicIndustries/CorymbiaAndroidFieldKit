import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { ThemeProvider } from '@corymbia/ui'
import type { Activity, Project } from '@corymbia/data'

/**
 * Tests for starting an activity (spec §10.1, §7.4) — reached two ways: from
 * `projects.tsx` when the project she chose has no activity to resume, and
 * from the launcher's `carry-on-new-activity` when she wants a fresh one in
 * the project she is already in.
 *
 * WHAT IS AND IS NOT MOCKED. `createActivity`, `setCurrentActivity` and
 * `getProject` are, and nothing else is. What each of them does is already
 * proved in `packages/data` — the blank-name refusal, the foreign key, the
 * refusal to select an activity that does not exist — and re-proving any of
 * it through a React tree would test the repository twice while testing this
 * screen once. What is left for this file is what the screen sends them
 * (above all, the kind she actually chose rather than a hardcoded one), what
 * it does with the answers, and the two states in which it deliberately
 * offers no form at all.
 *
 * `ACTIVITY_KINDS` is NOT mocked: it is required from the real repository
 * module inside the factory below. The screen renders one option per member
 * of that array, so a stubbed list here would only prove the stub — the
 * "offers every activity kind" test below is exactly the one that must fail
 * if a sixth kind is added to `@corymbia/data` and the list this screen maps
 * over is not the same list. That test names the five literals AND counts the
 * chips against `ACTIVITY_KINDS.length`: the literals say what the five are
 * today, and the count is what a sixth kind moves. Iterating the literals
 * alone would not — five chips out of six is five passing lookups.
 */

const mockRouter = {
  dismissTo: jest.fn(),
  push: jest.fn(),
}

/**
 * The route's own parameter, replaced per test. `let`, not `const`: the
 * no-project tests below render with it empty.
 *
 * Typed `string | string[] | undefined`, which is what expo-router actually
 * delivers (`UnknownOutputParams = Record<string, string | string[]>`) — a
 * key repeated in the URL arrives as an array. Narrowing this fixture to
 * `string` would have made the shape the screen has to survive unwritable
 * here, which is how an asserted parameter stays asserted.
 */
let mockParams: { projectId?: string | string[] } = { projectId: 'prj_tambo' }

jest.mock('expo-router', () => ({
  router: {
    dismissTo: (...args: unknown[]) => mockRouter.dismissTo(...args),
    push: (...args: unknown[]) => mockRouter.push(...args),
  },
  useLocalSearchParams: () => mockParams,
}))

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
 * — the single-argument shorthand does not compile under `@types/jest` 29),
 * so a `mockResolvedValue` here can only ever be handed a shape the real
 * repository actually returns.
 */
const mockRepo = {
  createActivity: jest.fn<
    ReturnType<typeof import('@corymbia/data').createActivity>,
    Parameters<typeof import('@corymbia/data').createActivity>
  >(),
  setCurrentActivity: jest.fn<
    ReturnType<typeof import('@corymbia/data').setCurrentActivity>,
    Parameters<typeof import('@corymbia/data').setCurrentActivity>
  >(),
  getProject: jest.fn<
    ReturnType<typeof import('@corymbia/data').getProject>,
    Parameters<typeof import('@corymbia/data').getProject>
  >(),
}

jest.mock('@corymbia/data', () => ({
  // The real array, reached by its module path rather than through the
  // package barrel — the barrel pulls in the Expo SQLite adapter, which this
  // suite has no use for.
  ACTIVITY_KINDS: jest.requireActual<typeof import('@corymbia/data/src/repositories/activities')>(
    '@corymbia/data/src/repositories/activities',
  ).ACTIVITY_KINDS,
  createActivity: (...args: Parameters<typeof import('@corymbia/data').createActivity>) =>
    mockRepo.createActivity(...args),
  setCurrentActivity: (...args: Parameters<typeof import('@corymbia/data').setCurrentActivity>) =>
    mockRepo.setCurrentActivity(...args),
  getProject: (...args: Parameters<typeof import('@corymbia/data').getProject>) =>
    mockRepo.getProject(...args),
}))

// Plain aliases, matching the brief's own naming — declared after the mock
// factory above, which is hoisted ahead of them and never references them.
const createActivity = mockRepo.createActivity
const setCurrentActivity = mockRepo.setCurrentActivity
const getProject = mockRepo.getProject

// Imported after the mocks so they are picked up. `ACTIVITY_KINDS` comes
// through the factory above, which hands back the real array.
import NewActivityScreen from '../new-activity'
import { ACTIVITY_KINDS } from '@corymbia/data'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TAMBO: Project = {
  id: 'prj_tambo',
  name: 'Tambo River eDNA',
  shortLabel: null,
  description: null,
  clientId: 'client-internal',
  status: 'active',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
}

const CREATED: Activity = {
  id: 'act_created',
  projectId: 'prj_tambo',
  kind: 'survey',
  name: 'Reach 4 transect',
  shortLabel: null,
  startedAt: '2026-09-11T00:00:00.000Z',
  endedAt: null,
}

async function renderNewActivity(): Promise<void> {
  await render(
    <ThemeProvider initial="dark">
      <NewActivityScreen />
    </ThemeProvider>,
  )
}

function spokenDescription(): unknown {
  return screen.getByTestId('new-activity-spoken-description').props.accessibilityLabel
}

beforeEach(() => {
  mockStatus = { state: 'ready', error: null, applied: ['001_initial'] }
  mockParams = { projectId: 'prj_tambo' }
  mockRouter.dismissTo.mockClear()
  mockRouter.push.mockClear()
  mockRepo.createActivity.mockReset()
  mockRepo.setCurrentActivity.mockReset()
  mockRepo.getProject.mockReset()
  mockRepo.createActivity.mockResolvedValue(CREATED)
  mockRepo.setCurrentActivity.mockResolvedValue(undefined)
  mockRepo.getProject.mockResolvedValue(TAMBO)
})

describe('starting an activity', () => {
  it('offers every activity kind', async () => {
    await renderNewActivity()
    for (const kind of ['survey', 'sampling', 'collection', 'workshop', 'meeting']) {
      expect(screen.getByTestId(`activity-kind-${kind}`)).toBeTruthy()
    }
    // And exactly those, counted against the repository's own list rather
    // than against the five literals above — a sixth kind added to
    // `@corymbia/data` fails here if this screen is not mapping over the same
    // array. The pattern excludes `activity-kind-<kind>-chosen`, the tick on
    // the selected chip.
    expect(screen.getAllByTestId(/^activity-kind-[a-z]+$/)).toHaveLength(ACTIVITY_KINDS.length)
  })

  it('creates the activity with the kind she chose', async () => {
    await renderNewActivity()
    await fireEvent.press(screen.getByTestId('activity-kind-sampling'))
    await fireEvent.changeText(screen.getByTestId('new-activity-name'), 'Pool 2 sediment')
    await fireEvent.press(screen.getByTestId('new-activity-save'))
    expect(createActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: 'prj_tambo',
        kind: 'sampling',
        name: 'Pool 2 sediment',
      }),
    )
  })

  it('creates with a different kind when a different one is chosen', async () => {
    // One kind would let it be hardcoded — the same defect this project has
    // now found four times in media fixtures.
    await renderNewActivity()
    await fireEvent.press(screen.getByTestId('activity-kind-workshop'))
    await fireEvent.changeText(screen.getByTestId('new-activity-name'), 'Method training')
    await fireEvent.press(screen.getByTestId('new-activity-save'))
    expect(createActivity.mock.calls[0]?.[1].kind).toBe('workshop')
  })

  it('selects the activity it just created', async () => {
    await renderNewActivity()
    await fireEvent.press(screen.getByTestId('activity-kind-survey'))
    await fireEvent.changeText(screen.getByTestId('new-activity-name'), 'Reach 4 transect')
    await fireEvent.press(screen.getByTestId('new-activity-save'))
    expect(setCurrentActivity).toHaveBeenCalledWith(expect.anything(), 'act_created')
  })

  it('refuses an empty name and says what is missing', async () => {
    await renderNewActivity()
    await fireEvent.press(screen.getByTestId('new-activity-save'))
    expect(createActivity).not.toHaveBeenCalled()
    expect(screen.getByTestId('new-activity-error')).toHaveTextContent(/name/i)
  })

  it('stops asking for a name once she has typed one', async () => {
    // The refusal is answered by typing, so it must go when she types.
    // Left standing it is worse on the screen and worse still in the spoken
    // description, which reads the error branch: voice mode would go on
    // saying "An activity needs a name" over the name she just gave it.
    await renderNewActivity()
    await fireEvent.press(screen.getByTestId('new-activity-save'))
    expect(screen.getByTestId('new-activity-error')).toHaveTextContent(/name/i)
    await fireEvent.changeText(screen.getByTestId('new-activity-name'), 'Reach 4 transect')
    expect(screen.queryByTestId('new-activity-error')).toBeNull()
    expect(spokenDescription()).not.toMatch(/needs a name/i)
    expect(spokenDescription()).toMatch(/type a name and save/i)
  })

  it('keeps a failed save on screen while she edits, because typing does not answer it', async () => {
    // The asymmetry is deliberate (doctrine rule 20). "Needs a name" is a
    // field she has not filled in, and typing answers it. "Could not be
    // saved" is the only telling she gets that a write did not land, and
    // nothing in the application remembers it once it is off screen — so a
    // keystroke must not take it away.
    createActivity.mockRejectedValue(new Error('database is locked'))
    await renderNewActivity()
    await fireEvent.changeText(screen.getByTestId('new-activity-name'), 'Reach 4 transect')
    await fireEvent.press(screen.getByTestId('new-activity-save'))
    expect(screen.getByTestId('new-activity-error')).toHaveTextContent(/could not be saved/i)
    await fireEvent.changeText(screen.getByTestId('new-activity-name'), 'Reach 4 transect b')
    expect(screen.getByTestId('new-activity-error')).toHaveTextContent(/could not be saved/i)
  })

  it('says so and stays put when it cannot be saved', async () => {
    createActivity.mockRejectedValue(new Error('database is locked'))
    await renderNewActivity()
    await fireEvent.press(screen.getByTestId('activity-kind-survey'))
    await fireEvent.changeText(screen.getByTestId('new-activity-name'), 'Reach 4 transect')
    await fireEvent.press(screen.getByTestId('new-activity-save'))
    expect(screen.getByTestId('new-activity-error')).toBeTruthy()
    expect(setCurrentActivity).not.toHaveBeenCalled()
  })

  it('starts a kind chosen for her rather than none at all', async () => {
    // Spec §10.1 treats a survey as the primary case, and nothing about this
    // screen is improved by making her choose before she can type. Without
    // this, a screen that started with no kind selected would still satisfy
    // every test above — each of them presses a kind first.
    await renderNewActivity()
    await fireEvent.changeText(screen.getByTestId('new-activity-name'), 'Reach 4 transect')
    await fireEvent.press(screen.getByTestId('new-activity-save'))
    expect(createActivity.mock.calls[0]?.[1].kind).toBe('survey')
  })

  it('shows which kind is chosen in a second channel, not colour alone', async () => {
    // Doctrine rule 9. `accessibilityState` is what a screen reader gets; the
    // mark is what she gets in glare.
    await renderNewActivity()
    await fireEvent.press(screen.getByTestId('activity-kind-workshop'))
    expect(screen.getByTestId('activity-kind-workshop').props.accessibilityState.selected).toBe(
      true,
    )
    expect(screen.getByTestId('activity-kind-survey').props.accessibilityState.selected).toBe(false)
    expect(screen.getByTestId('activity-kind-workshop-chosen')).toBeTruthy()
    expect(screen.queryByTestId('activity-kind-survey-chosen')).toBeNull()
  })

  it('names the project the activity is going into, rather than its id', async () => {
    // Doctrine rule 6: she reads the project's name. `prj_tambo` is a thing
    // the database calls it, not a thing she calls it.
    await renderNewActivity()
    expect(getProject).toHaveBeenCalledWith(mockDb, 'prj_tambo')
    expect(screen.getByTestId('new-activity-project')).toHaveTextContent('Tambo River eDNA')
    expect(screen.getByTestId('new-activity-project')).not.toHaveTextContent('prj_tambo', {
      exact: false,
    })
  })

  it('goes to the launcher once the activity is started, and only then', async () => {
    // Not `back()`: the launcher is where the new activity becomes the card
    // she captures from, and she reached this screen from two different
    // places. The count is what tells a correct destination from a swapped
    // one.
    await renderNewActivity()
    await fireEvent.changeText(screen.getByTestId('new-activity-name'), 'Reach 4 transect')
    await fireEvent.press(screen.getByTestId('new-activity-save'))
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/')
    expect(mockRouter.dismissTo).toHaveBeenCalledTimes(1)
  })

  it('stays on the screen when the save fails', async () => {
    createActivity.mockRejectedValue(new Error('database is locked'))
    await renderNewActivity()
    await fireEvent.changeText(screen.getByTestId('new-activity-name'), 'Reach 4 transect')
    await fireEvent.press(screen.getByTestId('new-activity-save'))
    expect(mockRouter.dismissTo).not.toHaveBeenCalled()
  })

  it('stays on the screen when the name is empty', async () => {
    await renderNewActivity()
    await fireEvent.press(screen.getByTestId('new-activity-save'))
    expect(mockRouter.dismissTo).not.toHaveBeenCalled()
  })

  it('ignores a second press while the first save is still in flight', async () => {
    let release: (value: Activity) => void = () => {}
    createActivity.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    await renderNewActivity()
    await fireEvent.changeText(screen.getByTestId('new-activity-name'), 'Reach 4 transect')
    const save = screen.getByTestId('new-activity-save')
    // Two presses, each awaited in turn rather than fired together inside one
    // `act` — `fireEvent` in RNTL v14 opens an `act` scope of its own, so
    // nesting them is what produces React's "overlapping act() calls"
    // warning. The first press does not settle anything: `createActivity` is
    // still holding its promise, so the second lands while the save is
    // genuinely in flight, which is the condition under test.
    await fireEvent.press(save)
    await fireEvent.press(save)
    release(CREATED)
    await act(async () => {})
    expect(createActivity).toHaveBeenCalledTimes(1)
  })

  it('disables the save while the write is in flight, rather than swallowing the tap', async () => {
    // Doctrine rule 18: a busy control is genuinely disabled, not silently
    // inert. `savingRef` alone would refuse the second press invisibly, which
    // teaches her the tap did not register when it did.
    let release: (value: Activity) => void = () => {}
    createActivity.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    await renderNewActivity()
    await fireEvent.changeText(screen.getByTestId('new-activity-name'), 'Reach 4 transect')
    expect(screen.getByTestId('new-activity-save').props.accessibilityState.disabled).toBe(false)
    await fireEvent.press(screen.getByTestId('new-activity-save'))
    expect(screen.getByTestId('new-activity-save')).toHaveTextContent('Starting…')
    expect(screen.getByTestId('new-activity-save').props.accessibilityState.disabled).toBe(true)
    release(CREATED)
    await act(async () => {})
  })

  it('offers the save again when the write failed', async () => {
    // The other half of the rule above: the guard closes for the save that
    // succeeded (this screen is on its way to the launcher) and reopens for
    // the one that did not, because the retry is on this screen.
    createActivity.mockRejectedValue(new Error('database is locked'))
    await renderNewActivity()
    await fireEvent.changeText(screen.getByTestId('new-activity-name'), 'Reach 4 transect')
    await fireEvent.press(screen.getByTestId('new-activity-save'))
    expect(screen.getByTestId('new-activity-save').props.accessibilityState.disabled).toBe(false)
    createActivity.mockResolvedValue(CREATED)
    await fireEvent.press(screen.getByTestId('new-activity-save'))
    expect(createActivity).toHaveBeenCalledTimes(2)
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/')
  })

  describe('with no project to start it in', () => {
    it('offers no form when the route carried no project', async () => {
      mockParams = {}
      await renderNewActivity()
      expect(screen.queryByTestId('new-activity-name')).toBeNull()
      expect(screen.queryByTestId('new-activity-save')).toBeNull()
      expect(screen.queryByTestId('activity-kind-survey')).toBeNull()
      expect(getProject).not.toHaveBeenCalled()
    })

    it('offers no form when the project no longer exists', async () => {
      getProject.mockResolvedValue(null)
      await renderNewActivity()
      expect(screen.queryByTestId('new-activity-name')).toBeNull()
      expect(screen.queryByTestId('new-activity-save')).toBeNull()
    })

    it('offers no form when the project could not be read, and names the cause', async () => {
      // The absence of the form is already covered by the `null` case above,
      // so on its own it proves nothing about this one. What is particular
      // here is what she is told: a read that failed is a different event
      // from a project she never chose, and saying the second when the first
      // happened sends her off to choose a project she has already chosen.
      // `toHaveTextContent` is exact by default in RNTL 14, hence
      // `{ exact: false }`.
      getProject.mockRejectedValue(new Error('database is locked'))
      await renderNewActivity()
      expect(screen.queryByTestId('new-activity-name')).toBeNull()
      expect(screen.queryByTestId('new-activity-save')).toBeNull()
      const sentence = screen.getByTestId('new-activity-no-project')
      expect(sentence).toHaveTextContent('could not be opened', { exact: false })
      expect(sentence).toHaveTextContent('database is locked', { exact: false })
      expect(sentence).not.toHaveTextContent('No project has been chosen', { exact: false })
      expect(spokenDescription()).toMatch(/could not be opened/i)
      expect(spokenDescription()).toMatch(/database is locked/i)
      expect(spokenDescription()).not.toMatch(/no project has been chosen/i)
    })

    it('offers no form when the route carried an empty project id', async () => {
      // An empty string is a parameter that arrived, so `projectId !==
      // undefined` would have let it through to `getProject(db, '')` — a
      // lookup that can only come back empty, reported as "that project no
      // longer exists" about a project she never named.
      mockParams = { projectId: '' }
      await renderNewActivity()
      expect(screen.queryByTestId('new-activity-name')).toBeNull()
      expect(screen.getByTestId('new-activity-no-project')).toBeTruthy()
      expect(getProject).not.toHaveBeenCalled()
    })

    it('offers no form when the route carried the project twice', async () => {
      // expo-router types a parameter `string | string[]`: a key repeated in
      // the URL arrives as an array. Asserting it is a string does not make
      // it one — it makes `getProject(db, ['prj_tambo', 'prj_yarra'])`.
      mockParams = { projectId: ['prj_tambo', 'prj_yarra'] }
      await renderNewActivity()
      expect(screen.queryByTestId('new-activity-name')).toBeNull()
      expect(screen.getByTestId('new-activity-no-project')).toBeTruthy()
      expect(getProject).not.toHaveBeenCalled()
    })

    it('sends her to choose a project instead, and nothing else', async () => {
      mockParams = {}
      await renderNewActivity()
      await fireEvent.press(screen.getByTestId('new-activity-choose-project'))
      expect(mockRouter.push).toHaveBeenCalledWith('/projects')
      expect(mockRouter.push).toHaveBeenCalledTimes(1)
      expect(createActivity).not.toHaveBeenCalled()
    })
  })

  it('shows no form until the database is open', async () => {
    mockStatus = { state: 'opening', error: null, applied: [] }
    await renderNewActivity()
    expect(screen.queryByTestId('new-activity-name')).toBeNull()
    expect(screen.queryByTestId('new-activity-save')).toBeNull()
    expect(screen.getByTestId('new-activity')).toHaveTextContent(/opening/i)
  })

  describe('the spoken description (doctrine rule 16)', () => {
    it('names the project and what the form asks for', async () => {
      await renderNewActivity()
      expect(spokenDescription()).toMatch(/Tambo River eDNA/)
      expect(spokenDescription()).toMatch(/name/i)
      expect(spokenDescription()).toMatch(/survey/i)
    })

    it('names the database state it is waiting on', async () => {
      mockStatus = { state: 'opening', error: null, applied: [] }
      await renderNewActivity()
      expect(spokenDescription()).toMatch(/opening/i)
    })

    it('says there is no project when the route carried none', async () => {
      mockParams = {}
      await renderNewActivity()
      expect(spokenDescription()).toMatch(/no project/i)
    })

    it('says so when the save has failed', async () => {
      createActivity.mockRejectedValue(new Error('database is locked'))
      await renderNewActivity()
      await fireEvent.changeText(screen.getByTestId('new-activity-name'), 'Reach 4 transect')
      await fireEvent.press(screen.getByTestId('new-activity-save'))
      expect(spokenDescription()).toMatch(/could not be saved/i)
    })
  })
})
