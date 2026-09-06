import { newId } from '../ids'

describe('newId', () => {
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
