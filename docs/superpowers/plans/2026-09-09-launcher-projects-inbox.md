# Launcher, Projects and the Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a capture tool into something she can work with across a day — open the app and it already knows where she is, capture into a real activity, and find what she recorded afterwards.

**Architecture:** A `currentContext` repository in `@corymbia/data` remembers the selected activity (the `setting` table is a generic key/value store, but `Settings` is a closed vocabulary and a free-form id does not belong in it). The launcher reads that context and resumes it; project, activity and record screens are ordinary expo-router routes; the Inbox files unfiled records using the two-number model already built in `records.ts`.

**Tech Stack:** Expo SDK 57, expo-router (a `Stack`), React Native 0.86.3, TypeScript ~6 strict, `@corymbia/data` + `@corymbia/ui`, better-sqlite3 for Node tests, jest-expo + @testing-library/react-native.

## What already exists, and what does not

Read before starting — several things this plan needs are **already built** and must not be rewritten:

- `createProject`, `getProject`, `listProjects` (`repositories/projects.ts`), with `DEFAULT_CLIENT_ID` and `DEFAULT_LOCATION_ID` for spec §7.3's "name only" creation.
- `createActivity`, `listActivities`, `mostRecentActivity` (`repositories/activities.ts`).
- `listRecords(db, activityId)`, `listUnfiledRecords(db)`, `fileRecord`, `moveRecord`, `refileRecord` (`repositories/records.ts`) — **the whole two-number filing model, including the renumbering.** This plan builds its UI, not its logic.
- `readSettings` / `writeSetting`, and the `setting` table.

What does not exist: any way to select or remember a current activity; any launcher; any project, activity, record or Inbox screen; and — the one that matters most — **the capture screen files nothing.** `useCapture` calls `createRecord` with `activityId: null` and never sets `contextActivityId`, so every capture made so far has gone to the Inbox with no record of where she was.

## Global Constraints

- Components consume semantic tokens from `@corymbia/tokens` only — never raw hex, never the raw ramp. Lint-enforced, including in tests.
- Only `packages/ui/src/layout/useLayout.ts` reads window dimensions. Everything else branches on `sizeClass` or `deviceClass`.
- A tool under `apps/fieldkit/src/tools/` may import from packages and from itself, never from a sibling tool.
- Every adapter that opens the database sets `PRAGMA recursive_triggers = ON` and `PRAGMA foreign_keys = ON`.
- TypeScript strict with `noUncheckedIndexedAccess`. No `as` casts to silence a type, no non-null assertions.
- `toHaveTextContent` defaults to **`exact = true`** in the installed RNTL v14.0.1 — settled from source. A `.not.` form without `{ exact: false }` is vacuous; a positive one without it is strict, which is usually right.
- Use `jest.fn<typeof f>()` for any mock whose payload is asserted. An untyped mock makes a wrong field a runtime `undefined` rather than a compile error.
- RNTL v14 is async throughout: `render`, `fireEvent.*` and `unmount` all return promises.
- Never `git add -A` or `git add .` — unrelated pre-existing deletions under `.agents/skills/tauri/` must stay out of every commit.
- Do not run `pnpm run format` repo-wide, and do not run any `expo` command from the repository root.
- Every commit message ends with exactly this line and nothing after it:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  ```
- Do not run `npx expo run:android` or `expo prebuild` — the owner builds and installs.

## Doctrine this plan is checked against

`docs/ui-doctrine.md` is the authority; these are the rules most at risk here.

- **Rule 16:** every screen carries a `spokenDescription`, accurate to its state. Several screens in this plan have empty states — the description must say which.
- **Rule 9:** state carried by two channels, never colour alone. Used outdoors, in glare.
- **Rule 6:** plain language. No "purge", no "sync", no "record ID" shown to her.
- **Rule 3:** no control that looks pressable and does nothing. An unbuilt destination must not have a live-looking tile.
- **Rule 5:** one visual signature per input kind, used identically everywhere.
- Field controls take their size from the token scale; never a bare number.

## A note on visual design

**The owner has said the current layouts are poor and a design pass is coming**, covering these screens plus the capture screen's recorded state (issue #11). Build these plainly and correctly. Do not invest in visual flourish — it will be discarded. Composition, spacing and hierarchy are that pass's job; this plan's job is that the screens exist, are honest about their state, and work.

## File structure

| File | Responsibility |
| --- | --- |
| `packages/data/src/repositories/context.ts` | Remember and resolve the current activity. |
| `apps/fieldkit/app/index.tsx` | The launcher (replaces the component gallery). |
| `apps/fieldkit/app/gallery.tsx` | The component gallery, moved off `/`. |
| `apps/fieldkit/app/projects.tsx` | Project list, with **Start a new project**. |
| `apps/fieldkit/app/new-project.tsx` | Project creation — a name and nothing else required. |
| `apps/fieldkit/app/new-activity.tsx` | Activity creation within a project. |
| `apps/fieldkit/app/records.tsx` | The records in the current activity. |
| `apps/fieldkit/app/inbox.tsx` | Unfiled records, and filing them. |
| `apps/fieldkit/src/context/useCurrentContext.ts` | The launcher's view of project + activity + counts. |
| `packages/ui/src/launcher/CarryOnCard.tsx` | The **Carry on with** card. |
| `packages/ui/src/launcher/ToolTiles.tsx` | Tool tiles, ordered by activity kind. |

---

### Task 1: Remembering where she was

**Files:**
- Create: `packages/data/src/repositories/context.ts`
- Modify: `packages/data/src/index.ts`
- Test: `packages/data/src/repositories/__tests__/context.test.ts`

**Interfaces:**
- Consumes: `Database`, `nowIso`, `Activity`, `listActivities`, `mostRecentActivity`.
- Produces:
  ```ts
  export type CurrentContext = { activity: Activity; project: Project } | null
  export function setCurrentActivity(db: Database, activityId: string | null): Promise<void>
  export function readCurrentContext(db: Database): Promise<CurrentContext>
  ```

**Why this is not a `Setting`.** `Settings` is a closed vocabulary — `readSettings` drops any value not in `VOCABULARIES` for its key, which is right for a theme and wrong for an id. The `setting` table itself is a generic key/value store, so this repository uses it under the key `currentActivityId` with its own validation, and `readSettings` continues to ignore that key because it is not in `VOCABULARIES`. Say this in the module's doc comment; it is the first thing a reader will wonder.

**What `readCurrentContext` must do.** Spec §10.1: the application *resumes the last context*. So:

1. If a stored activity id exists **and** that activity is still live (not deleted, not ended), return it with its project.
2. Otherwise fall back to `mostRecentActivity()` — a fresh install, or a stored activity that has since been deleted, should still land her somewhere sensible rather than nowhere.
3. If there is no activity at all, return `null`. That is the genuine first-run state and the launcher must handle it.

**A stale stored id must not be an error.** She may delete an activity from another screen; resuming should degrade to the fallback, not throw.

- [ ] **Step 1: Write the failing tests**

```ts
describe('the current context', () => {
  it('remembers the activity she selected', async () => {
    await setCurrentActivity(db, activityB.id)
    const context = await readCurrentContext(db)
    expect(context?.activity.id).toBe(activityB.id)
  })

  it('returns the project that activity belongs to, not just the activity', async () => {
    // The launcher shows both, and a second query from the screen would be a
    // second chance to disagree with this one.
    await setCurrentActivity(db, activityB.id)
    const context = await readCurrentContext(db)
    expect(context?.project.id).toBe(projectB.id)
    expect(context?.project.name).toBe('Tambo River eDNA')
  })

  it('falls back to the most recent activity when nothing has been selected', async () => {
    const context = await readCurrentContext(db)
    expect(context?.activity.id).toBe(mostRecentlyStarted.id)
  })

  it('falls back rather than throwing when the stored activity has been deleted', async () => {
    await setCurrentActivity(db, activityB.id)
    await softDeleteActivity(db, activityB.id)
    const context = await readCurrentContext(db)
    expect(context?.activity.id).toBe(mostRecentlyStarted.id)
  })

  it('reports no context at all on a fresh install', async () => {
    // The genuine first-run state. The launcher has to render something
    // honest here, so this must be distinguishable from an error.
    const context = await readCurrentContext(emptyDb)
    expect(context).toBeNull()
  })

  it('clears the selection when given null', async () => {
    await setCurrentActivity(db, activityB.id)
    await setCurrentActivity(db, null)
    const context = await readCurrentContext(db)
    expect(context?.activity.id).toBe(mostRecentlyStarted.id)
  })

  it('refuses an activity that does not exist, rather than storing it', async () => {
    // Storing an unknown id would look fine until the next launch, when the
    // fallback would silently take over and she would wonder why her
    // selection did not stick.
    await expect(setCurrentActivity(db, 'act_nope')).rejects.toThrow(/does not exist/i)
  })
})
```

Write the fixtures out in full in the test file. `softDeleteActivity` may not exist — if it does not, delete the row's `deleted_at` directly with `db.execute` and say so in a comment rather than adding a repository function this plan does not need.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/data && npx jest src/repositories/__tests__/context.test.ts`
Expected: FAIL — `Cannot find module '../context'`.

- [ ] **Step 3: Implement**

Follow `repositories/settings.ts` for the upsert shape and `repositories/records.ts` for how existence is checked and how errors are worded — a message says what rule is being protected, not merely that something failed.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/data && npx jest src/repositories/__tests__/context.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Prove the fallback can fail**

Delete the live-activity check so a stored id is returned unconditionally, re-run, and confirm `falls back rather than throwing when the stored activity has been deleted` fails. Restore. Quote both outputs verbatim, each beside the command that produced it.

- [ ] **Step 6: Export and commit**

Export `setCurrentActivity`, `readCurrentContext` and the `CurrentContext` type from `packages/data/src/index.ts`. Run `pnpm turbo run test lint typecheck --force`.

```bash
git add packages/data/src/repositories/context.ts packages/data/src/repositories/__tests__/context.test.ts packages/data/src/index.ts
git commit
```

---

### Task 2: Captures land in the activity she is in

**Files:**
- Modify: `apps/fieldkit/src/capture/useCapture.ts`
- Test: `apps/fieldkit/src/capture/__tests__/useCapture.test.ts`

**Interfaces:**
- Consumes: `readCurrentContext` (Task 1), `createRecord`.
- Produces: `useCapture` accepts the current activity and passes it to `createRecord`.

**This is the task that makes the rest matter.** Today `useCapture` calls `createRecord` with `activityId: null` and never sets `contextActivityId`, so **every capture goes to the Inbox** and nothing records where she was. Spec §8.3 is explicit that these are two different links:

- **Context activity** — where she *was*. Captured automatically, always.
- **Filed activity** — what it is filed *to*. A deliberate decision, initially empty.

So a capture made while an activity is running is filed into it **and** stamped with it as context. A capture made with no activity is filed nowhere and stamped with nothing — that is the Inbox, and spec §10.2 calls it a supported destination, not an error.

**Do not change the capture flow's timing, its state machine, or the fix handling.** This adds a destination; it changes nothing about how a fix is taken.

- [ ] **Step 1: Write the failing tests**

```ts
it('files a capture into the activity that is running', async () => {
  const { result } = renderHook(() => useCapture({ db, device, source, activityId: 'act_survey' }))
  await act(async () => { await result.current.capture() })
  expect(createRecordSpy.mock.calls[0]?.[1]).toEqual(
    expect.objectContaining({ activityId: 'act_survey', contextActivityId: 'act_survey' }),
  )
})

it('leaves a capture unfiled when no activity is running', async () => {
  // Spec §10.2: the Inbox is a supported destination, not an error state.
  const { result } = renderHook(() => useCapture({ db, device, source, activityId: null }))
  await act(async () => { await result.current.capture() })
  expect(createRecordSpy.mock.calls[0]?.[1]).toEqual(
    expect.objectContaining({ activityId: null, contextActivityId: null }),
  )
})

it('files into a second activity when the context has changed', async () => {
  // One example value would let a hardcoded id pass.
  const { result } = renderHook(() => useCapture({ db, device, source, activityId: 'act_sampling' }))
  await act(async () => { await result.current.capture() })
  expect(createRecordSpy.mock.calls[0]?.[1].activityId).toBe('act_sampling')
})
```

Every existing `useCapture` test must still pass. If one needs editing, stop and report it.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/fieldkit && npx jest src/capture/__tests__/useCapture.test.ts`
Expected: FAIL — `activityId` is `null` where `'act_survey'` was expected.

- [ ] **Step 3: Implement**

Thread the activity id through `useCapture`'s options into `createRecord`. Both `activityId` and `contextActivityId` take the same value, and the doc comment must say why they are nevertheless two fields (spec §8.3) — otherwise the next reader will "simplify" one away.

- [ ] **Step 4: Run the suite**

Run: `cd apps/fieldkit && npx jest`
Expected: PASS.

- [ ] **Step 5: Prove it**

Hardcode `activityId: null` in the `createRecord` call, re-run, and confirm the first and third tests fail. Restore. Quote both outputs verbatim beside their commands.

- [ ] **Step 6: Commit**

```bash
git add apps/fieldkit/src/capture/useCapture.ts apps/fieldkit/src/capture/__tests__/useCapture.test.ts
git commit
```

---

### Task 3: The Carry on with card

**Files:**
- Create: `packages/ui/src/launcher/CarryOnCard.tsx`, `packages/ui/src/launcher/index.ts`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/launcher/__tests__/CarryOnCard.test.tsx`

**Interfaces:**
- Consumes: `Card`, `Type`, `Button`, `ProjectName`, `useTheme`, tokens.
- Produces:
  ```tsx
  export type CarryOn = {
    projectName: string
    activityName: string
    activityKind: 'survey' | 'sampling' | 'collection' | 'workshop' | 'meeting'
    startedAt: string
    captureCount: number
    clientName: string
  }
  export function CarryOnCard(props: {
    carryOn: CarryOn | null
    onCapture: () => void
    onSwitchProject: () => void
    onNewActivity: () => void
    testID?: string
  }): React.JSX.Element
  ```

Spec §10.1: the card shows **project, activity, when it started, capture count, and client**, with `CAPTURE` inside it and `Switch project` / `New activity` beneath. Presentational only — it is handed strings and hands back presses.

**The null case is the first run**, and it is not an error. With no context there is nothing to carry on with, so the card says so plainly and offers the way forward — a project — rather than a disabled `CAPTURE` that would be a control which looks pressable and does nothing (doctrine rule 3).

**`startedAt` is an ISO string and must be rendered as elapsed time**, not a timestamp: "started 40 minutes ago" is what she needs mid-survey; `2026-09-09T14:03:11Z` is not. Round to whole minutes under an hour, whole hours above.

- [ ] **Step 1: Write the failing tests**

```tsx
const carryOn: CarryOn = {
  projectName: 'Tambo River eDNA',
  activityName: 'Reach 3 transect',
  activityKind: 'survey',
  startedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
  captureCount: 12,
  clientName: 'DEECA',
}

it('shows everything §10.1 asks for', async () => {
  await render(<CarryOnCard carryOn={carryOn} {...handlers} testID="carry-on" />)
  const card = screen.getByTestId('carry-on')
  expect(card).toHaveTextContent(/Tambo River eDNA/)
  expect(card).toHaveTextContent(/Reach 3 transect/)
  expect(card).toHaveTextContent(/DEECA/)
  expect(card).toHaveTextContent(/12/)
})

it('says how long ago it started, not when', async () => {
  // Mid-survey she needs elapsed time. A timestamp is arithmetic homework.
  await render(<CarryOnCard carryOn={carryOn} {...handlers} testID="carry-on" />)
  expect(screen.getByTestId('carry-on-started')).toHaveTextContent('40 minutes ago')
})

it('reads hours once it has been running that long', async () => {
  // One example value would let '40 minutes ago' be hardcoded.
  const older = { ...carryOn, startedAt: new Date(Date.now() - 3 * 3_600_000).toISOString() }
  await render(<CarryOnCard carryOn={older} {...handlers} testID="carry-on" />)
  expect(screen.getByTestId('carry-on-started')).toHaveTextContent('3 hours ago')
})

it('counts one capture in the singular', async () => {
  const one = { ...carryOn, captureCount: 1 }
  await render(<CarryOnCard carryOn={one} {...handlers} testID="carry-on" />)
  expect(screen.getByTestId('carry-on-captures')).toHaveTextContent('1 capture')
})

it('offers CAPTURE from inside the card', async () => {
  const onCapture = jest.fn()
  await render(<CarryOnCard carryOn={carryOn} {...handlers} onCapture={onCapture} testID="carry-on" />)
  await fireEvent.press(screen.getByTestId('carry-on-capture'))
  expect(onCapture).toHaveBeenCalled()
})

it('offers switching project and starting an activity beneath it', async () => {
  const onSwitchProject = jest.fn()
  const onNewActivity = jest.fn()
  await render(
    <CarryOnCard carryOn={carryOn} {...handlers} onSwitchProject={onSwitchProject} onNewActivity={onNewActivity} testID="carry-on" />,
  )
  await fireEvent.press(screen.getByTestId('carry-on-switch-project'))
  await fireEvent.press(screen.getByTestId('carry-on-new-activity'))
  expect(onSwitchProject).toHaveBeenCalled()
  expect(onNewActivity).toHaveBeenCalled()
})

it('says there is nothing to carry on with on a first run, and offers a way forward', async () => {
  // Not an error, and not a disabled CAPTURE — a control that looks
  // pressable and does nothing is what doctrine rule 3 forbids.
  await render(<CarryOnCard carryOn={null} {...handlers} testID="carry-on" />)
  expect(screen.queryByTestId('carry-on-capture')).toBeNull()
  expect(screen.getByTestId('carry-on')).toHaveTextContent(/no project/i)
  expect(screen.getByTestId('carry-on-switch-project')).toBeTruthy()
})

it('gives CAPTURE a field-sized target', async () => {
  await render(<CarryOnCard carryOn={carryOn} {...handlers} testID="carry-on" />)
  const style = flatten(screen.getByTestId('carry-on-capture').props.style)
  expect(style.minHeight).toBeGreaterThanOrEqual(field.control)
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/ui && npx jest src/launcher/__tests__/CarryOnCard.test.tsx`
Expected: FAIL — `Cannot find module '../CarryOnCard'`.

- [ ] **Step 3: Implement**

`CAPTURE` uses `Button` at `size="field"`. The elapsed-time helper is local and pure; the two duration tests pin its format. Use `ProjectName` for the project so the name treatment matches everywhere else (doctrine rule 5).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/ui && npx jest src/launcher/__tests__/CarryOnCard.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Prove the null case can fail**

Render the card's normal body when `carryOn` is null, re-run, and confirm the first-run test fails. Restore. Quote both outputs beside their commands.

- [ ] **Step 6: Export and commit**

```bash
git add packages/ui/src/launcher packages/ui/src/index.ts
git commit
```

---

### Task 4: Tool tiles, ordered by what she is doing

**Files:**
- Create: `packages/ui/src/launcher/ToolTiles.tsx`
- Modify: `packages/ui/src/launcher/index.ts`
- Test: `packages/ui/src/launcher/__tests__/ToolTiles.test.tsx`

**Interfaces:**
- Consumes: `Card`, `Type`, `useTheme`, tokens.
- Produces:
  ```tsx
  export type ToolKind = 'capture' | 'records' | 'media' | 'batching'
  export function ToolTiles(props: {
    activityKind: CarryOn['activityKind'] | null
    available: ToolKind[]
    onOpen: (tool: ToolKind) => void
    testID?: string
  }): React.JSX.Element
  ```

Spec §10.1: tool tiles, **reordered by activity type** — a survey floats capture and records to the top and dims batching. Pinning and manual ordering are version 2 and are **not** in scope.

**`available` is doctrine rule 3 made explicit.** Batching and the media library do not exist yet. A tile for an unbuilt destination must not look pressable — pass only what exists, and render the rest not at all rather than disabled. Do not invent a "coming soon" state.

- [ ] **Step 1: Write the failing tests**

```tsx
it('floats capture and records for a survey', async () => {
  await render(<ToolTiles activityKind="survey" available={['capture', 'records', 'media']} onOpen={() => {}} testID="tools" />)
  const order = screen.getAllByTestId(/^tool-/).map((t) => t.props.testID)
  expect(order.slice(0, 2)).toEqual(['tool-capture', 'tool-records'])
})

it('orders differently for a different activity kind', async () => {
  // One kind would let the order be hardcoded.
  await render(<ToolTiles activityKind="sampling" available={['capture', 'records', 'media']} onOpen={() => {}} testID="tools" />)
  const order = screen.getAllByTestId(/^tool-/).map((t) => t.props.testID)
  expect(order).not.toEqual(['tool-capture', 'tool-records', 'tool-media'])
})

it('renders nothing for a tool that does not exist yet', async () => {
  // Doctrine rule 3: an unbuilt destination must not have a live-looking tile.
  await render(<ToolTiles activityKind="survey" available={['capture', 'records']} onOpen={() => {}} testID="tools" />)
  expect(screen.queryByTestId('tool-batching')).toBeNull()
})

it('opens the tool that was pressed', async () => {
  const onOpen = jest.fn()
  await render(<ToolTiles activityKind="survey" available={['capture', 'records']} onOpen={onOpen} testID="tools" />)
  await fireEvent.press(screen.getByTestId('tool-records'))
  expect(onOpen).toHaveBeenCalledWith('records')
})

it('keeps a stable order when there is no activity to order by', async () => {
  await render(<ToolTiles activityKind={null} available={['capture', 'records']} onOpen={() => {}} testID="tools" />)
  expect(screen.getAllByTestId(/^tool-/).map((t) => t.props.testID)).toEqual(['tool-capture', 'tool-records'])
})

it('gives every tile a target big enough to hit while moving', async () => {
  await render(<ToolTiles activityKind="survey" available={['capture', 'records']} onOpen={() => {}} testID="tools" />)
  const style = flatten(screen.getByTestId('tool-capture').props.style)
  expect(style.minHeight).toBeGreaterThanOrEqual(touch.comfortable)
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/ui && npx jest src/launcher/__tests__/ToolTiles.test.tsx`
Expected: FAIL — `Cannot find module '../ToolTiles'`.

- [ ] **Step 3: Implement**

A per-kind order table, filtered by `available`. "Dims batching" in the spec means it sorts last — since batching is not in `available` yet, that ordering is currently unobservable, so write the table to be right and say in a comment that the batching case is untestable until that tool exists.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/ui && npx jest src/launcher/__tests__/ToolTiles.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Prove the ordering is real**

Replace the per-kind table with a single fixed order, re-run, and confirm `orders differently for a different activity kind` fails. Restore. Quote both outputs beside their commands.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/launcher
git commit
```

---

### Task 5: The launcher

**Files:**
- Create: `apps/fieldkit/src/context/useCurrentContext.ts`
- Modify: `apps/fieldkit/app/index.tsx` (becomes the launcher)
- Create: `apps/fieldkit/app/gallery.tsx` (the component gallery, moved off `/`)
- Test: `apps/fieldkit/src/context/__tests__/useCurrentContext.test.ts`, `apps/fieldkit/app/__tests__/index.test.tsx`

**Interfaces:**
- Consumes: `readCurrentContext` (Task 1), `listRecords`, `listUnfiledRecords`, `getProject`, `CarryOnCard` (Task 3), `ToolTiles` (Task 4).
- Produces:
  ```ts
  export function useCurrentContext(): {
    carryOn: CarryOn | null
    activityId: string | null
    unfiledCount: number
    loading: boolean
    refresh: () => Promise<void>
  }
  ```

Spec §10.1: the launcher **assumes rather than asks**. It resumes the last context and shows it, with `CAPTURE` live on the launch screen. An **Inbox strip appears when unfiled items exist** — and only then.

**The gallery moves rather than being deleted.** It is how every component gets judged on a device and is the only place several of them can be seen at all. Give it a route, and reach it from the launcher only in a way that does not compete with real work — say where you put it and why.

**Use `useFocusEffect`, not a mount effect.** She returns here constantly — from a capture, from filing, from creating a project — and a launcher showing a stale capture count or a vanished Inbox strip is worse than one that is slow. `capture.tsx` already does this with a generation counter for last-response-wins; follow it.

- [ ] **Step 1: Write the failing hook tests**

```ts
it('resumes the stored context', async () => {
  const { result } = renderHook(() => useCurrentContext())
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.carryOn?.activityName).toBe('Reach 3 transect')
  expect(result.current.activityId).toBe('act_survey')
})

it('counts the captures in that activity', async () => {
  listRecords.mockResolvedValue([recordRow('rec_a'), recordRow('rec_b'), recordRow('rec_c')])
  const { result } = renderHook(() => useCurrentContext())
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.carryOn?.captureCount).toBe(3)
})

it('counts unfiled records separately from those in the activity', async () => {
  // Two different numbers from two different queries; one fixture would let
  // either be reported for both.
  listRecords.mockResolvedValue([recordRow('rec_a')])
  listUnfiledRecords.mockResolvedValue([recordRow('rec_x'), recordRow('rec_y')])
  const { result } = renderHook(() => useCurrentContext())
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.carryOn?.captureCount).toBe(1)
  expect(result.current.unfiledCount).toBe(2)
})

it('reports no context on a fresh install without failing', async () => {
  readCurrentContext.mockResolvedValue(null)
  const { result } = renderHook(() => useCurrentContext())
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.carryOn).toBeNull()
  expect(result.current.activityId).toBeNull()
})
```

- [ ] **Step 2: Write the failing screen tests**

```tsx
it('shows the card and the tools once a context is resumed', async () => {
  await renderLauncher()
  expect(screen.getByTestId('launcher-carry-on')).toBeTruthy()
  expect(screen.getByTestId('launcher-tools')).toBeTruthy()
})

it('shows the Inbox strip only when something is unfiled', async () => {
  await renderLauncher({ unfiledCount: 0 })
  expect(screen.queryByTestId('launcher-inbox')).toBeNull()
})

it('shows the Inbox strip, and how many, when there is something in it', async () => {
  await renderLauncher({ unfiledCount: 4 })
  expect(screen.getByTestId('launcher-inbox')).toHaveTextContent('4')
})

it('says one unfiled capture in the singular', async () => {
  await renderLauncher({ unfiledCount: 1 })
  expect(screen.getByTestId('launcher-inbox')).toHaveTextContent('1 unfiled capture')
})

it('goes straight to capture from the card', async () => {
  await renderLauncher()
  await fireEvent.press(screen.getByTestId('carry-on-capture'))
  expect(routerPush).toHaveBeenCalledWith('/capture')
})

it('carries a spoken description that names the state it is in', async () => {
  // Doctrine rule 16, and the empty case is the one that matters.
  await renderLauncher({ carryOn: null })
  expect(screen.getByTestId('launcher-spoken-description')).toHaveTextContent(/no project/i)
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd apps/fieldkit && npx jest src/context app/__tests__/index.test.tsx`
Expected: FAIL — module not found, and the gallery renders where the launcher is expected.

- [ ] **Step 4: Implement**

The launcher is `CarryOnCard` + `ToolTiles` + a conditional Inbox strip. `useDatabase`/`useDevice` throw before the database opens, so the screen splits into a guard and a body the way `capture.tsx` does.

- [ ] **Step 5: Run the suite**

Run: `cd apps/fieldkit && npx jest`
Expected: PASS.

- [ ] **Step 6: Prove the Inbox strip's condition**

Render the strip unconditionally, re-run, and confirm `shows the Inbox strip only when something is unfiled` fails. Restore. Quote both outputs beside their commands.

- [ ] **Step 7: Commit**

```bash
git add apps/fieldkit/src/context apps/fieldkit/app/index.tsx apps/fieldkit/app/gallery.tsx apps/fieldkit/app/__tests__/index.test.tsx
git commit
```

---

### Task 6: Projects — listing and creating

**Files:**
- Create: `apps/fieldkit/app/projects.tsx`, `apps/fieldkit/app/new-project.tsx`
- Test: `apps/fieldkit/app/__tests__/projects.test.tsx`, `apps/fieldkit/app/__tests__/new-project.test.tsx`

**Interfaces:**
- Consumes: `listProjects`, `createProject`, `listActivities`, `setCurrentActivity` (Task 1).
- Produces: routes `/projects` and `/new-project`.

Spec §10.3: projects are listed with **the most recent in-progress highlighted**, and a prominent **Start a new project**. Creation asks for **a name and nothing else**. Description, locations and client are optional *on the same screen*.

**`createProject` already defaults a skipped client and location** (`DEFAULT_CLIENT_ID`, `DEFAULT_LOCATION_ID`, spec §7.3), so "name only" is a call with one field — do not build a wizard.

**Client typeahead and location lookup are NOT in this task.** §10.3 wants them eventually and §8.4 requires location lookup to work offline; neither has a data layer yet (there is no `listClients`, no location search). Ship name, description and short label. Say in your report that the two optional fields are deferred and why — do not half-build a typeahead over a query that does not exist.

**Selecting a project must select an activity**, because the launcher's context is an activity. Choosing a project with activities selects its most recent; choosing one with none should take her to activity creation rather than leaving her in a context that cannot capture. Decide, implement it, and say which you chose.

- [ ] **Step 1: Write the failing tests**

```tsx
it('lists the projects', async () => {
  await renderProjects()
  expect(screen.getByText('Tambo River eDNA')).toBeTruthy()
  expect(screen.getByText('Snowy estuary baseline')).toBeTruthy()
})

it('marks the most recent in-progress project', async () => {
  await renderProjects()
  expect(screen.getByTestId('project-prj_tambo').props.accessibilityState.selected).toBe(true)
  expect(screen.getByTestId('project-prj_snowy').props.accessibilityState.selected).toBe(false)
})

it('says so plainly when there are no projects yet', async () => {
  listProjects.mockResolvedValue([])
  await renderProjects()
  expect(screen.getByTestId('projects-empty')).toHaveTextContent(/no projects/i)
  expect(screen.getByTestId('projects-new')).toBeTruthy()
})

it('creates a project from a name alone', async () => {
  await renderNewProject()
  await fireEvent.changeText(screen.getByTestId('new-project-name'), 'Mitchell River eDNA')
  await fireEvent.press(screen.getByTestId('new-project-save'))
  expect(createProject).toHaveBeenCalledWith(expect.anything(), { name: 'Mitchell River eDNA' })
})

it('refuses an empty name, and says what is missing', async () => {
  await renderNewProject()
  await fireEvent.press(screen.getByTestId('new-project-save'))
  expect(createProject).not.toHaveBeenCalled()
  expect(screen.getByTestId('new-project-error')).toHaveTextContent(/name/i)
})

it('keeps the optional fields optional', async () => {
  await renderNewProject()
  await fireEvent.changeText(screen.getByTestId('new-project-name'), 'Mitchell River eDNA')
  await fireEvent.changeText(screen.getByTestId('new-project-description'), 'Autumn baseline')
  await fireEvent.press(screen.getByTestId('new-project-save'))
  expect(createProject).toHaveBeenCalledWith(
    expect.anything(),
    { name: 'Mitchell River eDNA', description: 'Autumn baseline' },
  )
})

it('says so and stays put when the project cannot be saved', async () => {
  createProject.mockRejectedValue(new Error('database is locked'))
  await renderNewProject()
  await fireEvent.changeText(screen.getByTestId('new-project-name'), 'Mitchell River eDNA')
  await fireEvent.press(screen.getByTestId('new-project-save'))
  expect(screen.getByTestId('new-project-error')).toHaveTextContent(/could not be saved/i)
  expect(routerBack).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/fieldkit && npx jest app/__tests__/projects.test.tsx app/__tests__/new-project.test.tsx`
Expected: FAIL — routes do not exist.

- [ ] **Step 3: Implement**

Doctrine rule 6 on the failure message: a human sentence saying what happened and what to do, technical cause subordinate. `camera.tsx`'s `messageFor` is the shape.

- [ ] **Step 4: Run the suite**

Run: `cd apps/fieldkit && npx jest`
Expected: PASS.

- [ ] **Step 5: Prove the empty and failure paths**

Render the list unconditionally so the empty state never shows, re-run, confirm the empty test fails; restore. Then navigate back on failure, re-run, confirm the failure test fails; restore. Quote all four outputs beside their commands.

- [ ] **Step 6: Commit**

```bash
git add apps/fieldkit/app/projects.tsx apps/fieldkit/app/new-project.tsx apps/fieldkit/app/__tests__/projects.test.tsx apps/fieldkit/app/__tests__/new-project.test.tsx
git commit
```

---

### Task 7: Starting an activity

**Files:**
- Create: `apps/fieldkit/app/new-activity.tsx`
- Test: `apps/fieldkit/app/__tests__/new-activity.test.tsx`

**Interfaces:**
- Consumes: `createActivity`, `setCurrentActivity` (Task 1), `getProject`.
- Produces: route `/new-activity` taking a `projectId` param.

`createActivity` requires a `projectId`, a `kind` and a `name`. The five kinds are `survey`, `sampling`, `collection`, `workshop`, `meeting` — the union is in `repositories/activities.ts` and the screen must not restate it as literals; derive the options from the exported type's own list so a sixth kind cannot be added in one place and missed here.

**Creating an activity selects it.** She started it because she is about to work in it; making her then choose it is a tap that answers a question she has already answered.

**The kind drives the tool order on the launcher** (Task 4), so this is the screen that decides what she sees when she gets back.

- [ ] **Step 1: Write the failing tests**

```tsx
it('offers every activity kind', async () => {
  await renderNewActivity()
  for (const kind of ['survey', 'sampling', 'collection', 'workshop', 'meeting']) {
    expect(screen.getByTestId(`activity-kind-${kind}`)).toBeTruthy()
  }
})

it('creates the activity with the kind she chose', async () => {
  await renderNewActivity()
  await fireEvent.press(screen.getByTestId('activity-kind-sampling'))
  await fireEvent.changeText(screen.getByTestId('new-activity-name'), 'Pool 2 sediment')
  await fireEvent.press(screen.getByTestId('new-activity-save'))
  expect(createActivity).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ projectId: 'prj_tambo', kind: 'sampling', name: 'Pool 2 sediment' }),
  )
})

it('creates with a different kind when a different one is chosen', async () => {
  // One kind would let it be hardcoded — the same defect this project has
  // now found four times in media fixtures.
  await renderNewActivity()
  await fireEvent.press(screen.getByTestId('activity-kind-workshop'))
  await fireEvent.changeText(screen.getByTestId('new-activity-name'), 'Method training')
  await fireEvent.press(screen.getByTestId('new-activity-save'))
  expect(createActivity.mock.calls[0]?.[1].kind).toBe('workshop')
})

it('selects the activity it just created', async () => {
  await renderNewActivity()
  await fireEvent.press(screen.getByTestId('activity-kind-survey'))
  await fireEvent.changeText(screen.getByTestId('new-activity-name'), 'Reach 4 transect')
  await fireEvent.press(screen.getByTestId('new-activity-save'))
  expect(setCurrentActivity).toHaveBeenCalledWith(expect.anything(), 'act_created')
})

it('refuses an empty name and says what is missing', async () => {
  await renderNewActivity()
  await fireEvent.press(screen.getByTestId('new-activity-save'))
  expect(createActivity).not.toHaveBeenCalled()
  expect(screen.getByTestId('new-activity-error')).toHaveTextContent(/name/i)
})

it('says so and stays put when it cannot be saved', async () => {
  createActivity.mockRejectedValue(new Error('database is locked'))
  await renderNewActivity()
  await fireEvent.press(screen.getByTestId('activity-kind-survey'))
  await fireEvent.changeText(screen.getByTestId('new-activity-name'), 'Reach 4 transect')
  await fireEvent.press(screen.getByTestId('new-activity-save'))
  expect(screen.getByTestId('new-activity-error')).toBeTruthy()
  expect(setCurrentActivity).not.toHaveBeenCalled()
})
```

That last assertion matters: a failed creation must not select an activity that does not exist.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/fieldkit && npx jest app/__tests__/new-activity.test.tsx`
Expected: FAIL — the route does not exist.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the suite**

Run: `cd apps/fieldkit && npx jest`
Expected: PASS.

- [ ] **Step 5: Prove the selection is conditional**

Call `setCurrentActivity` before awaiting `createActivity`, re-run, and confirm the last test fails. Restore. Quote both outputs beside their commands.

- [ ] **Step 6: Commit**

```bash
git add apps/fieldkit/app/new-activity.tsx apps/fieldkit/app/__tests__/new-activity.test.tsx
git commit
```

---

### Task 8: The records list

**Files:**
- Create: `apps/fieldkit/app/records.tsx`
- Test: `apps/fieldkit/app/__tests__/records.test.tsx`

**Interfaces:**
- Consumes: `listRecords`, `readCurrentContext` (Task 1), `ContextStamp`.
- Produces: route `/records`.

**This is the screen the owner went looking for and could not find.** After capturing, there was nowhere in the app to see what had been recorded. It lists the records in the current activity: each one's sequence within the activity, its title if it has one, its accuracy, and when it was taken.

**Show the sequence, not the capture number.** Spec §7.2: the capture number is the stable one written on a sample tube; the sequence is the ordinal *within the activity*, which is what makes "Pin 023" mean something in the survey she is running. Both exist; this list is about the survey.

**Use `ContextStamp` for the fix.** It already renders the deliberate/ambient/none distinction correctly, and reinventing it here would be a fourth statement of a rule spec §8.2 says must never be blurred.

- [ ] **Step 1: Write the failing tests**

```tsx
it('lists the records in the activity, in order', async () => {
  listRecords.mockResolvedValue([recordRow({ id: 'rec_a', sequence: 1 }), recordRow({ id: 'rec_b', sequence: 2 })])
  await renderRecords()
  expect(screen.getAllByTestId(/^record-row-/).map((r) => r.props.testID)).toEqual([
    'record-row-rec_a', 'record-row-rec_b',
  ])
})

it('shows the sequence within the activity, not the capture number', async () => {
  // Spec §7.2: two numbers, two questions. This list answers "where in this
  // survey", and the capture number is the one written on a tube.
  listRecords.mockResolvedValue([recordRow({ id: 'rec_a', sequence: 7, captureNumber: 412 })])
  const row = await renderRecords().then(() => screen.getByTestId('record-row-rec_a'))
  expect(row).toHaveTextContent('7')
  expect(row).not.toHaveTextContent('412')
})

it('shows a record with no title without pretending it has one', async () => {
  listRecords.mockResolvedValue([recordRow({ id: 'rec_a', sequence: 1, title: null })])
  await renderRecords()
  expect(screen.getByTestId('record-row-rec_a')).toHaveTextContent(/untitled/i)
})

it('shows how good each fix was', async () => {
  listRecords.mockResolvedValue([recordRow({ id: 'rec_a', sequence: 1, accuracyM: 2.4 })])
  await renderRecords()
  expect(screen.getByTestId('record-row-rec_a')).toHaveTextContent('2.4')
})

it('says so plainly when the activity has no records yet', async () => {
  listRecords.mockResolvedValue([])
  await renderRecords()
  expect(screen.getByTestId('records-empty')).toHaveTextContent(/nothing recorded/i)
})

it('says so when there is no activity to list records for', async () => {
  // A different empty state from the one above, and conflating them would
  // tell her an activity is empty when she has not chosen one.
  readCurrentContext.mockResolvedValue(null)
  await renderRecords()
  expect(screen.getByTestId('records-no-activity')).toBeTruthy()
  expect(screen.queryByTestId('records-empty')).toBeNull()
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/fieldkit && npx jest app/__tests__/records.test.tsx`
Expected: FAIL — the route does not exist.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the suite**

Run: `cd apps/fieldkit && npx jest`
Expected: PASS.

- [ ] **Step 5: Prove the two empty states are distinct**

Render `records-empty` for both cases, re-run, and confirm `says so when there is no activity` fails. Restore. Quote both outputs beside their commands.

- [ ] **Step 6: Commit**

```bash
git add apps/fieldkit/app/records.tsx apps/fieldkit/app/__tests__/records.test.tsx
git commit
```

---

### Task 9: The Inbox

**Files:**
- Create: `apps/fieldkit/app/inbox.tsx`
- Test: `apps/fieldkit/app/__tests__/inbox.test.tsx`

**Interfaces:**
- Consumes: `listUnfiledRecords`, `fileRecord`, `listActivities`, `listProjects`, `readCurrentContext`.
- Produces: route `/inbox`.

**The Inbox is a supported destination, not an error state** (spec §10.2). The screen must not scold. It lists what is unfiled and offers to file it — nothing about it should read as a queue of mistakes.

**The filing logic is already built and must not be reimplemented.** `fileRecord(db, { recordId, activityId, deviceId, position?, fix? })` handles the two-number model: it assigns the activity, allocates a `sequence`, and — when a `position` is given — shifts everything at and after it. That renumbering was hard-won (SQLite checks a unique index per row during an UPDATE, so a naive bulk shift fails partway) and it is tested. This task calls it.

**Appending is the default and the common case.** `position` omitted appends to the end. The owner asked for insertion because misfiled or quickly-recorded things should be placeable in order later — so offer it, but do not make her answer a question she usually does not care about.

**The suggested destination is the record's context activity** — spec §8.3 says the context link is captured automatically precisely so an unfiled record still knows which activity was running. Use it to offer one-tap filing, and let her choose another.

- [ ] **Step 1: Write the failing tests**

```tsx
it('lists what is unfiled without calling it a problem', async () => {
  listUnfiledRecords.mockResolvedValue([unfiled('rec_a'), unfiled('rec_b')])
  await renderInbox()
  expect(screen.getAllByTestId(/^inbox-row-/)).toHaveLength(2)
  expect(screen.getByTestId('inbox')).not.toHaveTextContent(/error|problem|unassigned/i, { exact: false })
})

it('files a record into the activity that was running when it was taken', async () => {
  // Spec §8.3: the context link exists so an unfiled record still knows
  // where she was. That makes one tap enough for the common case.
  listUnfiledRecords.mockResolvedValue([unfiled('rec_a', { contextActivityId: 'act_survey' })])
  await renderInbox()
  await fireEvent.press(screen.getByTestId('inbox-file-rec_a'))
  expect(fileRecord).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ recordId: 'rec_a', activityId: 'act_survey' }),
  )
})

it('appends by default rather than asking where', async () => {
  listUnfiledRecords.mockResolvedValue([unfiled('rec_a', { contextActivityId: 'act_survey' })])
  await renderInbox()
  await fireEvent.press(screen.getByTestId('inbox-file-rec_a'))
  expect(fileRecord.mock.calls[0]?.[1].position).toBeUndefined()
})

it('lets her file into a different activity', async () => {
  listUnfiledRecords.mockResolvedValue([unfiled('rec_a', { contextActivityId: 'act_survey' })])
  await renderInbox()
  await fireEvent.press(screen.getByTestId('inbox-choose-rec_a'))
  await fireEvent.press(screen.getByTestId('inbox-activity-act_sampling'))
  expect(fileRecord).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ recordId: 'rec_a', activityId: 'act_sampling' }),
  )
})

it('offers a position when she wants one, and passes it through', async () => {
  listUnfiledRecords.mockResolvedValue([unfiled('rec_a', { contextActivityId: 'act_survey' })])
  await renderInbox()
  await fireEvent.press(screen.getByTestId('inbox-choose-rec_a'))
  await fireEvent.press(screen.getByTestId('inbox-activity-act_survey'))
  await fireEvent.changeText(screen.getByTestId('inbox-position'), '3')
  await fireEvent.press(screen.getByTestId('inbox-confirm'))
  expect(fileRecord.mock.calls[0]?.[1].position).toBe(3)
})

it('stops showing a record once it is filed', async () => {
  listUnfiledRecords.mockResolvedValueOnce([unfiled('rec_a')]).mockResolvedValueOnce([])
  await renderInbox()
  await fireEvent.press(screen.getByTestId('inbox-file-rec_a'))
  await waitFor(() => expect(screen.queryByTestId('inbox-row-rec_a')).toBeNull())
  expect(listUnfiledRecords).toHaveBeenCalledTimes(2)
})

it('says so and keeps the record when filing fails', async () => {
  // An optimistic removal would tell her it is filed while it is not, and
  // the records list would disagree.
  fileRecord.mockRejectedValue(new Error('database is locked'))
  listUnfiledRecords.mockResolvedValue([unfiled('rec_a', { contextActivityId: 'act_survey' })])
  await renderInbox()
  await fireEvent.press(screen.getByTestId('inbox-file-rec_a'))
  expect(screen.getByTestId('inbox-row-rec_a')).toBeTruthy()
  expect(screen.getByTestId('inbox-error')).toHaveTextContent(/could not be filed/i)
})

it('says so plainly when the Inbox is empty', async () => {
  listUnfiledRecords.mockResolvedValue([])
  await renderInbox()
  expect(screen.getByTestId('inbox-empty')).toHaveTextContent(/nothing waiting/i)
})

it('offers no one-tap filing for a record with no context activity', async () => {
  // A capture taken with no activity running has nothing to suggest, and a
  // button that guesses would file it somewhere she did not choose.
  listUnfiledRecords.mockResolvedValue([unfiled('rec_a', { contextActivityId: null })])
  await renderInbox()
  expect(screen.queryByTestId('inbox-file-rec_a')).toBeNull()
  expect(screen.getByTestId('inbox-choose-rec_a')).toBeTruthy()
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/fieldkit && npx jest app/__tests__/inbox.test.tsx`
Expected: FAIL — the route does not exist.

- [ ] **Step 3: Implement**

Refresh from `listUnfiledRecords` after a successful filing rather than mutating local state, so what is shown is what the database holds. `capture.tsx`'s generation-ticketed refresh is the pattern.

- [ ] **Step 4: Run the suite**

Run: `cd apps/fieldkit && npx jest`
Expected: PASS.

- [ ] **Step 5: Prove the failure path**

Remove the row optimistically before awaiting `fileRecord`, re-run, and confirm `says so and keeps the record when filing fails` fails. Restore. Then remove the context-activity guard so the one-tap button always renders, re-run, and confirm the last test fails. Restore. Quote all four outputs beside their commands.

- [ ] **Step 6: Commit**

```bash
git add apps/fieldkit/app/inbox.tsx apps/fieldkit/app/__tests__/inbox.test.tsx
git commit
```

---

### Task 10: The routes, the gallery, and the docs

**Files:**
- Modify: `apps/fieldkit/src/gallery/sections.tsx`
- Modify: `docs/ui-doctrine.md`
- Modify: `docs/superpowers/specs/2026-09-05-corymbia-field-kit-design.md`
- Create: `docs/launcher-hardware-checklist.md`

**No production behaviour changes.** If you find a real defect while writing the docs, report it rather than fixing it.

- [ ] **Step 1: Gallery entries**

Add `CarryOnCard` — with a context and without one — and `ToolTiles` at two activity kinds and with a tool missing. Read the existing sections and match how they are written.

- [ ] **Step 2: Doctrine**

Add the rule this plan settled: **an unbuilt destination gets no tile at all, rather than a disabled one.** That is doctrine rule 3 applied to navigation, and `ToolTiles`' `available` prop is how it is enforced. Say how it is checked (component-level, with a test, not lint).

- [ ] **Step 3: Spec**

Check §10.1, §10.2 and §10.3 against what was built. Two things are known to differ and must be recorded rather than left to be rediscovered: **client typeahead and location lookup were not built** (no `listClients`, no location search — §10.3 and §8.4 still describe them as intended), and **pinning and manual tool ordering remain version 2**.

- [ ] **Step 4: The hardware checklist**

`docs/launcher-hardware-checklist.md`, in the shape of `docs/media-hardware-checklist.md` — a thing to do, what to expect, and what a failure looks like. It must cover at least:

1. **A fresh install has no context.** Clear app data, open it: the card should say there is nothing to carry on with and offer a project, not a dead `CAPTURE`.
2. **The whole "methodical" journey**: new project → new activity → capture → records. Three taps to capture, per §10.2.
3. **A capture now lands in the activity**, not the Inbox. Capture, then open the records list: it should be there, numbered within the activity.
4. **The Inbox strip appears only when something is unfiled** — and disappears once the last one is filed.
5. **Filing with a position renumbers the rest.** File into position 2 of an activity with four records, then open the records list and check 2, 3, 4, 5 read in order with nothing repeated or missing. This is the one that exercises the renumbering, and it is the one where a wrong answer is silent.
6. **Force-quit and reopen.** The launcher must resume the same activity.
7. **The tablet.** It has still never run this app.

- [ ] **Step 5: Verify and commit**

Run `pnpm turbo run test lint typecheck --force` and `pnpm run lint:verify-rules`, and quote their output.

```bash
git add apps/fieldkit/src/gallery/sections.tsx docs/ui-doctrine.md docs/superpowers/specs/2026-09-05-corymbia-field-kit-design.md docs/launcher-hardware-checklist.md
git commit
```

---

## Notes for the executing controller

- **Task 2 is the one that changes what the app is.** Until captures reach an activity, every screen after it lists an empty set. If it slips, everything downstream tests against fixtures and nothing is proven end to end.
- **Do not let a task reimplement `fileRecord`'s renumbering.** It exists, it is tested, and the SQLite trap it works around (a unique index checked per row during an UPDATE, with no ORDER BY) is not obvious from reading the call site.
- **Four things this plan deliberately does not build**, and the reports should say so rather than leaving them ambiguous: client typeahead (§10.3 — there is no `listClients`), location lookup (§10.3 and §8.4 — there is no location search, and §8.4's offline place names have no query behind them), any tool tile for batching or a media library, and the tablet's two-pane workspace (§10.4, which is Plan 7). Each wants a data layer or a plan that does not exist yet; none should be half-built here.
- **The design pass comes after this**, covering these screens plus the capture screen's recorded state (issue #11). Reviewers should not spend findings on visual composition here; they should spend them on whether each screen is honest about its state.
