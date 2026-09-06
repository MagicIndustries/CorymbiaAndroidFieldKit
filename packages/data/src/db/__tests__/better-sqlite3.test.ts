import { openTestDatabase } from '../better-sqlite3'
import type { Database } from '../port'

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

  it('enforces foreign keys, which SQLite disables by default', async () => {
    await db.execute('CREATE TABLE child (id TEXT PRIMARY KEY, t_id TEXT NOT NULL REFERENCES t(id))')
    await expect(
      db.execute('INSERT INTO child (id, t_id) VALUES (?, ?)', ['c', 'nonexistent']),
    ).rejects.toThrow()
  })
})
