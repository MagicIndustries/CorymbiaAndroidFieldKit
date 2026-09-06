import { nowIso } from '../time'

describe('nowIso', () => {
  it('includes an offset, so a record keeps the local time it was taken at', () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$/)
  })

  it('round-trips through Date without losing the instant', () => {
    const iso = nowIso()
    expect(new Date(iso).toISOString()).toBe(new Date(iso).toISOString())
    expect(Number.isNaN(new Date(iso).getTime())).toBe(false)
  })
})
