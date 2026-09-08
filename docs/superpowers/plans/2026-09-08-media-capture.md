# Media Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Photos and voice notes attached to a record — captured in-app, stored in app-owned storage keyed by record UUID, soft-deletable, and visible on the record they belong to.

**Architecture:** A new `@corymbia/media` package owns the filesystem: a `MediaStore` port with an `expo-file-system` adapter for the device and an in-memory adapter for Node tests, exactly the split `@corymbia/data` already uses for SQLite. `@corymbia/data` gains a `media` table and repository — the rows; `@corymbia/media` owns the bytes. The capture screens live in `apps/fieldkit`, built on an `InputAffordanceRow` finally taught the states the capture screen has been faking locally since Plan 3.

**Tech Stack:** Expo SDK 57 (`expo-camera` ~57.0.4, `expo-audio` ~57.0.4, `expo-file-system` ~57.0.6), React Native 0.86.3, TypeScript ~6 strict, better-sqlite3 for Node tests, jest-expo + @testing-library/react-native.

## Read before writing any code

`apps/fieldkit/AGENTS.md` is binding and short: **Expo has changed. Read the exact
versioned docs at <https://docs.expo.dev/versions/v57.0.0/> before writing any code.**
The three APIs this plan uses were all rewritten in recent SDKs, and the shapes you may
remember are the old ones:

- `expo-file-system` is now a class API — `File`, `Directory`, `Paths` — not
  `FileSystem.writeAsStringAsync`. The old surface still exists at
  `expo-file-system/legacy`; do not use it.
- `expo-audio` replaces `expo-av`. Recording is `useAudioRecorder(RecordingPresets.HIGH_QUALITY)`
  plus `useAudioRecorderState`, not `Audio.Recording`.
- `expo-camera` is `CameraView` plus `useCameraPermissions`, not `Camera`.

The exact signatures each task needs are written out in that task. Where a task's code and
the docs disagree, the docs win — say so in your report rather than making the code fit.

## Global Constraints

- Components consume semantic tokens from `@corymbia/tokens` only — never raw hex, never the raw ramp. Enforced by lint, including in tests.
- Only `packages/ui/src/layout/useLayout.ts` reads window dimensions. Everything else branches on `sizeClass` or `deviceClass` — never on a raw width or height.
- A tool under `apps/fieldkit/src/tools/` may import from packages and from itself, never from a sibling tool.
- Every adapter that opens the database must set `PRAGMA recursive_triggers = ON` and `PRAGMA foreign_keys = ON`.
- TypeScript strict with `noUncheckedIndexedAccess`. No `as` casts to silence a type, no non-null assertions.
- Never `git add -A` or `git add .`. The working tree carries unrelated pre-existing deletions under `.agents/skills/tauri/` that must stay out of every commit. Stage the exact paths each step names.
- Every commit message ends with exactly this one trailer line, and nothing after it:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  ```
- Do not run `npx expo run:android`. It never exits — it keeps Metro alive by design. The owner builds and installs.
- Media files are **app-owned and flat**, named by record UUID plus index (spec §12.1). Never a public shared directory: scoped storage on Android 10+ forbids it, and anything placed there is swept into the gallery and cloud backup, which destroys chain-of-custody.

## Scope

In: photo capture, voice note capture, storage lifecycle, soft delete, media rows on the
record spine, and seeing/playing/removing what is attached to a record.

Out, deliberately:

- **A browsing library across records.** Spec §14 item 8 names "the library and detail
  views" alongside capture. Browsing belongs with the launcher, project and Inbox work of
  item 9, which is where every other list of records lives; building a second one here
  would be thrown away. This plan gives a record its own media strip, which is the detail
  view. Raise it with the owner if you disagree — do not silently widen the plan.
- **The media-first entry points** of spec §9.6.1 (starting a record from a photo or a
  voice memo, with an ambient fix). There is nowhere to start one from until the launcher
  exists. Task 5 builds the data-layer rule those entry points need, so Plan 5 can rely on
  it; the entry points themselves are Plan 5's.

## File structure

| File | Responsibility |
| --- | --- |
| `packages/media/src/store/port.ts` | The `MediaStore` interface. No implementation. |
| `packages/media/src/store/memory.ts` | In-memory adapter for Node tests. |
| `packages/media/src/store/expo.ts` | `expo-file-system` adapter for the device. |
| `packages/media/src/naming.ts` | Pure: derives a stored filename from the media id and kind. |
| `packages/media/src/index.ts` | The barrel. |
| `packages/data/src/migrations/005-media.ts` | The `media` table, its CHECKs and its triggers. |
| `packages/data/src/repositories/media.ts` | `attachMedia`, `listMedia`, `softDeleteMedia`. |
| `packages/ui/src/inputs/InputAffordanceRow.tsx` | Gains `unavailable`, retires the capture screen's local copy. |
| `packages/ui/src/media/MediaStrip.tsx` | Presentational: what is attached, in order. |
| `apps/fieldkit/app/camera.tsx` | The camera screen. |
| `apps/fieldkit/app/voice.tsx` | The voice note screen. |
| `apps/fieldkit/src/media/useAttachMedia.ts` | Writes the file then the row, in that order, with rollback. |

---

### Task 1: The `@corymbia/media` package — naming, the store port, and the in-memory adapter

**Files:**
- Create: `packages/media/package.json`, `packages/media/tsconfig.json`, `packages/media/jest.config.js`
- Create: `packages/media/src/naming.ts`, `packages/media/src/store/port.ts`, `packages/media/src/store/memory.ts`, `packages/media/src/index.ts`
- Test: `packages/media/src/__tests__/naming.test.ts`, `packages/media/src/__tests__/memory.test.ts`

**Interfaces:**
- Consumes: nothing. This is the package's first task.
- Produces: `MediaKind = 'photo' | 'voice'`; `mediaFileName(mediaId: string, kind: MediaKind): string`; `MediaStore` (below); `createMemoryStore(): MediaStore & { contents(): Map<string, number> }`.

Model the package configuration on `packages/geo`, which is the closest sibling: pure logic plus
a native adapter behind a port. Copy its `tsconfig.json` verbatim. Its `jest.config.js` uses
`testEnvironment: 'node'` with no preset, and the same applies here for the same reason — the
barrel re-exports the `expo-file-system` adapter, and importing it under plain Node dies on ESM.
**Tests import specific modules (`../naming`, `../store/memory`), never the barrel.**

- [ ] **Step 1: Scaffold the package**

`packages/media/package.json`:

```json
{
  "name": "@corymbia/media",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "jest",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "expo-file-system": "~57.0.6"
  },
  "devDependencies": {
    "expo-file-system": "~57.0.6",
    "jest-expo": "~57.0.0",
    "react": "19.2.3",
    "react-native": "0.86.3"
  }
}
```

`packages/media/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2022", "DOM"], "types": ["jest"] },
  "include": ["src"]
}
```

`packages/media/jest.config.js`:

```js
// Tests import specific modules ('../naming', '../store/memory'), never the
// package barrel. The barrel statically re-exports the expo-file-system
// adapter, and expo-file-system ships ESM this plain config does not transform
// — importing the barrel from a test dies under Node with
// `SyntaxError: Unexpected token 'export'`. The same layering `packages/geo`
// keeps for the same reason: logic over the MediaStore port must not depend on
// the device adapter, so its tests must not reach it either.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
}
```

Then `pnpm install` from the repo root so the workspace picks the package up.

- [ ] **Step 2: Write the failing naming tests**

`packages/media/src/__tests__/naming.test.ts`:

```ts
import { mediaFileName } from '../naming'

describe('mediaFileName', () => {
  it('names a photo by the media id and a jpeg extension', () => {
    expect(mediaFileName('med_abc123', 'photo')).toBe('med_abc123.jpg')
  })

  it('names a voice note with the m4a extension expo-audio actually writes', () => {
    // RecordingPresets.HIGH_QUALITY records .m4a on Android. A stored name
    // claiming .mp3 or .wav would be a lie the export manifest then repeats.
    expect(mediaFileName('med_abc123', 'voice')).toBe('med_abc123.m4a')
  })

  it('depends on nothing that can later change', () => {
    // The whole reason this takes a media id and not a record plus an index
    // (spec §12.1). The name must survive reordering, removal of an earlier
    // attachment, refiling the record, and retitling it.
    expect(mediaFileName('med_abc123', 'photo')).toBe(mediaFileName('med_abc123', 'photo'))
  })

  // The id reaches this function from `newId`, so in practice it is always
  // safe. The guard is here because the RESULT IS A FILESYSTEM PATH: an id
  // carrying a slash or a `..` would write outside the media directory, and
  // "the only caller is safe today" is not a property the type system holds
  // on to. Cheap to enforce, permanently.
  it.each([
    ['a path separator', 'med/../../etc'],
    ['a parent traversal', '..'],
    ['a dot segment', 'med.abc'],
    ['an empty id', ''],
  ])('refuses %s', (_label, mediaId) => {
    expect(() => mediaFileName(mediaId, 'photo')).toThrow(/media id/i)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd packages/media && npx jest src/__tests__/naming.test.ts`
Expected: FAIL — `Cannot find module '../naming'`.

- [ ] **Step 4: Write `naming.ts`**

```ts
/**
 * How a stored media file is named on disk (spec §12.1).
 *
 * The media row's own id, and nothing else. §12.1 rejects three richer names
 * for one reason: a path must not depend on anything that can change.
 *
 *  - NOT the title — editable, duplicable, blank-able, and can contain slashes.
 *  - NOT under a project directory — records are refilable between projects.
 *  - NOT the record id plus an index — the index moves when an earlier
 *    attachment is removed or the order changes, and because deletion is soft
 *    the removed file is STILL ON DISK under the name the new one would take.
 *
 * The media id is minted once and never changes. The record it belongs to is a
 * column, which is where a mutable relationship belongs. Human-readable names
 * are applied at export, where project and sequence are known and nothing
 * downstream depends on them.
 */
export type MediaKind = 'photo' | 'voice'

/**
 * The extension per kind, which must match what the capture APIs actually
 * write: `expo-camera`'s `takePictureAsync` produces JPEG, and `expo-audio`'s
 * `RecordingPresets.HIGH_QUALITY` produces `.m4a` on Android.
 */
const EXTENSION: Record<MediaKind, string> = {
  photo: 'jpg',
  voice: 'm4a',
}

/** Ids from `newId` are `prefix_` plus base-36, so this is not restrictive. */
const SAFE_MEDIA_ID = /^[A-Za-z0-9_-]+$/

export function mediaFileName(mediaId: string, kind: MediaKind): string {
  if (!SAFE_MEDIA_ID.test(mediaId)) {
    throw new Error(
      `Refusing to build a filename from media id ${JSON.stringify(mediaId)}. The result is ` +
        'a filesystem path, and an id carrying a separator or a dot segment would write ' +
        'outside the media directory.',
    )
  }
  return `${mediaId}.${EXTENSION[kind]}`
}
```

- [ ] **Step 5: Run the naming tests to verify they pass**

Run: `cd packages/media && npx jest src/__tests__/naming.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Write the failing store tests**

`packages/media/src/__tests__/memory.test.ts`:

```ts
import { createMemoryStore } from '../store/memory'

describe('the in-memory media store', () => {
  it('saves a file and reports the bytes it took', async () => {
    const store = createMemoryStore({ 'file:///tmp/shot.jpg': 2048 })
    const saved = await store.save('med_a1.jpg', 'file:///tmp/shot.jpg')
    expect(saved.byteSize).toBe(2048)
    expect(await store.exists('med_a1.jpg')).toBe(true)
  })

  it('reports a stable uri for a saved file', async () => {
    const store = createMemoryStore({ 'file:///tmp/shot.jpg': 10 })
    const saved = await store.save('med_a1.jpg', 'file:///tmp/shot.jpg')
    expect(saved.uri).toBe(store.uriFor('med_a1.jpg'))
  })

  it('refuses to save over a name that already exists', async () => {
    // Overwriting silently is how one record's photo becomes another's. The
    // index that makes names unique is derived from a count, and a count read
    // outside a transaction can repeat.
    const store = createMemoryStore({ 'file:///tmp/a.jpg': 1, 'file:///tmp/b.jpg': 2 })
    await store.save('med_a1.jpg', 'file:///tmp/a.jpg')
    await expect(store.save('med_a1.jpg', 'file:///tmp/b.jpg')).rejects.toThrow(/already/i)
  })

  it('throws when the source file is not there', async () => {
    const store = createMemoryStore({})
    await expect(store.save('med_a1.jpg', 'file:///tmp/gone.jpg')).rejects.toThrow(/source/i)
  })

  it('deletes a file', async () => {
    const store = createMemoryStore({ 'file:///tmp/a.jpg': 1 })
    await store.save('med_a1.jpg', 'file:///tmp/a.jpg')
    await store.remove('med_a1.jpg')
    expect(await store.exists('med_a1.jpg')).toBe(false)
  })

  it('is silent about deleting something that is already gone', async () => {
    // Purge runs over rows, and a row can outlive its file (an interrupted
    // save, a restored backup). Throwing there would strand every later row.
    const store = createMemoryStore({})
    await expect(store.remove('med_a1.jpg')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 7: Run the store tests to verify they fail**

Run: `cd packages/media && npx jest src/__tests__/memory.test.ts`
Expected: FAIL — `Cannot find module '../store/memory'`.

- [ ] **Step 8: Write the port and the in-memory adapter**

`packages/media/src/store/port.ts`:

```ts
/**
 * Everything this application does to media files, and nothing else.
 *
 * The same shape `@corymbia/data` uses for SQLite: one narrow interface, an
 * `expo-file-system` adapter for the device, an in-memory adapter for Node
 * tests. The lifecycle rules — save before the row, roll back on failure,
 * never delete on a soft delete — live above this port, not inside it.
 *
 * `remove` is deliberately not called `delete`: deletion in this application is
 * SOFT (spec §12.1, the row is flagged and the file survives until a
 * deliberate purge in settings), and a store method named `delete` invites a
 * caller to reach for it when a user removes a photo. This one is for the
 * purge and for rolling back a half-finished save.
 */
export type MediaStore = {
  /** Moves the captured file at `sourceUri` into app-owned storage. */
  save(fileName: string, sourceUri: string): Promise<{ uri: string; byteSize: number }>
  /** Permanently removes the file. Silent if it is already gone. */
  remove(fileName: string): Promise<void>
  exists(fileName: string): Promise<boolean>
  /** Where the file lives, whether or not it is there yet. */
  uriFor(fileName: string): string
}
```

`packages/media/src/store/memory.ts`:

```ts
import type { MediaStore } from './port'

/**
 * An in-memory `MediaStore` for Node tests. Holds byte sizes rather than bytes:
 * nothing above this port reads a file's contents, so contents would be a
 * fiction the tests then have to maintain.
 *
 * `sources` seeds the fake filesystem the camera and recorder are pretending to
 * have written into: a map of source uri to byte size.
 */
export function createMemoryStore(
  sources: Record<string, number> = {},
): MediaStore & { contents(): Map<string, number> } {
  const stored = new Map<string, number>()

  return {
    async save(fileName, sourceUri) {
      const size = sources[sourceUri]
      if (size === undefined) {
        throw new Error(`No source file at ${sourceUri} to save as ${fileName}.`)
      }
      if (stored.has(fileName)) {
        throw new Error(
          `${fileName} already exists. Saving over it would replace one record's media with ` +
            "another's, and the row pointing at the old bytes would not know.",
        )
      }
      stored.set(fileName, size)
      return { uri: this.uriFor(fileName), byteSize: size }
    },
    async remove(fileName) {
      stored.delete(fileName)
    },
    async exists(fileName) {
      return stored.has(fileName)
    },
    uriFor(fileName) {
      return `memory://media/${fileName}`
    },
    contents() {
      return new Map(stored)
    },
  }
}
```

`packages/media/src/index.ts`:

```ts
export { mediaFileName } from './naming'
export type { MediaKind } from './naming'
export type { MediaStore } from './store/port'
export { createMemoryStore } from './store/memory'
```

Note the barrel does **not** export the expo adapter yet — Task 2 adds it.

`MediaKind` is exported here because two other packages consume it type-only:
`@corymbia/data` (Task 4) and `@corymbia/ui` (Task 7). It lives in this package rather than in
`data` because it must agree with `EXTENSION` — a kind with no extension cannot be named.

- [ ] **Step 9: Run the whole package's tests**

Run: `cd packages/media && npx jest`
Expected: PASS, 13 tests across 2 suites.

- [ ] **Step 10: Prove the overwrite guard can fail**

Delete the `stored.has(fileName)` check, re-run, and confirm
`refuses to save over a name that already exists` fails. Restore it. Quote both outputs in
your report.

- [ ] **Step 11: Verify and commit**

Run: `pnpm turbo run test lint typecheck --force` from the repo root.
Expected: all workspaces pass, now including `@corymbia/media`.

```bash
git add packages/media pnpm-lock.yaml
git commit
```

---

### Task 2: The `expo-file-system` adapter

**Files:**
- Create: `packages/media/src/store/expo.ts`
- Modify: `packages/media/src/index.ts`
- Test: `packages/media/src/__tests__/expo-store.test.ts`

**Interfaces:**
- Consumes: `MediaStore` from `./port`.
- Produces: `createExpoMediaStore(): MediaStore`, exported from the barrel.

**The SDK 57 API, verbatim from the docs — this is not the API you may remember:**

```ts
import { File, Directory, Paths } from 'expo-file-system'

const directory = new Directory(Paths.document, 'media')
directory.create({ intermediates: true, idempotent: true })
const file = new File(Paths.document, 'media', 'name.jpg')
file.exists     // boolean property, NOT a method, NOT a promise
file.size       // bytes
file.uri
file.move(destination)   // synchronous; updates file.uri
file.delete()
```

`Paths.document` is the app's document directory — private, not swept into the gallery, and
not deleted under storage pressure the way `Paths.cache` is. That distinction is the whole
of §12.1's "app-owned storage": use `Paths.document`, never `Paths.cache`, and never a
public directory.

The class API is synchronous. The port is async because the in-memory adapter and every
caller already are; wrapping synchronous calls in an async function is correct here, not a
smell.

- [ ] **Step 1: Write the failing test**

`packages/media/src/__tests__/expo-store.test.ts`:

```ts
/**
 * `expo-file-system` is a native module with no Node implementation, so this
 * suite mocks it. That means it proves the adapter CALLS THE RIGHT API in the
 * right order with the right arguments — not that files actually move. The
 * real thing is proven on the device, in Task 12's hardware checklist.
 *
 * Mocking is worth doing anyway because the two things most likely to be wrong
 * here are exactly the things a mock can see: writing into `Paths.cache`
 * instead of `Paths.document` (silent, until Android reclaims storage and a
 * day's photos are gone), and not creating the directory before the move.
 */
const move = jest.fn()
const remove = jest.fn()
const createDirectory = jest.fn()

let fileExists = true
let fileSize = 4096

class FakeFile {
  uri: string
  constructor(...segments: string[]) {
    this.uri = segments.join('/')
  }
  get exists() {
    return fileExists
  }
  get size() {
    return fileSize
  }
  move(destination: { uri: string }) {
    move(this.uri, destination.uri)
    this.uri = `${destination.uri}/moved`
  }
  delete() {
    remove(this.uri)
  }
}

class FakeDirectory {
  uri: string
  constructor(...segments: string[]) {
    this.uri = segments.join('/')
  }
  create(options: unknown) {
    createDirectory(this.uri, options)
  }
}

jest.mock('expo-file-system', () => ({
  File: FakeFile,
  Directory: FakeDirectory,
  Paths: { document: 'file:///data/app/documents', cache: 'file:///data/app/cache' },
}))

import { createExpoMediaStore } from '../store/expo'

beforeEach(() => {
  jest.clearAllMocks()
  fileExists = true
  fileSize = 4096
})

describe('the expo-file-system media store', () => {
  it('stores under the document directory, never the cache', async () => {
    // Paths.cache is reclaimed by Android under storage pressure. A field day's
    // photos living there would vanish without an error, and the rows would
    // survive pointing at nothing.
    const store = createExpoMediaStore()
    expect(store.uriFor('med_a1.jpg')).toContain('file:///data/app/documents')
    expect(store.uriFor('med_a1.jpg')).not.toContain('cache')
  })

  it('creates the media directory before moving anything into it', async () => {
    const store = createExpoMediaStore()
    await store.save('med_a1.jpg', 'file:///tmp/shot.jpg')
    expect(createDirectory).toHaveBeenCalled()
    const createOrder = createDirectory.mock.invocationCallOrder[0]
    const moveOrder = move.mock.invocationCallOrder[0]
    expect(createOrder).toBeDefined()
    expect(moveOrder).toBeDefined()
    expect(createOrder as number).toBeLessThan(moveOrder as number)
  })

  it('moves the captured file out of its temporary home', async () => {
    const store = createExpoMediaStore()
    await store.save('med_a1.jpg', 'file:///tmp/shot.jpg')
    expect(move).toHaveBeenCalledWith('file:///tmp/shot.jpg', expect.stringContaining('media'))
  })

  it('reports the stored size', async () => {
    fileSize = 123456
    const store = createExpoMediaStore()
    const saved = await store.save('med_a1.jpg', 'file:///tmp/shot.jpg')
    expect(saved.byteSize).toBe(123456)
  })

  it('refuses to overwrite an existing name', async () => {
    const store = createExpoMediaStore()
    await expect(store.save('med_a1.jpg', 'file:///tmp/shot.jpg')).rejects.toThrow(/already/i)
    expect(move).not.toHaveBeenCalled()
  })

  it('is silent about removing a file that is already gone', async () => {
    fileExists = false
    const store = createExpoMediaStore()
    await expect(store.remove('med_a1.jpg')).resolves.toBeUndefined()
    expect(remove).not.toHaveBeenCalled()
  })
})
```

Note the fifth test: `fileExists` defaults to `true`, so the destination looks present and
the save must refuse. The sixth flips it to `false`.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/media && npx jest src/__tests__/expo-store.test.ts`
Expected: FAIL — `Cannot find module '../store/expo'`.

- [ ] **Step 3: Write the adapter**

```ts
import { Directory, File, Paths } from 'expo-file-system'
import type { MediaStore } from './port'

/**
 * The directory every media file lives in, flat (spec §12.1).
 *
 * Under `Paths.document`, which is app-private and survives — NOT
 * `Paths.cache`, which Android reclaims under storage pressure. A day's photos
 * disappearing with no error, leaving rows that point at nothing, is the
 * failure that choice prevents.
 */
const MEDIA_DIRECTORY = 'media'

export function createExpoMediaStore(): MediaStore {
  const directory = (): Directory => new Directory(Paths.document, MEDIA_DIRECTORY)
  const fileFor = (fileName: string): File => new File(Paths.document, MEDIA_DIRECTORY, fileName)

  return {
    async save(fileName, sourceUri) {
      const destination = fileFor(fileName)
      if (destination.exists) {
        throw new Error(
          `${fileName} already exists. Saving over it would replace one record's media with ` +
            "another's, and the row pointing at the old bytes would not know.",
        )
      }
      // Idempotent so a second capture does not throw on a directory that is
      // already there, and `intermediates` so a fresh install does not fail on
      // a missing parent.
      directory().create({ intermediates: true, idempotent: true })

      const source = new File(sourceUri)
      if (!source.exists) {
        throw new Error(`No source file at ${sourceUri} to save as ${fileName}.`)
      }
      source.move(directory())

      const stored = fileFor(fileName)
      return { uri: stored.uri, byteSize: stored.size ?? 0 }
    },
    async remove(fileName) {
      const file = fileFor(fileName)
      if (!file.exists) return
      file.delete()
    },
    async exists(fileName) {
      return fileFor(fileName).exists
    },
    uriFor(fileName) {
      return fileFor(fileName).uri
    },
  }
}
```

**A gap you must close before you finish this task.** `source.move(directory())` moves the
file under its *source* name, not `fileName` — the docs' own example shows
`file.move(new Directory(...))` keeping `example.txt`. Read the SDK 57 `File` docs and find
the supported way to move-and-rename in one step (check whether `move` accepts a `File`
destination as well as a `Directory`). Implement whichever the docs support, adjust the
test's expectation to match, and **state in your report which API you used and where the
docs say so.** Do not guess, and do not leave the rename to a second operation without
saying why.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/media && npx jest`
Expected: PASS, all suites.

- [ ] **Step 5: Prove the document-directory guard can fail**

Change `Paths.document` to `Paths.cache` in the adapter, re-run, and confirm
`stores under the document directory, never the cache` fails. Restore. Quote both outputs.

- [ ] **Step 6: Export it and commit**

Add to `packages/media/src/index.ts`:

```ts
export { createExpoMediaStore } from './store/expo'
```

Run: `pnpm turbo run test lint typecheck --force`

```bash
git add packages/media
git commit
```

---

### Task 3: The `media` table

**Files:**
- Create: `packages/data/src/migrations/005-media.ts`
- Modify: `packages/data/src/migrations/index.ts`
- Test: `packages/data/src/__tests__/migration-005.test.ts`

**Interfaces:**
- Consumes: `Migration` from `../db/migrate`; the `record` table from migration 003.
- Produces: the `media` table; `migration005` appended to `migrations`.

Read `packages/data/src/migrations/003-records.ts` first. It is the pattern: every CHECK is
**named**, because SQLite reports the name in the error and that is what lets a test assert
that a *specific* rule fired rather than that something threw.

- [ ] **Step 1: Write the failing tests**

`packages/data/src/__tests__/migration-005.test.ts`. Follow the existing migration tests for
how to open a database — read `packages/data/src/__tests__/` for the established helper and use
it rather than inventing one.

```ts
describe('the media table', () => {
  it('stores a photo attached to a record', async () => {
    // …insert a device, a record, then a media row; expect it to read back.
  })

  it('refuses a kind it does not know', async () => {
    await expect(insertMedia({ kind: 'video' })).rejects.toThrow(/media_kind_known/)
  })

  it('refuses a voice note with no duration', async () => {
    // A voice note whose length is unknown cannot be shown, played back with a
    // progress bar, or costed for export. Photos have no duration at all, and
    // one constraint enforces both halves so neither can drift.
    await expect(insertMedia({ kind: 'voice', durationMs: null })).rejects.toThrow(
      /media_duration_matches_kind/,
    )
  })

  it('refuses a photo that claims a duration', async () => {
    await expect(insertMedia({ kind: 'photo', durationMs: 5000 })).rejects.toThrow(
      /media_duration_matches_kind/,
    )
  })

  it('refuses a zero-byte file', async () => {
    // An empty file is a failed capture that reported success. Storing the row
    // makes it look like she has a photo she does not have.
    await expect(insertMedia({ byteSize: 0 })).rejects.toThrow(/media_byte_size_positive/)
  })

  it('refuses two rows claiming the same file', async () => {
    await insertMedia({ id: 'med_one', fileName: 'med_one.jpg' })
    await expect(insertMedia({ id: 'med_two', fileName: 'med_one.jpg' })).rejects.toThrow(
      /idx_media_file_name|UNIQUE/,
    )
  })

  it('refuses two live attachments at the same position on one record', async () => {
    await insertMedia({ id: 'med_one', recordId: 'rec_a', ordinal: 1 })
    await expect(insertMedia({ id: 'med_two', recordId: 'rec_a', ordinal: 1 })).rejects.toThrow(
      /idx_media_record_ordinal|UNIQUE/,
    )
  })

  it('frees a position once the attachment at it is soft-deleted', async () => {
    // The ordinal is display order and nothing else now that filenames are
    // derived from the media id, so reusing one is safe — and required, or
    // removing a photo would leave a permanent hole in the numbering.
    await insertMedia({ id: 'med_one', recordId: 'rec_a', ordinal: 1 })
    await softDelete('med_one')
    await expect(insertMedia({ id: 'med_two', recordId: 'rec_a', ordinal: 1 })).resolves.toBeDefined()
  })

  it('refuses to let a stored filename be rewritten', async () => {
    // The row is the only thing that knows which bytes belong to this record.
    // An UPDATE here silently re-points it at another record's file — or at
    // nothing — and every export afterwards carries the wrong image.
    await insertMedia({ id: 'med_one', fileName: 'med_one.jpg' })
    await expect(
      db.execute('UPDATE media SET file_name = ? WHERE id = ?', ['other.jpg', 'med_one']),
    ).rejects.toThrow(/media_file_name_is_immutable/)
  })

  it('refuses to let a media row be hard-deleted', async () => {
    // Deletion is soft (spec §12.1): the row is flagged and the file survives
    // until a deliberate purge. A hard DELETE loses the record that the file
    // on disk was ever attached to anything, so the purge can never find it.
    await insertMedia({ id: 'med_one' })
    await expect(db.execute('DELETE FROM media WHERE id = ?', ['med_one'])).rejects.toThrow(
      /media_is_never_hard_deleted/,
    )
  })

  it('refuses an attachment on a record that does not exist', async () => {
    await expect(insertMedia({ recordId: 'rec_nope' })).rejects.toThrow(/FOREIGN KEY/)
  })
})
```

Write the `insertMedia` / `softDelete` helpers out in full in the test file — they are local
fixtures, not shared utilities.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/data && npx jest src/__tests__/migration-005.test.ts`
Expected: FAIL — `no such table: media`.

- [ ] **Step 3: Write the migration**

```ts
import type { Migration } from '../db/migrate'

/**
 * Photos and voice notes attached to a record (spec §7.1, §12.1).
 *
 * This table holds the ROWS; `@corymbia/media` holds the bytes. The split is
 * deliberate and the invariant between them is one-directional: a row without
 * its file is a broken record, a file without its row is garbage. So a file is
 * written before its row is inserted, and the file is removed if the insert
 * fails — never the other way round.
 *
 * `media_kind_known`'s list is one of THREE statements of the same fact, and
 * all three change together: this CHECK, `MediaKind` in `@corymbia/media`, and
 * the `EXTENSION` map beside it that says what each kind is written as. A kind
 * added here alone is a row nothing can name a file for; a kind added there
 * alone fails this constraint mid-capture on a field device.
 *
 * `file_name` is derived from the media id, not from the record and an index
 * (spec §12.1). Two consequences show up here: the name can be UNIQUE across
 * the whole table for the life of the database, and `ordinal` is free to be
 * display order alone — reusable once an attachment is soft-deleted, because
 * no file's name depends on it.
 *
 * **Deletion is soft, and that is load-bearing.** The row is flagged and the
 * file survives until a deliberate purge in settings. `media_is_never_hard_deleted`
 * is what makes that true rather than conventional: a hard DELETE would lose
 * the only record that a file on disk was ever attached to anything, and the
 * purge would then have nothing to find it by. Both triggers here need
 * `PRAGMA recursive_triggers = ON` for the same reason migration 003's do —
 * with it off, `INSERT OR REPLACE` deletes the conflicting row and SQLite
 * SKIPS the BEFORE DELETE trigger for that deletion.
 */
export const migration005: Migration = {
  id: '005-media',
  up: [
    `CREATE TABLE media (
       id           TEXT PRIMARY KEY,

       record_id    TEXT NOT NULL REFERENCES record(id),

       kind         TEXT NOT NULL
                    CONSTRAINT media_kind_known CHECK (kind IN ('photo', 'voice')),

       -- The name in the media directory, derived from `id` at capture. Never
       -- rewritten: see media_file_name_is_immutable below.
       file_name    TEXT NOT NULL,

       -- What the file actually took on disk, measured after the write. Zero
       -- means the capture failed and reported success, which must not be
       -- storable — it would show as a photo she does not have.
       byte_size    INTEGER NOT NULL
                    CONSTRAINT media_byte_size_positive CHECK (byte_size > 0),

       -- Voice notes carry a length; photos carry none. One constraint states
       -- both halves so the two cannot drift apart.
       duration_ms  INTEGER
                    CONSTRAINT media_duration_matches_kind
                    CHECK ((kind = 'voice' AND duration_ms IS NOT NULL AND duration_ms > 0)
                        OR (kind = 'photo' AND duration_ms IS NULL)),

       -- Display order within the record, from 1. Not part of any filename.
       ordinal      INTEGER NOT NULL
                    CONSTRAINT media_ordinal_positive CHECK (ordinal > 0),

       captured_at  TEXT NOT NULL,
       deleted_at   TEXT,
       created_at   TEXT NOT NULL,
       updated_at   TEXT NOT NULL
     )`,

    // Across every row, deleted included: a soft-deleted attachment's file is
    // still on disk, so its name must never be handed to a new one.
    `CREATE UNIQUE INDEX idx_media_file_name ON media(file_name)`,

    // Live rows only. Removing the second of three photos must not leave a
    // permanent hole at position 2.
    `CREATE UNIQUE INDEX idx_media_record_ordinal
       ON media(record_id, ordinal) WHERE deleted_at IS NULL`,

    `CREATE INDEX idx_media_record ON media(record_id) WHERE deleted_at IS NULL`,

    `CREATE TRIGGER media_file_name_is_immutable
       BEFORE UPDATE OF file_name ON media
       WHEN OLD.file_name IS NOT NEW.file_name
       BEGIN
         SELECT RAISE(ABORT, 'media_file_name_is_immutable');
       END`,

    `CREATE TRIGGER media_is_never_hard_deleted
       BEFORE DELETE ON media
       BEGIN
         SELECT RAISE(ABORT, 'media_is_never_hard_deleted');
       END`,
  ],
}
```

- [ ] **Step 4: Register it**

In `packages/data/src/migrations/index.ts`, import `migration005` and append it to the
`migrations` array. **Append only** — the comment there is not decorative: never reorder or
edit a shipped migration.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/data && npx jest src/__tests__/migration-005.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Prove two constraints can fail**

Delete `media_is_never_hard_deleted`, re-run, confirm the hard-delete test fails. Restore.
Then widen `media_duration_matches_kind` to `CHECK (1)`, re-run, confirm both duration tests
fail. Restore. Quote all outputs.

- [ ] **Step 7: Commit**

```bash
git add packages/data/src/migrations/005-media.ts packages/data/src/migrations/index.ts packages/data/src/__tests__/migration-005.test.ts
git commit
```

---

### Task 4: The media repository

**Files:**
- Create: `packages/data/src/repositories/media.ts`
- Modify: `packages/data/src/index.ts`
- Test: `packages/data/src/repositories/__tests__/media.test.ts`

**Interfaces:**
- Consumes: `Database`, `newId`, `nowIso`, `appendEvent`, `Fix`.
- Produces:
  ```ts
  // NOT re-declared here. `MediaKind` is owned by `@corymbia/media`, which is
  // where the extension per kind lives, and imported type-only so nothing at
  // runtime crosses the package boundary:
  //   import type { MediaKind } from '@corymbia/media'
  export type Attachment = {
    id: string
    recordId: string
    kind: MediaKind
    fileName: string
    byteSize: number
    durationMs: number | null
    ordinal: number
    capturedAt: string
    deletedAt: string | null
  }
  export function newMediaId(): string
  export function attachMedia(db: Database, input: {
    mediaId: string
    recordId: string
    kind: MediaKind
    fileName: string
    byteSize: number
    durationMs: number | null
    deviceId: string
    fix: Fix
  }): Promise<Attachment>
  export function listMedia(db: Database, recordId: string): Promise<Attachment[]>
  export function softDeleteMedia(db: Database, mediaId: string, deviceId: string, fix: Fix): Promise<void>
  ```

**Why `attachMedia` takes the id rather than minting it.** The caller must know the filename
*before* the row exists, because the file is written first. `newMediaId()` mints it, the
caller derives the name with `mediaFileName`, writes the bytes, and passes both in. Minting
inside would force either a two-phase write or a rename, both of which can be interrupted.

**Ordinal allocation happens inside the transaction**, as `SELECT COALESCE(MAX(ordinal), 0) + 1
FROM media WHERE record_id = ? AND deleted_at IS NULL`. Reading it outside and passing it in
is how two attachments end up at the same position.

**`MediaKind` has one home, and it is not this package.** `@corymbia/media` declares it
alongside the extension each kind is written with, because the two must agree — a kind with no
extension cannot be named. Add `"@corymbia/media": "workspace:*"` to `packages/data`'s
dependencies and import the type only:

```ts
import type { MediaKind } from '@corymbia/media'
```

A type-only import is erased at compile time, so nothing pulls `expo-file-system` into the
bundle through this edge. Declaring a second `'photo' | 'voice'` here instead would be the
same defect the fix classes already have a rule about: **migration 005's CHECK, this union,
and `mediaFileName`'s `EXTENSION` map are three statements of one fact, and all three change
together.** Adding a kind — video, say — in only one of them leaves the other two disagreeing,
and the disagreement surfaces as a `SQLITE_CONSTRAINT` mid-capture on a field device, or as a
file written with no extension at all. Say this in the union's doc comment.

- [ ] **Step 1: Write the failing tests**

`packages/data/src/repositories/__tests__/media.test.ts`. Model the setup on
`packages/data/src/repositories/__tests__/records.test.ts`.

```ts
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
    const row = await db.first('SELECT deleted_at FROM media WHERE id = ?', ['med_one'])
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
    expect(removal?.message).toMatch(/removed/i)
  })

  it('is refused for an attachment that is already gone', async () => {
    await attachMedia(db, photoInput({ mediaId: 'med_one' }))
    await softDeleteMedia(db, 'med_one', DEVICE, fix)
    await expect(softDeleteMedia(db, 'med_one', DEVICE, fix)).rejects.toThrow(/already/i)
  })
})
```

Check `appendEvent`'s actual parameter names in `packages/data/src/repositories/events.ts`
and use them — the `message` field above is the shape `refineRecordFix` already writes, so
confirm rather than assume.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/data && npx jest src/repositories/__tests__/media.test.ts`
Expected: FAIL — `Cannot find module '../media'`.

- [ ] **Step 3: Write the repository**

Follow `packages/data/src/repositories/records.ts` throughout: one `db.transaction`, the
existence and soft-delete checks read *inside* it from the row on disk, error messages that
say what the rule protects rather than only that it fired. `attachMedia` allocates the
ordinal, inserts, and appends the `media_added` event in one transaction.
`softDeleteMedia` sets `deleted_at` and `updated_at` and appends an `edited` event whose
message names the removed attachment.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/data && npx jest src/repositories/__tests__/media.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Prove the transaction boundary can fail**

Move the `appendEvent` call outside the transaction, re-run, and confirm
`writes nothing at all when the row is refused` fails. Restore. Quote both outputs.

- [ ] **Step 6: Export and commit**

Add `attachMedia`, `listMedia`, `softDeleteMedia`, `newMediaId` and the `Attachment` type to
`packages/data/src/index.ts`. Run `pnpm turbo run test lint typecheck --force`.

```bash
git add packages/data/src/repositories/media.ts packages/data/src/repositories/__tests__/media.test.ts packages/data/src/index.ts
git commit
```

---

### Task 5: A deliberate fix must supersede an ambient one (spec §9.6.2)

**Files:**
- Modify: `packages/data/src/repositories/records.ts` — the guard inside `refineRecordFix`
- Test: `packages/data/src/repositories/__tests__/records.test.ts`

**Interfaces:**
- Consumes: `refineRecordFix`, `Fix`.
- Produces: no signature change. The guard's behaviour changes.

**The defect, from spec §9.6.2.** `refineRecordFix` keeps the better fix, and `accuracy_m` is
its sole criterion. That is right for two deliberate holds over one point. It is wrong for an
**ambient-to-deliberate upgrade**: a cached ambient fix can report an optimistic ±3 m, and an
honest deliberate hold reaching ±4 m would be *refused*. The record keeps the ambient
coordinates, stays stamped ambient, and exports as ambient — after she deliberately stood
still to fix it. That is the blurring §8.2 says must never happen.

Nothing in the application can reach this today, because every record starts from the capture
screen with a deliberate fix. Plan 5's media-first entry points are what make it reachable,
and this is built now so they can rely on it.

**The rule: a deliberate fix always supersedes an ambient or absent one, whatever the two
accuracy figures say. The accuracy comparison applies only between fixes of the same class.**

- [ ] **Step 1: Write the failing tests**

Add to `packages/data/src/repositories/__tests__/records.test.ts`:

```ts
describe('refineRecordFix across fix classes (spec §9.6.2)', () => {
  it('applies a deliberate fix over an ambient one that claims to be sharper', async () => {
    // The trap this rule exists for. The ambient number comes off a cached
    // reading that never waited for anything; the deliberate one is a held,
    // averaged, accuracy-gated measurement. They are not comparable, and
    // comparing them leaves the record stamped ambient after she stood still
    // to fix it — exactly what §8.2 forbids.
    const record = await createRecord(db, { ...base, fix: ambientFix({ accuracyM: 3 }) })
    const result = await refineRecordFix(db, {
      recordId: record.id,
      fix: deliberateFix({ accuracyM: 4 }),
      deviceId: DEVICE,
    })
    expect(result.applied).toBe(true)
    expect(result.record.fix.quality).toBe('deliberate')
    expect(result.record.accuracyM).toBeCloseTo(4, 6)
  })

  it('applies a deliberate fix over no position at all', async () => {
    const record = await createRecord(db, { ...base, fix: { quality: 'none' } })
    const result = await refineRecordFix(db, {
      recordId: record.id,
      fix: deliberateFix({ accuracyM: 12 }),
      deviceId: DEVICE,
    })
    expect(result.applied).toBe(true)
  })

  it('still refuses a blunter deliberate fix over a sharper deliberate one', async () => {
    // Same class, so the accuracy comparison is the right one and keeps
    // working. This is the rule from §9.2.1 and it is not being relaxed.
    const record = await createRecord(db, { ...base, fix: deliberateFix({ accuracyM: 2 }) })
    const result = await refineRecordFix(db, {
      recordId: record.id,
      fix: deliberateFix({ accuracyM: 5 }),
      deviceId: DEVICE,
    })
    expect(result.applied).toBe(false)
    expect(result.record.accuracyM).toBeCloseTo(2, 6)
  })

  it('never downgrades a deliberate fix to an ambient one, however sharp', async () => {
    // The other direction, and the more dangerous one: an ambient fix
    // overwriting a survey-grade measurement would put an unwaited-for
    // coordinate into a biodiversity dataset under a solid teal chip.
    const record = await createRecord(db, { ...base, fix: deliberateFix({ accuracyM: 9 }) })
    const result = await refineRecordFix(db, {
      recordId: record.id,
      fix: ambientFix({ accuracyM: 1 }),
      deviceId: DEVICE,
    })
    expect(result.applied).toBe(false)
    expect(result.record.fix.quality).toBe('deliberate')
  })

  it('compares accuracy between two ambient fixes', async () => {
    const record = await createRecord(db, { ...base, fix: ambientFix({ accuracyM: 30 }) })
    const result = await refineRecordFix(db, {
      recordId: record.id,
      fix: ambientFix({ accuracyM: 12 }),
      deviceId: DEVICE,
    })
    expect(result.applied).toBe(true)
  })
})
```

The existing `refineRecordFix` tests must all still pass unchanged. If any needs editing,
stop and report it — it means the rule was drawn wrongly.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/data && npx jest src/repositories/__tests__/records.test.ts -t "across fix classes"`
Expected: FAIL — the first test reports `applied` false, the fourth reports it true.

- [ ] **Step 3: Change the guard**

The read inside the transaction currently selects `deleted_at, accuracy_m, activity_id`. It
must also select `fix_quality`. Replace the single-criterion line with a rank-then-compare:
a deliberate fix outranks ambient, which outranks none; a strictly higher rank always
applies; an equal rank falls through to the existing `accuracy_m` comparison; a lower rank
never applies. Write the reasoning above it, citing §9.6.2, and say plainly that the two
numbers are not comparable across classes rather than only that the ranks differ.

Both outcomes still append an `'edited'` event, as they do today. Check what the discarded-run
message says for a same-class refusal and give the cross-class refusal wording that fits what
actually happened — a deliberate fix was not replaced by an ambient one is a different event
from a hold that did not improve on the last.

- [ ] **Step 4: Run the whole records suite**

Run: `cd packages/data && npx jest src/repositories/__tests__/records.test.ts`
Expected: PASS, every existing test plus the 5 new ones.

- [ ] **Step 5: Prove the rank guard can fail**

Remove the rank comparison so only `accuracy_m` decides, re-run, and confirm the first and
fourth new tests fail. Restore. Quote both outputs.

- [ ] **Step 6: Update the spec and commit**

Spec §9.6.2 currently describes this as a trap laid for the media work. Rewrite it as built:
what the rule is, where it is enforced, and that the three-places rule for fix classes still
applies. Keep the explanation of why the two numbers are not comparable — that is the part
a future reader needs.

```bash
git add packages/data/src/repositories/records.ts packages/data/src/repositories/__tests__/records.test.ts docs/superpowers/specs/2026-09-05-corymbia-field-kit-design.md
git commit
```

---

### Task 6: `InputAffordanceRow` grows the states the capture screen has been faking

**Files:**
- Modify: `packages/ui/src/inputs/InputAffordanceRow.tsx`
- Test: `packages/ui/src/inputs/__tests__/InputAffordanceRow.test.tsx`

**Interfaces:**
- Consumes: `InputAffordanceKind`, `INPUT_AFFORDANCE_ORDER`.
- Produces: `InputAffordanceRow` with a new `busy?: InputAffordanceKind[]` prop and per-kind counts.

Read `apps/fieldkit/app/capture.tsx` around the `AffordanceTile` component before starting.
Plan 3 wrote a local copy of this component with a three-state model and a long comment
explaining that it exists only because there was no media table, and that **Plan 4 attaches
here**. Task 10 deletes it. This task's job is to make sure that deletion loses nothing.

Three states were needed there: `done`, `available`, `unavailable`. After this plan **nothing
is unavailable** — photo, voice, title and notes all work — so do *not* port `unavailable`
across. That is the "or to find it no longer needs one" half of the comment's prediction, and
carrying a dead state forward would be the wrong half.

What this row *does* need, which it has never had:

- **A count.** A record can carry several photos. `Photo ✓` after four of them is a worse
  answer than `Photo · 4`, and doctrine rule 9 wants the state carried by words, not by a
  border alone.
- **A busy state.** Saving a photo touches the filesystem and the database. A tile that looks
  idle while that happens invites a second tap, and a second tap is a second attachment.

- [ ] **Step 1: Write the failing tests**

Add to `packages/ui/src/inputs/__tests__/InputAffordanceRow.test.tsx`:

```tsx
it('shows how many of a kind are attached, not merely that some are', async () => {
  await render(<InputAffordanceRow onPress={() => {}} counts={{ photo: 4 }} />)
  expect(screen.getByTestId('affordance-photo-label')).toHaveTextContent('4')
})

it('says done without a number for a kind that can only happen once', async () => {
  // A record has one title. "Title · 1" is noise.
  await render(<InputAffordanceRow onPress={() => {}} completed={['title']} />)
  expect(screen.getByTestId('affordance-title-label')).not.toHaveTextContent('1')
})

it('refuses a second press while a kind is busy', async () => {
  // Saving a photo writes a file and a row. A second tap during that write is
  // a second attachment she did not ask for.
  const onPress = jest.fn()
  await render(<InputAffordanceRow onPress={onPress} busy={['photo']} />)
  await fireEvent.press(screen.getByTestId('affordance-photo'))
  expect(onPress).not.toHaveBeenCalled()
})

it('marks a busy affordance disabled to a screen reader, not merely dim', async () => {
  await render(<InputAffordanceRow onPress={() => {}} busy={['photo']} />)
  expect(screen.getByTestId('affordance-photo').props.accessibilityState.disabled).toBe(true)
})

it('leaves the other affordances live while one is busy', async () => {
  const onPress = jest.fn()
  await render(<InputAffordanceRow onPress={onPress} busy={['photo']} />)
  await fireEvent.press(screen.getByTestId('affordance-voice'))
  expect(onPress).toHaveBeenCalledWith('voice')
})
```

`render` and `fireEvent.*` are async in RNTL v14 — every one must be awaited, or its work
lands in the middle of the next assertion.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/ui && npx jest src/inputs/__tests__/InputAffordanceRow.test.tsx`
Expected: FAIL — unknown props `counts` and `busy`, and no `affordance-photo-label` text.

- [ ] **Step 3: Implement**

Add two optional props:

```tsx
counts?: Partial<Record<InputAffordanceKind, number>>
busy?: InputAffordanceKind[]
```

The label becomes: the kind's own label, plus `· N` when `counts[kind]` is greater than zero,
plus ` ✓` when the kind is in `completed` and has no count. A busy tile gets
`disabled`, `accessibilityState={{ disabled: true }}`, and no `onPress` call — do not pass an
`onPress` that returns early; a `Pressable` that looks pressable and silently does nothing is
the shape Plan 3's comment already warns about.

Keep the existing dashed-versus-solid border and the existing test handles. Do not introduce a
colour-only distinction: doctrine rule 9 requires two channels.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/ui && npx jest src/inputs/__tests__/InputAffordanceRow.test.tsx`
Expected: PASS, all tests including the 5 existing ones.

- [ ] **Step 5: Prove the busy guard can fail**

Replace the `disabled` prop with an `onPress` that returns early, re-run, and confirm
`marks a busy affordance disabled to a screen reader` fails while the press test still passes
— which is the point: the two tests catch different halves. Restore. Quote both outputs.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/inputs
git commit
```

---

### Task 7: `MediaStrip` — what is attached, in order

**Files:**
- Create: `packages/ui/src/media/MediaStrip.tsx`, `packages/ui/src/media/index.ts`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/media/__tests__/MediaStrip.test.tsx`

**Interfaces:**
- Consumes: `useTheme`, `Type`, tokens (`spacing`, `radii`, `field`, `touch`).
- Produces:
  ```tsx
  export type MediaStripItem = {
    id: string
    // `import type { MediaKind } from '@corymbia/media'` — not a fourth copy
    // of the union. `@corymbia/ui` already takes type-only imports this way.
    kind: MediaKind
    uri: string
    durationMs: number | null
  }
  export function MediaStrip(props: {
    items: MediaStripItem[]
    onPress?: (id: string) => void
    onRemove?: (id: string) => void
    testID?: string
  }): React.JSX.Element | null
  ```

Presentational only. It knows nothing about the database, the filesystem, or playback — it is
handed uris and hands back ids. Playback lives in Task 11, on the screen.

- [ ] **Step 1: Write the failing tests**

```tsx
const photo = (id: string): MediaStripItem => ({ id, kind: 'photo', uri: `file:///${id}.jpg`, durationMs: null })
const voice = (id: string, ms: number): MediaStripItem => ({ id, kind: 'voice', uri: `file:///${id}.m4a`, durationMs: ms })

it('renders nothing at all when there is nothing attached', async () => {
  // An empty strip is a frame around a void: it costs vertical space on a
  // phone and says only that a thing she did not do has not been done.
  await render(<MediaStrip items={[]} testID="strip" />)
  expect(screen.queryByTestId('strip')).toBeNull()
})

it('renders one tile per attachment, in the order given', async () => {
  await render(<MediaStrip items={[photo('a'), voice('b', 4000), photo('c')]} testID="strip" />)
  expect(screen.getAllByTestId(/^media-tile-/).map((t) => t.props.testID)).toEqual([
    'media-tile-a', 'media-tile-b', 'media-tile-c',
  ])
})

it('shows a voice note as a length, because there is nothing to look at', async () => {
  await render(<MediaStrip items={[voice('b', 8200)]} testID="strip" />)
  expect(screen.getByTestId('media-tile-b')).toHaveTextContent('0:08')
})

it('rounds a length to whole seconds rather than showing milliseconds', async () => {
  await render(<MediaStrip items={[voice('b', 65400)]} testID="strip" />)
  expect(screen.getByTestId('media-tile-b')).toHaveTextContent('1:05')
})

it('shows a photo as the photo, not as a filename', async () => {
  await render(<MediaStrip items={[photo('a')]} testID="strip" />)
  expect(screen.getByTestId('media-thumb-a').props.source).toEqual({ uri: 'file:///a.jpg' })
})

it('gives every tile a touch target big enough to hit while moving', async () => {
  // Doctrine: field controls are sized for gloved, one-handed use. A thumbnail
  // strip is still a control.
  await render(<MediaStrip items={[photo('a')]} onPress={() => {}} testID="strip" />)
  const tile = screen.getByTestId('media-tile-a')
  const style = Array.isArray(tile.props.style) ? Object.assign({}, ...tile.props.style) : tile.props.style
  expect(style.minHeight).toBeGreaterThanOrEqual(touch.comfortable)
})

it('names each attachment to a screen reader by kind and position', async () => {
  await render(<MediaStrip items={[photo('a'), voice('b', 4000)]} onPress={() => {}} testID="strip" />)
  expect(screen.getByTestId('media-tile-a').props.accessibilityLabel).toMatch(/photo 1 of 2/i)
  expect(screen.getByTestId('media-tile-b').props.accessibilityLabel).toMatch(/voice note 2 of 2/i)
})

it('offers removal only when a handler is given', async () => {
  await render(<MediaStrip items={[photo('a')]} testID="strip" />)
  expect(screen.queryByTestId('media-remove-a')).toBeNull()
})

it('reports which attachment is to be removed', async () => {
  const onRemove = jest.fn()
  await render(<MediaStrip items={[photo('a'), photo('c')]} onRemove={onRemove} testID="strip" />)
  await fireEvent.press(screen.getByTestId('media-remove-c'))
  expect(onRemove).toHaveBeenCalledWith('c')
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/ui && npx jest src/media/__tests__/MediaStrip.test.tsx`
Expected: FAIL — `Cannot find module '../MediaStrip'`.

- [ ] **Step 3: Implement**

A horizontally scrolling row of square tiles. A photo tile renders `<Image source={{ uri }} />`;
a voice tile renders the microphone glyph over its length as `m:ss`. Each tile is a
`Pressable` when `onPress` is given and a plain `View` otherwise — never a `Pressable` with no
handler. The remove control is a separate `Pressable` inside the tile, rendered only when
`onRemove` is given, with its own accessible label naming what it removes.

Return `null` when `items` is empty — the first test is the requirement, not an optimisation.

Duration formatting is `m:ss` with the seconds zero-padded, rounding to the nearest second.
Put it in a small exported-for-test-free local function; the two duration tests pin it.

Sizing comes from `touch.comfortable` and the `field` scale. If a tile wants a size the scale
does not have, add a named token to `packages/tokens/src/scales.ts` with a comment saying what
ergonomic question it answers — do not write a bare number into the component.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/ui && npx jest src/media/__tests__/MediaStrip.test.tsx`
Expected: PASS, 9 tests.

- [ ] **Step 5: Prove the empty case can fail**

Return the container unconditionally, re-run, confirm `renders nothing at all` fails. Restore.

- [ ] **Step 6: Export and commit**

Add `export * from './media'` to `packages/ui/src/index.ts` and the component to
`packages/ui/src/media/index.ts`. Run `pnpm turbo run test lint typecheck --force`.

```bash
git add packages/ui/src/media packages/ui/src/index.ts packages/tokens/src/scales.ts
git commit
```

---

### Task 8: The camera screen

**Files:**
- Create: `apps/fieldkit/app/camera.tsx`
- Modify: `apps/fieldkit/app.json`
- Test: `apps/fieldkit/app/__tests__/camera.test.tsx`

**Interfaces:**
- Consumes: `expo-camera`; `useLocalSearchParams`, `router` from `expo-router`.
- Produces: a route at `/camera` taking a `recordId` param, which captures a photo and returns to the record.

**The SDK 57 API, verbatim from the docs:**

```tsx
import { CameraView, useCameraPermissions } from 'expo-camera'

const [permission, requestPermission] = useCameraPermissions()
// permission: PermissionResponse | null — { granted, status, canAskAgain, expires }
// requestPermission: () => Promise<PermissionResponse>

const ref = useRef<CameraView>(null)
const shot = await ref.current?.takePictureAsync({ quality: 0.85, exif: true })
// shot: { uri, width, height, format } — uri is a file path on native
```

`permission` is `null` until the hook resolves. `null` is not `denied`: rendering the denied
message while it is null flashes a refusal at someone who has granted access. Three states,
not two.

`app.json` needs the config plugin and the Android permission:

```json
["expo-camera", { "cameraPermission": "Corymbia Field Kit uses the camera to attach photos to a survey record." }]
```

and `CAMERA` added to `android.permissions`. **`app.json` changes do not reach a build on
their own** — they are written into native resources by `npx expo prebuild --platform android`,
which the owner runs. Note it in your report; do not run the build yourself.

`exif: true` is deliberate. The image carries its own timestamp and, where the OS provides it,
its own coordinates — independent corroboration of the record's fix, which matters for a
photograph that may end up as evidence of what was at a site.

- [ ] **Step 1: Write the failing tests**

Mock `expo-camera` at the top of the test file: a `CameraView` that renders a `View` and
exposes `takePictureAsync` through its ref, and a `useCameraPermissions` whose return value
the test controls.

```tsx
it('asks for the camera before showing a viewfinder', async () => {
  setPermission({ granted: false, canAskAgain: true, status: 'undetermined' })
  await render(<CameraScreen />)
  expect(screen.getByTestId('camera-request')).toBeTruthy()
  expect(screen.queryByTestId('camera-view')).toBeNull()
})

it('shows neither the viewfinder nor a refusal while permission is still unknown', async () => {
  // `useCameraPermissions` returns null until it resolves. Treating null as
  // denied flashes "no camera access" at someone who granted it months ago.
  setPermission(null)
  await render(<CameraScreen />)
  expect(screen.queryByTestId('camera-denied')).toBeNull()
  expect(screen.queryByTestId('camera-view')).toBeNull()
})

it('explains what to do when permission was refused for good', async () => {
  setPermission({ granted: false, canAskAgain: false, status: 'denied' })
  await render(<CameraScreen />)
  expect(screen.getByTestId('camera-denied')).toHaveTextContent(/settings/i)
})

it('shows the shutter once permission is granted', async () => {
  setPermission({ granted: true, canAskAgain: false, status: 'granted' })
  await render(<CameraScreen />)
  expect(screen.getByTestId('camera-shutter')).toBeTruthy()
})

it('gives the shutter a field-sized target', async () => {
  // She is holding a phone one-handed over a plot, possibly gloved. This is
  // the same reason the capture control is `field.control` and not `touch.min`.
  setPermission({ granted: true, canAskAgain: false, status: 'granted' })
  await render(<CameraScreen />)
  const style = flatten(screen.getByTestId('camera-shutter').props.style)
  expect(style.minHeight).toBeGreaterThanOrEqual(field.control)
})

it('attaches the captured photo to the record it was opened for', async () => {
  takePictureAsync.mockResolvedValue({ uri: 'file:///tmp/shot.jpg', width: 4, height: 3 })
  setPermission({ granted: true, canAskAgain: false, status: 'granted' })
  await render(<CameraScreen />)
  await fireEvent.press(screen.getByTestId('camera-shutter'))
  expect(attachPhoto).toHaveBeenCalledWith(expect.objectContaining({
    recordId: 'rec_a',
    sourceUri: 'file:///tmp/shot.jpg',
  }))
})

it('ignores a second shutter press while the first is still saving', async () => {
  // The exact failure that killed the capture button in Plan 3: a claim taken
  // after an await is a claim taken too late. Two presses, one photo.
  setPermission({ granted: true, canAskAgain: false, status: 'granted' })
  let release: (v: unknown) => void = () => {}
  takePictureAsync.mockReturnValue(new Promise((r) => { release = r }))
  await render(<CameraScreen />)
  await fireEvent.press(screen.getByTestId('camera-shutter'))
  await fireEvent.press(screen.getByTestId('camera-shutter'))
  release({ uri: 'file:///tmp/shot.jpg' })
  await act(async () => {})
  expect(takePictureAsync).toHaveBeenCalledTimes(1)
})

it('says so and stays open when saving fails', async () => {
  // A camera screen that closes on failure loses the photo AND the message.
  takePictureAsync.mockResolvedValue({ uri: 'file:///tmp/shot.jpg' })
  attachPhoto.mockRejectedValue(new Error('disk full'))
  setPermission({ granted: true, canAskAgain: false, status: 'granted' })
  await render(<CameraScreen />)
  await fireEvent.press(screen.getByTestId('camera-shutter'))
  expect(screen.getByTestId('camera-error')).toBeTruthy()
  expect(screen.getByTestId('camera-shutter')).toBeTruthy()
})

it('returns to the record once the photo is attached', async () => {
  takePictureAsync.mockResolvedValue({ uri: 'file:///tmp/shot.jpg' })
  setPermission({ granted: true, canAskAgain: false, status: 'granted' })
  await render(<CameraScreen />)
  await fireEvent.press(screen.getByTestId('camera-shutter'))
  expect(routerBack).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/fieldkit && npx jest app/__tests__/camera.test.tsx`
Expected: FAIL — `Cannot find module '../camera'`.

- [ ] **Step 3: Implement the screen**

Structure, in order:

```tsx
export default function CameraScreen() {
  const { recordId } = useLocalSearchParams<{ recordId: string }>()
  const [permission, requestPermission] = useCameraPermissions()
  const cameraRef = useRef<CameraView>(null)
  const [error, setError] = useState<string | null>(null)
  const savingRef = useRef(false)          // claimed synchronously — see below
  const [saving, setSaving] = useState(false)

  const shoot = useCallback(async () => {
    // Claimed BEFORE any await. A flag set after the first await is set after
    // the second press has already been handled, which is how Plan 3's capture
    // button went dead for a whole session.
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      const shot = await cameraRef.current?.takePictureAsync({ quality: 0.85, exif: true })
      if (shot === undefined) throw new Error('The camera returned no photo.')
      await attachPhoto({ recordId, sourceUri: shot.uri })
      router.back()
    } catch (cause) {
      setError(messageFor(cause))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [recordId])
  …
}
```

Render, in three permission states: `permission === null` → a quiet waiting state, neither
viewfinder nor refusal. `!permission.granted && permission.canAskAgain` → the request, with a
sentence saying why the camera is wanted. `!permission.granted && !permission.canAskAgain` →
the refusal, naming Settings as the way back. `permission.granted` → `CameraView` filling the
screen with the shutter beneath it at `field.control`, positioned by the reach zone the
capture screen already uses.

The error is shown *on the screen*, not in an `Alert`. Doctrine rule 3: a level of disclosure
that is not built must not pretend otherwise, and a modal that dismisses takes the message
with it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/fieldkit && npx jest app/__tests__/camera.test.tsx`
Expected: PASS, 9 tests.

- [ ] **Step 5: Prove the double-press guard can fail**

Move the `savingRef.current = true` claim to after the `takePictureAsync` await, re-run, and
confirm `ignores a second shutter press` fails. Restore. Quote both outputs.

- [ ] **Step 6: Configure and commit**

Add the plugin entry and the `CAMERA` permission to `app.json`.

```bash
git add apps/fieldkit/app/camera.tsx apps/fieldkit/app/__tests__/camera.test.tsx apps/fieldkit/app.json
git commit
```

---

### Task 9: The voice note screen

**Files:**
- Create: `apps/fieldkit/app/voice.tsx`
- Modify: `apps/fieldkit/app.json`
- Test: `apps/fieldkit/app/__tests__/voice.test.tsx`

**Interfaces:**
- Consumes: `expo-audio`; `useLocalSearchParams`, `router`.
- Produces: a route at `/voice` taking a `recordId` param.

**The SDK 57 API, verbatim from the docs:**

```tsx
import {
  useAudioRecorder, useAudioRecorderState, AudioModule, RecordingPresets, setAudioModeAsync,
} from 'expo-audio'

const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
const state = useAudioRecorderState(recorder)   // { isRecording, durationMillis, canRecord, mediaServicesDidReset }

const status = await AudioModule.requestRecordingPermissionsAsync()
await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true })

await recorder.prepareToRecordAsync()
recorder.record()                                // NOT awaited — starts capture
await recorder.stop()
recorder.uri                                     // the finished file, read AFTER stop resolves
```

`RecordingPresets.HIGH_QUALITY` writes `.m4a` on Android, which is why `mediaFileName` uses
that extension. `recorder.uri` is only meaningful once `stop()` has resolved.

`app.json` needs `RECORD_AUDIO` in `android.permissions`. The `expo-audio` plugin entry is
already there — `expo install` added it. Give it the `microphonePermission` string.

- [ ] **Step 1: Write the failing tests**

Mock `expo-audio` so the test drives `isRecording`, `durationMillis` and `uri`.

```tsx
it('asks for the microphone before offering to record', async () => {
  requestRecordingPermissionsAsync.mockResolvedValue({ granted: false })
  await render(<VoiceScreen />)
  await act(async () => {})
  expect(screen.getByTestId('voice-denied')).toBeTruthy()
})

it('shows how long she has been talking, so she knows it is running', async () => {
  // A recorder with no visible timer is indistinguishable from one that
  // silently failed to start — and she will not find out until playback.
  setRecorderState({ isRecording: true, durationMillis: 12400 })
  await render(<VoiceScreen />)
  expect(screen.getByTestId('voice-elapsed')).toHaveTextContent('0:12')
})

it('prepares before recording, because record() on an unprepared recorder does nothing', async () => {
  await render(<VoiceScreen />)
  await fireEvent.press(screen.getByTestId('voice-toggle'))
  expect(prepareToRecordAsync.mock.invocationCallOrder[0]).toBeLessThan(
    record.mock.invocationCallOrder[0] as number,
  )
})

it('attaches the finished recording with the length it actually ran for', async () => {
  setRecorderState({ isRecording: true, durationMillis: 8200 })
  uri.mockReturnValue('file:///tmp/note.m4a')
  await render(<VoiceScreen />)
  await fireEvent.press(screen.getByTestId('voice-toggle'))
  expect(attachVoice).toHaveBeenCalledWith(expect.objectContaining({
    recordId: 'rec_a',
    sourceUri: 'file:///tmp/note.m4a',
    durationMs: 8200,
  }))
})

it('reads the uri only after stop resolves', async () => {
  // Before stop() resolves the recorder's uri is the previous recording's, or
  // nothing. Reading it early attaches the wrong file with a straight face.
  setRecorderState({ isRecording: true, durationMillis: 3000 })
  await render(<VoiceScreen />)
  await fireEvent.press(screen.getByTestId('voice-toggle'))
  expect(stop.mock.invocationCallOrder[0]).toBeLessThan(uriReadOrder())
})

it('discards a recording too short to carry anything', async () => {
  // A stray tap produces a 200 ms file. Attaching it puts a voice note on the
  // record that says nothing, and she has to play it to find that out.
  setRecorderState({ isRecording: true, durationMillis: 300 })
  await render(<VoiceScreen />)
  await fireEvent.press(screen.getByTestId('voice-toggle'))
  expect(attachVoice).not.toHaveBeenCalled()
  expect(screen.getByTestId('voice-too-short')).toBeTruthy()
})

it('stays open and says so when saving fails', async () => {
  setRecorderState({ isRecording: true, durationMillis: 5000 })
  attachVoice.mockRejectedValue(new Error('disk full'))
  await render(<VoiceScreen />)
  await fireEvent.press(screen.getByTestId('voice-toggle'))
  expect(screen.getByTestId('voice-error')).toBeTruthy()
})

it('stops the recorder when the screen goes away mid-recording', async () => {
  // Leaving a recorder running holds the microphone and the wake it implies
  // for the rest of the session.
  setRecorderState({ isRecording: true, durationMillis: 4000 })
  const view = await render(<VoiceScreen />)
  await view.unmount()
  expect(stop).toHaveBeenCalled()
})
```

The minimum length is a named constant — `MINIMUM_NOTE_MS = 1000` — with a comment saying it
exists to discard stray taps, not to judge how much she had to say.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/fieldkit && npx jest app/__tests__/voice.test.tsx`
Expected: FAIL — `Cannot find module '../voice'`.

- [ ] **Step 3: Implement**

One toggle: not recording → prepare, set the audio mode, record. Recording → stop, read the
uri, attach if long enough. The same synchronously-claimed `busyRef` as the camera screen,
for the same reason. The elapsed time renders from `useAudioRecorderState`'s `durationMillis`
in `m:ss`, at `hero` — it is the only number on the screen and the only evidence that
anything is happening.

Stop the recorder in a cleanup effect if it is still running at unmount.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/fieldkit && npx jest app/__tests__/voice.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Prove the ordering guard can fail**

Read `recorder.uri` before awaiting `stop()`, re-run, confirm `reads the uri only after stop
resolves` fails. Restore. Quote both outputs.

- [ ] **Step 6: Configure and commit**

```bash
git add apps/fieldkit/app/voice.tsx apps/fieldkit/app/__tests__/voice.test.tsx apps/fieldkit/app.json
git commit
```

---

### Task 10: `useAttachMedia` — the file, then the row, and rollback if the row is refused

**Files:**
- Create: `apps/fieldkit/src/media/useAttachMedia.ts`, `apps/fieldkit/src/media/store.ts`
- Test: `apps/fieldkit/src/media/__tests__/useAttachMedia.test.ts`

**Interfaces:**
- Consumes: `newMediaId`, `attachMedia`, `Fix` from `@corymbia/data`; `mediaFileName`, `createExpoMediaStore` from `@corymbia/media`; the database and device from `apps/fieldkit/src/db`.
- Produces:
  ```ts
  export function useAttachMedia(): {
    attachPhoto(input: { recordId: string; sourceUri: string }): Promise<void>
    attachVoice(input: { recordId: string; sourceUri: string; durationMs: number }): Promise<void>
  }
  ```

**The ordering rule, and why it is this way round.** A row without its file is a broken record:
the strip shows a tile, the tile shows nothing, and export produces a manifest entry pointing
at a missing file. A file without its row is garbage: invisible, harmless, and cleanable by a
purge. So:

1. mint the media id
2. derive the filename
3. write the bytes
4. insert the row
5. **if the insert throws, remove the file** — and if the removal also throws, let the
   original error win, because the insert failure is the one she needs to hear about

A crash between 3 and 4 leaves an orphan file. That is the failure this ordering *chooses*,
and it is the cheap one.

The fix stamped on the `media_added` event comes from the ambient cache (§8.1: every event
carries where it happened). Do not read a live position here — attaching a photo must never
wait on the GPS.

- [ ] **Step 1: Write the failing tests**

```ts
it('writes the file before the row', async () => {
  await attachPhoto({ recordId: 'rec_a', sourceUri: 'file:///tmp/shot.jpg' })
  expect(save.mock.invocationCallOrder[0]).toBeLessThan(attachMediaSpy.mock.invocationCallOrder[0] as number)
})

it('names the file after the media id it inserts', async () => {
  // The row and the bytes must agree. If these two ever diverge, the strip
  // renders a tile whose image is another record's photo.
  await attachPhoto({ recordId: 'rec_a', sourceUri: 'file:///tmp/shot.jpg' })
  const [fileName] = save.mock.calls[0] as [string, string]
  const inserted = attachMediaSpy.mock.calls[0]?.[1]
  expect(fileName).toBe(`${inserted.mediaId}.jpg`)
  expect(inserted.fileName).toBe(fileName)
})

it('stores the byte size the store measured, not one it was told', async () => {
  save.mockResolvedValue({ uri: 'file:///media/med_a.jpg', byteSize: 91234 })
  await attachPhoto({ recordId: 'rec_a', sourceUri: 'file:///tmp/shot.jpg' })
  expect(attachMediaSpy.mock.calls[0]?.[1].byteSize).toBe(91234)
})

it('removes the file when the row is refused', async () => {
  attachMediaSpy.mockRejectedValue(new Error('constraint failed'))
  await expect(attachPhoto({ recordId: 'rec_a', sourceUri: 'file:///tmp/shot.jpg' })).rejects.toThrow()
  expect(remove).toHaveBeenCalledWith(expect.stringMatching(/\.jpg$/))
})

it('reports the row failure even when the rollback also fails', async () => {
  // The rollback failing is a leaked file. The insert failing is a photo she
  // thinks she took. She needs to hear about the second one.
  attachMediaSpy.mockRejectedValue(new Error('constraint failed'))
  remove.mockRejectedValue(new Error('read-only filesystem'))
  await expect(attachPhoto({ recordId: 'rec_a', sourceUri: 'file:///tmp/shot.jpg' }))
    .rejects.toThrow(/constraint failed/)
})

it('does not remove the file when the row succeeded', async () => {
  await attachPhoto({ recordId: 'rec_a', sourceUri: 'file:///tmp/shot.jpg' })
  expect(remove).not.toHaveBeenCalled()
})

it('gives a voice note the m4a name and its duration', async () => {
  await attachVoice({ recordId: 'rec_a', sourceUri: 'file:///tmp/n.m4a', durationMs: 8200 })
  expect(save.mock.calls[0]?.[0]).toMatch(/\.m4a$/)
  expect(attachMediaSpy.mock.calls[0]?.[1].durationMs).toBe(8200)
})

it('sends no duration at all for a photo', async () => {
  // The database refuses a photo carrying one (media_duration_matches_kind).
  // Sending 0 instead of null would fail at the constraint, mid-capture.
  await attachPhoto({ recordId: 'rec_a', sourceUri: 'file:///tmp/shot.jpg' })
  expect(attachMediaSpy.mock.calls[0]?.[1].durationMs).toBeNull()
})

it('stamps the event with an ambient fix and never waits for one', async () => {
  await attachPhoto({ recordId: 'rec_a', sourceUri: 'file:///tmp/shot.jpg' })
  expect(attachMediaSpy.mock.calls[0]?.[1].fix.quality).toBe('ambient')
  expect(refreshAmbient).not.toHaveBeenCalled()
})

it('stamps no position when the cache has none, rather than inventing one', async () => {
  readAmbient.mockReturnValue(null)
  await attachPhoto({ recordId: 'rec_a', sourceUri: 'file:///tmp/shot.jpg' })
  expect(attachMediaSpy.mock.calls[0]?.[1].fix).toEqual({ quality: 'none' })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/fieldkit && npx jest src/media/__tests__/useAttachMedia.test.ts`
Expected: FAIL — `Cannot find module '../useAttachMedia'`.

- [ ] **Step 3: Implement**

`apps/fieldkit/src/media/store.ts` holds a single module-level `createExpoMediaStore()` so the
whole app shares one, the way the database provider does. `useAttachMedia` reads the database
and device from context and performs the five steps above.

Converting an `AmbientFix` into a `Fix` of quality `'ambient'` is a small mapping — check
`Fix`'s ambient arm in `packages/data/src/repositories/records.ts` for the exact fields it
requires, including the `AltitudeEvidence` pairing rule, and map every one. A missing field
here fails at a CHECK constraint on a field device, which is the worst place to find it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/fieldkit && npx jest src/media/__tests__/useAttachMedia.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Prove the rollback can fail**

Delete the `remove` call in the catch, re-run, and confirm `removes the file when the row is
refused` fails. Restore. Then swap the order so the row is inserted before the file is
written, re-run, and confirm `writes the file before the row` fails. Restore. Quote all
outputs.

- [ ] **Step 6: Commit**

```bash
git add apps/fieldkit/src/media
git commit
```

---

### Task 11: Wire it into the capture screen, and retire the local affordance tile

**Files:**
- Modify: `apps/fieldkit/app/capture.tsx`
- Test: `apps/fieldkit/app/__tests__/capture.test.tsx`

**Interfaces:**
- Consumes: `InputAffordanceRow` (Task 6), `useAttachMedia` (Task 10), `listMedia`, `renameRecord`.
- Produces: no new exports.

Three changes, all of them things Plan 3 wrote down as owed:

1. **Delete `AffordanceTile`, `AFFORDANCE_FACE`, `RECORDED_AFFORDANCES`, `RecordedAffordanceKind`
   and `offeredHere`**, and render `InputAffordanceRow` instead. Its own comment is the
   instruction: it exists only because there was no media table, and Plan 4 attaches here.
   Delete the comment with the component — do not leave a note about a component that is gone.
2. **Drop the location tile.** Spec §9.6: location is not an affordance on this screen,
   because it is what this screen just did. The fix is already shown by the `ContextStamp` and
   the accuracy readout. A chip that does nothing in a row that teaches tappability is the
   thing being removed, not the reassurance — check the recorded state still says what was
   stored, and if it does not, that is a separate finding to report rather than a reason to
   keep the tile.
3. **Offer notes.** §9.6 lists four: title, notes, voice, photo. `renameRecord` already
   accepts `description`, so this is a text input beside the title's, not new plumbing.
   Without it, `unavailable` would have to survive for one affordance and Task 6's simplification
   would be wasted.

- [ ] **Step 1: Write the failing tests**

```tsx
it('offers all four inputs on a recorded capture', async () => {
  await renderRecorded()
  for (const kind of ['title', 'description', 'voice', 'photo']) {
    expect(screen.getByTestId(`affordance-${kind}`)).toBeTruthy()
  }
})

it('does not offer location, because the capture just took one', async () => {
  await renderRecorded()
  expect(screen.queryByTestId('affordance-location')).toBeNull()
})

it('still says what position was stored', async () => {
  // Removing the location tile must not remove the reassurance it carried.
  await renderRecorded({ accuracyM: 2.4 })
  expect(screen.getByTestId('capture-recorded-accuracy')).toHaveTextContent('2.4')
})

it('opens the camera for the record that was just captured', async () => {
  await renderRecorded()
  await fireEvent.press(screen.getByTestId('affordance-photo'))
  expect(routerPush).toHaveBeenCalledWith(expect.objectContaining({
    pathname: '/camera',
    params: { recordId: 'rec_a' },
  }))
})

it('opens the voice recorder for the record that was just captured', async () => {
  await renderRecorded()
  await fireEvent.press(screen.getByTestId('affordance-voice'))
  expect(routerPush).toHaveBeenCalledWith(expect.objectContaining({
    pathname: '/voice',
    params: { recordId: 'rec_a' },
  }))
})

it('shows how many photos are attached', async () => {
  listMedia.mockResolvedValue([photoRow('med_a'), photoRow('med_b')])
  await renderRecorded()
  expect(screen.getByTestId('affordance-photo-label')).toHaveTextContent('2')
})

it('saves notes against the record', async () => {
  await renderRecorded()
  await fireEvent.press(screen.getByTestId('affordance-description'))
  await fireEvent.changeText(screen.getByTestId('capture-description-input'), 'Wet gully, ferns')
  await fireEvent.press(screen.getByTestId('capture-description-save'))
  expect(renameRecord).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    recordId: 'rec_a',
    description: 'Wet gully, ferns',
  }))
})

it('shows the attachments on the record', async () => {
  listMedia.mockResolvedValue([photoRow('med_a')])
  await renderRecorded()
  expect(screen.getByTestId('media-tile-med_a')).toBeTruthy()
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/fieldkit && npx jest app/__tests__/capture.test.tsx`
Expected: FAIL on the new tests; the location test fails because the tile is still rendered.

- [ ] **Step 3: Implement**

Delete the five local symbols, render `InputAffordanceRow` with `completed`, `counts` and
`busy` derived from the record and the media list, and push to `/camera` and `/voice` on the
matching kinds. Render `MediaStrip` beneath it from `listMedia`. Add the notes input beside
the title's, following whatever pattern the title affordance already uses on this screen
rather than inventing a second one.

Existing tests naming `affordance-location` must be deleted, not adjusted — the tile is gone.
Any other existing test that fails is a finding: report it before changing it.

- [ ] **Step 4: Run the whole app suite**

Run: `cd apps/fieldkit && npx jest`
Expected: PASS, every suite.

- [ ] **Step 5: Prove the count is real**

Hardcode the photo count to 1, re-run, confirm `shows how many photos are attached` fails.
Restore. Quote both outputs.

- [ ] **Step 6: Commit**

```bash
git add apps/fieldkit/app/capture.tsx apps/fieldkit/app/__tests__/capture.test.tsx
git commit
```

---

### Task 12: Playing a voice note back, and removing an attachment

**Files:**
- Modify: `apps/fieldkit/app/capture.tsx`
- Test: `apps/fieldkit/app/__tests__/capture.test.tsx`

**Interfaces:**
- Consumes: `useAudioPlayer` from `expo-audio`; `softDeleteMedia` from `@corymbia/data`; `MediaStrip`'s `onPress` / `onRemove`.
- Produces: no new exports.

Check the SDK 57 playback API in the docs before writing — `useAudioPlayer(source)` with
`player.play()` / `player.pause()` is the current shape, but confirm it and say in your report
where the docs state it.

**Playback is logged.** `'played'` is already one of migration 003's permitted event actions —
it was put there for exactly this, and §8.5's log is chain of custody, of which who listened to
a field note and when is a part. Log it only once the player has actually started: an event
saying a note was played, written when the decoder threw, is a false entry in an append-only
log that nothing can remove.

Removal is **soft**: `softDeleteMedia` flags the row, the file stays until a purge. The strip
must stop showing it immediately.

- [ ] **Step 1: Write the failing tests**

```tsx
it('plays a voice note when its tile is pressed', async () => {
  listMedia.mockResolvedValue([voiceRow('med_b', 8200)])
  await renderRecorded()
  await fireEvent.press(screen.getByTestId('media-tile-med_b'))
  expect(play).toHaveBeenCalled()
})

it('logs that a voice note was played', async () => {
  // `played` is already a valid event action in migration 003's CHECK — it was
  // put there for this. The event log is chain of custody (spec §8.5), and who
  // listened to a field note and when is part of it. Adding the action later
  // would mean rebuilding the event table, which its own append-only triggers
  // forbid; using the one that exists costs nothing.
  listMedia.mockResolvedValue([voiceRow('med_b', 8200)])
  await renderRecorded()
  await fireEvent.press(screen.getByTestId('media-tile-med_b'))
  expect(appendEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    action: 'played',
    recordId: 'rec_a',
  }))
})

it('does not log a play that never started', async () => {
  play.mockImplementation(() => { throw new Error('decoder failed') })
  listMedia.mockResolvedValue([voiceRow('med_b', 8200)])
  await renderRecorded()
  await fireEvent.press(screen.getByTestId('media-tile-med_b'))
  expect(appendEvent).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    action: 'played',
  }))
})

it('confirms before removing an attachment', async () => {
  // Doctrine rule 4: warn, never block. But a photo removed by a mis-tap on a
  // strip of thumbnails is gone from her view with no undo on this screen.
  listMedia.mockResolvedValue([photoRow('med_a')])
  await renderRecorded()
  await fireEvent.press(screen.getByTestId('media-remove-med_a'))
  expect(softDeleteMedia).not.toHaveBeenCalled()
  expect(screen.getByTestId('media-remove-confirm')).toBeTruthy()
})

it('removes it once confirmed', async () => {
  listMedia.mockResolvedValue([photoRow('med_a')])
  await renderRecorded()
  await fireEvent.press(screen.getByTestId('media-remove-med_a'))
  await fireEvent.press(screen.getByTestId('media-remove-confirm'))
  expect(softDeleteMedia).toHaveBeenCalledWith(expect.anything(), 'med_a', expect.anything(), expect.anything())
})

it('stops showing a removed attachment', async () => {
  listMedia.mockResolvedValue([photoRow('med_a')])
  await renderRecorded()
  await fireEvent.press(screen.getByTestId('media-remove-med_a'))
  await fireEvent.press(screen.getByTestId('media-remove-confirm'))
  expect(screen.queryByTestId('media-tile-med_a')).toBeNull()
})

it('keeps the attachment when the removal is declined', async () => {
  listMedia.mockResolvedValue([photoRow('med_a')])
  await renderRecorded()
  await fireEvent.press(screen.getByTestId('media-remove-med_a'))
  await fireEvent.press(screen.getByTestId('media-remove-cancel'))
  expect(softDeleteMedia).not.toHaveBeenCalled()
  expect(screen.getByTestId('media-tile-med_a')).toBeTruthy()
})

it('says so and keeps the tile when the removal fails', async () => {
  listMedia.mockResolvedValue([photoRow('med_a')])
  softDeleteMedia.mockRejectedValue(new Error('database locked'))
  await renderRecorded()
  await fireEvent.press(screen.getByTestId('media-remove-med_a'))
  await fireEvent.press(screen.getByTestId('media-remove-confirm'))
  expect(screen.getByTestId('media-tile-med_a')).toBeTruthy()
  expect(screen.getByTestId('media-remove-error')).toBeTruthy()
})
```

The last test matters: an optimistic removal that hides the tile and then fails leaves her
believing a photo is gone when it is still attached, and the export will disagree with her.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/fieldkit && npx jest app/__tests__/capture.test.tsx -t "remov"`
Expected: FAIL — no remove control on the strip.

- [ ] **Step 3: Implement**

Pass `onPress` and `onRemove` to `MediaStrip`. `onPress` on a voice tile plays it; on a photo
tile it does nothing yet — a full-screen viewer belongs with the browsing views in Plan 5, so
either give the photo tile no press handler or open nothing, and say which you chose and why.
`onRemove` opens an inline confirmation on the screen, not an `Alert`, for the same reason the
camera screen's error is inline.

Refresh the list from `listMedia` after a successful removal rather than mutating local state,
so what is shown is what the database holds.

- [ ] **Step 4: Run the whole app suite**

Run: `cd apps/fieldkit && npx jest`
Expected: PASS.

- [ ] **Step 5: Prove the failure path can fail**

Remove the tile optimistically before awaiting `softDeleteMedia`, re-run, and confirm
`says so and keeps the tile when the removal fails` fails. Restore. Quote both outputs.

- [ ] **Step 6: Commit**

```bash
git add apps/fieldkit/app/capture.tsx apps/fieldkit/app/__tests__/capture.test.tsx
git commit
```

---

### Task 13: The gallery, the docs, and the hardware checklist

**Files:**
- Modify: `apps/fieldkit/src/gallery/sections.tsx`
- Modify: `docs/ui-doctrine.md`
- Modify: `docs/superpowers/specs/2026-09-05-corymbia-field-kit-design.md`
- Create: `docs/media-storage.md`

**Interfaces:** none.

- [ ] **Step 1: Add the new components to the gallery**

`MediaStrip` in its states — empty (renders nothing, so say so in the section's prose rather
than showing a blank), photos only, a voice note with a length, mixed, and with removal
offered. `InputAffordanceRow` with counts and a busy tile. Read the existing sections first
and match how they are written.

- [ ] **Step 2: Write `docs/media-storage.md`**

The thing a future reader most needs and cannot derive from the code:

- Why files are named by media id — the three rejected alternatives from §12.1 and what
  breaks with each. This is the third time the same failure has been designed out of this
  section; write it down so it is the last.
- The file-then-row ordering and which failure it deliberately chooses.
- That deletion is soft, the file survives until a purge, and therefore that a filename must
  never be reused — which is why `idx_media_file_name` covers deleted rows and
  `idx_media_record_ordinal` does not.
- That `Paths.document` is required and `Paths.cache` would lose a field day's photos with no
  error at all.

- [ ] **Step 3: Update the doctrine and the spec**

`docs/ui-doctrine.md`: add the rule this plan settled — an affordance row shows a count where
a kind can repeat, and a busy affordance is disabled rather than silently inert. Say how it is
enforced (component-level, with tests, not lint).

Spec §9.6: it currently describes the affordances as a design. Correct anything the build
proved wrong. Spec §12.1 and §9.6.2 were updated in Tasks 5 and earlier — check they still
match the code rather than assuming.

- [ ] **Step 4: Write the hardware checklist into the plan's report**

Not runnable in Jest, and every item here is something a test cannot see. To be run on the S25
by the owner, in this order:

1. Take a photo on a record. Confirm the count on the tile goes to 1 and the thumbnail appears.
2. Take three more. Confirm the strip scrolls rather than shrinking the tiles.
3. Record a voice note. Confirm the elapsed time moves while recording — a frozen timer means
   the recorder never started.
4. Play it back. Confirm it is the note just recorded, not a previous one.
5. Remove a photo. Confirm it disappears and the others keep their order.
6. Force-quit the app and reopen the record. Confirm every attachment is still there — this is
   the one that proves files landed in `Paths.document` and not somewhere transient.
7. Deny the camera permission, then reopen the camera screen. Confirm it explains where to
   turn it back on rather than showing a dead viewfinder.
8. Turn the device sideways on the camera screen. Confirm the shutter is still reachable
   (issue #7 covers the capture screen's landscape layout; note anything the camera screen
   shares with it).

`app.json` gained two permission entries in this plan. **Remind the owner in your report that
`npx expo prebuild --platform android` must run before the build**, or neither permission
reaches the manifest and both screens fail at runtime with no useful message.

- [ ] **Step 5: Verify and commit**

Run: `pnpm turbo run test lint typecheck --force` and `pnpm run lint:verify-rules`.

```bash
git add apps/fieldkit/src/gallery/sections.tsx docs/ui-doctrine.md docs/media-storage.md docs/superpowers/specs/2026-09-05-corymbia-field-kit-design.md
git commit
```

---

## Notes for the executing controller

- **Tasks 1–5 are independent of 6–13** and touch different packages. They still run in order
  — 10 consumes 1, 2 and 4 — but a reviewer can gate them separately.
- **Task 5 has no user-visible effect in this plan.** It exists so Plan 5's media-first entry
  points cannot silently blur a fix class. Do not let a reviewer cut it as unused.
- **The one place this plan can quietly go wrong** is Task 2's move-and-rename. The docs'
  example moves a file into a directory keeping its source name, and this plan needs it under a
  new one. The implementer is told to read the SDK 57 docs and report which API they used. If
  that report does not name a doc section, send it back.
