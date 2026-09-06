import { mockedVerdict } from '../mocked'
import type { Reading } from '../classify'

const reading = (over: Partial<Reading> = {}): Reading => ({
  latitude: -37.82141,
  longitude: 145.03318,
  accuracyM: 4,
  altitudeM: 62,
  timestampMs: 1_000,
  ...over,
})

describe('mockedVerdict', () => {
  describe('the three unmixed answers', () => {
    it("is 'mocked' when every reading was mocked", () => {
      expect(mockedVerdict([reading({ isMocked: true }), reading({ isMocked: true })])).toBe(
        'mocked',
      )
    })

    it("is 'notMocked' only when every reading explicitly said so", () => {
      expect(mockedVerdict([reading({ isMocked: false }), reading({ isMocked: false })])).toBe(
        'notMocked',
      )
    })

    it("is 'notReported' when no reading said anything", () => {
      // `isMocked` is optional on Reading, so this is the shape a platform that
      // never exposes the flag produces. Collapsing it to false here is the
      // bug this function exists to make unwritable.
      expect(mockedVerdict([reading(), reading()])).toBe('notReported')
    })
  })

  describe('the mixed sets, where the collapse used to happen', () => {
    it("is 'mocked' when a single reading in the set was mocked", () => {
      // The position was computed partly from it. A fix built from a set
      // containing a spoofed reading cannot be described as unspoofed.
      expect(
        mockedVerdict([
          reading({ isMocked: false }),
          reading({ isMocked: false }),
          reading({ isMocked: true }),
        ]),
      ).toBe('mocked')
    })

    it("is 'mocked' even when the rest of the set never reported", () => {
      // Mocked outranks silence: one reading positively said yes.
      expect(mockedVerdict([reading(), reading({ isMocked: true })])).toBe('mocked')
    })

    it("is 'notReported' when one reading did not say and none was mocked", () => {
      // The set cannot assert more than its least informative member — a hold
      // that began before the platform started reporting the flag.
      expect(mockedVerdict([reading({ isMocked: false }), reading()])).toBe('notReported')
    })

    it('does not let the order of the readings change the answer', () => {
      const mixed = [reading({ isMocked: false }), reading(), reading({ isMocked: true })]
      expect(mockedVerdict(mixed)).toBe('mocked')
      expect(mockedVerdict([...mixed].reverse())).toBe('mocked')
    })
  })

  it("reports 'notReported' for an empty set rather than a clean bill of health", () => {
    // Nothing said anything. averageReadings refuses an empty set before this
    // is reached, but the honest answer is the one to give a direct caller.
    expect(mockedVerdict([])).toBe('notReported')
  })

  it('answers for readings that earned no weight in the average, too', () => {
    // A mock provider claiming 0 m accuracy gets no weight in averageReadings —
    // weightlessness is about how far it moved the position, not about whether
    // it was in the hold. It was, and it was a mock.
    expect(mockedVerdict([reading({ isMocked: false }), reading({ accuracyM: 0, isMocked: true })]))
      .toBe('mocked')
  })
})
