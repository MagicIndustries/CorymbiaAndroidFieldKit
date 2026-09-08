import { openTestDatabase } from '../../db/better-sqlite3'
import { migrate } from '../../db/migrate'
import type { Database } from '../../db/port'
import { createActivity } from '../activities'
import { createProject } from '../projects'
import { registerDevice } from '../devices'
import { listEvents } from '../events'
import { createRecord, softDeleteRecord } from '../records'
import type { Fix } from '../records'
import { attachMedia, listMedia, softDeleteMedia } from '../media'

// The one attribute this test file cares about is that a fix is positioned —
// which fix stamps the events is asserted against `fix` below, not against
// this shape's other fields, so it is kept minimal rather than mirroring
// records.test.ts's full provenance fixtures.
const fix: Fix = {
  quality: 'deliberate',
  latitude: -37.82141,
  longitude: 145.03318,
  accuracyM: 4,
  altitudeM: 62,
  altitudeReference: 'wgs84Ellipsoid',
  datum: 'WGS84',
  sampleCount: 1,
  spreadM: null,
  holdMs: 0,
  verticalAccuracyM: 3,
  accuracyConvention: 'radius68',
  isMocked: false,
  provider: 'gps',
  gpsTime: '2026-02-11T09:14:03+11:00',
}

describe('media', () => {
  let db: Database
  let RECORD: string
  let DEVICE: string

  const photoInput = (
    overrides: Partial<Parameters<typeof attachMedia>[1]> = {},
  ): Parameters<typeof attachMedia>[1] => ({
    mediaId: 'med_default',
    recordId: RECORD,
    kind: 'photo',
    fileName: `${overrides.mediaId ?? 'med_default'}.jpg`,
    byteSize: 204800,
    durationMs: null,
    deviceId: DEVICE,
    fix,
    ...overrides,
  })

  const voiceInput = (
    overrides: Partial<Parameters<typeof attachMedia>[1]> = {},
  ): Parameters<typeof attachMedia>[1] => ({
    mediaId: 'med_default',
    recordId: RECORD,
    kind: 'voice',
    fileName: `${overrides.mediaId ?? 'med_default'}.m4a`,
    byteSize: 51200,
    durationMs: 4000,
    deviceId: DEVICE,
    fix,
    ...overrides,
  })

  beforeEach(async () => {
    db = await openTestDatabase()
    await migrate(db)
    DEVICE = (
      await registerDevice(db, {
        installId: 'install-abc',
        label: 'field-s24',
        manufacturer: 'samsung',
        brand: 'samsung',
        modelName: 'Galaxy S24',
        modelId: 'SM-S938B',
        deviceType: 'phone',
        osName: 'Android',
        osVersion: '16',
        isPhysical: true,
        appVersion: '1.0.0',
        appBuild: '1',
      })
    ).id
    const project = await createProject(db, { name: 'Yarra Flats' })
    const activityId = (
      await createActivity(db, { projectId: project.id, kind: 'survey', name: 'Survey 3' })
    ).id
    RECORD = (await createRecord(db, { activityId, kind: 'pin', fix, deviceId: DEVICE })).id
  })

  afterEach(async () => {
    await db.close()
  })

  describe('attachMedia', () => {
    it('attaches a photo and gives it the first position', async () => {
      const attachment = await attachMedia(db, photoInput({ mediaId: 'med_one' }))
      expect(attachment.ordinal).toBe(1)
    })

    it('gives the next attachment the next position', async () => {
      await attachMedia(db, photoInput({ mediaId: 'med_one' }))
      const second = await attachMedia(db, photoInput({ mediaId: 'med_two' }))
      expect(second.ordinal).toBe(2)
    })

    it('reuses the position of a removed attachment rather than leaving a hole', async () => {
      await attachMedia(db, photoInput({ mediaId: 'med_one' }))
      await attachMedia(db, photoInput({ mediaId: 'med_two' }))
      await softDeleteMedia(db, 'med_two', DEVICE, fix)
      const third = await attachMedia(db, photoInput({ mediaId: 'med_three' }))
      expect(third.ordinal).toBe(2)
    })

    it('logs a media_added event', async () => {
      await attachMedia(db, photoInput({ mediaId: 'med_one' }))
      const events = await listEvents(db, RECORD)
      expect(events.map((e) => e.action)).toContain('media_added')
    })

    it('stamps the event with the fix it was given', async () => {
      // Every event carries where it happened (spec §8.1). A photo taken 40 m
      // from the pin is a different claim from one taken at it.
      await attachMedia(db, photoInput({ mediaId: 'med_one' }))
      const added = (await listEvents(db, RECORD)).find((e) => e.action === 'media_added')
      expect(added?.latitude).toBeCloseTo(fix.latitude, 6)
    })

    it('refuses to attach to a deleted record', async () => {
      await softDeleteRecord(db, RECORD, DEVICE, fix)
      await expect(attachMedia(db, photoInput({ mediaId: 'med_one' }))).rejects.toThrow(/deleted/i)
    })

    it('writes nothing at all when the row is refused', async () => {
      // The transaction must not leave an event behind for an attachment that
      // does not exist — the log would then claim media the record never had.
      await attachMedia(db, photoInput({ mediaId: 'med_one', fileName: 'med_one.jpg' }))
      const before = (await listEvents(db, RECORD)).length
      await expect(
        attachMedia(db, photoInput({ mediaId: 'med_two', fileName: 'med_one.jpg' })),
      ).rejects.toThrow()
      expect((await listEvents(db, RECORD)).length).toBe(before)
      expect(await listMedia(db, RECORD)).toHaveLength(1)
    })
  })

  describe('listMedia', () => {
    it('returns attachments in display order', async () => {
      await attachMedia(db, photoInput({ mediaId: 'med_one' }))
      await attachMedia(db, voiceInput({ mediaId: 'med_two' }))
      expect((await listMedia(db, RECORD)).map((m) => m.id)).toEqual(['med_one', 'med_two'])
    })

    it('leaves out what has been removed', async () => {
      await attachMedia(db, photoInput({ mediaId: 'med_one' }))
      await softDeleteMedia(db, 'med_one', DEVICE, fix)
      expect(await listMedia(db, RECORD)).toHaveLength(0)
    })

    it('returns a voice note with its duration and a photo without one', async () => {
      await attachMedia(db, photoInput({ mediaId: 'med_one' }))
      await attachMedia(db, voiceInput({ mediaId: 'med_two', durationMs: 8200 }))
      const [photo, voice] = await listMedia(db, RECORD)
      expect(photo?.durationMs).toBeNull()
      expect(voice?.durationMs).toBe(8200)
    })
  })

  describe('softDeleteMedia', () => {
    it('flags the row and leaves it in the table', async () => {
      // The file is still on disk until a purge, and the row is what the purge
      // finds it by.
      await attachMedia(db, photoInput({ mediaId: 'med_one' }))
      await softDeleteMedia(db, 'med_one', DEVICE, fix)
      const row = await db.first<{ deleted_at: string | null }>(
        'SELECT deleted_at FROM media WHERE id = ?',
        ['med_one'],
      )
      expect(row).toBeDefined()
      expect(row?.deleted_at).not.toBeNull()
    })

    it('logs the removal against the record', async () => {
      // There is no 'media_removed' action, and adding one would mean rebuilding
      // the event table's CHECK — which its own append-only triggers forbid. An
      // `edited` event naming what was removed is honest and needs no migration.
      await attachMedia(db, photoInput({ mediaId: 'med_one' }))
      await softDeleteMedia(db, 'med_one', DEVICE, fix)
      const events = await listEvents(db, RECORD)
      const removal = events.filter((e) => e.action === 'edited').at(-1)
      // The brief's test names this field `message`; `appendEvent`'s actual
      // parameter — and the column `listEvents` reads back — is `detail`.
      expect(removal?.detail).toMatch(/removed/i)
    })

    it('is refused for an attachment that is already gone', async () => {
      await attachMedia(db, photoInput({ mediaId: 'med_one' }))
      await softDeleteMedia(db, 'med_one', DEVICE, fix)
      await expect(softDeleteMedia(db, 'med_one', DEVICE, fix)).rejects.toThrow(/already/i)
    })
  })

  it('holds a soft-deleted attachment’s filename so it can never be reused', async () => {
    // idx_media_file_name is unique across every row, deleted included — the
    // removed file is still on disk under that name. A repository that
    // allocated ordinals without regard to the file-name index would still
    // pass every test above; this one pins the schema-level guarantee that
    // attachMedia must not attempt to defeat by, say, reusing a soft-deleted
    // row's file name for a new attachment.
    await attachMedia(db, photoInput({ mediaId: 'med_one', fileName: 'shared.jpg' }))
    await softDeleteMedia(db, 'med_one', DEVICE, fix)
    await expect(
      attachMedia(db, photoInput({ mediaId: 'med_two', fileName: 'shared.jpg' })),
    ).rejects.toThrow()
  })
})
