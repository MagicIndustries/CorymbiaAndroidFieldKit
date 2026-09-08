import React from 'react'
import { act, render, renderHook } from '@testing-library/react-native'
import { ThemeProvider } from '@corymbia/ui'
import { createFakeLocationSource, type Reading } from '@corymbia/geo'
import type { Attachment, FieldRecord, Fix } from '@corymbia/data'

/**
 * The one test that fails if the ambient cache ever has two instances again
 * (Plan 4, Task 10b).
 *
 * **What went wrong, and what this is here to stop happening twice.** Task 10
 * shipped `useAttachMedia` reading a module-level ambient cache that *nothing
 * called `record()` on*, while `diagnostics.tsx` fed a private cache of its
 * own and `capture.tsx` fed nothing at all. Every `media_added` event would
 * have been stamped `{ quality: 'none' }`: a photo pipeline that passes its
 * own unit tests, attaches its files, writes its rows, and silently records no
 * position on any of them. That is the failure that looks like success, and no
 * test in either half could see it — `useAttachMedia.test.ts` mocks the cache,
 * and the screen tests mock the attach.
 *
 * So this file mocks NEITHER. It drives the whole path a field ecologist
 * actually walks: a screen watches the GPS, a reading arrives, and a photo
 * attached afterwards carries **that** position onto its event. Feeding one
 * cache and reading another passes every other test in this repo and fails
 * here, which is the entire point.
 *
 * WHAT IS AND IS NOT MOCKED.
 *
 * Not mocked: `src/geo/ambient.ts` — the shared cache, the object under test —
 * nor the real `createAmbientCache`, `buildAmbientFix`, `useAttachMedia`, or
 * either screen's own wiring to a `LocationSource`.
 *
 * Mocked: `createExpoLocationSource`, replaced by `createFakeLocationSource`,
 * whose `emit` delivers a reading on demand; `@corymbia/data`'s repository
 * functions, including the `attachMedia` whose payload every assertion below
 * reads; `src/media/store`, which is `expo-file-system`; and
 * `src/db/provider`, so both screens get a database handle and a device
 * without a real SQLite connection.
 *
 * **The latitudes are per-test and deliberately different.** The cache is a
 * module singleton and therefore survives between tests in this file, so
 * asserting merely `quality === 'ambient'` would let the second screen coast
 * on the first screen's reading. Each test asserts the coordinates ITS OWN
 * screen emitted, which a private cache in that screen cannot satisfy.
 */

// ---------------------------------------------------------------------------
// Module mocks. As elsewhere in this directory, every factory reaches its
// fixtures through a lazy arrow over a `mock`-prefixed identifier:
// `jest.mock` is hoisted above the `const` declarations, so a factory that
// touched a fixture at definition time would run before it exists.
// ---------------------------------------------------------------------------

let mockSource: ReturnType<typeof createFakeLocationSource>

jest.mock('@corymbia/geo', () => {
  const actual = jest.requireActual<typeof import('@corymbia/geo')>('@corymbia/geo')
  return {
    ...actual,
    // The one thing in this package that talks to a device. `createAmbientCache`
    // — the thing this file is actually about — is the real implementation.
    createExpoLocationSource: () => mockSource,
  }
})

const mockAttachMedia = jest.fn<
  ReturnType<typeof import('@corymbia/data').attachMedia>,
  Parameters<typeof import('@corymbia/data').attachMedia>
>()

const mockRepo = {
  createRecord: jest.fn(),
  refineRecordFix: jest.fn(),
  renameRecord: jest.fn(),
  listProjects: jest.fn(),
  listActivities: jest.fn(),
  createProject: jest.fn(),
  createActivity: jest.fn(),
  listRecords: jest.fn(),
}

jest.mock('@corymbia/data', () => {
  const actual = jest.requireActual<typeof import('@corymbia/data')>('@corymbia/data')
  return {
    ...actual,
    attachMedia: (...args: Parameters<typeof import('@corymbia/data').attachMedia>) =>
      mockAttachMedia(...args),
    createRecord: (...args: unknown[]) => mockRepo.createRecord(...args),
    refineRecordFix: (...args: unknown[]) => mockRepo.refineRecordFix(...args),
    renameRecord: (...args: unknown[]) => mockRepo.renameRecord(...args),
    listProjects: (...args: unknown[]) => mockRepo.listProjects(...args),
    listActivities: (...args: unknown[]) => mockRepo.listActivities(...args),
    createProject: (...args: unknown[]) => mockRepo.createProject(...args),
    createActivity: (...args: unknown[]) => mockRepo.createActivity(...args),
    listRecords: (...args: unknown[]) => mockRepo.listRecords(...args),
  }
})

const mockSave = jest.fn<
  ReturnType<import('@corymbia/media').MediaStore['save']>,
  Parameters<import('@corymbia/media').MediaStore['save']>
>()

jest.mock('../../src/media/store', () => ({
  mediaStore: {
    save: (...args: Parameters<import('@corymbia/media').MediaStore['save']>) => mockSave(...args),
    remove: () => Promise.reject(new Error('not used by this test')),
    exists: () => Promise.reject(new Error('not used by this test')),
    uriFor: () => {
      throw new Error('not used by this test')
    },
  },
}))

const mockDevice = {
  id: 'device-under-test',
  installId: 'install-1',
  label: 'test-handset',
  manufacturer: 'Test',
  brand: 'Test',
  modelName: 'Model',
  modelId: 'model-1',
  deviceType: 'phone' as const,
  osName: 'Android',
  osVersion: '15',
  isPhysical: true,
  appVersion: '1.0.0',
  appBuild: '1',
  firstSeenAt: '2026-09-07T00:00:00.000Z',
  lastSeenAt: '2026-09-07T00:00:00.000Z',
}

const mockSettings = {
  theme: 'dark' as const,
  handedness: 'right' as const,
  capturePrimary: 'saveNow' as const,
  density: 'comfortable' as const,
}

const mockUseSettings = { settings: mockSettings, updateSetting: () => Promise.resolve() }

// Identity-stable, the way the real provider's context value is: a fresh `db`
// per render re-runs the on-arrival effects of both screens forever.
const mockDb = { handle: 'not a real database' }
const mockStatus = { state: 'ready' as const, error: null, applied: ['001_initial'] }

jest.mock('../../src/db/provider', () => ({
  useDatabase: () => mockDb,
  useDatabaseStatus: () => mockStatus,
  useDevice: () => mockDevice,
  useSettings: () => mockUseSettings,
}))

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() }

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
}))

// Imported after every mock above so they pick them up.
import CaptureScreen from '../capture'
import Diagnostics from '../diagnostics'
import { useAttachMedia } from '../../src/media/useAttachMedia'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A reading with everything an ambient fix needs to survive the trip:
 * a usable accuracy, and an explicit `isMocked: false`. `undefined` there is
 * the platform declining to say, which `useAttachMedia` deliberately
 * downgrades to `{ quality: 'none' }` — correct, and not what this file is
 * about.
 */
function reading(latitude: number, longitude: number, timestampMs: number): Reading {
  return {
    latitude,
    longitude,
    accuracyM: 6,
    altitudeM: 31,
    verticalAccuracyM: 4,
    isMocked: false,
    timestampMs,
  }
}

function attachment(): Attachment {
  return {
    id: 'med_fixture',
    recordId: 'rec_a',
    kind: 'photo',
    fileName: 'med_fixture.jpg',
    byteSize: 1234,
    durationMs: null,
    ordinal: 1,
    capturedAt: '2026-09-08T01:00:00.000Z',
    deletedAt: null,
  }
}

function storedRecord(fix: Fix): FieldRecord {
  return {
    id: 'record-1',
    activityId: null,
    contextActivityId: null,
    kind: 'pin',
    captureNumber: 1,
    sequence: null,
    filedAt: null,
    title: null,
    description: null,
    fix,
    capturedAt: '2026-09-08T01:00:00.000Z',
    deviceId: mockDevice.id,
    attributes: {},
  }
}

// The clock is deliberately REAL in this file, where every other screen test
// in this directory fakes it. Nothing here needs a fake one: no test taps the
// capture control, so no countdown, ticker or animation is ever started, and
// the only time that matters is the thirty seconds between a reading and the
// attach that stamps its age — which real timers give for free.
beforeEach(() => {
  mockSource = createFakeLocationSource({ permission: 'granted', readings: [] })

  mockAttachMedia.mockReset()
  mockAttachMedia.mockResolvedValue(attachment())
  mockSave.mockReset()
  mockSave.mockResolvedValue({ uri: 'file:///media/med_fixture.jpg', byteSize: 1234 })

  for (const fn of Object.values(mockRepo)) fn.mockReset()
  mockRepo.createRecord.mockImplementation((_db: unknown, input: { fix: Fix }) =>
    Promise.resolve(storedRecord(input.fix)),
  )
  mockRepo.refineRecordFix.mockImplementation((_db: unknown, input: { fix: Fix }) =>
    Promise.resolve({ record: storedRecord(input.fix), applied: true }),
  )
  mockRepo.listProjects.mockResolvedValue([{ id: 'project-1', name: 'Diagnostics' }])
  mockRepo.listActivities.mockResolvedValue([{ id: 'activity-1', name: 'Diagnostics run' }])
  mockRepo.listRecords.mockResolvedValue([])
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

/** Attaches a photo through the real hook and returns the fix it stamped. */
async function attachAPhotoAndReadItsFix(): Promise<Fix | undefined> {
  const { result } = await renderHook(() => useAttachMedia())
  await act(async () => {
    await result.current.attachPhoto({ recordId: 'rec_a', sourceUri: 'file:///tmp/shot.jpg' })
  })
  return mockAttachMedia.mock.calls[0]?.[1].fix
}

/** The voice counterpart to `attachAPhotoAndReadItsFix`, above. */
async function attachAVoiceNoteAndReadItsFix(): Promise<Fix | undefined> {
  const { result } = await renderHook(() => useAttachMedia())
  await act(async () => {
    await result.current.attachVoice({
      recordId: 'rec_a',
      sourceUri: 'file:///tmp/n.m4a',
      durationMs: 4200,
    })
  })
  return mockAttachMedia.mock.calls[0]?.[1].fix
}

/**
 * The whole assertion, in one place because both tests make exactly it: the
 * event carries an ambient fix, at the coordinates the screen under test
 * emitted, aged from that reading's own timestamp.
 *
 * The coordinates are the load-bearing part. A hook that stamped a hardcoded
 * ambient fix — or read a cache some *other* screen had filled — passes
 * `quality === 'ambient'` and fails here.
 */
function expectAmbientAt(fix: Fix | undefined, latitude: number, longitude: number) {
  expect(fix?.quality).toBe('ambient')
  expect(fix).toMatchObject({ latitude, longitude, accuracyM: 6, isMocked: false })
  // The age is what makes this an ambient fix rather than a deliberate one:
  // the position is real, it is old, and the event says how old. Asserted as
  // a range rather than exactly 30, because the clock in this file is real —
  // the reading is timestamped thirty seconds back and the attach happens a
  // few milliseconds later.
  const ageSeconds = fix !== undefined && fix.quality === 'ambient' ? fix.ageSeconds : null
  expect(ageSeconds).toBeGreaterThanOrEqual(30)
  expect(ageSeconds).toBeLessThan(35)
}

/** A reading thirty seconds old, which is what makes the fix an ambient one. */
function thirtySecondsAgo(): number {
  return Date.now() - 30_000
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/**
 * A cold start: nothing has watched a reading yet, only `capture.tsx`'s
 * mount effect calling `ambientCache.refresh()` (Plan 4, Task 10b review).
 *
 * Deliberately its own describe block, placed first in the file. `refresh()`
 * reaches `src/geo/ambient.ts`'s `platformSource` — a module singleton for
 * the life of this test FILE, lazily built from `createExpoLocationSource()`
 * (mocked above) the first time anything calls `refresh()`. Once built it is
 * never rebuilt, so a test after this one in the file would find it already
 * pointing at THIS test's `mockSource` rather than its own. Running first is
 * what lets this test build it from the `lastKnown` it scripts below.
 */
describe('a cold start, before any reading has arrived from a watch', () => {
  it('stamps a photo with the last-known position, without waiting for a watched reading', async () => {
    mockSource = createFakeLocationSource({
      permission: 'granted',
      readings: [],
      lastKnown: reading(-37.9, 145.05, thirtySecondsAgo()),
    })

    await render(
      <ThemeProvider initial="dark">
        <CaptureScreen />
      </ThemeProvider>,
    )
    await settle()

    // No `mockSource.emit(...)` anywhere above — the only thing that can have
    // put a position in the cache is the mount effect's `refresh()`.
    expectAmbientAt(await attachAPhotoAndReadItsFix(), -37.9, 145.05)
  })
})

describe('the ambient cache, from the screen that fills it to the event that carries it', () => {
  it('stamps a photo with the position the capture screen was watching', async () => {
    // The whole feature, end to end. `capture.tsx` wraps its location source
    // in `feedingAmbientCache`; unwrap it and this reading reaches
    // `useCapture` and nothing else, the hook finds an empty cache, and the
    // event below is stamped `{ quality: 'none' }` instead.
    await render(
      <ThemeProvider initial="dark">
        <CaptureScreen />
      </ThemeProvider>,
    )
    await settle()
    await act(async () => {
      mockSource.emit(reading(-37.8136, 144.9631, thirtySecondsAgo()))
    })

    expectAmbientAt(await attachAPhotoAndReadItsFix(), -37.8136, 144.9631)
  })

  it('stamps a photo with the position the diagnostics screen was watching', async () => {
    // The second producer, and the reason its coordinates differ from the
    // test above: `diagnostics.tsx` used to build a private cache in a
    // `useRef`. With that back, the shared cache still holds the capture
    // screen's reading (a module singleton outlives a test), so this would
    // report -37.8136 and fail on latitude rather than on quality.
    await render(
      <ThemeProvider initial="dark">
        <Diagnostics />
      </ThemeProvider>,
    )
    await settle()
    await act(async () => {
      mockSource.emit(reading(-38.1042, 145.2117, thirtySecondsAgo()))
    })

    expectAmbientAt(await attachAPhotoAndReadItsFix(), -38.1042, 145.2117)
  })

  it('stamps a voice note with an ambient position too, not just a photo', async () => {
    // `attachPhoto` and `attachVoice` share the same `ambientFix()` mapping
    // in `useAttachMedia.ts`, so the risk of this ever diverging is low — but
    // until this test, nothing end-to-end exercised the voice half at all.
    // `voice.tsx` has no producer of its own (unlike `capture.tsx`), so this
    // reuses the capture screen to fill the cache and reads back what
    // `attachVoice` actually stamped.
    await render(
      <ThemeProvider initial="dark">
        <CaptureScreen />
      </ThemeProvider>,
    )
    await settle()
    await act(async () => {
      mockSource.emit(reading(-37.5622, 143.8503, thirtySecondsAgo()))
    })

    expectAmbientAt(await attachAVoiceNoteAndReadItsFix(), -37.5622, 143.8503)
  })
})
