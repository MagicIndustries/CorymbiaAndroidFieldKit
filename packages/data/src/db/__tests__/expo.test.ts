// Mock functions must be named with a leading "mock" (case-insensitive):
// babel-plugin-jest-hoist (via jest-expo's preset) hoists `jest.mock()` calls
// above other module-scope declarations, and refuses to let the factory close
// over any other out-of-scope variable — this is exactly that restriction, not
// a stylistic choice.
const mockRunAsync = jest.fn().mockResolvedValue(undefined)
const mockGetAllAsync = jest.fn().mockResolvedValue([])
const mockGetFirstAsync = jest.fn().mockResolvedValue(null)
const mockCloseAsync = jest.fn().mockResolvedValue(undefined)
const mockOpenDatabaseAsync = jest.fn().mockResolvedValue({
  runAsync: mockRunAsync,
  getAllAsync: mockGetAllAsync,
  getFirstAsync: mockGetFirstAsync,
  closeAsync: mockCloseAsync,
})

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: mockOpenDatabaseAsync }))

// A static `import { openDatabase } from '../expo'` here is transformed by
// babel-preset-expo into a `require('../expo')` that is hoisted, alongside
// this file's own imports, ABOVE the `jest.mock('expo-sqlite', ...)` call
// above — even though that call is itself hoisted, and even though it is
// written first in source order. The result: '../expo' evaluates its own
// `import { openDatabaseAsync } from 'expo-sqlite'` against the REAL
// expo-sqlite module, before the mock is registered, and every call comes
// back `undefined`. A plain `require`, run as an ordinary statement rather
// than an ES import, is untouched by that hoisting and runs where it is
// written — after the mock is in place. Verified by reproducing the failure
// with a static import and watching it disappear with this change.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { openDatabase } = require('../expo') as typeof import('../expo')
import type { Database } from '../port'

describe('the expo-sqlite adapter', () => {
  let db: Database

  beforeEach(async () => {
    jest.clearAllMocks()
    db = await openDatabase()
  })

  it('opens the named database, defaulting to fieldkit.db', async () => {
    expect(mockOpenDatabaseAsync).toHaveBeenCalledWith('fieldkit.db')
  })

  it('opens a database under a caller-supplied name', async () => {
    jest.clearAllMocks()
    await openDatabase('other.db')
    expect(mockOpenDatabaseAsync).toHaveBeenCalledWith('other.db')
  })

  it('enables foreign keys, which SQLite disables by default', async () => {
    expect(mockRunAsync).toHaveBeenCalledWith('PRAGMA foreign_keys = ON')
  })

  it('enables recursive triggers, without which the append-only log is bypassable', async () => {
    expect(mockRunAsync).toHaveBeenCalledWith('PRAGMA recursive_triggers = ON')
  })

  it('passes parameters through positionally on execute', async () => {
    await db.execute('INSERT INTO t (a) VALUES (?)', ['x'])
    expect(mockRunAsync).toHaveBeenCalledWith('INSERT INTO t (a) VALUES (?)', ['x'])
  })

  it('passes parameters through positionally on all', async () => {
    mockGetAllAsync.mockResolvedValueOnce([{ id: 'a' }])
    const rows = await db.all<{ id: string }>('SELECT id FROM t WHERE n = ?', [1])
    expect(mockGetAllAsync).toHaveBeenCalledWith('SELECT id FROM t WHERE n = ?', [1])
    expect(rows).toEqual([{ id: 'a' }])
  })

  it('returns null rather than undefined when a single row is absent', async () => {
    mockGetFirstAsync.mockResolvedValueOnce(undefined)
    expect(await db.first('SELECT 1')).toBeNull()
  })

  it('rolls back when a transaction body throws', async () => {
    await expect(
      db.transaction(async () => {
        throw new Error('deliberate')
      }),
    ).rejects.toThrow('deliberate')
    expect(mockRunAsync).toHaveBeenCalledWith('ROLLBACK')
    expect(mockRunAsync).not.toHaveBeenCalledWith('COMMIT')
  })

  it('commits a transaction that completes', async () => {
    await db.transaction(async () => undefined)
    expect(mockRunAsync).toHaveBeenCalledWith('COMMIT')
  })

  it('serialises overlapping transactions rather than interleaving them', async () => {
    // Un-awaited and overlapping on purpose: two rapid taps on the capture
    // button produce exactly this shape. Interleaved, the second BEGIN would
    // race the first COMMIT.
    const started: string[] = []
    const run = (id: string): Promise<void> =>
      db.transaction(async () => {
        started.push(`begin ${id}`)
        await Promise.resolve()
        started.push(`commit ${id}`)
      })

    await Promise.all([run('x'), run('y')])

    expect(started).toEqual(['begin x', 'commit x', 'begin y', 'commit y'])
  })

  it('keeps serialising after a transaction body throws, rather than wedging the queue', async () => {
    const failing = db.transaction(async () => {
      throw new Error('deliberate')
    })
    const following = db.transaction(async () => undefined)

    await expect(failing).rejects.toThrow('deliberate')
    await expect(following).resolves.toBeUndefined()
    expect(mockRunAsync).toHaveBeenCalledWith('COMMIT')
  })

  it('rejects a nested transaction instead of deadlocking, and keeps serving the next caller', async () => {
    await expect(
      db.transaction(async () => {
        await db.transaction(async () => undefined)
      }),
    ).rejects.toThrow(/Nested transaction/)

    // The queue is unharmed: a normal transaction after the rejected one still
    // runs and commits.
    await expect(db.transaction(async () => undefined)).resolves.toBeUndefined()
    expect(mockRunAsync).toHaveBeenCalledWith('COMMIT')
  })

  it('still queues genuinely concurrent callers rather than treating them as nested', async () => {
    const start = async (): Promise<void> => {
      await Promise.resolve()
      await db.transaction(async () => {
        await Promise.resolve()
      })
    }

    await expect(Promise.all([start(), start(), start()])).resolves.toBeDefined()
  })

  it('closes the underlying connection', async () => {
    await db.close()
    expect(mockCloseAsync).toHaveBeenCalled()
  })
})
