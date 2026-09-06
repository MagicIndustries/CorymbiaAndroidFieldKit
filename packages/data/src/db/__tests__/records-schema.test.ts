import { openTestDatabase } from '../better-sqlite3'
import { migrate } from '../migrate'
import type { Database } from '../port'

const NOW = '2026-09-06T09:14:00+10:00'

/**
 * Every negative assertion below names the constraint it expects, because
 * `.rejects.toThrow()` with no matcher passes on a column typo, a renamed table
 * or a dropped constraint alike — it asserts only that something threw. The
 * constraints in migration 003 are named, so SQLite reports them by name
 * ("CHECK constraint failed: record_none_has_no_position") and a test can insist
 * that the rule it is about is the rule that fired.
 *
 * These assertions are only meaningful because `workerIdleMemoryLimit` in
 * jest.config.js keeps each test file in its own process. jest.setup.js proves
 * that per file, in a `beforeAll` that runs before the tests below, so this
 * file cannot pass while silently enforcing nothing.
 */
const CHECK = (name: string): RegExp => new RegExp(`CHECK constraint failed: ${name}`)
const UNIQUE = /UNIQUE constraint failed/
const FOREIGN_KEY = /FOREIGN KEY constraint failed/

async function seedDevice(db: Database): Promise<void> {
  await db.execute(
    `INSERT INTO device (id, install_id, label, device_type, is_physical, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
    ['dev-1', 'install-abc', 'field-s24', 'phone', NOW, NOW],
  )
}

async function seedActivity(db: Database): Promise<void> {
  await db.execute(
    'INSERT INTO project (id, name, client_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ['p1', 'Yarra Flats', 'client-internal', NOW, NOW],
  )
  await db.execute(
    'INSERT INTO activity (id, project_id, kind, name, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['a1', 'p1', 'survey', 'Survey 3', NOW, NOW, NOW],
  )
}

/** A well-formed deliberate fix: every override below is a departure from this. */
async function insertRecord(db: Database, over: Record<string, unknown> = {}): Promise<void> {
  const row = {
    id: 'r1',
    activity_id: 'a1',
    context_activity_id: null,
    kind: 'pin',
    sequence: 1,
    title: null,
    short_label: null,
    description: null,
    latitude: -37.82141,
    longitude: 145.03318,
    accuracy_m: 4,
    altitude_m: 62,
    datum: 'WGS84',
    fix_quality: 'deliberate',
    fix_age_seconds: null,
    fix_sample_count: 7,
    fix_spread_m: 1.2,
    fix_hold_ms: 4200,
    captured_at: NOW,
    gps_time: NOW,
    device_id: 'dev-1',
    vertical_accuracy_m: 3,
    is_mocked: 0,
    location_provider: 'gps',
    accuracy_convention: 'radius68',
    altitude_reference: 'wgs84Ellipsoid',
    attributes: '{}',
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    ...over,
  }
  const columns = Object.keys(row)
  await db.execute(
    `INSERT INTO record (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    Object.values(row) as (string | number | null)[],
  )
}

/**
 * SAVE NOW: one tap, one reading. The capture is real and deliberate — she chose
 * this spot — but nothing was averaged, so there is no spread to state.
 */
const INSTANT: Record<string, unknown> = {
  fix_sample_count: 1,
  fix_spread_m: null,
  fix_hold_ms: 0,
}

/** The ambient class: a cached position, carrying its age and no averaging evidence. */
const AMBIENT: Record<string, unknown> = {
  fix_quality: 'ambient',
  accuracy_m: 38,
  fix_age_seconds: 240,
  fix_sample_count: null,
  fix_spread_m: null,
  fix_hold_ms: null,
}

/** The none class: absent, never guessed — provenance of the absent fix included. */
const NONE: Record<string, unknown> = {
  fix_quality: 'none',
  latitude: null,
  longitude: null,
  accuracy_m: null,
  altitude_m: null,
  datum: null,
  fix_age_seconds: null,
  fix_sample_count: null,
  fix_spread_m: null,
  fix_hold_ms: null,
  vertical_accuracy_m: null,
  accuracy_convention: null,
  altitude_reference: null,
  location_provider: null,
  gps_time: null,
  is_mocked: null,
}

const ambient = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...AMBIENT,
  ...over,
})
const none = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ ...NONE, ...over })
const instant = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...INSTANT,
  ...over,
})

async function insertEvent(db: Database, over: Record<string, unknown> = {}): Promise<void> {
  const row = {
    id: 'e1',
    record_id: 'r1',
    action: 'created',
    device_id: 'dev-1',
    occurred_at: NOW,
    latitude: -37.82141,
    longitude: 145.03318,
    accuracy_m: 4,
    accuracy_convention: 'radius68',
    datum: 'WGS84',
    fix_quality: 'deliberate',
    is_mocked: 0,
    activity_id: 'a1',
    detail: null,
    ...over,
  }
  const columns = Object.keys(row)
  await db.execute(
    `INSERT INTO event (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    Object.values(row) as (string | number | null)[],
  )
}

describe('the record schema', () => {
  let db: Database
  beforeEach(async () => {
    db = await openTestDatabase()
    await migrate(db)
    await seedDevice(db)
    await seedActivity(db)
  })
  afterEach(async () => {
    await db.close()
  })

  describe('the deliberate class — survey-grade, or not deliberate', () => {
    it('accepts a well-formed deliberate fix', async () => {
      await insertRecord(db)
      expect(await db.all('SELECT id FROM record')).toHaveLength(1)
    })

    it('refuses a deliberate fix with no accuracy — the whole point of the class', async () => {
      await expect(insertRecord(db, { accuracy_m: null })).rejects.toThrow(
        CHECK('record_deliberate_is_survey_grade'),
      )
    })

    it('refuses a deliberate fix that claims an age; it was taken just now', async () => {
      await expect(insertRecord(db, { fix_age_seconds: 240 })).rejects.toThrow(
        CHECK('record_deliberate_is_survey_grade'),
      )
    })

    it('refuses a deliberate fix with no latitude', async () => {
      // is_mocked goes with the position, so it goes too; otherwise this would
      // also trip record_mocked_known_when_positioned.
      await expect(insertRecord(db, { latitude: null, is_mocked: null })).rejects.toThrow(
        CHECK('record_deliberate_is_survey_grade'),
      )
    })

    it('refuses a deliberate fix with no longitude', async () => {
      await expect(insertRecord(db, { longitude: null })).rejects.toThrow(
        CHECK('record_deliberate_is_survey_grade'),
      )
    })

    it('refuses a deliberate fix with no datum — a coordinate in no stated frame', async () => {
      await expect(insertRecord(db, { datum: null })).rejects.toThrow(
        CHECK('record_deliberate_is_survey_grade'),
      )
    })

    it('refuses a deliberate fix with no sample count: survey-grade asserted on nothing', async () => {
      await expect(insertRecord(db, { fix_sample_count: null })).rejects.toThrow(
        CHECK('record_deliberate_is_survey_grade'),
      )
    })

    it('refuses a deliberate fix with no hold duration', async () => {
      await expect(insertRecord(db, { fix_hold_ms: null })).rejects.toThrow(
        CHECK('record_deliberate_is_survey_grade'),
      )
    })

    it('refuses a deliberate fix whose accuracy has no stated confidence level', async () => {
      // 'unknown' is legitimate for ambient or imported data; a survey-grade
      // coordinate whose accuracy means nothing in particular is exactly what the
      // spec forbids exporting.
      await expect(insertRecord(db, { accuracy_convention: 'unknown' })).rejects.toThrow(
        CHECK('record_deliberate_is_survey_grade'),
      )
    })
  })

  describe('SHARPEN and SAVE NOW — spread exists when there were readings to disagree', () => {
    it('accepts a held fix: several samples, and the spread between them', async () => {
      await insertRecord(db, { id: 'r1s', fix_sample_count: 7, fix_spread_m: 1.2 })
      const row = await db.first<{ fix_sample_count: number; fix_spread_m: number }>(
        'SELECT fix_sample_count, fix_spread_m FROM record WHERE id = ?',
        ['r1s'],
      )
      expect(row?.fix_sample_count).toBe(7)
      expect(row?.fix_spread_m).toBe(1.2)
    })

    it('accepts an instant fix: one sample, no spread, and a hold of zero', async () => {
      // SAVE NOW is a single tap. Requiring a spread here would force a written 0,
      // asserting perfect agreement between readings that were never compared.
      // A hold of 0 is not a guess: she genuinely did not hold.
      await insertRecord(db, instant({ id: 'r1i' }))
      const row = await db.first<{
        fix_sample_count: number
        fix_spread_m: number | null
        fix_hold_ms: number
      }>('SELECT fix_sample_count, fix_spread_m, fix_hold_ms FROM record WHERE id = ?', ['r1i'])
      expect(row?.fix_sample_count).toBe(1)
      expect(row?.fix_spread_m).toBeNull()
      expect(row?.fix_hold_ms).toBe(0)
    })

    it('refuses a one-sample fix that nonetheless claims a spread', async () => {
      // Spread between one reading is not a small number; it is undefined.
      await expect(insertRecord(db, instant({ id: 'r1j', fix_spread_m: 0 }))).rejects.toThrow(
        CHECK('record_spread_matches_sample_count'),
      )
    })

    it('refuses a multi-sample fix with no spread — evidence with nothing behind it', async () => {
      await expect(
        insertRecord(db, { id: 'r1k', fix_sample_count: 7, fix_spread_m: null }),
      ).rejects.toThrow(CHECK('record_spread_matches_sample_count'))
    })
  })

  describe('the ambient class — a cached fix, wearing no borrowed evidence', () => {
    it('accepts an ambient fix carrying its age', async () => {
      await insertRecord(db, ambient({ id: 'r2' }))
      expect(await db.all('SELECT id FROM record')).toHaveLength(1)
    })

    it("accepts an ambient fix whose accuracy convention is 'unknown'", async () => {
      await insertRecord(db, ambient({ id: 'r2b', accuracy_convention: 'unknown' }))
      expect(await db.all('SELECT id FROM record')).toHaveLength(1)
    })

    it('refuses an ambient fix with no accuracy', async () => {
      await expect(
        insertRecord(db, ambient({ id: 'r3', accuracy_m: null, accuracy_convention: null })),
      ).rejects.toThrow(CHECK('record_ambient_carries_age'))
    })

    it('refuses an ambient fix with no age — a cached fix that will not say how old it is', async () => {
      await expect(insertRecord(db, ambient({ id: 'r3a', fix_age_seconds: null }))).rejects.toThrow(
        CHECK('record_ambient_carries_age'),
      )
    })

    it('refuses an ambient fix with no latitude', async () => {
      await expect(
        insertRecord(db, ambient({ id: 'r3b', latitude: null, is_mocked: null })),
      ).rejects.toThrow(CHECK('record_ambient_carries_age'))
    })

    it('refuses an ambient fix with no datum', async () => {
      await expect(insertRecord(db, ambient({ id: 'r3c', datum: null }))).rejects.toThrow(
        CHECK('record_ambient_carries_age'),
      )
    })

    it('refuses an ambient fix carrying a sample count it never averaged', async () => {
      await expect(insertRecord(db, ambient({ id: 'r3d', fix_sample_count: 7 }))).rejects.toThrow(
        CHECK('record_ambient_carries_age'),
      )
    })

    it('refuses an ambient fix carrying a spread', async () => {
      await expect(insertRecord(db, ambient({ id: 'r3e', fix_spread_m: 1.2 }))).rejects.toThrow(
        CHECK('record_ambient_carries_age'),
      )
    })

    it('refuses an ambient fix carrying a hold duration', async () => {
      await expect(insertRecord(db, ambient({ id: 'r3f', fix_hold_ms: 4200 }))).rejects.toThrow(
        CHECK('record_ambient_carries_age'),
      )
    })
  })

  describe('the none class — no position, and no provenance for one', () => {
    it('accepts a record with no position at all, recorded as absent', async () => {
      await insertRecord(db, none({ id: 'r4' }))
      expect(await db.all('SELECT id FROM record')).toHaveLength(1)
    })

    const conjuncts: [string, Record<string, unknown>][] = [
      ['a latitude', { latitude: -37.82141, is_mocked: 0 }],
      ['a longitude', { longitude: 145.03318 }],
      ['an accuracy', { accuracy_m: 4, accuracy_convention: 'radius68' }],
      ['an altitude', { altitude_m: 62, altitude_reference: 'wgs84Ellipsoid' }],
      ['a datum', { datum: 'WGS84' }],
      ['a fix age', { fix_age_seconds: 240 }],
      ['a sample count', { fix_sample_count: 7 }],
      ['a spread', { fix_spread_m: 1.2 }],
      ['a hold duration', { fix_hold_ms: 4200 }],
      ['a vertical accuracy', { vertical_accuracy_m: 3 }],
      ['an accuracy convention', { accuracy_convention: 'radius68' }],
      ['an altitude reference', { altitude_reference: 'wgs84Ellipsoid' }],
      // The three the first pass missed: a positionless record could name the
      // provider that produced the position it does not have, quote the satellite
      // clock, and assert that the absent position was not spoofed.
      ['a location provider', { location_provider: 'gps' }],
      ['a GPS time', { gps_time: NOW }],
    ]

    it.each(conjuncts)('refuses a positionless record carrying %s', async (_what, over) => {
      await expect(insertRecord(db, none({ id: 'r5', ...over }))).rejects.toThrow(
        CHECK('record_none_has_no_position'),
      )
    })

    it('refuses a positionless record that claims the position it has was not spoofed', async () => {
      // Violates the none clause and, equally, the rule that spoofing is only
      // knowable where there is a position; either firing is the right answer.
      await expect(insertRecord(db, none({ id: 'r5m', is_mocked: 0 }))).rejects.toThrow(
        /CHECK constraint failed: record_(none_has_no_position|mocked_known_when_positioned)/,
      )
    })
  })

  describe('the vocabularies, one member at a time', () => {
    // A negative test that rejects a bogus value stays green when a legitimate
    // value is deleted from the IN list, and deleting one is the likeliest real
    // edit to these lines. Each member below is therefore written successfully
    // at least once, so its removal goes red.

    it.each(['WGS84', 'GDA94', 'AGD66'])('accepts the datum %s', async (datum) => {
      // The VBA's three accepted frames; see
      // docs/research/2026-09-06-victorian-biodiversity-destinations.md §5.3.
      await insertRecord(db, { id: `rv-${datum}`, datum })
      const row = await db.first<{ datum: string }>('SELECT datum FROM record WHERE id = ?', [
        `rv-${datum}`,
      ])
      expect(row?.datum).toBe(datum)
    })

    it.each(['radius68', 'radius95'])(
      'accepts the accuracy convention %s on a deliberate fix',
      async (convention) => {
        await insertRecord(db, { id: `rc-${convention}`, accuracy_convention: convention })
        const row = await db.first<{ accuracy_convention: string }>(
          'SELECT accuracy_convention FROM record WHERE id = ?',
          [`rc-${convention}`],
        )
        expect(row?.accuracy_convention).toBe(convention)
      },
    )

    it("accepts the accuracy convention 'unknown' on an ambient fix", async () => {
      await insertRecord(db, ambient({ id: 'rc-unknown', accuracy_convention: 'unknown' }))
      const row = await db.first<{ accuracy_convention: string }>(
        'SELECT accuracy_convention FROM record WHERE id = ?',
        ['rc-unknown'],
      )
      expect(row?.accuracy_convention).toBe('unknown')
    })

    it.each(['wgs84Ellipsoid', 'meanSeaLevel'])(
      'accepts the altitude reference %s',
      async (reference) => {
        await insertRecord(db, { id: `ra-${reference}`, altitude_reference: reference })
        const row = await db.first<{ altitude_reference: string }>(
          'SELECT altitude_reference FROM record WHERE id = ?',
          [`ra-${reference}`],
        )
        expect(row?.altitude_reference).toBe(reference)
      },
    )

    it.each(['deliberate', 'ambient', 'none'])('accepts the fix quality %s', async (quality) => {
      const over =
        quality === 'ambient'
          ? ambient({})
          : quality === 'none'
            ? none({})
            : { fix_quality: 'deliberate' }
      await insertRecord(db, { ...over, id: `rq-${quality}` })
      const row = await db.first<{ fix_quality: string }>(
        'SELECT fix_quality FROM record WHERE id = ?',
        [`rq-${quality}`],
      )
      expect(row?.fix_quality).toBe(quality)
    })

    it("accepts the record kind 'pin'", async () => {
      await insertRecord(db, { id: 'rk-pin', kind: 'pin' })
      const row = await db.first<{ kind: string }>('SELECT kind FROM record WHERE id = ?', [
        'rk-pin',
      ])
      expect(row?.kind).toBe('pin')
    })
  })

  describe('conventions, without which the numbers mean nothing', () => {
    it('accepts a record with no altitude at all — barometer off, or none fitted', async () => {
      await insertRecord(db, { id: 'r10z', altitude_m: null, altitude_reference: null })
      const row = await db.first<{ altitude_m: number | null }>(
        'SELECT altitude_m FROM record WHERE id = ?',
        ['r10z'],
      )
      expect(row?.altitude_m).toBeNull()
    })

    it('refuses an accuracy stored without the convention that gives it meaning', async () => {
      await expect(
        insertRecord(db, ambient({ id: 'r10', accuracy_convention: null })),
      ).rejects.toThrow(CHECK('record_accuracy_has_convention'))
    })

    it('refuses an altitude with no stated reference — several metres of it, in Victoria', async () => {
      await expect(
        insertRecord(db, ambient({ id: 'r10a', altitude_reference: null })),
      ).rejects.toThrow(CHECK('record_altitude_has_reference'))
    })

    it('refuses an accuracy convention outside the known set', async () => {
      await expect(
        insertRecord(db, ambient({ id: 'r10b', accuracy_convention: 'radius99' })),
      ).rejects.toThrow(CHECK('record_accuracy_convention_known'))
    })

    it('refuses an altitude reference outside the known set', async () => {
      await expect(insertRecord(db, { id: 'r10c', altitude_reference: 'ahd71' })).rejects.toThrow(
        CHECK('record_altitude_reference_known'),
      )
    })

    it('refuses a datum the destination does not accept', async () => {
      // The VBA takes exactly WGS84, GDA94 and AGD66. GDA2020 is not one of them,
      // and the app never produces it — Android returns WGS84 and nothing here
      // transforms it. See docs/research/2026-09-06-victorian-biodiversity-destinations.md §5.3.
      await expect(insertRecord(db, { id: 'r6', datum: 'GDA2020' })).rejects.toThrow(
        CHECK('record_datum_known'),
      )
    })
  })

  describe('mocked positions', () => {
    it('records a mocked position as such, so a spoofed fix is identifiable', async () => {
      await insertRecord(db, { id: 'r11', is_mocked: 1 })
      const row = await db.first<{ is_mocked: number }>(
        'SELECT is_mocked FROM record WHERE id = ?',
        ['r11'],
      )
      expect(row?.is_mocked).toBe(1)
    })

    it('refuses a positioned record that will not say whether it was spoofed', async () => {
      // No DEFAULT 0 to fall back on: silently asserting "not spoofed" for a fix
      // nobody examined is the guess spec §7.5 forbids.
      await expect(insertRecord(db, { id: 'r11a', is_mocked: null })).rejects.toThrow(
        CHECK('record_mocked_known_when_positioned'),
      )
    })

    it('refuses an is_mocked value that is neither true nor false', async () => {
      await expect(insertRecord(db, { id: 'r11b', is_mocked: 2 })).rejects.toThrow(
        CHECK('record_is_mocked_boolean'),
      )
    })
  })

  describe('magnitudes — a coordinate that is out of range is not a coordinate', () => {
    it('refuses a transposed latitude/longitude pair', async () => {
      // Victoria is around -37.8, 145.0; the transposition puts the latitude at
      // 145, off the planet. Sign and transposition errors are live in this
      // domain while the hemisphere convention is still open with DEECA.
      await expect(
        insertRecord(db, { id: 'r12', latitude: 145.03318, longitude: -37.82141 }),
      ).rejects.toThrow(CHECK('record_latitude_range'))
    })

    it('refuses a longitude beyond the meridian', async () => {
      await expect(insertRecord(db, { id: 'r12a', longitude: 245.03318 })).rejects.toThrow(
        CHECK('record_longitude_range'),
      )
    })

    it('refuses a non-positive accuracy', async () => {
      await expect(insertRecord(db, { id: 'r12b', accuracy_m: 0 })).rejects.toThrow(
        CHECK('record_accuracy_positive'),
      )
    })

    it('refuses a non-positive vertical accuracy', async () => {
      await expect(insertRecord(db, { id: 'r12c', vertical_accuracy_m: 0 })).rejects.toThrow(
        CHECK('record_vertical_accuracy_positive'),
      )
    })

    it('refuses a negative fix age', async () => {
      await expect(insertRecord(db, ambient({ id: 'r12d', fix_age_seconds: -5 }))).rejects.toThrow(
        CHECK('record_fix_age_non_negative'),
      )
    })

    it('refuses a sample count of zero — nothing was averaged', async () => {
      await expect(insertRecord(db, { id: 'r12e', fix_sample_count: 0 })).rejects.toThrow(
        CHECK('record_fix_sample_count_positive'),
      )
    })

    it('refuses a negative spread', async () => {
      await expect(insertRecord(db, { id: 'r12f', fix_spread_m: -1 })).rejects.toThrow(
        CHECK('record_fix_spread_non_negative'),
      )
    })

    it('refuses a negative hold duration', async () => {
      await expect(insertRecord(db, { id: 'r12g', fix_hold_ms: -1 })).rejects.toThrow(
        CHECK('record_fix_hold_non_negative'),
      )
    })

    it('refuses a non-positive sequence number', async () => {
      await expect(insertRecord(db, { id: 'r12h', sequence: 0 })).rejects.toThrow(
        CHECK('record_sequence_positive'),
      )
    })

    it('accepts an altitude anywhere Victoria reaches', async () => {
      // Mt Bogong, the state's high point.
      await insertRecord(db, { id: 'r12i', altitude_m: 1986 })
      const row = await db.first<{ altitude_m: number }>(
        'SELECT altitude_m FROM record WHERE id = ?',
        ['r12i'],
      )
      expect(row?.altitude_m).toBe(1986)
    })

    it('refuses an altitude above the troposphere — a GNSS glitch, not a measurement', async () => {
      await expect(insertRecord(db, { id: 'r12j', altitude_m: 40000 })).rejects.toThrow(
        CHECK('record_altitude_range'),
      )
    })

    it('refuses an altitude below the lowest dry land on earth', async () => {
      await expect(insertRecord(db, { id: 'r12k', altitude_m: -3000 })).rejects.toThrow(
        CHECK('record_altitude_range'),
      )
    })
  })

  describe('position pairing, independent of the fix-quality discriminant', () => {
    // The three class clauses pair latitude and longitude only as a side effect
    // of the discriminant. This rule says it on its own, so a fourth quality
    // value added without a fourth clause cannot silently unconstrain position.
    it('refuses half a coordinate that no class clause would catch', async () => {
      const sql = `INSERT INTO record
        (id, kind, sequence, latitude, longitude, fix_quality, captured_at, device_id,
         created_at, updated_at)
        VALUES (?, 'pin', 1, ?, NULL, 'none', ?, 'dev-1', ?, ?)`
      // 'none' would ordinarily refuse a latitude, so this proves the pairing
      // rule exists at all rather than that the class clause fired again.
      await expect(db.execute(sql, ['r17', -37.82141, NOW, NOW, NOW])).rejects.toThrow(
        /CHECK constraint failed: record_(none_has_no_position|position_is_paired|mocked_known_when_positioned)/,
      )
    })

    it('states the pairing rule in the schema, not only as a side effect of a class', async () => {
      const table = await db.first<{ sql: string }>(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'record'`,
      )
      expect(table?.sql).toMatch(/CONSTRAINT record_position_is_paired/)
    })
  })

  describe("the none clause's conjuncts that no insert can isolate", () => {
    // accuracy_m, altitude_m and is_mocked cannot be tested in isolation: any
    // value for them also trips a pairing rule (record_accuracy_has_convention,
    // record_altitude_has_reference, record_mocked_known_when_positioned), so
    // deleting the conjunct alone leaves every insert-based test green. The
    // schema text is the assertion that does go red — the same technique the
    // Inbox-index test uses.
    const noneClause = (sql: string): string => {
      const start = sql.indexOf('CONSTRAINT record_none_has_no_position')
      expect(start).toBeGreaterThan(-1)
      return sql.slice(start, sql.indexOf('CONSTRAINT', start + 1))
    }

    it.each(['accuracy_m IS NULL', 'altitude_m IS NULL', 'is_mocked IS NULL'])(
      'keeps `%s` a conjunct of record_none_has_no_position',
      async (conjunct) => {
        const table = await db.first<{ sql: string }>(
          `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'record'`,
        )
        expect(noneClause(table?.sql ?? '')).toContain(conjunct)
      },
    )
  })

  describe('kind and attributes', () => {
    it('refuses a kind the first implementation does not define', async () => {
      await expect(insertRecord(db, { id: 'r13', kind: 'sample' })).rejects.toThrow(
        CHECK('record_kind_known'),
      )
    })

    it('refuses a fix quality outside the three classes', async () => {
      await expect(insertRecord(db, { id: 'r13a', fix_quality: 'estimated' })).rejects.toThrow(
        CHECK('record_fix_quality_known'),
      )
    })

    it('accepts kind-specific attributes as JSON', async () => {
      await insertRecord(db, { id: 'r13b', attributes: '{"species":"Eucalyptus camaldulensis"}' })
      const row = await db.first<{ species: string }>(
        `SELECT json_extract(attributes, '$.species') AS species FROM record WHERE id = ?`,
        ['r13b'],
      )
      expect(row?.species).toBe('Eucalyptus camaldulensis')
    })

    it('refuses attributes that are not valid JSON', async () => {
      await expect(
        insertRecord(db, { id: 'r13c', attributes: '{species: Eucalyptus' }),
      ).rejects.toThrow(CHECK('record_attributes_are_json'))
    })

    it.each(['1234', '"Eucalyptus"', 'null', 'true', '[1,2,3]'])(
      'refuses attributes that are valid JSON but not an object: %s',
      async (attributes) => {
        // json_valid() alone accepts all of these, and json_extract then returns
        // NULL for every path rather than erroring — so the kind-specific fields
        // arrive as silently missing instead of as a failure.
        await expect(insertRecord(db, { id: 'r13d', attributes })).rejects.toThrow(
          CHECK('record_attributes_are_json'),
        )
      },
    )
  })

  describe('activities, sequences and the Inbox', () => {
    it('keeps sequence numbers unique per activity, not per project', async () => {
      await insertRecord(db)
      await expect(insertRecord(db, { id: 'r7', sequence: 1 })).rejects.toThrow(UNIQUE)

      await db.execute(
        'INSERT INTO activity (id, project_id, kind, name, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['a2', 'p1', 'survey', 'Survey 4', NOW, NOW, NOW],
      )
      await insertRecord(db, { id: 'r8', activity_id: 'a2', sequence: 1 })
      expect(await db.all('SELECT id FROM record')).toHaveLength(2)
    })

    it('refuses a record naming a device that was never registered', async () => {
      await expect(insertRecord(db, { id: 'r9', device_id: 'ghost' })).rejects.toThrow(FOREIGN_KEY)
    })

    it('refuses a record filed to an activity that does not exist', async () => {
      await expect(insertRecord(db, { id: 'r9a', activity_id: 'ghost' })).rejects.toThrow(
        FOREIGN_KEY,
      )
    })

    it('refuses a record whose context activity does not exist', async () => {
      await expect(insertRecord(db, { id: 'r9b', context_activity_id: 'ghost' })).rejects.toThrow(
        FOREIGN_KEY,
      )
    })

    it('lets an unfiled record say which activity was running when it was captured', async () => {
      // Spec §8.3: context is captured always, filing is a deliberate decision.
      // The Inbox's one-tap suggestion is exactly this column.
      await insertRecord(db, { id: 'r14', activity_id: null, context_activity_id: 'a1' })
      const row = await db.first<{ activity_id: string | null; context_activity_id: string }>(
        'SELECT activity_id, context_activity_id FROM record WHERE id = ?',
        ['r14'],
      )
      expect(row?.activity_id).toBeNull()
      expect(row?.context_activity_id).toBe('a1')
    })

    it('keeps soft-deleted records out of the Inbox index', async () => {
      const index = await db.first<{ sql: string }>(
        `SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_record_unfiled'`,
      )
      expect(index?.sql).toMatch(/deleted_at IS NULL/)

      await insertRecord(db, { id: 'r15', activity_id: null, sequence: 1 })
      await insertRecord(db, { id: 'r16', activity_id: null, sequence: 2, deleted_at: NOW })
      const inbox = await db.all<{ id: string }>(
        'SELECT id FROM record WHERE activity_id IS NULL AND deleted_at IS NULL ORDER BY captured_at DESC',
      )
      expect(inbox.map((row) => row.id)).toEqual(['r15'])
    })
  })

  describe('the event log', () => {
    beforeEach(async () => {
      await insertRecord(db)
    })

    it('stores an event with its own context stamp, convention and datum included', async () => {
      await insertEvent(db)
      const event = await db.first<{ action: string; datum: string; accuracy_convention: string }>(
        'SELECT action, datum, accuracy_convention FROM event WHERE id = ?',
        ['e1'],
      )
      expect(event?.action).toBe('created')
      expect(event?.datum).toBe('WGS84')
      expect(event?.accuracy_convention).toBe('radius68')
    })

    it('refuses an event action outside the known set', async () => {
      await expect(insertEvent(db, { id: 'e2', action: 'teleported' })).rejects.toThrow(
        CHECK('event_action_known'),
      )
    })

    it('refuses an event accuracy stored without its convention', async () => {
      await expect(insertEvent(db, { id: 'e3', accuracy_convention: null })).rejects.toThrow(
        CHECK('event_accuracy_has_convention'),
      )
    })

    it('refuses an event position stored without its datum', async () => {
      await expect(insertEvent(db, { id: 'e4', datum: null })).rejects.toThrow(
        CHECK('event_position_has_datum'),
      )
    })

    it('refuses an event datum outside the destination vocabulary', async () => {
      await expect(insertEvent(db, { id: 'e5', datum: 'GDA2020' })).rejects.toThrow(
        CHECK('event_datum_known'),
      )
    })

    it('refuses an event accuracy convention outside the known set', async () => {
      await expect(insertEvent(db, { id: 'e6', accuracy_convention: 'radius99' })).rejects.toThrow(
        CHECK('event_accuracy_convention_known'),
      )
    })

    it('refuses an event fix quality outside the three classes', async () => {
      await expect(insertEvent(db, { id: 'e7', fix_quality: 'estimated' })).rejects.toThrow(
        CHECK('event_fix_quality_known'),
      )
    })

    it('refuses a positionless event stamp that nonetheless carries a position', async () => {
      await expect(insertEvent(db, { id: 'e8', fix_quality: 'none' })).rejects.toThrow(
        CHECK('event_none_has_no_position'),
      )
    })

    it('accepts a positionless event stamp', async () => {
      await insertEvent(db, {
        id: 'e9',
        fix_quality: 'none',
        latitude: null,
        longitude: null,
        accuracy_m: null,
        accuracy_convention: null,
        datum: null,
        is_mocked: null,
      })
      expect(await db.all('SELECT id FROM event')).toHaveLength(1)
    })

    it('refuses an event latitude off the planet', async () => {
      await expect(insertEvent(db, { id: 'e10', latitude: 145.03318 })).rejects.toThrow(
        CHECK('event_latitude_range'),
      )
    })

    it('refuses an event longitude beyond the meridian', async () => {
      await expect(insertEvent(db, { id: 'e10a', longitude: 245.03318 })).rejects.toThrow(
        CHECK('event_longitude_range'),
      )
    })

    it('refuses a non-positive event accuracy', async () => {
      await expect(insertEvent(db, { id: 'e10b', accuracy_m: 0 })).rejects.toThrow(
        CHECK('event_accuracy_positive'),
      )
    })

    it.each(['created', 'edited', 'media_added', 'filed', 'played', 'deleted', 'restored'])(
      'records the action %s',
      async (action) => {
        // The negative test above ('teleported') stays green if a legitimate action
        // is deleted from the IN list — and 'restored' is what the soft-delete flow
        // depends on. Each member is written once, so its removal goes red.
        await insertEvent(db, { id: `ea-${action}`, action })
        const row = await db.first<{ action: string }>('SELECT action FROM event WHERE id = ?', [
          `ea-${action}`,
        ])
        expect(row?.action).toBe(action)
      },
    )

    it('records the full seven-action vocabulary in one log', async () => {
      const actions = ['created', 'edited', 'media_added', 'filed', 'played', 'deleted', 'restored']
      for (const [i, action] of actions.entries()) {
        await insertEvent(db, { id: `es-${i}`, action })
      }
      const stored = await db.all<{ action: string }>('SELECT action FROM event ORDER BY id')
      expect(stored.map((row) => row.action)).toEqual(actions)
    })

    it.each(['WGS84', 'GDA94', 'AGD66'])('accepts the event datum %s', async (datum) => {
      await insertEvent(db, { id: `ed-${datum}`, datum })
      const row = await db.first<{ datum: string }>('SELECT datum FROM event WHERE id = ?', [
        `ed-${datum}`,
      ])
      expect(row?.datum).toBe(datum)
    })

    it.each(['radius68', 'radius95'])(
      'accepts the event accuracy convention %s',
      async (convention) => {
        await insertEvent(db, { id: `ec-${convention}`, accuracy_convention: convention })
        const row = await db.first<{ accuracy_convention: string }>(
          'SELECT accuracy_convention FROM event WHERE id = ?',
          [`ec-${convention}`],
        )
        expect(row?.accuracy_convention).toBe(convention)
      },
    )

    it("accepts the event accuracy convention 'unknown' on an ambient stamp", async () => {
      await insertEvent(db, {
        id: 'ec-unknown',
        fix_quality: 'ambient',
        accuracy_convention: 'unknown',
      })
      const row = await db.first<{ accuracy_convention: string }>(
        'SELECT accuracy_convention FROM event WHERE id = ?',
        ['ec-unknown'],
      )
      expect(row?.accuracy_convention).toBe('unknown')
    })

    it('records a mocked event stamp as such, so a spoofed stamp is identifiable', async () => {
      // Spec §7.5 wants a spoofed position distinguishable from a real one, and a
      // 'filed' or 'deleted' stamp is a position like any other.
      await insertEvent(db, { id: 'e14', action: 'filed', is_mocked: 1 })
      const row = await db.first<{ is_mocked: number }>(
        'SELECT is_mocked FROM event WHERE id = ?',
        ['e14'],
      )
      expect(row?.is_mocked).toBe(1)
    })

    it('refuses a positioned event stamp that will not say whether it was spoofed', async () => {
      await expect(insertEvent(db, { id: 'e14a', is_mocked: null })).rejects.toThrow(
        CHECK('event_mocked_known_when_positioned'),
      )
    })

    it('refuses an event is_mocked value that is neither true nor false', async () => {
      await expect(insertEvent(db, { id: 'e14b', is_mocked: 2 })).rejects.toThrow(
        CHECK('event_is_mocked_boolean'),
      )
    })

    it('refuses a positionless stamp that claims the position it lacks was not spoofed', async () => {
      await expect(
        insertEvent(db, {
          id: 'e14c',
          fix_quality: 'none',
          latitude: null,
          longitude: null,
          accuracy_m: null,
          accuracy_convention: null,
          datum: null,
          is_mocked: 0,
        }),
      ).rejects.toThrow(
        /CHECK constraint failed: event_(none_has_no_position|mocked_known_when_positioned)/,
      )
    })

    it('refuses a deliberate event stamp with no coordinates', async () => {
      // The record table makes this row impossible; the event table used to accept
      // it, which teaches the next author that the class means nothing here.
      await expect(
        insertEvent(db, { id: 'e15', fix_quality: 'deliberate', latitude: null, is_mocked: null }),
      ).rejects.toThrow(CHECK('event_deliberate_has_position'))
    })

    it("refuses a deliberate event stamp whose accuracy means 'unknown'", async () => {
      await expect(
        insertEvent(db, { id: 'e15a', fix_quality: 'deliberate', accuracy_convention: 'unknown' }),
      ).rejects.toThrow(CHECK('event_deliberate_has_position'))
    })

    it('accepts an ambient event stamp', async () => {
      await insertEvent(db, { id: 'e16', fix_quality: 'ambient', accuracy_m: 38 })
      const row = await db.first<{ fix_quality: string }>(
        'SELECT fix_quality FROM event WHERE id = ?',
        ['e16'],
      )
      expect(row?.fix_quality).toBe('ambient')
    })

    it('refuses an ambient event stamp with no coordinates', async () => {
      await expect(
        insertEvent(db, { id: 'e16a', fix_quality: 'ambient', latitude: null, is_mocked: null }),
      ).rejects.toThrow(CHECK('event_ambient_has_position'))
    })

    it('refuses half a coordinate on an event stamp, whatever the class', async () => {
      await expect(
        insertEvent(db, { id: 'e17', fix_quality: null, longitude: null }),
      ).rejects.toThrow(CHECK('event_position_is_paired'))
    })

    it('refuses an event pointing at a record that does not exist', async () => {
      await expect(insertEvent(db, { id: 'e11', record_id: 'ghost' })).rejects.toThrow(FOREIGN_KEY)
    })

    it('refuses an event naming a device that was never registered', async () => {
      await expect(insertEvent(db, { id: 'e12', device_id: 'ghost' })).rejects.toThrow(FOREIGN_KEY)
    })

    it('refuses an event naming an activity that does not exist', async () => {
      await expect(insertEvent(db, { id: 'e13', activity_id: 'ghost' })).rejects.toThrow(
        FOREIGN_KEY,
      )
    })

    it('refuses an update: the log is append-only, in the schema and not only in prose', async () => {
      await insertEvent(db)
      await expect(
        db.execute('UPDATE event SET detail = ? WHERE id = ?', ['tampered', 'e1']),
      ).rejects.toThrow(/append-only/)
    })

    it('refuses a delete: chain of custody is real or it is aspirational', async () => {
      await insertEvent(db)
      await expect(db.execute('DELETE FROM event WHERE id = ?', ['e1'])).rejects.toThrow(
        /append-only/,
      )
      expect(await db.all('SELECT id FROM event')).toHaveLength(1)
    })

    it('refuses an INSERT OR REPLACE: the route around both triggers', async () => {
      // REPLACE deletes the conflicting row to make room, and SQLite skips the
      // BEFORE DELETE trigger for that deletion unless `recursive_triggers` is
      // ON — which it is not by default. With the pragma off this statement
      // succeeded and rewrote the event's content, which defeats the one table
      // whose entire purpose is being tamper-evident. openTestDatabase() sets it;
      // if this test goes red, that pragma is the first place to look.
      await insertEvent(db, { detail: 'original' })
      await expect(
        db.execute(
          `INSERT OR REPLACE INTO event
             (id, record_id, action, device_id, occurred_at, latitude, longitude, accuracy_m,
              accuracy_convention, datum, fix_quality, is_mocked, activity_id, detail)
           VALUES (?, 'r1', 'deleted', 'dev-1', ?, -37.82141, 145.03318, 4,
                   'radius68', 'WGS84', 'deliberate', 0, 'a1', 'tampered')`,
          ['e1', NOW],
        ),
      ).rejects.toThrow(/append-only/)

      const rows = await db.all<{ action: string; detail: string }>(
        'SELECT action, detail FROM event',
      )
      expect(rows).toEqual([{ action: 'created', detail: 'original' }])
    })

    it('leaves recursive_triggers on, which is what makes the REPLACE refusal work', async () => {
      const pragma = await db.first<{ recursive_triggers: number }>('PRAGMA recursive_triggers')
      expect(pragma?.recursive_triggers).toBe(1)
    })
  })
})
