import { newId } from '../ids'

describe('newId', () => {
  it('prefixes the id so a stray value is identifiable in a log', () => {
    expect(newId('rec')).toMatch(/^rec_[0-9a-z]+$/i)
  })

  it('does not collide across many calls', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => newId('rec')))
    expect(ids.size).toBe(5000)
  })

  it('sorts lexicographically in creation order, so ids are useful as a tiebreak', async () => {
    const first = newId('rec')
    await new Promise((r) => setTimeout(r, 5))
    const second = newId('rec')
    expect([second, first].sort()).toEqual([first, second])
  })

  it('mints unique, lexicographically ordered ids when called in a tight loop', () => {
    const count = 5000
    const ids: string[] = []
    for (let i = 0; i < count; i++) {
      ids.push(newId('x'))
    }

    expect(new Set(ids).size).toBe(count)

    const sorted = [...ids].sort()
    expect(ids).toEqual(sorted)
  })
})
