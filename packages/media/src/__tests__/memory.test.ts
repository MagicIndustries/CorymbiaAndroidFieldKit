import { createMemoryStore } from '../store/memory'

describe('the in-memory media store', () => {
  it('saves a file and reports the bytes it took', async () => {
    const store = createMemoryStore({ 'file:///tmp/shot.jpg': 2048 })
    const saved = await store.save('med_a1.jpg', 'file:///tmp/shot.jpg')
    expect(saved.byteSize).toBe(2048)
    expect(await store.exists('med_a1.jpg')).toBe(true)
  })

  it('reports a stable uri for a saved file', async () => {
    const store = createMemoryStore({ 'file:///tmp/shot.jpg': 10 })
    const saved = await store.save('med_a1.jpg', 'file:///tmp/shot.jpg')
    expect(saved.uri).toBe(store.uriFor('med_a1.jpg'))
  })

  it('refuses to save over a name that already exists', async () => {
    // Overwriting silently is how one record's photo becomes another's. The
    // index that makes names unique is derived from a count, and a count read
    // outside a transaction can repeat.
    const store = createMemoryStore({ 'file:///tmp/a.jpg': 1, 'file:///tmp/b.jpg': 2 })
    await store.save('med_a1.jpg', 'file:///tmp/a.jpg')
    await expect(store.save('med_a1.jpg', 'file:///tmp/b.jpg')).rejects.toThrow(/already/i)
  })

  it('throws when the source file is not there', async () => {
    const store = createMemoryStore({})
    await expect(store.save('med_a1.jpg', 'file:///tmp/gone.jpg')).rejects.toThrow(/source/i)
  })

  it('deletes a file', async () => {
    const store = createMemoryStore({ 'file:///tmp/a.jpg': 1 })
    await store.save('med_a1.jpg', 'file:///tmp/a.jpg')
    await store.remove('med_a1.jpg')
    expect(await store.exists('med_a1.jpg')).toBe(false)
  })

  it('is silent about deleting something that is already gone', async () => {
    // Purge runs over rows, and a row can outlive its file (an interrupted
    // save, a restored backup). Throwing there would strand every later row.
    const store = createMemoryStore({})
    await expect(store.remove('med_a1.jpg')).resolves.toBeUndefined()
  })
})
