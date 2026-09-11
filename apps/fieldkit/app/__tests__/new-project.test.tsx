import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { ThemeProvider } from '@corymbia/ui'
import type { Project } from '@corymbia/data'

/**
 * Tests for creating a project (spec §7.3, §10.3) — reached from `projects.tsx`'s
 * `projects-new`.
 *
 * WHAT IS AND IS NOT MOCKED. `createProject` is, and nothing else is: its
 * defaulting of a skipped client and location is already proved in
 * `packages/data/src/repositories/__tests__/projects.test.ts`. What is left
 * for this file is what the screen sends it — a name alone is a call with
 * one key, not three with two of them empty strings — and what it does with
 * the result: navigate back on success, stay put and say why on failure, and
 * never call it at all on an empty name.
 */

const mockRouterBack = jest.fn()

jest.mock('expo-router', () => ({
  router: { back: (...args: unknown[]) => mockRouterBack(...args) },
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
 * Typed against the real function (`jest.fn<ReturnType<F>, Parameters<F>>()`
 * — the single-argument shorthand does not compile under `@types/jest` 29),
 * so a `mockResolvedValue` here can only ever be handed a `Project` shape.
 */
const mockCreateProject = jest.fn<
  ReturnType<typeof import('@corymbia/data').createProject>,
  Parameters<typeof import('@corymbia/data').createProject>
>()

jest.mock('@corymbia/data', () => ({
  createProject: (...args: Parameters<typeof import('@corymbia/data').createProject>) =>
    mockCreateProject(...args),
}))

// Plain alias, matching the brief's own naming — declared after the mock
// factory above, never referenced from inside it.
const createProject = mockCreateProject
const routerBack = mockRouterBack

// Imported after the mocks so it picks them up.
import NewProjectScreen from '../new-project'

const CREATED: Project = {
  id: 'prj_mitchell',
  name: 'Mitchell River eDNA',
  shortLabel: null,
  description: null,
  clientId: 'client-internal',
  status: 'active',
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z',
}

async function renderNewProject(): Promise<void> {
  await render(
    <ThemeProvider initial="dark">
      <NewProjectScreen />
    </ThemeProvider>,
  )
}

function spokenDescription(): unknown {
  return screen.getByTestId('new-project-spoken-description').props.accessibilityLabel
}

beforeEach(() => {
  mockStatus = { state: 'ready', error: null, applied: ['001_initial'] }
  mockRouterBack.mockClear()
  mockCreateProject.mockReset()
  mockCreateProject.mockResolvedValue(CREATED)
})

describe('creating a project', () => {
  it('creates a project from a name alone', async () => {
    await renderNewProject()
    await fireEvent.changeText(screen.getByTestId('new-project-name'), 'Mitchell River eDNA')
    await fireEvent.press(screen.getByTestId('new-project-save'))
    expect(createProject).toHaveBeenCalledWith(expect.anything(), { name: 'Mitchell River eDNA' })
  })

  it('refuses an empty name, and says what is missing', async () => {
    await renderNewProject()
    await fireEvent.press(screen.getByTestId('new-project-save'))
    expect(createProject).not.toHaveBeenCalled()
    expect(screen.getByTestId('new-project-error')).toHaveTextContent(/name/i)
  })

  it('stops asking for a name once she has typed one', async () => {
    // The refusal is answered by typing, so it must go when she types. Left
    // standing it is worse on the screen and worse still in the spoken
    // description, which reads the error branch: voice mode would go on
    // saying "A project needs a name" over the name she just gave it.
    await renderNewProject()
    await fireEvent.press(screen.getByTestId('new-project-save'))
    expect(screen.getByTestId('new-project-error')).toHaveTextContent(/name/i)
    await fireEvent.changeText(screen.getByTestId('new-project-name'), 'Mitchell River eDNA')
    expect(screen.queryByTestId('new-project-error')).toBeNull()
    expect(spokenDescription()).not.toMatch(/needs a name/i)
    expect(spokenDescription()).toMatch(/only the name is required/i)
  })

  it('keeps a failed save on screen while she edits, because typing does not answer it', async () => {
    // The asymmetry is deliberate (doctrine rule 20). "Needs a name" is a
    // field she has not filled in, and typing answers it. "Could not be
    // saved" is the only telling she gets that a write did not land, and
    // nothing in the application remembers it once it is off screen — so a
    // keystroke must not take it away.
    createProject.mockRejectedValue(new Error('database is locked'))
    await renderNewProject()
    await fireEvent.changeText(screen.getByTestId('new-project-name'), 'Mitchell River eDNA')
    await fireEvent.press(screen.getByTestId('new-project-save'))
    expect(screen.getByTestId('new-project-error')).toHaveTextContent(/could not be saved/i)
    await fireEvent.changeText(screen.getByTestId('new-project-name'), 'Mitchell River eDNA 2')
    expect(screen.getByTestId('new-project-error')).toHaveTextContent(/could not be saved/i)
  })

  it('keeps the optional fields optional', async () => {
    await renderNewProject()
    await fireEvent.changeText(screen.getByTestId('new-project-name'), 'Mitchell River eDNA')
    await fireEvent.changeText(screen.getByTestId('new-project-description'), 'Autumn baseline')
    await fireEvent.press(screen.getByTestId('new-project-save'))
    expect(createProject).toHaveBeenCalledWith(expect.anything(), {
      name: 'Mitchell River eDNA',
      description: 'Autumn baseline',
    })
  })

  it('keeps the short label optional too', async () => {
    // The companion to the test above, for the third field: nothing else in
    // this file exercises `new-project-short-label` at all, so deleting the
    // field entirely would leave the suite green without this.
    await renderNewProject()
    await fireEvent.changeText(screen.getByTestId('new-project-name'), 'Mitchell River eDNA')
    await fireEvent.changeText(screen.getByTestId('new-project-short-label'), 'Mitchell')
    await fireEvent.press(screen.getByTestId('new-project-save'))
    expect(createProject).toHaveBeenCalledWith(expect.anything(), {
      name: 'Mitchell River eDNA',
      shortLabel: 'Mitchell',
    })
  })

  it('sends all three fields together when all three are filled in', async () => {
    await renderNewProject()
    await fireEvent.changeText(screen.getByTestId('new-project-name'), 'Mitchell River eDNA')
    await fireEvent.changeText(screen.getByTestId('new-project-short-label'), 'Mitchell')
    await fireEvent.changeText(screen.getByTestId('new-project-description'), 'Autumn baseline')
    await fireEvent.press(screen.getByTestId('new-project-save'))
    expect(createProject).toHaveBeenCalledWith(expect.anything(), {
      name: 'Mitchell River eDNA',
      shortLabel: 'Mitchell',
      description: 'Autumn baseline',
    })
  })

  it('trims whitespace-only optional fields down to nothing, rather than sending blanks', async () => {
    await renderNewProject()
    await fireEvent.changeText(screen.getByTestId('new-project-name'), '  Mitchell River eDNA  ')
    await fireEvent.changeText(screen.getByTestId('new-project-description'), '   ')
    await fireEvent.press(screen.getByTestId('new-project-save'))
    expect(createProject).toHaveBeenCalledWith(expect.anything(), { name: 'Mitchell River eDNA' })
  })

  it('says so and stays put when the project cannot be saved', async () => {
    createProject.mockRejectedValue(new Error('database is locked'))
    await renderNewProject()
    await fireEvent.changeText(screen.getByTestId('new-project-name'), 'Mitchell River eDNA')
    await fireEvent.press(screen.getByTestId('new-project-save'))
    expect(screen.getByTestId('new-project-error')).toHaveTextContent(/could not be saved/i)
    expect(routerBack).not.toHaveBeenCalled()
  })

  it('returns once the project is saved, and only then', async () => {
    // The positive half of "stays put on failure": a screen that navigated
    // back unconditionally would still pass every test above.
    await renderNewProject()
    await fireEvent.changeText(screen.getByTestId('new-project-name'), 'Mitchell River eDNA')
    await fireEvent.press(screen.getByTestId('new-project-save'))
    expect(routerBack).toHaveBeenCalledTimes(1)
  })

  it('shows the saving label while the write is in flight, and reverts if it fails', async () => {
    let release: (value: Project) => void = () => {}
    createProject.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    await renderNewProject()
    await fireEvent.changeText(screen.getByTestId('new-project-name'), 'Mitchell River eDNA')
    expect(screen.getByTestId('new-project-save')).toHaveTextContent('Save project')
    await fireEvent.press(screen.getByTestId('new-project-save'))
    expect(screen.getByTestId('new-project-save')).toHaveTextContent('Saving…')
    release(CREATED)
    await act(async () => {})
  })

  it('ignores a second press while the first save is still in flight', async () => {
    let release: (value: Project) => void = () => {}
    createProject.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    await renderNewProject()
    await fireEvent.changeText(screen.getByTestId('new-project-name'), 'Mitchell River eDNA')
    const save = screen.getByTestId('new-project-save')
    // Two presses, each awaited in turn rather than fired together inside one
    // `act` — `fireEvent` in RNTL v14 opens an `act` scope of its own, so
    // nesting them is what produced this file's three "overlapping act()
    // calls" errors. The condition under test is unchanged: the first press
    // settles nothing, because `createProject` is still holding its promise,
    // so the second lands while the save is genuinely in flight.
    await fireEvent.press(save)
    await fireEvent.press(save)
    release(CREATED)
    await act(async () => {})
    expect(createProject).toHaveBeenCalledTimes(1)
  })

  it('shows no form until the database is open', async () => {
    mockStatus = { state: 'opening', error: null, applied: [] }
    await renderNewProject()
    expect(screen.queryByTestId('new-project-name')).toBeNull()
    expect(screen.queryByTestId('new-project-save')).toBeNull()
    expect(screen.getByTestId('new-project')).toHaveTextContent(/opening/i)
  })

  describe('the spoken description (doctrine rule 16)', () => {
    it('describes the form, naming what is required', async () => {
      await renderNewProject()
      expect(spokenDescription()).toMatch(/name/i)
      expect(spokenDescription()).toMatch(/only the name is required/i)
    })

    it('names the database state it is waiting on', async () => {
      mockStatus = { state: 'opening', error: null, applied: [] }
      await renderNewProject()
      expect(spokenDescription()).toMatch(/opening/i)
    })

    it('says so when the save has failed', async () => {
      createProject.mockRejectedValue(new Error('database is locked'))
      await renderNewProject()
      await fireEvent.changeText(screen.getByTestId('new-project-name'), 'Mitchell River eDNA')
      await fireEvent.press(screen.getByTestId('new-project-save'))
      expect(spokenDescription()).toMatch(/could not be saved/i)
    })
  })
})
