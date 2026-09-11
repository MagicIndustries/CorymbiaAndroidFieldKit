import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react-native'
import { ThemeProvider } from '@corymbia/ui'
import type { Activity, Project } from '@corymbia/data'

/**
 * Tests for the project list (spec §10.3) — where "Switch project" on the
 * launcher goes, reached from `index.tsx`'s `carry-on-switch-project`.
 *
 * WHAT IS AND IS NOT MOCKED. `listProjects`, `listActivities` and
 * `setCurrentActivity` are, and nothing else is. Their behaviour is already
 * proved in `packages/data`; what is left for this file is what the screen
 * does with their answers — which project is highlighted, what "Start a new
 * project" does, and, above all, what selecting a project actually selects:
 * this screen's whole point is that a project alone is not somewhere a
 * capture can land, so choosing one must also choose (or start) an activity.
 */

const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  replace: jest.fn(),
}

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return {
    useRouter: () => mockRouter,
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

let mockStatus: MockStatus = { state: 'ready', error: null, applied: ['001_initial'] }
const mockDb = { handle: 'not a real database' }

jest.mock('../../src/db/provider', () => ({
  useDatabase: () => mockDb,
  useDatabaseStatus: () => mockStatus,
}))

/**
 * Typed against the real functions rather than left bare (`jest.fn<
 * ReturnType<F>, Parameters<F>>()` — the two-argument form, since the
 * single-argument shorthand does not compile under `@types/jest` 29): a
 * `mockResolvedValue` below can then only ever be handed a shape the real
 * repository actually returns.
 */
const mockRepo = {
  listProjects: jest.fn<
    ReturnType<typeof import('@corymbia/data').listProjects>,
    Parameters<typeof import('@corymbia/data').listProjects>
  >(),
  listActivities: jest.fn<
    ReturnType<typeof import('@corymbia/data').listActivities>,
    Parameters<typeof import('@corymbia/data').listActivities>
  >(),
  setCurrentActivity: jest.fn<
    ReturnType<typeof import('@corymbia/data').setCurrentActivity>,
    Parameters<typeof import('@corymbia/data').setCurrentActivity>
  >(),
}

jest.mock('@corymbia/data', () => ({
  listProjects: (...args: Parameters<typeof import('@corymbia/data').listProjects>) =>
    mockRepo.listProjects(...args),
  listActivities: (...args: Parameters<typeof import('@corymbia/data').listActivities>) =>
    mockRepo.listActivities(...args),
  setCurrentActivity: (...args: Parameters<typeof import('@corymbia/data').setCurrentActivity>) =>
    mockRepo.setCurrentActivity(...args),
}))

// Plain aliases, matching the brief's own naming — not referenced from
// inside the `jest.mock` factory above, which is hoisted ahead of this
// declaration.
const listProjects = mockRepo.listProjects
const listActivities = mockRepo.listActivities
const setCurrentActivity = mockRepo.setCurrentActivity

// Imported after the mocks so it picks them up.
import ProjectsScreen from '../projects'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function project(overrides: Partial<Project>): Project {
  return {
    id: 'prj_x',
    name: 'A project',
    shortLabel: null,
    description: null,
    clientId: 'client-internal',
    status: 'active',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function activity(overrides: Partial<Activity>): Activity {
  return {
    id: 'act_x',
    projectId: 'prj_x',
    kind: 'sampling',
    name: 'An activity',
    shortLabel: null,
    startedAt: '2026-09-01T00:00:00.000Z',
    endedAt: null,
    ...overrides,
  }
}

// `listProjects` already orders active projects first, most recently updated
// first (`packages/data/src/repositories/projects.ts`) — this is that order,
// pre-applied, exactly as the real repository would hand it back.
const TAMBO = project({ id: 'prj_tambo', name: 'Tambo River eDNA', status: 'active' })
const SNOWY = project({ id: 'prj_snowy', name: 'Snowy estuary baseline', status: 'active' })

async function renderProjects(): Promise<void> {
  await render(
    <ThemeProvider initial="dark">
      <ProjectsScreen />
    </ThemeProvider>,
  )
}

function spokenDescription(): unknown {
  return screen.getByTestId('projects-spoken-description').props.accessibilityLabel
}

beforeEach(() => {
  mockStatus = { state: 'ready', error: null, applied: ['001_initial'] }
  mockRouter.push.mockClear()
  mockRouter.back.mockClear()
  mockRouter.replace.mockClear()
  mockRepo.listProjects.mockReset()
  mockRepo.listActivities.mockReset()
  mockRepo.setCurrentActivity.mockReset()
  mockRepo.listProjects.mockResolvedValue([TAMBO, SNOWY])
  mockRepo.listActivities.mockResolvedValue([])
  mockRepo.setCurrentActivity.mockResolvedValue(undefined)
})

describe('the project list', () => {
  it('lists the projects', async () => {
    await renderProjects()
    expect(screen.getByText('Tambo River eDNA')).toBeTruthy()
    expect(screen.getByText('Snowy estuary baseline')).toBeTruthy()
  })

  it('marks the most recent in-progress project', async () => {
    await renderProjects()
    expect(screen.getByTestId('project-prj_tambo').props.accessibilityState.selected).toBe(true)
    expect(screen.getByTestId('project-prj_snowy').props.accessibilityState.selected).toBe(false)
  })

  it('says so plainly when there are no projects yet', async () => {
    listProjects.mockResolvedValue([])
    await renderProjects()
    expect(screen.getByTestId('projects-empty')).toHaveTextContent(/no projects/i)
    expect(screen.getByTestId('projects-new')).toBeTruthy()
  })

  it('starts a new project from Start a new project, and nothing else', async () => {
    await renderProjects()
    await fireEvent.press(screen.getByTestId('projects-new'))
    expect(mockRouter.push).toHaveBeenCalledWith('/new-project')
    expect(mockRouter.push).toHaveBeenCalledTimes(1)
    expect(listActivities).not.toHaveBeenCalled()
    expect(setCurrentActivity).not.toHaveBeenCalled()
  })

  it('selects the most recent activity of the project chosen, and returns', async () => {
    listActivities.mockResolvedValue([
      activity({ id: 'act_recent', projectId: 'prj_tambo', startedAt: '2026-09-05T00:00:00.000Z' }),
      activity({ id: 'act_older', projectId: 'prj_tambo', startedAt: '2026-09-01T00:00:00.000Z' }),
    ])
    await renderProjects()
    await fireEvent.press(screen.getByTestId('project-prj_tambo'))
    expect(listActivities).toHaveBeenCalledWith(mockDb, 'prj_tambo')
    // The FIRST activity handed back, not merely "an" activity: `listActivities`
    // already orders most-recent-first, so a screen that picked the wrong one
    // would still pass a test that only checked "some activity was selected".
    expect(setCurrentActivity).toHaveBeenCalledWith(mockDb, 'act_recent')
    expect(setCurrentActivity).toHaveBeenCalledTimes(1)
    expect(mockRouter.back).toHaveBeenCalledTimes(1)
    expect(mockRouter.push).not.toHaveBeenCalled()
  })

  it('selects only the activity of the project actually pressed, not another one', async () => {
    // Two rows, two different projects: pressing one must query and select
    // for THAT project's id, not merely "whichever project came first" or a
    // hardcoded id a narrower fixture set could not catch.
    listActivities.mockResolvedValue([activity({ id: 'act_snowy', projectId: 'prj_snowy' })])
    await renderProjects()
    await fireEvent.press(screen.getByTestId('project-prj_snowy'))
    expect(listActivities).toHaveBeenCalledWith(mockDb, 'prj_snowy')
    expect(listActivities).not.toHaveBeenCalledWith(mockDb, 'prj_tambo')
    expect(setCurrentActivity).toHaveBeenCalledWith(mockDb, 'act_snowy')
  })

  it('goes to start an activity when the chosen project has none', async () => {
    listActivities.mockResolvedValue([])
    await renderProjects()
    await fireEvent.press(screen.getByTestId('project-prj_tambo'))
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/new-activity',
      params: { projectId: 'prj_tambo' },
    })
    expect(mockRouter.push).toHaveBeenCalledTimes(1)
    expect(setCurrentActivity).not.toHaveBeenCalled()
    expect(mockRouter.back).not.toHaveBeenCalled()
  })

  it('says so, and does not navigate, when switching projects fails', async () => {
    listActivities.mockRejectedValue(new Error('database is locked'))
    await renderProjects()
    await fireEvent.press(screen.getByTestId('project-prj_tambo'))
    expect(screen.getByTestId('projects-error')).toHaveTextContent(/could not be loaded/i)
    expect(setCurrentActivity).not.toHaveBeenCalled()
    expect(mockRouter.back).not.toHaveBeenCalled()
    expect(mockRouter.push).not.toHaveBeenCalled()
  })

  describe('the spoken description (doctrine rule 16)', () => {
    it('says plainly that there are none yet', async () => {
      listProjects.mockResolvedValue([])
      await renderProjects()
      expect(spokenDescription()).toMatch(/no projects/i)
    })

    it('names the highlighted project and that it is in progress', async () => {
      await renderProjects()
      expect(spokenDescription()).toMatch(/Tambo River eDNA/)
      expect(spokenDescription()).toMatch(/in progress/i)
    })

    it('does not say "no projects" once some have loaded', async () => {
      await renderProjects()
      expect(spokenDescription()).not.toMatch(/no projects/i)
    })

    it('says the database is still opening rather than drawing an empty list', async () => {
      mockStatus = { state: 'opening', error: null, applied: [] }
      await renderProjects()
      expect(screen.queryByTestId('project-prj_tambo')).toBeNull()
      expect(screen.getByTestId('projects')).toHaveTextContent(/opening/i)
    })

    it('says so when the database failed, instead of looking like an empty list', async () => {
      mockStatus = { state: 'failed', error: new Error('migration 003 failed'), applied: [] }
      await renderProjects()
      expect(screen.queryByTestId('projects-empty')).toBeNull()
      expect(screen.getByTestId('projects')).toHaveTextContent(/migration 003 failed/)
    })
  })
})
