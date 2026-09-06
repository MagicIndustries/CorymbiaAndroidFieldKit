import { nowIso } from '../time'

describe('nowIso', () => {
  it('includes an offset, so a record keeps the local time it was taken at', () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$/)
  })

  it('round-trips through Date without losing the instant', () => {
    const iso = nowIso()
    expect(Number.isNaN(new Date(iso).getTime())).toBe(false)
  })

  describe('timezone offset arithmetic', () => {
    const mockTimezone = (offsetMinutes: number) => {
      const originalGetTimezoneOffset = Date.prototype.getTimezoneOffset
      Date.prototype.getTimezoneOffset = jest.fn(() => -offsetMinutes)
      return () => {
        Date.prototype.getTimezoneOffset = originalGetTimezoneOffset
      }
    }

    it('renders UTC as Z, not +00:00', () => {
      const restore = mockTimezone(0)
      try {
        const iso = nowIso(new Date('2024-01-15T14:30:45Z'))
        expect(iso).toMatch(/Z$/)
        expect(iso).not.toMatch(/\+00:00/)
      } finally {
        restore()
      }
    })

    it('handles positive whole-hour offsets (Victoria +10:00)', () => {
      const restore = mockTimezone(600) // +10:00 is -(-600) minutes offset
      try {
        const iso = nowIso(new Date('2024-01-15T14:30:45Z'))
        expect(iso).toMatch(/\+10:00$/)
        // At UTC 14:30:45, Victoria is 00:30:45 the next day
        expect(iso).toContain('2024-01-16T00:30:45')
      } finally {
        restore()
      }
    })

    it('handles negative offsets (US Eastern -05:00)', () => {
      const restore = mockTimezone(-300) // -05:00
      try {
        const iso = nowIso(new Date('2024-01-15T14:30:45Z'))
        expect(iso).toMatch(/-05:00$/)
        // At UTC 14:30:45, Eastern is 09:30:45
        expect(iso).toContain('09:30:45')
      } finally {
        restore()
      }
    })

    it('handles half-hour positive offsets (India +05:30)', () => {
      const restore = mockTimezone(330) // +05:30 is -(-330) minutes offset
      try {
        const iso = nowIso(new Date('2024-01-15T14:30:45Z'))
        expect(iso).toMatch(/\+05:30$/)
        // At UTC 14:30:45, India is 20:00:45
        expect(iso).toContain('20:00:45')
      } finally {
        restore()
      }
    })

    it('handles half-hour negative offsets (Newfoundland -03:30)', () => {
      const restore = mockTimezone(-210) // -03:30
      try {
        const iso = nowIso(new Date('2024-01-15T14:30:45Z'))
        expect(iso).toMatch(/-03:30$/)
        // At UTC 14:30:45, Newfoundland is 11:00:45
        expect(iso).toContain('11:00:45')
      } finally {
        restore()
      }
    })
  })
})
