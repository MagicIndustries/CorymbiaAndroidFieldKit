import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { Activity, Client, FieldRecord, Project } from '@corymbia/data'

/**
 * Tests for the launcher's context hook (spec §10.1).
 *
 * WHAT IS AND IS NOT MOCKED. The four repository functions are, and nothing
 * else is. Their behaviour is already proved in `packages/data` — the
 * fallback to the most recently started activity, the soft-delete rules, the
 * two record queries — and re-proving it through a React hook would test the
 * repository twice while testing this hook once. What is left for this file
 * is exactly what the hook adds: which query answers which question, the
 * shape handed to `CarryOnCard`, the first-run case, and the ordering that
 * stops a slow earlier read overwriting a newer one.
 *
 * `useFocusEffect` is mocked to the one property that matters — it runs on
 * first focus and again on every later focus — rather than by mounting
 * expo-router's navigation container, which would put its whole layout
 * machinery between these tests and the lines they are about.
 */

// A handle, not a database: every function that would call a method on it is
// mocked below. It has to be identity-stable, because `refresh` lists it as a
// dependency and the tests assert it is the handle passed to each query.
const mockDb = { handle: 'not a real database' }

jest.mock('../../db/provider', () => ({
  useDatabase: () => mockDb,
}))

/** Every focus effect a mounted component currently has registered. */
const mockFocusEffects = new Set<() => void>()

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return {
    useFocusEffect: (effect: () => void) => {
      // Identity-keyed, so an effect whose dependencies did not change does
      // not re-run — `useCurrentContext` wraps its callback in `useCallback`
      // precisely so this is a stable identity.
      useEffect(() => {
        mockFocusEffects.add(effect)
        effect()
        return () => {
          mockFocusEffects.delete(effect)
        }
      }, [effect])
    },
  }
})

/**
 * Typed against the real functions rather than left bare: several tests below
 * assert the exact arguments a query was called with, and an untyped
 * `jest.fn()` would let a `mockResolvedValue` be handed a shape the real
 * function never returns — which is how a fixture ends up proving itself.
 *
 * `jest.fn<ReturnType<F>, Parameters<F>>()` is the form `@types/jest@29`
 * takes; the single-type-argument shorthand does not compile here.
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
  listUnfiledRecords: jest.fn<
    ReturnType<typeof import('@corymbia/data').listUnfiledRecords>,
    Parameters<typeof import('@corymbia/data').listUnfiledRecords>
  >(),
  getClient: jest.fn<
    ReturnType<typeof import('@corymbia/data').getClient>,
    Parameters<typeof import('@corymbia/data').getClient>
  >(),
}

jest.mock('@corymbia/data', () => ({
  readCurrentContext: (...args: Parameters<typeof import('@corymbia/data').readCurrentContext>) =>
    mockRepo.readCurrentContext(...args),
  listRecords: (...args: Parameters<typeof import('@corymbia/data').listRecords>) =>
    mockRepo.listRecords(...args),
  listUnfiledRecords: (...args: Parameters<typeof import('@corymbia/data').listUnfiledRecords>) =>
    mockRepo.listUnfiledRecords(...args),
  getClient: (...args: Parameters<typeof import('@corymbia/data').getClient>) =>
    mockRepo.getClient(...args),
}))

// Plain aliases, matching the brief's own naming — not referenced from inside
// the `jest.mock` factory above, which is hoisted ahead of this declaration.
const readCurrentContext = mockRepo.readCurrentContext
const listRecords = mockRepo.listRecords
const listUnfiledRecords = mockRepo.listUnfiledRecords
const getClient = mockRepo.getClient

// Imported after the mocks so it picks them up.
import { useCurrentContext } from '../useCurrentContext'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const activity: Activity = {
  id: 'act_survey',
  projectId: 'prj_yarra',
  kind: 'survey',
  name: 'Reach 3 transect',
  shortLabel: null,
  startedAt: '2026-09-10T00:20:00.000Z',
  endedAt: null,
}

const project: Project = {
  id: 'prj_yarra',
  name: 'Yarra Flats eDNA',
  shortLabel: null,
  description: null,
  clientId: 'client-parks',
  status: 'active',
  createdAt: '2026-09-09T00:00:00.000Z',
  updatedAt: '2026-09-09T00:00:00.000Z',
}

const client: Client = { id: 'client-parks', name: 'Parks Victoria', contact: null }

function recordRow(id: string): FieldRecord {
  return {
    id,
    activityId: null,
    contextActivityId: null,
    kind: 'pin',
    captureNumber: 1,
    sequence: null,
    filedAt: null,
    title: null,
    description: null,
    fix: { quality: 'none' },
    capturedAt: '2026-09-10T00:30:00.000Z',
    deviceId: 'device-under-test',
    attributes: {},
  }
}

/**
 * A promise this test resolves by hand. The executor runs synchronously, so
 * `resolve` is always the real one by the time this returns — no definite
 * assignment assertion needed.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

beforeEach(() => {
  mockFocusEffects.clear()
  readCurrentContext.mockReset()
  listRecords.mockReset()
  listUnfiledRecords.mockReset()
  getClient.mockReset()

  readCurrentContext.mockResolvedValue({ activity, project })
  listRecords.mockResolvedValue([])
  listUnfiledRecords.mockResolvedValue([])
  getClient.mockResolvedValue(client)
})

describe('useCurrentContext', () => {
  it('resumes the stored context', async () => {
    const { result } = await renderHook(() => useCurrentContext())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.carryOn?.activityName).toBe('Reach 3 transect')
    expect(result.current.carryOn?.projectName).toBe('Yarra Flats eDNA')
    expect(result.current.carryOn?.activityKind).toBe('survey')
    expect(result.current.carryOn?.startedAt).toBe('2026-09-10T00:20:00.000Z')
    expect(result.current.activityId).toBe('act_survey')
  })

  it('reports the project that activity belongs to, for a new activity started in it', async () => {
    // The launcher's "New activity" has to say which project the new one
    // goes into, and `CarryOn` deliberately carries no ids (doctrine rule 6).
    // Without this the screen it pushes to has no project to create against.
    const { result } = await renderHook(() => useCurrentContext())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.projectId).toBe('prj_yarra')
  })

  it('names the client of the resumed project, looked up by that project’s client', async () => {
    const { result } = await renderHook(() => useCurrentContext())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(getClient).toHaveBeenCalledWith(mockDb, 'client-parks')
    expect(result.current.carryOn?.clientName).toBe('Parks Victoria')
  })

  it('says the client is unknown rather than printing its id when it has been deleted', async () => {
    getClient.mockResolvedValue(null)
    const { result } = await renderHook(() => useCurrentContext())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.carryOn?.clientName).toBe('Client unknown')
    expect(result.current.carryOn?.clientName).not.toContain('client-parks')
  })

  it('counts the captures in that activity', async () => {
    listRecords.mockResolvedValue([recordRow('rec_a'), recordRow('rec_b'), recordRow('rec_c')])
    const { result } = await renderHook(() => useCurrentContext())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.carryOn?.captureCount).toBe(3)
  })

  it('asks for the captures in the resumed activity, on the database it was given', async () => {
    await renderHook(() => useCurrentContext())
    await waitFor(() => {
      expect(listRecords).toHaveBeenCalledTimes(1)
    })
    expect(listRecords).toHaveBeenCalledWith(mockDb, 'act_survey')
  })

  it('counts unfiled records separately from those in the activity', async () => {
    // Two different numbers from two different queries; one fixture would let
    // either be reported for both.
    listRecords.mockResolvedValue([recordRow('rec_a')])
    listUnfiledRecords.mockResolvedValue([recordRow('rec_x'), recordRow('rec_y')])
    const { result } = await renderHook(() => useCurrentContext())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.carryOn?.captureCount).toBe(1)
    expect(result.current.unfiledCount).toBe(2)
  })

  it('reports no context on a fresh install without failing', async () => {
    readCurrentContext.mockResolvedValue(null)
    const { result } = await renderHook(() => useCurrentContext())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.carryOn).toBeNull()
    expect(result.current.activityId).toBeNull()
    expect(result.current.projectId).toBeNull()
  })

  it('still counts the Inbox when there is no activity to count captures in', async () => {
    // The first run that has already captured: no context, and two captures
    // sitting unfiled. An implementation that returned early on a null
    // context would report an empty Inbox and hide the only thing on the
    // device.
    readCurrentContext.mockResolvedValue(null)
    listUnfiledRecords.mockResolvedValue([recordRow('rec_x'), recordRow('rec_y')])
    const { result } = await renderHook(() => useCurrentContext())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.carryOn).toBeNull()
    expect(result.current.unfiledCount).toBe(2)
    expect(listRecords).not.toHaveBeenCalled()
  })

  it('re-reads on every focus, not once on mount', async () => {
    listUnfiledRecords.mockResolvedValue([recordRow('rec_x')])
    const { result } = await renderHook(() => useCurrentContext())
    await waitFor(() => {
      expect(result.current.unfiledCount).toBe(1)
    })

    // She files it from the Inbox and comes back.
    listUnfiledRecords.mockResolvedValue([])
    await act(async () => {
      for (const effect of mockFocusEffects) effect()
    })
    await waitFor(() => {
      expect(result.current.unfiledCount).toBe(0)
    })
  })

  it('keeps the newer answer when a slower earlier read lands last', async () => {
    const first = deferred<FieldRecord[]>()
    const second = deferred<FieldRecord[]>()
    listUnfiledRecords.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const { result } = await renderHook(() => useCurrentContext())
    // The mount's own focus read is in flight and holding `first`.
    await act(async () => {
      void result.current.refresh()
    })

    await act(async () => {
      second.resolve([recordRow('rec_x'), recordRow('rec_y')])
    })
    await waitFor(() => {
      expect(result.current.unfiledCount).toBe(2)
    })

    // The earlier read finally comes back with a smaller, staler answer.
    await act(async () => {
      first.resolve([])
    })
    expect(result.current.unfiledCount).toBe(2)
  })

  it('stops loading when a read fails, rather than waiting for ever', async () => {
    readCurrentContext.mockRejectedValue(new Error('database went away'))
    const { result } = await renderHook(() => useCurrentContext())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.carryOn).toBeNull()
    expect(result.current.activityId).toBeNull()
  })

  it('reports why a first read failed, rather than answering like a fresh install', async () => {
    // `carryOn === null` is the same value a genuine first run produces, so
    // without this field the launcher cannot tell "you have no project" from
    // "I could not find out" — and it said the first, out loud, on the screen
    // she opens most (doctrine rules 16 and 20).
    readCurrentContext.mockRejectedValue(new Error('database went away'))
    const { result } = await renderHook(() => useCurrentContext())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.error?.message).toBe('database went away')
  })

  it('reports no error when the read succeeded', async () => {
    // The other half: a hook that always reported one would pass the test
    // above and put a failure sentence on every launch.
    const { result } = await renderHook(() => useCurrentContext())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.error).toBeNull()
  })

  it('clears the error when a later read succeeds', async () => {
    readCurrentContext.mockRejectedValueOnce(new Error('database went away'))
    const { result } = await renderHook(() => useCurrentContext())
    await waitFor(() => {
      expect(result.current.error).not.toBeNull()
    })

    // She presses Try again and this time it works. An error left behind
    // would keep a sentence on screen about a read that has since succeeded.
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.error).toBeNull()
    expect(result.current.carryOn?.activityName).toBe('Reach 3 transect')
  })

  it('keeps the last good answer on screen when a later read fails, rather than blanking it', async () => {
    // Distinct from the test above: that one fails on the very FIRST read,
    // where `carryOn` is already null from `NOTHING_YET` — so it cannot tell
    // "blanked" from "was never filled in". This one succeeds first, so a
    // failure that replaced the state with `NOTHING_YET` rather than merely
    // flipping `loading` would be the one thing that could turn this from
    // green to red.
    const { result } = await renderHook(() => useCurrentContext())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.carryOn?.activityName).toBe('Reach 3 transect')
    expect(result.current.activityId).toBe('act_survey')

    readCurrentContext.mockRejectedValueOnce(new Error('database went away'))
    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.loading).toBe(false)
    expect(result.current.carryOn?.activityName).toBe('Reach 3 transect')
    expect(result.current.activityId).toBe('act_survey')
    // And it says the later read failed while keeping what the earlier one
    // found: the card stays, with the reason beside it.
    expect(result.current.error?.message).toBe('database went away')
  })

  it('never sets loading back to true on a refresh, so CAPTURE is not taken off screen while she is on her way back to it', async () => {
    // `loading` marks the first read only (the hook's own comment says so).
    // A refresh that flipped it back to `true` would show the "One moment"
    // screen — and take `CAPTURE` off it — every single time she returns from
    // a capture, which is the opposite of what the launcher is for. Stalled
    // with `deferred`, the same device this file uses to hold a read open, so
    // the state can be inspected while the refresh's own read is genuinely
    // still in flight rather than guessed at from outside `act`.
    const stall = deferred<Awaited<ReturnType<typeof readCurrentContext>>>()

    const { result } = await renderHook(() => useCurrentContext())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    readCurrentContext.mockReturnValueOnce(stall.promise)
    await act(async () => {
      void result.current.refresh()
    })

    expect(result.current.loading).toBe(false)

    await act(async () => {
      stall.resolve({ activity, project })
    })
    expect(result.current.loading).toBe(false)
  })

  describe('the activity a capture written now belongs to', () => {
    it('waits for the first read rather than answering null because it is early', async () => {
      // The window this whole seam exists for. `activityId` is null on the
      // first render — nobody has looked yet — and a capture taken then wrote
      // `activityId: null, contextActivityId: null`, which §8.3 never allows
      // to be revised. So the question asked at WRITE time must wait.
      const stall = deferred<Awaited<ReturnType<typeof readCurrentContext>>>()
      readCurrentContext.mockReturnValueOnce(stall.promise)

      const { result } = await renderHook(() => useCurrentContext())
      expect(result.current.activityId).toBeNull()

      let answered: string | null | 'still waiting' = 'still waiting'
      const asked = result.current.settledActivityId().then((id) => {
        answered = id
        return id
      })

      // Nothing yet: the read has not come back, and neither has this.
      await act(async () => {
        await Promise.resolve()
      })
      expect(answered).toBe('still waiting')

      await act(async () => {
        stall.resolve({ activity, project })
        await asked
      })
      expect(answered).toBe('act_survey')
    })

    it('answers the Inbox once a read has found nothing running', async () => {
      // A genuine first run still files to the Inbox, and it must not hang
      // waiting for an activity that does not exist.
      readCurrentContext.mockResolvedValue(null)
      const { result } = await renderHook(() => useCurrentContext())
      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })
      await expect(result.current.settledActivityId()).resolves.toBeNull()
    })

    it('answers rather than hanging when the read failed', async () => {
      // A failed read leaves the destination unknown, and the Inbox is where
      // an unknown destination goes. Hanging would mean the row was never
      // written at all — losing the capture, which is worse than filing it
      // somewhere she can move it from.
      readCurrentContext.mockRejectedValue(new Error('database went away'))
      const { result } = await renderHook(() => useCurrentContext())
      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })
      await expect(result.current.settledActivityId()).resolves.toBeNull()
    })

    it('answers a screen that has gone away, so a capture mid-write is still written', async () => {
      // `useCapture` awaits this immediately before its insert. A screen
      // unmounted with the first read still in flight would otherwise leave
      // that await pending for ever and the record would never be written —
      // and "the record is real from the moment of the tap" is the promise
      // the capture screen is built on.
      const stall = deferred<Awaited<ReturnType<typeof readCurrentContext>>>()
      readCurrentContext.mockReturnValueOnce(stall.promise)

      const { result, unmount } = await renderHook(() => useCurrentContext())
      const asked = result.current.settledActivityId()
      await unmount()

      await expect(asked).resolves.toBeNull()
    })
  })
})
