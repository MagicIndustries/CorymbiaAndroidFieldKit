import { act, renderHook } from '@testing-library/react-native'
import { averageReadings, createFakeLocationSource, holdVerdict, type Reading } from '@corymbia/geo'
import type { Database, Device, FieldRecord, Fix } from '@corymbia/data'

/**
 * Tests for the capture state machine.
 *
 * WHAT IS AND IS NOT MOCKED, and why. The same division `diagnostics.test.tsx`
 * draws, for the same reasons.
 *
 * Not mocked: `averageReadings`, `holdVerdict`, `sampleEvidence`, `nowIso`.
 * They are the logic under observation. A test that stubbed `holdVerdict`
 * could not tell whether this hook ends a countdown on a plateau — nor whether
 * it honours the minimum-sample guard, which is the single most important rule
 * below.
 *
 * Not mocked either: the location source. It is a *dependency* of the hook
 * rather than a module it reaches for, so `createFakeLocationSource` is simply
 * passed in — which is most of the point of lifting this out of the screen.
 *
 * Mocked: `createRecord` and `refineRecordFix`. Not because SQLite is
 * inconvenient but because it is already proved — 348 tests in packages/data
 * cover the schema, the CHECK constraints and both of these functions. What is
 * NOT proved anywhere else is this hook's state machine: how many records one
 * tap produces, how many refinements one countdown produces, and what happens
 * to the timers when the hook goes away. Mocking them is also what lets a test
 * hold a write open between two of its awaits, which is the only way to drive
 * the double-tap window at its real await boundary.
 */

// ---------------------------------------------------------------------------
// Module mocks. Each factory reaches its fixture through a lazy arrow, because
// `jest.mock` is hoisted above the `const` below it — a factory that touched
// `mockRepo` at definition time would run before it exists.
// ---------------------------------------------------------------------------

const mockRepo = {
  createRecord: jest.fn(),
  refineRecordFix: jest.fn(),
}

jest.mock('@corymbia/data', () => {
  const actual = jest.requireActual('@corymbia/data')
  return {
    ...actual,
    createRecord: (...args: unknown[]) => mockRepo.createRecord(...args),
    refineRecordFix: (...args: unknown[]) => mockRepo.refineRecordFix(...args),
  }
})

// Imported after the mocks so it picks them up.
import { useCapture } from '../useCapture'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A handle, not a database. Nothing in this file calls a method on it: the two
 * repository functions the hook uses are replaced above, and the hook only
 * passes the handle through to them. Every method rejects rather than
 * resolving, so a hook that started talking to the database directly would
 * fail loudly here instead of quietly succeeding against a stub.
 */
const testDb: Database = {
  execute: () => Promise.reject(new Error('the test database is a handle, not a database')),
  all: () => Promise.reject(new Error('the test database is a handle, not a database')),
  first: () => Promise.reject(new Error('the test database is a handle, not a database')),
  transaction: () => Promise.reject(new Error('the test database is a handle, not a database')),
  close: () => Promise.resolve(),
}

const testDevice: Device = {
  id: 'device-under-test',
  installId: 'install-1',
  label: 'test-handset',
  manufacturer: 'Test',
  brand: 'Test',
  modelName: 'Model',
  modelId: 'model-1',
  deviceType: 'phone',
  osName: 'Android',
  osVersion: '15',
  isPhysical: true,
  appVersion: '1.0.0',
  appBuild: '1',
  firstSeenAt: '2026-09-07T00:00:00.000Z',
  lastSeenAt: '2026-09-07T00:00:00.000Z',
}

/**
 * A reading with everything the save path insists on: a usable accuracy and an
 * explicit `isMocked: false`. `undefined` there is the platform declining to
 * say, which the save path refuses to store — correct behaviour, and the
 * subject of its own test below rather than an accident of this fixture.
 */
function reading(accuracyM: number, timestampMs: number): Reading {
  return {
    latitude: -37.8136,
    longitude: 144.9631,
    accuracyM,
    altitudeM: 31,
    verticalAccuracyM: 4,
    isMocked: false,
    timestampMs,
  }
}

let mockCaptureNumber = 0

/**
 * Every record the mocked repository has handed out, by id.
 *
 * `createRecord` and `refineRecordFix` are not independent fixtures:
 * `refineRecordFix` changes one column of a row `createRecord` already wrote,
 * and the real implementation is explicit about what it does *not* touch —
 * `records.ts` names `capture_number` and `captured_at`, and migration 003's
 * `record_capture_number_is_immutable` enforces the first at the database. A
 * fixture that minted a fresh capture number on every refinement models a
 * database state that cannot exist, and hands the hook a tube label that
 * changes halfway through a capture. Inert today, because nothing here reads
 * the number back — but it is the one property this branch most insists on,
 * and a fixture that contradicts it is where a test asserting it would
 * quietly start passing for the wrong reason.
 */
const mockRecords = new Map<string, FieldRecord>()

/**
 * Applies a change the way the repository does — in place, on the row that is
 * already there — or throws the way `refineRecordFix` does when the id names
 * nothing.
 */
function amendRecord(id: string, change: Partial<FieldRecord>): FieldRecord {
  const existing = mockRecords.get(id)
  if (!existing) throw new Error(`Record ${id} does not exist in the fixture.`)
  const amended: FieldRecord = { ...existing, ...change }
  mockRecords.set(id, amended)
  return amended
}

function recordFrom(fix: Fix): FieldRecord {
  mockCaptureNumber += 1
  const record: FieldRecord = {
    id: `record-${String(mockCaptureNumber)}`,
    activityId: null,
    contextActivityId: null,
    kind: 'pin',
    captureNumber: mockCaptureNumber,
    sequence: null,
    filedAt: null,
    title: null,
    description: null,
    fix,
    capturedAt: new Date(Date.now()).toISOString(),
    deviceId: testDevice.id,
    attributes: {},
  }
  mockRecords.set(record.id, record)
  return record
}

/**
 * A promise the test resolves by hand, so a capture can be held open between
 * two of its awaits — which is the window the double-tap defect lived in.
 *
 * Written without a definite-assignment assertion: the initial no-op is
 * replaced synchronously by the executor, which runs before `Promise` returns.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let settle: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolveWith) => {
    settle = resolveWith
  })
  return {
    promise,
    resolve: (value) => {
      settle(value)
    },
  }
}

const START_MS = Date.UTC(2026, 8, 7, 1, 0, 0)

/** The default countdown cap these tests run against, in seconds. */
const CAP_S = 15

/**
 * The hook's readout tick, in milliseconds — four times a second, the rate
 * the countdown ring is redrawn at. Mirrored here rather than exported,
 * because the tests that turn on it are about the *gap* between that rate and
 * the once-a-second whole-seconds readout.
 */
const TICK_MS = 250

/**
 * A cap long enough that it cannot be what ends a plateau test. The plateau
 * tests below run at most eleven seconds of readings, so a countdown that
 * finishes in one of them finished because `holdVerdict` said so.
 */
const LONG_CAP_S = 60

/**
 * The flat accuracy the two minimum-sample tests emit, in metres, and **the
 * one number in this file that had to be derived rather than picked.**
 *
 * With uniform readings `averageReadings` reports `max(σ/√n, σ/3)`, so the
 * whole accuracy series is σ scaled by a fixed factor and the point at which
 * `holdVerdict`'s trailing window falls under `MEANINGFUL_IMPROVEMENT_M`
 * depends only on σ. What matters for a test of the minimum-sample guard is
 * the gap between two crossings: the *guarded* one, from `MIN_SAMPLES`, and
 * the *unguarded* one — the same rule run from the earliest window it can
 * evaluate at all, n=5. Computed over the real `averageReadings`:
 *
 * ```
 *  σ        guarded   unguarded
 *  0.8 m      10          5
 *  1 m        10          6
 *  2 m        10          7
 *  3 m        10          8
 *  4 m        10          9
 *  4.4 m      10         10
 *  6 m        10         10
 *  8 m        11         11
 * ```
 *
 * **The two coincide from about σ = 4.4 m upward**, and above that the guard
 * holds nothing back: a test written with such a value passes identically
 * against a build with no minimum-sample guard at all. That includes the 8 m
 * the diagnostics tests use — where both crossings are n=11, so the guard is
 * inert there rather than landing exactly on `MIN_SAMPLES` as an earlier
 * version of this comment claimed. Everything from about 1 m to 4.4 m does
 * exercise the guard, by one to five samples.
 *
 * 0.8 m is chosen for the widest gap available. Verified against the real
 * `holdVerdict` (see the `it` block that pins it): the guarded crossing is
 * n=10, while the unguarded one is n=5, a full five samples earlier. That gap
 * is what test 6's first phase sits inside.
 */
const FLAT_M = 0.8

/** How many samples `holdVerdict` requires before it may claim a plateau. */
const MIN_SAMPLES = 10

let source: ReturnType<typeof createFakeLocationSource>

beforeEach(() => {
  // `setImmediate`, `nextTick` and `queueMicrotask` are deliberately left real.
  // React's async `act` flushes its work queue through `setImmediate`, so
  // faking it means every `await act(...)` waits for a callback the test itself
  // is holding, and every test fails on the 5 s timeout instead of on its
  // assertion. Everything the hook schedules — `setTimeout` for the countdown,
  // `setInterval` for the ticker, `Date.now` for the seconds remaining — is
  // still faked, which is the part that matters: a 60 s countdown must not take
  // 60 s to test.
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] })
  jest.setSystemTime(START_MS)

  mockCaptureNumber = 0
  mockRecords.clear()
  source = createFakeLocationSource({ permission: 'granted', readings: [] })

  mockRepo.createRecord.mockReset()
  mockRepo.refineRecordFix.mockReset()
  mockRepo.createRecord.mockImplementation((_db: unknown, input: { fix: Fix }) =>
    Promise.resolve(recordFrom(input.fix)),
  )
  // Amends the row that is already there, rather than minting a new one with
  // a fresh capture number — see `mockRecords`.
  mockRepo.refineRecordFix.mockImplementation(
    (_db: unknown, input: { recordId: string; fix: Fix }) =>
      Promise.resolve(amendRecord(input.recordId, { fix: input.fix })),
  )
})

afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Lets every pending promise continuation run, and React apply what they set. */
async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

/**
 * Mounts the hook and lets the permission request and the subscription resolve.
 * `@testing-library/react-native` v14 is async throughout, so `renderHook` and
 * `unmount` are both awaited.
 */
async function mountCapture(capSeconds = CAP_S) {
  const view = await renderHook(() =>
    useCapture({ db: testDb, device: testDevice, source, capSeconds }),
  )
  await settle()
  return view
}

/** Delivers one reading, a second after the last thing that happened. */
async function emit(accuracyM: number) {
  await act(async () => {
    jest.advanceTimersByTime(1000)
    source.emit(reading(accuracyM, Date.now()))
  })
}

/** Delivers `count` readings a second apart, each with the same accuracy. */
async function emitFlat(count: number, accuracyM = FLAT_M) {
  for (let i = 0; i < count; i++) await emit(accuracyM)
}

/** Runs the clock forward by whole countdowns. */
async function advanceCaps(count: number, capSeconds = CAP_S) {
  await act(async () => {
    jest.advanceTimersByTime(count * capSeconds * 1000 + 1000)
  })
  await settle()
}

/** A flat hold of `n` readings, as `holdVerdict` itself would be handed it. */
function flatHold(n: number, accuracyM = FLAT_M): Reading[] {
  return Array.from({ length: n }, (_, i) => reading(accuracyM, START_MS + i * 1000))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useCapture', () => {
  it('writes exactly one record on a tap and moves to acquiring', async () => {
    const { result } = await mountCapture()
    await emit(6)

    await act(async () => {
      result.current.capture()
    })
    await settle()

    expect(mockRepo.createRecord).toHaveBeenCalledTimes(1)
    // The record is real on disk before the wait starts — that is the whole
    // model: if the app dies or she walks away, the capture survives with the
    // fix it had and only the sharpening is lost.
    expect(result.current.record).not.toBeNull()
    expect(result.current.phase).toBe('acquiring')
    expect(mockRepo.createRecord).toHaveBeenCalledWith(
      testDb,
      expect.objectContaining({ fix: expect.objectContaining({ quality: 'deliberate' }) }),
    )
  })

  it('writes one record, not two, when a second tap lands inside the write window', async () => {
    // The window this test is about: `capture()` runs an await — the insert —
    // before the countdown exists, and nothing debounces the control, so the
    // second tap of a double-tap arrives while the first capture is parked at
    // that await with no countdown yet to test for.
    //
    // The record the missing guard produced was not a harmless duplicate: it
    // had one sample, no spread and a zero-length hold, which on disk is
    // indistinguishable from "the countdown produced no improvement" — the
    // exact measurement this interaction exists to make.
    //
    // Driven at the real await boundary rather than by inspecting a flag: the
    // insert is held open, so the first capture is genuinely parked between
    // `createRecord` and the countdown for as long as this test wants.
    const held = deferred<FieldRecord>()
    mockRepo.createRecord.mockImplementation(() => held.promise)

    const { result } = await mountCapture()
    await emit(6)

    await act(async () => {
      result.current.capture()
    })
    expect(mockRepo.createRecord).toHaveBeenCalledTimes(1)

    // The second tap, with the first capture parked mid-write.
    await act(async () => {
      result.current.capture()
    })
    expect(mockRepo.createRecord).toHaveBeenCalledTimes(1)

    await act(async () => {
      held.resolve(recordFrom({ quality: 'none' }))
      await held.promise
    })
    await settle()

    expect(mockRepo.createRecord).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe('acquiring')
  })

  it('refines exactly once when the countdown runs to its cap', async () => {
    const { result } = await mountCapture()
    await emit(6)

    await act(async () => {
      result.current.capture()
    })
    await settle()
    await emitFlat(3, 5)

    await advanceCaps(1)

    expect(mockRepo.refineRecordFix).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe('recorded')

    // The refinement changed the fix and nothing else. The capture number is
    // the thing that may already be written on a tube, and
    // `record_capture_number_is_immutable` enforces at the database what this
    // asserts through the hook.
    expect(result.current.record?.id).toBe('record-1')
    expect(result.current.record?.captureNumber).toBe(1)

    // A further full cap, to prove no later timer fires a second refinement.
    await advanceCaps(1)
    expect(mockRepo.refineRecordFix).toHaveBeenCalledTimes(1)
  })

  it('refines exactly once when the override accepts early, and no timer fires afterwards', async () => {
    const { result } = await mountCapture()
    await emit(6)

    await act(async () => {
      result.current.capture()
    })
    await settle()
    await emitFlat(2, 5)

    await act(async () => {
      result.current.acceptNow()
    })
    await settle()

    expect(mockRepo.refineRecordFix).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe('recorded')

    // The cap has not been reached yet; running past it must change nothing.
    await advanceCaps(1)
    expect(mockRepo.refineRecordFix).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe('recorded')
  })

  it('ends the countdown on a plateau, before the cap', async () => {
    const { result } = await mountCapture(LONG_CAP_S)
    await emit(FLAT_M)

    await act(async () => {
      result.current.capture()
    })
    await settle()

    // The tap's own reading is sample one, so `MIN_SAMPLES - 1` more reach the
    // minimum. All flat, which on this value is a plateau the moment the guard
    // allows one to be claimed.
    await emitFlat(MIN_SAMPLES - 1)
    await settle()

    expect(mockRepo.refineRecordFix).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe('recorded')
    // Which of the three completion paths ran, said out loud. The override was
    // never touched and nine seconds of readings is nowhere near a sixty-second
    // cap, so this is the plateau or nothing.
    expect(result.current.message).toBe(
      'The fix stopped improving, so the countdown finished itself.',
    )
    expect(Date.now() - START_MS).toBeLessThan(LONG_CAP_S * 1000)
  })

  it('will not claim a plateau before the minimum sample count, however flat the readings', async () => {
    // The value this test turns on. `FLAT_M`'s comment explains why it is 0.8
    // and not something more plausible-looking; these two assertions are the
    // verification that comment claims, run against the real `holdVerdict`
    // rather than taken on trust.
    //
    // Below the minimum the answer is always `'improving'` — including at the
    // sample where an unguarded rule would already have said `'plateaued'`,
    // which for this value is n=5.
    expect(holdVerdict(flatHold(MIN_SAMPLES - 1))).toBe('improving')
    expect(holdVerdict(flatHold(MIN_SAMPLES))).toBe('plateaued')

    const { result } = await mountCapture(LONG_CAP_S)
    await emit(FLAT_M)

    await act(async () => {
      result.current.capture()
    })
    await settle()

    // Two short of the minimum, counting the tap's own reading.
    await emitFlat(MIN_SAMPLES - 3)
    await settle()

    expect(result.current.phase).toBe('acquiring')
    expect(result.current.verdict).toBe('improving')
    expect(mockRepo.refineRecordFix).not.toHaveBeenCalled()

    // The reading that reaches the minimum, and the one after it. The wait ends
    // here and not a sample earlier.
    await emitFlat(2)
    await settle()

    expect(result.current.phase).toBe('recorded')
    expect(mockRepo.refineRecordFix).toHaveBeenCalledTimes(1)
  })

  it('leaves no timer running and refines nothing when it is unmounted mid-countdown', async () => {
    const view = await mountCapture()
    await emit(6)

    await act(async () => {
      view.result.current.capture()
    })
    await settle()

    expect(view.result.current.phase).toBe('acquiring')
    // The completion timeout and the readout ticker are both live.
    expect(jest.getTimerCount()).toBeGreaterThan(0)

    await view.unmount()

    expect(jest.getTimerCount()).toBe(0)

    await advanceCaps(2)
    expect(mockRepo.refineRecordFix).not.toHaveBeenCalled()
    // Nothing wrote a new phase into a hook that no longer exists.
    expect(view.result.current.phase).toBe('acquiring')
  })

  it('reports the remaining wait as a fraction that moves between ticks, not once a second', async () => {
    // The countdown ring is drawn from this number, and the whole-seconds
    // readout beside it is not the same quantity. `Math.ceil` is right for
    // `TIME LEFT` — a fractional second there is noise — and wrong for a ring:
    // a ceil-ed integer over a constant total changes at 1 Hz while the ticker
    // runs at 4 Hz, so the ring advanced in fifteen discrete 6.7% jumps and
    // went from one fifteenth remaining straight to unmounted.
    //
    // Half a second is the interval that tells the two apart: two ticks of the
    // ticker, and no change at all in the whole-seconds readout.
    const { result } = await mountCapture()
    await emit(6)

    await act(async () => {
      result.current.capture()
    })
    await settle()

    expect(result.current.remainingFraction).toBeCloseTo(1, 6)

    await act(async () => {
      jest.advanceTimersByTime(TICK_MS)
    })
    const afterOneTick = result.current.remainingFraction
    const secondsAfterOneTick = result.current.secondsRemaining

    await act(async () => {
      jest.advanceTimersByTime(TICK_MS)
    })

    expect(afterOneTick).toBeLessThan(1)
    expect(result.current.remainingFraction).toBeLessThan(afterOneTick)
    // And the readout that should only move once a second has not moved,
    // which is what makes this a statement about the fraction rather than
    // about the clock having advanced at all.
    expect(result.current.secondsRemaining).toBe(secondsAfterOneTick)
  })

  it('runs the fraction the whole way down, so the ring can reach empty', async () => {
    const { result } = await mountCapture()
    await emit(6)

    await act(async () => {
      result.current.capture()
    })
    await settle()

    // One tick short of the cap: the smallest value the fraction takes while
    // the countdown is still running. On the old integer quotient this was
    // 1/15 — the ring jumped from there to gone.
    await act(async () => {
      jest.advanceTimersByTime(CAP_S * 1000 - TICK_MS)
    })
    expect(result.current.phase).toBe('acquiring')
    expect(result.current.remainingFraction).toBeLessThan(1 / CAP_S)
    expect(result.current.remainingFraction).toBeGreaterThan(0)
  })

  it('returns to ready when the next capture is asked for', async () => {
    const { result } = await mountCapture()
    await emit(6)

    await act(async () => {
      result.current.capture()
    })
    await settle()
    await advanceCaps(1)
    expect(result.current.phase).toBe('recorded')

    await act(async () => {
      result.current.again()
    })

    expect(result.current.phase).toBe('ready')
    expect(result.current.record).toBeNull()
    expect(result.current.secondsRemaining).toBe(0)
  })

  it('still records a capture taken before there is any usable reading, with no position', async () => {
    // Doctrine rule 4: nothing blocks capture. A tap with no fix on hand writes
    // a real row at a real time — the countdown that follows can still give it
    // a position — and the row says `'none'` rather than inventing one.
    const { result } = await mountCapture()

    await act(async () => {
      result.current.capture()
    })
    await settle()

    expect(mockRepo.createRecord).toHaveBeenCalledTimes(1)
    expect(mockRepo.createRecord).toHaveBeenCalledWith(
      testDb,
      expect.objectContaining({ fix: { quality: 'none' } }),
    )
    expect(result.current.phase).toBe('acquiring')
    // The reason is carried into the record's `'created'` event, because a
    // `'none'` row's own columns cannot say why it has no position.
    expect(mockRepo.createRecord).toHaveBeenCalledWith(
      testDb,
      expect.objectContaining({ detail: expect.stringContaining('No readings') }),
    )
    expect(result.current.message).not.toBeNull()

    // And the countdown still gives it one — the claim this test's name
    // makes, not just that some refinement happened.
    await emitFlat(3, 5)
    await advanceCaps(1)
    expect(mockRepo.refineRecordFix).toHaveBeenCalledTimes(1)
    expect(mockRepo.refineRecordFix).toHaveBeenCalledWith(
      testDb,
      expect.objectContaining({ fix: expect.objectContaining({ quality: 'deliberate' }) }),
    )
    expect(result.current.phase).toBe('recorded')
  })

  it('refuses to store a position when the platform never reported whether it is mocked', async () => {
    // A fix that cannot show it was not spoofed is not evidence (spec §7.5).
    // `isMocked: undefined` is the platform declining to say — distinct from
    // `false`, which every other reading in this file sets explicitly — and
    // `buildDeliberateFix` refuses to store a position for it rather than
    // defaulting the unreported flag to "clean". The tap still writes a real
    // row, per doctrine rule 4: `'none'`, with the reason in its detail.
    const { result } = await mountCapture()

    await act(async () => {
      jest.advanceTimersByTime(1000)
      source.emit({
        latitude: -37.8136,
        longitude: 144.9631,
        accuracyM: 6,
        altitudeM: 31,
        verticalAccuracyM: 4,
        isMocked: undefined,
        timestampMs: Date.now(),
      })
    })

    await act(async () => {
      result.current.capture()
    })
    await settle()

    expect(mockRepo.createRecord).toHaveBeenCalledTimes(1)
    expect(mockRepo.createRecord).toHaveBeenCalledWith(
      testDb,
      expect.objectContaining({ fix: { quality: 'none' } }),
    )
    expect(mockRepo.createRecord).toHaveBeenCalledWith(
      testDb,
      expect.objectContaining({ detail: expect.stringContaining('never reported whether') }),
    )
    expect(result.current.phase).toBe('acquiring')
  })

  it('reports a message and stays capturable when the fix builder throws synchronously', async () => {
    // `buildDeliberateFix` is not a pure numeric transform: `nowIso` runs
    // `Date#toISOString` on the last sample's timestamp, which raises a
    // synchronous `RangeError` when the platform hands back a timestamp
    // outside the range `Date` can represent — a misbehaving provider, not a
    // hypothetical. Un-guarded, this is exactly the throw that used to leave
    // `writeInFlight` claimed forever: the first assertion below is the
    // symptom (no message, capture silently does nothing); the second is the
    // one that actually matters, and the one that failed before this fix.
    const { result } = await mountCapture()
    await act(async () => {
      jest.advanceTimersByTime(1000)
      source.emit(reading(6, 8.65e15))
    })

    await act(async () => {
      result.current.capture()
    })
    await settle()

    expect(mockRepo.createRecord).not.toHaveBeenCalled()
    expect(result.current.message).toContain('Invalid time value')
    expect(result.current.phase).toBe('ready')

    // The claim must have been released: a second, ordinary tap has to work,
    // not be silently refused for the rest of the session.
    await emit(6)
    await act(async () => {
      result.current.capture()
    })
    await settle()

    expect(mockRepo.createRecord).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe('acquiring')
  })

  it('says how the wait ended even when the fix builder throws on the refinement itself', async () => {
    // The same synchronous throw the tap path guards against — `nowIso`
    // running `Date#toISOString` on an out-of-range timestamp from a
    // misbehaving provider — reached on the *refinement* path, where
    // `buildDeliberateFix` was called bare.
    //
    // This is not the in-flight leak: `finishCountdown`'s `finally` releases
    // the claim, so the control stays live. The failure is that the promise
    // rejected unhandled and the recorded state rendered with NO "how the
    // wait ended" sentence at all, over a record that was never refined. She
    // stands still for fifteen seconds, the screen says the capture is done,
    // and it silently keeps the tap's coarser fix. Every other exit from this
    // path has a sentence attached; this was the only one that said nothing.
    const { result } = await mountCapture()
    await emit(6)

    await act(async () => {
      result.current.capture()
    })
    await settle()

    // A reading the receiver stamped outside the range `Date` can represent.
    // It is the last sample in the buffer, which is the one whose timestamp
    // becomes the fix's `gpsTime`.
    await act(async () => {
      jest.advanceTimersByTime(1000)
      source.emit(reading(5, 8.65e15))
    })

    await act(async () => {
      result.current.acceptNow()
    })
    await settle()

    // The record keeps the fix the tap saved — nothing was refined — and the
    // wait is over either way.
    expect(mockRepo.refineRecordFix).not.toHaveBeenCalled()
    expect(result.current.phase).toBe('recorded')
    expect(result.current.message).toContain('Invalid time value')
    expect(result.current.message).toContain('the fix it already had')
  })

  it('reports a positive improvedByM once the countdown sharpens the fix', async () => {
    const { result } = await mountCapture()
    // A mediocre tap reading, then three much better ones, all at the same
    // position — so `averageReadings`' answer depends only on the accuracies,
    // the thing this test is about.
    await emit(12)

    await act(async () => {
      result.current.capture()
    })
    await settle()

    await emitFlat(3, 2)
    await settle()

    // `averageReadings` is not mocked in this file — it is the logic under
    // observation — so the expectation is computed the same way the hook
    // computes its preview, against the real function and the exact samples
    // the hook itself accumulated, rather than a value picked by hand.
    const expectedAccuracyM = averageReadings([
      reading(12, START_MS + 1000),
      reading(2, START_MS + 2000),
      reading(2, START_MS + 3000),
      reading(2, START_MS + 4000),
    ]).accuracyM
    expect(result.current.preview).not.toBeNull()
    expect(result.current.preview?.sampleCount).toBe(4)
    expect(result.current.preview?.improvedByM).toBeCloseTo(12 - expectedAccuracyM, 6)
    expect(result.current.preview?.improvedByM).toBeGreaterThan(0)
  })

  it('does not report improvedByM as negative, however much worse the countdown\'s readings are', async () => {
    // The doc comment on `CapturePreview.improvedByM` calls out a countdown
    // that makes the fix *worse* as one of the more useful things this
    // interaction can report. It cannot happen here, and this test is the
    // verification of that, not an assumption: the tap's own reading is
    // always sample one of the buffer `averageReadings` is called on, and
    // inverse-variance weighting is monotonic in the sample count — every
    // reading added can only raise the combined weight and can only lower
    // `best`, never the reverse — so the combined accuracy this preview
    // reports cannot exceed what the tap alone produced. A very good tap
    // followed by readings two orders of magnitude worse is the case most
    // likely to break that if it were going to.
    const { result } = await mountCapture()
    await emit(2)

    await act(async () => {
      result.current.capture()
    })
    await settle()

    await emitFlat(5, 200)
    await settle()

    expect(result.current.preview).not.toBeNull()
    expect(result.current.preview?.improvedByM).toBeGreaterThanOrEqual(0)
    // Not just non-negative but barely moved: five readings two orders of
    // magnitude worse than the tap's own can only nudge the combined
    // accuracy, never meaningfully improve or worsen it.
    expect(result.current.preview?.improvedByM).toBeLessThan(0.05)
  })

  it('reports the spread beside the improvement, and none at all for a single reading', async () => {
    // Spec §9.3: `improvedByM` is structurally incapable of going negative, so
    // a capture that went badly and one that went well produce the same shape
    // of number. The spread is what reports the difference — it genuinely
    // worsens when the readings disagree about where she is standing — so the
    // screen shows the pair, and the preview has to carry both.
    const { result } = await mountCapture()
    await emit(6)

    await act(async () => {
      result.current.capture()
    })
    await settle()

    // One sample has no disagreement to report, which is not the same thing as
    // a disagreement of zero. `averageReadings` returns 0 here; the preview
    // reports absence, the same rule migration 003's
    // `record_spread_matches_sample_count` enforces on the stored record.
    expect(result.current.preview?.sampleCount).toBe(1)
    expect(result.current.preview?.spreadM).toBeNull()

    // A second reading from about 11 m up the paddock: the accuracy the
    // countdown reports improves regardless (see the two tests above), and only
    // the spread can say the two readings disagree about the position.
    await act(async () => {
      jest.advanceTimersByTime(1000)
      source.emit({ ...reading(6, Date.now()), latitude: -37.8137 })
    })
    await settle()

    // Computed against the real `averageReadings` and the exact samples the
    // hook accumulated, rather than a number picked by hand.
    const expectedSpreadM = averageReadings([
      reading(6, START_MS + 1000),
      { ...reading(6, START_MS + 2000), latitude: -37.8137 },
    ]).spreadM
    expect(expectedSpreadM).toBeGreaterThan(1)
    expect(result.current.preview?.sampleCount).toBe(2)
    expect(result.current.preview?.spreadM).toBeCloseTo(expectedSpreadM, 6)
  })
})
