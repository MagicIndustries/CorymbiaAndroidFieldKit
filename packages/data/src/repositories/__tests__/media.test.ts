import { openTestDatabase } from '../../db/better-sqlite3'
import { migrate } from '../../db/migrate'
import type { Database, SqlValue } from '../../db/port'
import { createActivity } from '../activities'
import { createProject } from '../projects'
import { registerDevice } from '../devices'
import { listEvents } from '../events'
import { createRecord, softDeleteRecord } from '../records'
import type { Fix } from '../records'
import { AttachmentPersistError, attachMedia, listMedia, newMediaId, softDeleteMedia } from '../media'

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

// `.rejects.toThrow()` with no matcher passes on a column typo, a renamed
// table or a dropped constraint alike — migration-005.test.ts's doc comment
// spells this out and pins the real form of a SQLite UNIQUE error, which
// never names an index: `UNIQUE constraint failed: media.file_name`.
const UNIQUE_FILE_NAME = /UNIQUE constraint failed: media\.file_name/

/**
 * The rejection a call produced, as a value to make assertions about.
 *
 * `.rejects.toThrow(AttachmentPersistError)` would do for the two positive
 * cases below, but not for the negative one: the whole property being pinned
 * is that a PRE-commit refusal is *not* that class, and `.rejects` has no
 * form that asserts the class of a rejection it must still require to
 * happen. Capturing the value is the one shape that says both things —
 * "this rejected" and "with something that is not an AttachmentPersistError"
 * — without a cast or a non-null assertion.
 */
async function rejectionOf(call: Promise<unknown>): Promise<unknown> {
  const outcome: { rejected: false } | { rejected: true; error: unknown } = await call.then(
    (): { rejected: false } => ({ rejected: false }),
    (error: unknown): { rejected: true; error: unknown } => ({ rejected: true, error }),
  )
  if (!outcome.rejected) {
    throw new Error('Expected the call to reject, but it resolved.')
  }
  return outcome.error
}

/**
 * `base`, with `attachMedia`'s post-commit confirming re-read — and only that
 * read — made to fail.
 *
 * `attachMedia` runs three `first` queries: the record lookup and
 * `nextOrdinal`'s `MAX(ordinal)`, both inside the transaction, and then the
 * `SELECT ... FROM media WHERE id = ?` that runs after it has committed. Only
 * the last one carries `captured_at` in its projection (see `SELECT` in
 * `media.ts`), so matching on that column is what picks out the post-commit
 * read without also catching either in-transaction one — or
 * `softDeleteMedia`'s own `... FROM media WHERE id = ?`, whose projection
 * has no `captured_at` either.
 *
 * Everything else delegates to the real database, so the transaction really
 * commits: the row and its event are genuinely on disk when the failure is
 * raised, which is the whole state these tests exist to describe.
 */
function withFailingReadBack(base: Database, outcome: 'throws' | 'returns nothing'): Database {
  const isConfirmingReadBack = (sql: string): boolean =>
    sql.includes('FROM media') && sql.includes('WHERE id = ?') && sql.includes('captured_at')

  return {
    execute: (sql: string, params?: SqlValue[]) => base.execute(sql, params),
    all: <T,>(sql: string, params?: SqlValue[]) => base.all<T>(sql, params),
    first: <T,>(sql: string, params?: SqlValue[]): Promise<T | null> => {
      if (isConfirmingReadBack(sql)) {
        return outcome === 'throws'
          ? Promise.reject(new Error('disk I/O error'))
          : Promise.resolve(null)
      }
      return base.first<T>(sql, params)
    },
    transaction: <T,>(fn: () => Promise<T>) => base.transaction(fn),
    close: () => base.close(),
  }
}

describe('media', () => {
  let db: Database
  let RECORD: string
  let DEVICE: string
  let ACTIVITY: string

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
    ACTIVITY = (
      await createActivity(db, { projectId: project.id, kind: 'survey', name: 'Survey 3' })
    ).id
    RECORD = (await createRecord(db, { activityId: ACTIVITY, kind: 'pin', fix, deviceId: DEVICE })).id
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

    it('reuses the highest live position once the attachment holding it is removed', async () => {
      // MAX(ordinal) + 1 over live rows only reuses a position when the
      // removed attachment was the LAST one — delete the middle of three and
      // the result is 1, 3, 4: a permanent hole. What is guaranteed is
      // narrower than "no hole ever", which is why this fixture keeps to the
      // one case where the claim is actually true.
      await attachMedia(db, photoInput({ mediaId: 'med_one' }))
      await attachMedia(db, photoInput({ mediaId: 'med_two' }))
      await softDeleteMedia(db, 'med_two', DEVICE, fix)
      const third = await attachMedia(db, photoInput({ mediaId: 'med_three' }))
      expect(third.ordinal).toBe(2)
    })

    it('gives two simultaneous attaches on the same record distinct positions', async () => {
      // The house pattern from records.test.ts's "gives two simultaneous
      // Inbox captures distinct capture numbers": two un-awaited attachMedia
      // calls fired through Promise.all. nextOrdinal's read-then-write
      // (MAX(ordinal) + 1, then INSERT) is exactly the shape two interleaved
      // transactions could both resolve to 1 if the ordinal were read outside
      // attachMedia's own transaction — nothing here serialises that read
      // against a concurrent write unless the allocation stays inside it.
      const [first, second] = await Promise.all([
        attachMedia(db, photoInput({ mediaId: 'med_one' })),
        attachMedia(db, photoInput({ mediaId: 'med_two' })),
      ])
      expect([first.ordinal, second.ordinal].sort((a, b) => a - b)).toEqual([1, 2])
    })

    it('starts a second record’s ordinals at 1, independently of the first', async () => {
      // The fixture above creates exactly one record, so a `nextOrdinal` whose
      // WHERE clause dropped `record_id = ? AND` would still pass every test
      // there — ordinals would simply be global, and the first photo on a
      // second record would silently land on ordinal 2. No unique index
      // catches that: idx_media_record_ordinal is scoped to (record_id,
      // ordinal), so a global-ordinal bug is invisible to the schema too.
      await attachMedia(db, photoInput({ mediaId: 'med_one' }))
      const other = (
        await createRecord(db, { activityId: ACTIVITY, kind: 'pin', fix, deviceId: DEVICE })
      ).id
      const first = await attachMedia(db, photoInput({ mediaId: 'med_two', recordId: other }))
      expect(first.ordinal).toBe(1)
    })

    it('logs a media_added event naming the device, fix and attachment, exactly once', async () => {
      // `toContain('media_added')` alone passes if the event carried the
      // wrong device, no detail, or were appended twice — none of which this
      // repository's contract allows.
      await attachMedia(db, photoInput({ mediaId: 'med_one' }))
      const events = await listEvents(db, RECORD)
      expect(events.filter((e) => e.action === 'media_added')).toHaveLength(1)
      const added = events.find((e) => e.action === 'media_added')
      expect(added?.deviceId).toBe(DEVICE)
      expect(added?.detail).toBe('photo med_one.jpg')
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

    it('refuses to attach to a record that does not exist', async () => {
      // The house style from records.test.ts: the message names the id, not
      // just "not found" — /rec_missing does not exist/.
      await expect(
        attachMedia(db, photoInput({ mediaId: 'med_one', recordId: 'rec_missing' })),
      ).rejects.toThrow(/rec_missing does not exist/)
    })

    it('writes nothing at all when the row is refused', async () => {
      // The transaction must not leave an event behind for an attachment that
      // does not exist — the log would then claim media the record never had.
      await attachMedia(db, photoInput({ mediaId: 'med_one', fileName: 'med_one.jpg' }))
      const before = (await listEvents(db, RECORD)).length
      await expect(
        attachMedia(db, photoInput({ mediaId: 'med_two', fileName: 'med_one.jpg' })),
      ).rejects.toThrow(UNIQUE_FILE_NAME)
      expect((await listEvents(db, RECORD)).length).toBe(before)
      expect(await listMedia(db, RECORD)).toHaveLength(1)
    })

    /**
     * `AttachmentPersistError` is the only thing that carries, across the
     * package boundary, the distinction the whole file-then-row ordering
     * rests on: a failure from BEFORE the commit means the caller should
     * delete the file it wrote, and a failure from AFTER it means the caller
     * must not, because the row already exists and would be left naming
     * bytes that no longer do.
     *
     * `useAttachMedia.ts`'s rollback is that caller, and it tells the two
     * apart with `instanceof`. Nothing here used to assert the class at all:
     * replacing both `throw new AttachmentPersistError(...)` in `media.ts`
     * with `throw new Error(...)` left every suite in this repository green,
     * while turning the consumer's check into a no-match — the catch would
     * delete the file behind a committed row. The three cases below are what
     * make that mutation fail, and the third is the one that actually pins
     * the property rather than the two happy-path classes: a pre-commit
     * refusal must NOT be this class, which today holds only because of
     * where the `try` block happens to sit.
     */
    it('reports a committed attachment whose confirming re-read throws as an AttachmentPersistError', async () => {
      const error = await rejectionOf(
        attachMedia(withFailingReadBack(db, 'throws'), photoInput({ mediaId: 'med_one' })),
      )

      expect(error).toBeInstanceOf(AttachmentPersistError)
      // And the row really is committed — which is what makes deleting the
      // file behind it the wrong response, and this class the right one.
      expect((await listMedia(db, RECORD)).map((m) => m.id)).toEqual(['med_one'])
    })

    it('reports a committed attachment whose confirming re-read comes back empty as an AttachmentPersistError', async () => {
      const error = await rejectionOf(
        attachMedia(withFailingReadBack(db, 'returns nothing'), photoInput({ mediaId: 'med_one' })),
      )

      expect(error).toBeInstanceOf(AttachmentPersistError)
      expect((await listMedia(db, RECORD)).map((m) => m.id)).toEqual(['med_one'])
    })

    it('does not report a refusal from before the commit as an AttachmentPersistError', async () => {
      // The negative half, and the only one that pins the distinction as a
      // property rather than as two hard-coded classes: this refusal happens
      // inside the transaction, nothing is committed, and the caller MUST
      // delete the file it already wrote. A build that raised
      // `AttachmentPersistError` here — the plausible mistake of "this is
      // attachMedia's error class, so this is what attachMedia throws" —
      // would leave an orphaned file behind on every missing-record refusal,
      // and every other test in this file would still pass.
      const error = await rejectionOf(
        attachMedia(db, photoInput({ mediaId: 'med_one', recordId: 'rec_missing' })),
      )

      expect(error).toBeInstanceOf(Error)
      expect(error).not.toBeInstanceOf(AttachmentPersistError)
      expect(await listMedia(db, RECORD)).toHaveLength(0)
    })
  })

  describe('listMedia', () => {
    it('returns attachments in display order', async () => {
      // Ordinals 1 and 2 inserted in that order would leave rowid order and
      // ordinal order coinciding, which passes whether or not `ORDER BY
      // ordinal ASC` is even there. A third attachment plus a direct SQL
      // swap of two ordinals (nothing in this repository writes an UPDATE
      // ... SET ordinal, so this reaches for raw SQL the way records.test.ts
      // does to build state the API can't) makes insertion order and ordinal
      // order genuinely disagree, so the ORDER BY is what the assertion is
      // actually about.
      await attachMedia(db, photoInput({ mediaId: 'med_one' }))
      await attachMedia(db, voiceInput({ mediaId: 'med_two' }))
      await attachMedia(db, photoInput({ mediaId: 'med_three' }))
      await db.execute('UPDATE media SET ordinal = 99 WHERE id = ?', ['med_three'])
      await db.execute('UPDATE media SET ordinal = 3 WHERE id = ?', ['med_two'])
      await db.execute('UPDATE media SET ordinal = 2 WHERE id = ?', ['med_three'])
      expect((await listMedia(db, RECORD)).map((m) => m.id)).toEqual([
        'med_one',
        'med_three',
        'med_two',
      ])
    })

    it('leaves out what has been removed', async () => {
      await attachMedia(db, photoInput({ mediaId: 'med_one' }))
      await softDeleteMedia(db, 'med_one', DEVICE, fix)
      expect(await listMedia(db, RECORD)).toHaveLength(0)
    })

    it('returns only the requested record’s attachments, not another record’s', async () => {
      // The one-record fixture leaves listMedia's `record_id = ?` filter free:
      // deleting it from the WHERE clause would still pass every other test
      // here, because there is only ever one record's worth of media to
      // return. A second record is what makes the filter's absence visible —
      // every attachment would otherwise show up on both.
      await attachMedia(db, photoInput({ mediaId: 'med_one' }))
      const other = (
        await createRecord(db, { activityId: ACTIVITY, kind: 'pin', fix, deviceId: DEVICE })
      ).id
      await attachMedia(db, photoInput({ mediaId: 'med_two', recordId: other }))

      expect((await listMedia(db, RECORD)).map((m) => m.id)).toEqual(['med_one'])
      expect((await listMedia(db, other)).map((m) => m.id)).toEqual(['med_two'])
    })

    it('returns a voice note with its duration and a photo without one', async () => {
      await attachMedia(db, photoInput({ mediaId: 'med_one' }))
      await attachMedia(db, voiceInput({ mediaId: 'med_two', durationMs: 8200 }))
      const [photo, voice] = await listMedia(db, RECORD)
      expect(photo?.durationMs).toBeNull()
      expect(voice?.durationMs).toBe(8200)
    })

    it('maps every column of the row onto the attachment it returns', async () => {
      // The test above only ever inspects durationMs. A transposed field in
      // toAttachment — kind and fileName swapped, say, or byteSize read from
      // the wrong column — would be invisible to anything here otherwise.
      const attached = await attachMedia(
        db,
        voiceInput({ mediaId: 'med_one', fileName: 'med_one.m4a', byteSize: 51200 }),
      )
      const [only] = await listMedia(db, RECORD)
      expect(only).toEqual(attached)
      expect(only).toMatchObject({
        id: 'med_one',
        recordId: RECORD,
        kind: 'voice',
        fileName: 'med_one.m4a',
        byteSize: 51200,
      })
    })
  })

  describe('softDeleteMedia', () => {
    it('flags the row and leaves it in the table', async () => {
      // The file is still on disk — permanently, since the purge that would
      // clear it is not built — and the row is the only thing that says which
      // attachment those bytes were.
      await attachMedia(db, photoInput({ mediaId: 'med_one' }))
      await softDeleteMedia(db, 'med_one', DEVICE, fix)
      const row = await db.first<{ deleted_at: string | null }>(
        'SELECT deleted_at FROM media WHERE id = ?',
        ['med_one'],
      )
      // db.first returns T | null, never undefined, so `toBeDefined()` cannot
      // fail — it (and `not.toBeNull()` on an optional-chained read) both pass
      // just as well for a row entirely absent from the table.
      expect(row).not.toBeNull()
      expect(row?.deleted_at).not.toBeNull()
    })

    it('logs the removal against the record', async () => {
      // There is no 'media_removed' action, and adding one would mean rebuilding
      // the event table's CHECK — which its own append-only triggers forbid. An
      // `edited` event naming what was removed is honest and needs no migration.
      await attachMedia(db, photoInput({ mediaId: 'med_one', fileName: 'med_one.jpg' }))
      await softDeleteMedia(db, 'med_one', DEVICE, fix)
      const events = await listEvents(db, RECORD)
      const removal = events.filter((e) => e.action === 'edited').at(-1)
      // The brief's test names this field `message`; `appendEvent`'s actual
      // parameter — and the column `listEvents` reads back — is `detail`.
      // `detail: 'removed'` alone would pass /removed/i while destroying the
      // one thing that makes an 'edited' event an acceptable substitute for a
      // dedicated media_removed action: naming WHAT was removed.
      expect(removal?.detail).toMatch(/removed/i)
      expect(removal?.detail).toContain('med_one.jpg')
    })

    it('is refused for an attachment that is already gone', async () => {
      await attachMedia(db, photoInput({ mediaId: 'med_one' }))
      await softDeleteMedia(db, 'med_one', DEVICE, fix)
      await expect(softDeleteMedia(db, 'med_one', DEVICE, fix)).rejects.toThrow(/already/i)
    })

    it('is refused for an attachment that does not exist', async () => {
      await expect(softDeleteMedia(db, 'med_missing', DEVICE, fix)).rejects.toThrow(
        /med_missing does not exist/,
      )
    })
  })

  describe('newMediaId', () => {
    it('mints a distinct id on every call, prefixed for the kind of thing it names', async () => {
      const first = newMediaId()
      const second = newMediaId()
      expect(first).not.toBe(second)
      expect(first).toMatch(/^med_/)
      expect(second).toMatch(/^med_/)
    })
  })

  // No 'holds a soft-deleted attachment's filename so it can never be reused'
  // test here. It duplicated migration-005.test.ts's 'refuses a new
  // attachment claiming a soft-deleted attachment's file name' — same
  // scenario, same fixture, same ids — while asserting less (a bare
  // `.rejects.toThrow()` where that test pins the exact UNIQUE constraint).
  // It tested migration 005, not this repository: no line of media.ts
  // controls file names, which arrive from the caller.
})
