import { openTestDatabase } from '../better-sqlite3'
import type { Database } from '../port'
import { DEFAULT_TRANSACTION_START_TIMEOUT_MS } from '../transactions'

/**
 * The nested-transaction guard is a bound on how long a transaction may wait
 * for its turn (see ../transactions for why React Native leaves no alternative),
 * so a test that provokes it necessarily waits that long. The production
 * default is five seconds; these tests open their own database with a small
 * one, and a separate test below pins the default so shrinking it here cannot
 * quietly shrink it on device.
 */
const SHORT_START_TIMEOUT_MS = 50

describe('the test database adapter', () => {
  let db: Database

  beforeEach(async () => {
    db = await openTestDatabase()
    await db.execute('CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER NOT NULL)')
  })

  afterEach(async () => {
    await db.close()
  })

  it('executes statements and reads rows back', async () => {
    await db.execute('INSERT INTO t (id, n) VALUES (?, ?)', ['a', 1])
    await db.execute('INSERT INTO t (id, n) VALUES (?, ?)', ['b', 2])
    const rows = await db.all<{ id: string; n: number }>('SELECT id, n FROM t ORDER BY n')
    expect(rows).toEqual([
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
    ])
  })

  it('returns null rather than throwing when a single row is absent', async () => {
    expect(await db.first('SELECT id FROM t WHERE id = ?', ['missing'])).toBeNull()
  })

  it('enforces constraints, so the schema is genuinely under test', async () => {
    await db.execute('INSERT INTO t (id, n) VALUES (?, ?)', ['a', 1])
    await expect(db.execute('INSERT INTO t (id, n) VALUES (?, ?)', ['a', 9])).rejects.toThrow()
  })

  it('rolls a transaction back when the body throws', async () => {
    await expect(
      db.transaction(async () => {
        await db.execute('INSERT INTO t (id, n) VALUES (?, ?)', ['x', 1])
        throw new Error('deliberate')
      }),
    ).rejects.toThrow('deliberate')
    expect(await db.all('SELECT id FROM t')).toEqual([])
  })

  it('commits a transaction that completes', async () => {
    await db.transaction(async () => {
      await db.execute('INSERT INTO t (id, n) VALUES (?, ?)', ['x', 1])
    })
    expect(await db.all('SELECT id FROM t')).toHaveLength(1)
  })

  it('serialises overlapping transactions rather than interleaving them', async () => {
    // Un-awaited and overlapping on purpose: this is the shape two rapid taps
    // on the capture button produce. Interleaved, the second BEGIN throws and
    // the first COMMIT commits the second's partial work.
    const started: string[] = []
    const run = (id: string, n: number): Promise<void> =>
      db.transaction(async () => {
        started.push(`begin ${id}`)
        await db.execute('INSERT INTO t (id, n) VALUES (?, ?)', [id, n])
        // Yield mid-transaction, giving the other call every chance to cut in.
        await Promise.resolve()
        started.push(`commit ${id}`)
      })

    await Promise.all([run('x', 1), run('y', 2)])

    expect(started).toEqual(['begin x', 'commit x', 'begin y', 'commit y'])
    expect(await db.all('SELECT id FROM t')).toHaveLength(2)
  })

  it('keeps serialising after a transaction body throws, rather than wedging the queue', async () => {
    // A rejected link left in the chain would make every later transaction
    // hang or inherit the failure. The rollback must still be the only effect.
    const failing = db.transaction(async () => {
      await db.execute('INSERT INTO t (id, n) VALUES (?, ?)', ['doomed', 1])
      throw new Error('deliberate')
    })
    const following = db.transaction(async () => {
      await db.execute('INSERT INTO t (id, n) VALUES (?, ?)', ['survivor', 2])
    })

    await expect(failing).rejects.toThrow('deliberate')
    await expect(following).resolves.toBeUndefined()
    expect(await db.all('SELECT id FROM t')).toEqual([{ id: 'survivor' }])
  })

  describe('when a transaction body opens a second transaction', () => {
    let nesting: Database

    beforeEach(async () => {
      nesting = await openTestDatabase({ transactionStartTimeoutMs: SHORT_START_TIMEOUT_MS })
      await nesting.execute('CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER NOT NULL)')
    })

    afterEach(async () => {
      await nesting.close()
    })

    it('fails with a named error instead of deadlocking, and keeps serving the next caller', async () => {
      // Serialising turns nesting from an error into a hang: the inner call
      // waits for a queue that cannot advance until the outer body it is
      // running inside returns. A hang has no error, no stack and nothing in
      // the log — on a field tablet it is indistinguishable from a dead device.
      // So it must be named.
      //
      // The "later callers still work" half is the one that matters. A guard
      // that avoids a deadlock by wedging the queue behind it has not helped
      // anyone.
      const attempt = nesting.transaction(async () => {
        await nesting.execute('INSERT INTO t (id, n) VALUES (?, ?)', ['outer', 1])
        await nesting.transaction(async () => {
          await nesting.execute('INSERT INTO t (id, n) VALUES (?, ?)', ['inner', 2])
        })
      })

      await expect(attempt).rejects.toThrow(/Nested transaction/)
      await expect(attempt).rejects.toMatchObject({ name: 'NestedTransactionError' })

      // The outer transaction rolled back, as any failing body does — and the
      // inner body never ran, so the row it would have written is absent too.
      expect(await nesting.all('SELECT id FROM t')).toEqual([])

      // And the queue is unharmed: a normal transaction after the rejected one
      // still runs and commits.
      await nesting.transaction(async () => {
        await nesting.execute('INSERT INTO t (id, n) VALUES (?, ?)', ['after', 3])
      })
      expect(await nesting.all('SELECT id FROM t')).toEqual([{ id: 'after' }])
    })

    it('never runs the abandoned body, even long after the outer transaction unwinds', async () => {
      // The inner call gives up while still queued, but its queue link is real
      // and settles once the outer transaction rolls back. If the runner then
      // ran the body anyway, the inner INSERT would land in a transaction of
      // its own, after its caller had already been told it failed.
      let innerBodyRan = false
      await expect(
        nesting.transaction(async () => {
          await nesting.transaction(async () => {
            innerBodyRan = true
            await nesting.execute('INSERT INTO t (id, n) VALUES (?, ?)', ['inner', 2])
          })
        }),
      ).rejects.toThrow(/Nested transaction/)

      await nesting.transaction(async () => undefined)
      expect(innerBodyRan).toBe(false)
      expect(await nesting.all('SELECT id FROM t')).toEqual([])
    })
  })

  it('waits five seconds before calling a stalled transaction nested', () => {
    // Pinned deliberately. The tests above shorten this to keep the suite fast,
    // and a default shortened to match them would start rejecting honest
    // transactions on a slow device.
    expect(DEFAULT_TRANSACTION_START_TIMEOUT_MS).toBe(5_000)
  })

  it('still queues genuinely concurrent callers rather than treating them as nested', async () => {
    // The guard must key off "did this call originate inside a transaction
    // body", not "is a transaction open" — a concurrent caller waiting its turn
    // is also running while one is open, and rejecting it would undo the
    // serialisation entirely. Each call here starts from its own context after
    // an await, so a naive in-flight flag would fail this.
    const start = async (id: string, n: number): Promise<void> => {
      await Promise.resolve()
      await db.transaction(async () => {
        await db.execute('INSERT INTO t (id, n) VALUES (?, ?)', [id, n])
        await Promise.resolve()
      })
    }

    await Promise.all([start('p', 1), start('q', 2), start('r', 3)])
    expect(await db.all('SELECT id FROM t ORDER BY id')).toEqual([
      { id: 'p' },
      { id: 'q' },
      { id: 'r' },
    ])
  })

  it('enforces foreign keys, which SQLite disables by default', async () => {
    await db.execute('CREATE TABLE child (id TEXT PRIMARY KEY, t_id TEXT NOT NULL REFERENCES t(id))')
    await expect(
      db.execute('INSERT INTO child (id, t_id) VALUES (?, ?)', ['c', 'nonexistent']),
    ).rejects.toThrow()
  })
})
