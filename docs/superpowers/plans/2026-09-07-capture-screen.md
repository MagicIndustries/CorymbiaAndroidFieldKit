# The Capture Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the capture interaction proved on the diagnostics instrument into the real field screen — a traffic-light frame that grades the fix and breathes while it refines, accuracy and seconds sized as the largest things on the screen, and a recorded point she can name.

**Architecture:** The frame becomes a shared component in `@corymbia/ui` because it is a field affordance other tools will reuse; the screen lives in `apps/fieldkit/app/capture.tsx`. Everything below the screen already exists and is measured — `holdVerdict`, `averageReadings`, `createRecord`, `refineRecordFix`, `resolveReach`. This plan builds no new engine, only the surface. Captures land in the Inbox (`activityId: null`) until Plan 5 adds project selection.

**Tech Stack:** Expo SDK ~57, React Native 0.86, TypeScript ~6 strict with `noUncheckedIndexedAccess`, `react-native-svg` 15.15.4 (already a dependency), Jest with `jest-expo` and `@testing-library/react-native`.

## Global Constraints

- Components consume semantic tokens from `@corymbia/tokens` only — never a raw hex value, never the raw ramp. Enforced by lint.
- Only `packages/ui/src/layout/useLayout.ts` reads window dimensions. Branch on `sizeClass` (layout) or `deviceClass` (ergonomics), never a raw width or height. A view's own `onLayout` is not a window dimension and is permitted.
- A tool under `apps/fieldkit/src/tools/` may import from packages and from itself, never from a sibling tool.
- TypeScript strict with `noUncheckedIndexedAccess`: no casts or non-null assertions papering over index access.
- Only the single root `eslint.config.mjs` governs lint; add no per-package config.
- Colour never carries meaning alone (doctrine rule 9). Every state the frame expresses in colour or motion is also expressed in a word.
- Nothing blocks capture (doctrine rule 4). A tap before the receiver has a lock still records, with an honest `'none'` position.
- Never `git add -A` or `git add .` — the working tree carries pre-existing deletions under `.agents/skills/tauri/` that must stay out of every commit.
- Do not run `npx expo run:android`; it never exits. The controller builds and installs.
- Do not change `holdVerdict`'s constants, `averageReadings`, or the accuracy floor. They are measured against hardware and confirmed working; §9.3 records where each number came from.

---

## File structure

| File | Responsibility |
| --- | --- |
| `packages/ui/src/capture/TrafficLightFrame.tsx` | The frame: grades the fix in colour and in a word, breathes while refining, shows countdown progress around its perimeter. Owns no capture logic. |
| `packages/ui/src/capture/CaptureFramePerimeter.tsx` | The SVG rounded-rect stroke that empties as the countdown runs down. Split out because it is the only file needing `react-native-svg` and measured layout. |
| `packages/ui/src/capture/index.ts` | Barrel. |
| `packages/data/src/repositories/records.ts` | Gains `renameRecord` — the only way a title or description reaches a saved row. |
| `apps/fieldkit/app/capture.tsx` | The screen: Ready, Acquiring, Recorded. |
| `apps/fieldkit/src/capture/useCapture.ts` | The state machine — tap, collect, refine, override, plateau — lifted out of the screen so it can be tested without rendering. |

The diagnostics screen at `apps/fieldkit/app/diagnostics.tsx` is a **working reference implementation** of this interaction. Read it before starting any task that touches capture behaviour. It stays as it is: it is the instrument, it keeps the countdown chooser and the transcript, and this plan does not modify it.

---

### Task 1: The traffic-light frame, static

**Files:**
- Create: `packages/ui/src/capture/TrafficLightFrame.tsx`, `packages/ui/src/capture/index.ts`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/capture/__tests__/TrafficLightFrame.test.tsx`

**Interfaces:**
- Consumes: `gradeAccuracy` is **not** used here — the frame is told its grade, it does not compute one. `useTheme()` from `../theme`, `field`, `radii`, `spacing` from `@corymbia/tokens`.
- Produces:
  - `type FixGradeName = 'good' | 'fair' | 'poor'`
  - `TrafficLightFrame(props: { grade: FixGradeName; refining?: boolean; secondsRemaining?: number; secondsTotal?: number; children: React.ReactNode })`

**Why the frame is told its grade rather than computing it:** `gradeAccuracy` lives in `@corymbia/geo`, and `@corymbia/ui` must not depend on the GPS package to draw a border. The screen computes the grade and passes it down.

- [ ] **Step 1: Write the failing test**

`packages/ui/src/capture/__tests__/TrafficLightFrame.test.tsx`:

```tsx
import React from 'react'
import { Text } from 'react-native'
import { render, screen } from '@testing-library/react-native'
import { darkTheme } from '@corymbia/tokens'
import { ThemeProvider } from '../../theme'
import { TrafficLightFrame } from '../TrafficLightFrame'

const renderFrame = (grade: 'good' | 'fair' | 'poor') =>
  render(
    <ThemeProvider>
      <TrafficLightFrame grade={grade}>
        <Text>contents</Text>
      </TrafficLightFrame>
    </ThemeProvider>,
  )

describe('TrafficLightFrame', () => {
  it('says the grade in a word, so colour never carries it alone', () => {
    renderFrame('good')
    expect(screen.getByText('GOOD FIX')).toBeTruthy()
  })

  it('says the other two grades too', () => {
    renderFrame('fair')
    expect(screen.getByText('FAIR FIX')).toBeTruthy()
    screen.unmount()
    renderFrame('poor')
    expect(screen.getByText('POOR FIX')).toBeTruthy()
  })

  it('renders what it encloses, because the frame is a container not a widget', () => {
    renderFrame('good')
    expect(screen.getByText('contents')).toBeTruthy()
  })

  it('borders in the status colour for the grade', () => {
    renderFrame('good')
    expect(screen.getByTestId('traffic-light-border').props.style).toEqual(
      expect.objectContaining({ borderColor: darkTheme.colors.statusGood }),
    )
  })

  it('dashes the border when the fix is poor, so the grade survives greyscale', () => {
    renderFrame('poor')
    expect(screen.getByTestId('traffic-light-border').props.style).toEqual(
      expect.objectContaining({ borderStyle: 'dashed', borderColor: darkTheme.colors.statusPoor }),
    )
    screen.unmount()
    renderFrame('good')
    expect(screen.getByTestId('traffic-light-border').props.style).toEqual(
      expect.objectContaining({ borderStyle: 'solid' }),
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @corymbia/ui test TrafficLightFrame`
Expected: FAIL — `Cannot find module '../TrafficLightFrame'`.

- [ ] **Step 3: Write `packages/ui/src/capture/TrafficLightFrame.tsx`**

```tsx
import React from 'react'
import { View } from 'react-native'
import { field, radii, spacing } from '@corymbia/tokens'
import { Type } from '../primitives'
import { useTheme } from '../theme'

export type FixGradeName = 'good' | 'fair' | 'poor'

const WORD: Record<FixGradeName, string> = {
  good: 'GOOD FIX',
  fair: 'FAIR FIX',
  poor: 'POOR FIX',
}

/**
 * The frame around the capture block (spec §9.2).
 *
 * It encloses the readout and the control together, because §9.1.2 requires
 * them to be one object within sight of the thumb pressing it. A frame around
 * the whole screen would put its perimeter as far from the button as the panel
 * this design exists to replace.
 *
 * The border is drawn on its own absolutely-positioned layer rather than on the
 * container. Task 2 breathes that layer while the fix refines, and scaling a
 * layer that holds the content would scale the text with it.
 *
 * Colour never carries the grade alone (doctrine rule 9): the word is always
 * present, and a poor fix additionally dashes the border so the grade survives
 * a greyscale screenshot or a colour-blind reader.
 */
export function TrafficLightFrame({
  grade,
  children,
}: {
  grade: FixGradeName
  children: React.ReactNode
}) {
  const { theme } = useTheme()
  const colour = {
    good: theme.colors.statusGood,
    fair: theme.colors.statusFair,
    poor: theme.colors.statusPoor,
  }[grade]

  return (
    <View>
      <View
        testID="traffic-light-border"
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderWidth: field.frame,
          borderColor: colour,
          borderStyle: grade === 'poor' ? 'dashed' : 'solid',
          borderRadius: radii.xl,
        }}
      />
      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        <Type variant="label" style={{ color: colour }}>
          {WORD[grade]}
        </Type>
        {children}
      </View>
    </View>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @corymbia/ui test TrafficLightFrame`
Expected: PASS — 5 tests.

- [ ] **Step 5: Export it**

`packages/ui/src/capture/index.ts`:

```ts
export { TrafficLightFrame } from './TrafficLightFrame'
export type { FixGradeName } from './TrafficLightFrame'
```

Add to `packages/ui/src/index.ts`:

```ts
export * from './capture'
```

- [ ] **Step 6: Prove one test is real**

Change `borderStyle: grade === 'poor' ? 'dashed' : 'solid'` to always `'solid'`. Run the suite. Confirm the dashed test fails. Restore. Quote the failure in your report.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/capture packages/ui/src/index.ts
git commit -m "feat(ui): add the traffic-light frame"
```

---

### Task 2: The frame breathes while the fix refines

**Files:**
- Modify: `packages/ui/src/capture/TrafficLightFrame.tsx`
- Test: `packages/ui/src/capture/__tests__/TrafficLightFrame.test.tsx`

**Interfaces:**
- Produces: `TrafficLightFrame` gains `refining?: boolean`.

**The constraint, which is the whole difficulty.** Spec §9.2: the whole frame breathes, *and* the fix quality stays honestly readable at every point in the cycle. A naive pulse of the border's opacity or colour makes a good fix look worse at the bottom of each cycle, which is the one thing this frame must never do. The prototype dodged it by pulsing a separate inset ring, and that is explicitly rejected.

**The approach:** animate `transform: [{ scale }]` on the border layer, from `1` to `1.012` and back. The colour never changes, so the grade is at full strength throughout; the frame itself is what moves. The border layer holds no content, so nothing else scales with it. `scale` is supported by the native driver.

- [ ] **Step 1: Write the failing tests**

Add to `packages/ui/src/capture/__tests__/TrafficLightFrame.test.tsx`:

```tsx
import { AccessibilityInfo } from 'react-native'

describe('TrafficLightFrame while refining', () => {
  afterEach(() => jest.restoreAllMocks())

  it('keeps the border at full grade colour, because a pulse must never make a good fix look worse', () => {
    render(
      <ThemeProvider>
        <TrafficLightFrame grade="good" refining>
          <Text>contents</Text>
        </TrafficLightFrame>
      </ThemeProvider>,
    )
    const style = screen.getByTestId('traffic-light-border').props.style
    expect(style).toEqual(expect.objectContaining({ borderColor: darkTheme.colors.statusGood }))
    expect(style.opacity).toBeUndefined()
  })

  it('runs no animation when the system asks for reduced motion', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true)
    render(
      <ThemeProvider>
        <TrafficLightFrame grade="good" refining>
          <Text>contents</Text>
        </TrafficLightFrame>
      </ThemeProvider>,
    )
    await screen.findByTestId('traffic-light-border')
    expect(jest.getTimerCount()).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @corymbia/ui test TrafficLightFrame`
Expected: FAIL — `refining` is not a prop yet, so the reduced-motion test finds no animation to assert about and the type-check rejects the prop.

- [ ] **Step 3: Add the pulse**

Replace the component body in `TrafficLightFrame.tsx`, keeping everything from Task 1 and adding:

```tsx
import React, { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, View } from 'react-native'

/** One full breath. Slow enough to read as "still working", never as urgency. */
const PULSE_MS = 5000
/** Deliberately small: the frame should breathe, not throb. */
const PULSE_SCALE = 1.012
```

Inside the component, before the return:

```tsx
  const [reduceMotion, setReduceMotion] = useState(false)
  const scale = useRef(new Animated.Value(1)).current

  useEffect(() => {
    let cancelled = false
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (!cancelled) setReduceMotion(on)
    })
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    return () => {
      cancelled = true
      subscription.remove()
    }
  }, [])

  useEffect(() => {
    // A steady frame is the correct rendering when motion is refused, not a
    // degraded one: the grade is in the colour and the word either way.
    if (!refining || reduceMotion) {
      scale.setValue(1)
      return
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, {
          toValue: PULSE_SCALE,
          duration: PULSE_MS / 2,
          useNativeDriver: true,
        }),
        Animated.timing(scale, { toValue: 1, duration: PULSE_MS / 2, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => {
      loop.stop()
      scale.setValue(1)
    }
  }, [refining, reduceMotion, scale])
```

Change the border layer from `View` to `Animated.View` and add `transform: [{ scale }]` to its style. Nothing else about it changes — same colour, same width, same dash.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @corymbia/ui test TrafficLightFrame`
Expected: PASS — 7 tests.

- [ ] **Step 5: Prove the reduced-motion test is real**

Delete `|| reduceMotion` from the effect's guard. Run the suite. Confirm the reduced-motion test fails on a non-zero timer count. Restore. Quote the failure.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/capture
git commit -m "feat(ui): breathe the whole frame while a fix refines"
```

**Note for the report:** the animated value cannot advance under Jest with the native driver, so these tests assert the branch and the teardown, never the motion. Say so, and list what a person must check on a device: that the frame visibly breathes at roughly one cycle per five seconds, that it reads as ongoing rather than as an alarm, that the grade stays unambiguous at every point in the cycle, and that turning on the system's reduced-motion setting mid-capture stops it immediately.

---

### Task 3: Countdown progress around the perimeter

**Files:**
- Create: `packages/ui/src/capture/CaptureFramePerimeter.tsx`
- Modify: `packages/ui/src/capture/TrafficLightFrame.tsx`, `packages/ui/src/capture/index.ts`
- Test: `packages/ui/src/capture/__tests__/CaptureFramePerimeter.test.tsx`

**Interfaces:**
- Consumes: `react-native-svg` (already a dependency of `apps/fieldkit` and `@corymbia/brand`; add it to `packages/ui`'s `peerDependencies` and `devDependencies`, never `dependencies`).
- Produces: `CaptureFramePerimeter(props: { progress: number; colour: string })` — `progress` is 0 to 1, the fraction of the wait **remaining**.

Spec §9.2: the perimeter shows the countdown, not accumulated readings. It empties as the seconds run down. Sample count is still shown, as a number, inside the frame.

- [ ] **Step 1: Write the failing test**

`packages/ui/src/capture/__tests__/CaptureFramePerimeter.test.tsx`:

```tsx
import React from 'react'
import { render, screen } from '@testing-library/react-native'
import { CaptureFramePerimeter } from '../CaptureFramePerimeter'

describe('CaptureFramePerimeter', () => {
  it('renders nothing until it has been measured, because a perimeter needs a size', () => {
    render(<CaptureFramePerimeter progress={1} colour="#fff" />)
    expect(screen.queryByTestId('perimeter-track')).toBeNull()
  })

  it('empties as the wait runs down', () => {
    render(<CaptureFramePerimeter progress={1} colour="#fff" />)
    const box = screen.getByTestId('perimeter')
    box.props.onLayout({ nativeEvent: { layout: { width: 300, height: 200 } } })

    const full = screen.getByTestId('perimeter-track').props.strokeDashoffset
    screen.rerender(<CaptureFramePerimeter progress={0.25} colour="#fff" />)
    const quarter = screen.getByTestId('perimeter-track').props.strokeDashoffset

    // Offset grows as the stroke is withdrawn, so less remaining means more offset.
    expect(quarter).toBeGreaterThan(full)
  })

  it('is fully withdrawn at zero and fully drawn at one', () => {
    render(<CaptureFramePerimeter progress={1} colour="#fff" />)
    screen
      .getByTestId('perimeter')
      .props.onLayout({ nativeEvent: { layout: { width: 300, height: 200 } } })
    expect(screen.getByTestId('perimeter-track').props.strokeDashoffset).toBeCloseTo(0, 5)

    screen.rerender(<CaptureFramePerimeter progress={0} colour="#fff" />)
    const track = screen.getByTestId('perimeter-track')
    expect(track.props.strokeDashoffset).toBeCloseTo(track.props.strokeDasharray, 5)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @corymbia/ui test CaptureFramePerimeter`
Expected: FAIL — `Cannot find module '../CaptureFramePerimeter'`.

- [ ] **Step 3: Add the dependency**

Add to `packages/ui/package.json` under both `peerDependencies` and `devDependencies`:

```json
"react-native-svg": "15.15.4"
```

Never under `dependencies` — the app provides it. Run `pnpm install` from the repo root.

- [ ] **Step 4: Write `packages/ui/src/capture/CaptureFramePerimeter.tsx`**

```tsx
import React, { useState } from 'react'
import { View, type LayoutChangeEvent } from 'react-native'
import Svg, { Rect } from 'react-native-svg'
import { field, radii } from '@corymbia/tokens'

/**
 * The countdown, drawn around the frame's perimeter (spec §9.2).
 *
 * `progress` is the fraction of the wait *remaining*, so the stroke empties as
 * the seconds run down. Under the superseded press-and-hold model the only
 * measure of progress was how many readings a hold had gathered; there is now a
 * wait with a known end, so this is the honest progress of that.
 *
 * The size comes from `onLayout` — the view's own measured box, not the
 * window — because a perimeter cannot be drawn without one.
 */
export function CaptureFramePerimeter({
  progress,
  colour,
}: {
  progress: number
  colour: string
}) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    setSize({ width, height })
  }

  return (
    <View
      testID="perimeter"
      pointerEvents="none"
      onLayout={onLayout}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
    >
      {size ? <Track size={size} progress={progress} colour={colour} /> : null}
    </View>
  )
}

function Track({
  size,
  progress,
  colour,
}: {
  size: { width: number; height: number }
  progress: number
  colour: string
}) {
  const inset = field.frame / 2
  const width = Math.max(0, size.width - field.frame)
  const height = Math.max(0, size.height - field.frame)
  // Perimeter of a rounded rectangle: the straight runs plus one full circle
  // made of the four corner arcs.
  const r = Math.min(radii.xl, width / 2, height / 2)
  const perimeter = 2 * (width - 2 * r) + 2 * (height - 2 * r) + 2 * Math.PI * r
  const remaining = Math.min(1, Math.max(0, progress))

  return (
    <Svg width={size.width} height={size.height}>
      <Rect
        testID="perimeter-track"
        x={inset}
        y={inset}
        width={width}
        height={height}
        rx={r}
        ry={r}
        fill="none"
        stroke={colour}
        strokeWidth={field.frame}
        strokeDasharray={perimeter}
        strokeDashoffset={perimeter * (1 - remaining)}
      />
    </Svg>
  )
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @corymbia/ui test CaptureFramePerimeter`
Expected: PASS — 3 tests.

- [ ] **Step 6: Wire it into the frame**

`TrafficLightFrame` gains `secondsRemaining?: number` and `secondsTotal?: number`. When both are present and `secondsTotal > 0`, render `<CaptureFramePerimeter progress={secondsRemaining / secondsTotal} colour={colour} />` as a sibling of the border layer, inside the outer `View`. When either is absent, render no perimeter — the frame is live at all times but a countdown is not.

Add a test asserting the perimeter is absent without those props and present with them.

- [ ] **Step 7: Prove the emptying direction is real**

Change `perimeter * (1 - remaining)` to `perimeter * remaining`. Run the suite. Confirm the "empties as the wait runs down" test fails. Restore. Quote the failure. This matters: a perimeter that fills as time runs out reads as progress toward something rather than time running away.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/capture packages/ui/package.json pnpm-lock.yaml
git commit -m "feat(ui): draw the countdown around the frame's perimeter"
```

---

### Task 4: Naming a recorded point

**Files:**
- Modify: `packages/data/src/repositories/records.ts`, `packages/data/src/index.ts`
- Test: `packages/data/src/repositories/__tests__/records.test.ts`

**Interfaces:**
- Produces: `renameRecord(db: Database, input: { recordId: string; title: string | null; description?: string | null; deviceId: string }): Promise<FieldRecord>`

Spec §9.6: a saved pin gets a title. `FieldRecord` has the columns; nothing writes them after creation. This is the setter, and it is the only way a title reaches a saved row.

Follow the conventions `refineRecordFix` already establishes in the same file: refuse a missing or soft-deleted record with an explanatory sentence, do the row update and the event append in one transaction, and append an `'edited'` event.

- [ ] **Step 1: Write the failing tests**

Add to `packages/data/src/repositories/__tests__/records.test.ts`, following the file's existing helpers and setup:

```ts
describe('renameRecord', () => {
  it('gives a saved record a title', async () => {
    const { db, deviceId, activityId } = await seed()
    const record = await createRecord(db, {
      activityId,
      kind: 'pin',
      fix: deliberateFix(),
      deviceId,
    })
    const renamed = await renameRecord(db, {
      recordId: record.id,
      title: 'Frog pool, north end',
      deviceId,
    })
    expect(renamed.title).toBe('Frog pool, north end')
    expect((await getRecord(db, record.id))?.title).toBe('Frog pool, north end')
  })

  it('records the change in the event log, because a title is part of the observation', async () => {
    const { db, deviceId, activityId } = await seed()
    const record = await createRecord(db, {
      activityId,
      kind: 'pin',
      fix: deliberateFix(),
      deviceId,
    })
    await renameRecord(db, { recordId: record.id, title: 'Frog pool', deviceId })
    const events = await listEvents(db, record.id)
    expect(events.some((e) => e.action === 'edited' && e.detail.includes('title'))).toBe(true)
  })

  it('accepts a null title, because clearing a name is a real edit', async () => {
    const { db, deviceId, activityId } = await seed()
    const record = await createRecord(db, {
      activityId,
      kind: 'pin',
      fix: deliberateFix(),
      deviceId,
      title: 'Wrong',
    })
    const renamed = await renameRecord(db, { recordId: record.id, title: null, deviceId })
    expect(renamed.title).toBeNull()
  })

  it('does not touch the capture number, which may be written on a sample tube', async () => {
    const { db, deviceId, activityId } = await seed()
    const record = await createRecord(db, {
      activityId,
      kind: 'pin',
      fix: deliberateFix(),
      deviceId,
    })
    const renamed = await renameRecord(db, { recordId: record.id, title: 'Named', deviceId })
    expect(renamed.captureNumber).toBe(record.captureNumber)
  })

  it('refuses a record that does not exist, with a sentence', async () => {
    const { db, deviceId } = await seed()
    await expect(
      renameRecord(db, { recordId: 'nope', title: 'x', deviceId }),
    ).rejects.toThrow(/does not exist/)
  })

  it('refuses a deleted record, because a tombstone is not editable', async () => {
    const { db, deviceId, activityId } = await seed()
    const record = await createRecord(db, {
      activityId,
      kind: 'pin',
      fix: deliberateFix(),
      deviceId,
    })
    await softDeleteRecord(db, { recordId: record.id, deviceId })
    await expect(
      renameRecord(db, { recordId: record.id, title: 'x', deviceId }),
    ).rejects.toThrow(/has been deleted/)
  })
})
```

Use whatever `seed()` / `deliberateFix()` helpers that file already defines; if their names differ, use the existing ones rather than adding new ones.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @corymbia/data test records`
Expected: FAIL — `renameRecord is not defined`.

- [ ] **Step 3: Implement `renameRecord`**

In `packages/data/src/repositories/records.ts`, next to `refineRecordFix` and following its shape exactly: read the record inside the transaction, refuse missing and deleted with the same sentence style used elsewhere in the file, `UPDATE record SET title = ?, description = ?, updated_at = ?` (leave `description` unchanged when the caller omits it, distinguishing "not supplied" from an explicit `null`), then `appendEvent` with action `'edited'` and a detail naming what changed — e.g. `title set to "Frog pool"` or `title cleared`. Return the reloaded record.

Do not name `capture_number` or `captured_at` in the UPDATE. `record_capture_number_is_immutable` would abort the transaction if you did, but the column should not appear in the statement at all.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @corymbia/data test records`
Expected: PASS.

- [ ] **Step 5: Export it**

Add `renameRecord` to the export list in `packages/data/src/index.ts`, alphabetically among the other record functions.

- [ ] **Step 6: Prove the deleted-record refusal is real**

Remove the deleted check. Run the suite. Confirm the tombstone test fails. Restore. Quote the failure.

- [ ] **Step 7: Commit**

```bash
git add packages/data/src/repositories/records.ts packages/data/src/index.ts packages/data/src/repositories/__tests__/records.test.ts
git commit -m "feat(data): let a saved record be named"
```

---

### Task 5: The capture state machine

**Files:**
- Create: `apps/fieldkit/src/capture/useCapture.ts`
- Test: `apps/fieldkit/src/capture/__tests__/useCapture.test.ts`

**Interfaces:**
- Consumes: `createRecord`, `refineRecordFix`, `type Database`, `type Device`, `type FieldRecord` from `@corymbia/data`; `averageReadings`, `holdVerdict`, `gradeAccuracy`, `type Reading`, `type LocationSource` from `@corymbia/geo`.
- Produces:
  - `type CapturePhase = 'ready' | 'acquiring' | 'recorded'`
  - `useCapture(deps: { db: Database; device: Device; source: LocationSource; capSeconds?: number }): { phase: CapturePhase; latest: Reading | null; preview: { accuracyM: number; sampleCount: number; improvedByM: number } | null; secondsRemaining: number; secondsTotal: number; verdict: 'improving' | 'plateaued'; record: FieldRecord | null; message: string | null; capture(): void; acceptNow(): void; again(): void }`

**Lift it out of the screen so it can be tested without rendering.** The diagnostics screen holds this logic inline, which is why its tests must drive a whole tree to assert a guard. Read `apps/fieldkit/app/diagnostics.tsx` for the working behaviour — the write gate, the in-flight ref claimed synchronously before any await, the countdown ticker, the plateau check, the unmount teardown — and lift it, do not reinvent it.

Behaviour this hook must have, each of which was a real defect found on the prototype:

- **A tap writes a record immediately** with the current fix (or `'none'` when there is no usable reading), then begins the countdown. The record is real on disk before the wait starts.
- **A second tap during the window before the countdown starts must not write a second record.** That window spans the awaits inside `createRecord`. Claim an in-flight flag synchronously, before any await, and release it on every exit including errors.
- **The countdown ends by timer, by override, or by plateau** — all three run the same completion path, refining exactly once.
- **A plateau cannot be claimed before `holdVerdict`'s minimum sample count**, which is what stops a capture ending at 0.6 s with a fix four times worse than waiting reaches. The hook must not reimplement that rule; it calls `holdVerdict`.
- **Nothing updates state after unmount**, and no timer outlives the hook.

- [ ] **Step 1: Write the failing tests**

`apps/fieldkit/src/capture/__tests__/useCapture.test.ts`, using `renderHook` from `@testing-library/react-native`, `createFakeLocationSource` from `@corymbia/geo`, jest fake timers, and mocked `createRecord` / `refineRecordFix`. Cover, one test each:

1. `capture()` writes exactly one record and moves the phase to `acquiring`.
2. Two `capture()` calls in the same tick write exactly one record. **Drive the real await boundary** — hold the `createRecord` mock open on a deferred promise, call `capture()` twice, then resolve — rather than asserting on internal state.
3. Running the countdown to its cap refines exactly once, and the phase becomes `recorded`.
4. `acceptNow()` refines exactly once and no later timer fires a second refinement — advance the clock a further full cap after it resolves.
5. A plateau ends the countdown before the cap. Emit enough readings to pass `holdVerdict`'s minimum, all flat.
6. **Before that minimum, flat readings do not end it** — emit fewer than the minimum, assert the phase is still `acquiring` and no refinement has happened, then emit the rest and assert it finishes. Choose a reading value whose unguarded plateau crossing is well below the minimum, or the test cannot fail: with uniform readings the crossing is invariant near the minimum by arithmetic. Verify your chosen value against `holdVerdict` before relying on it.
7. Unmounting mid-countdown leaves no pending timer and performs no state update.
8. `again()` returns the phase to `ready`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter fieldkit test useCapture`
Expected: FAIL — `Cannot find module '../useCapture'`.

- [ ] **Step 3: Implement the hook**

Lift the behaviour from `diagnostics.tsx`. Keep the diagnostics screen working and unmodified; this is a parallel implementation for the field screen, and the two converge in a later plan when the instrument adopts the hook.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter fieldkit test useCapture`
Expected: PASS — 8 tests.

- [ ] **Step 5: Prove the two guards are real**

Remove the in-flight flag from `capture()`'s condition; confirm test 2 fails with two record writes. Restore. Then set `MIN_SAMPLES` in `packages/geo/src/trend.ts` to 2; confirm test 6 fails. Restore. Quote both failures. **Restore `trend.ts` exactly** — verify with `git diff packages/geo` that it is unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/fieldkit/src/capture
git commit -m "feat(app): lift the capture state machine out of the instrument"
```

---

### Task 6: The screen — Ready and Acquiring

**Files:**
- Create: `apps/fieldkit/app/capture.tsx`
- Test: `apps/fieldkit/app/__tests__/capture.test.tsx`

**Interfaces:**
- Consumes: `useCapture` from Task 5; `TrafficLightFrame` from Tasks 1–3; `useDatabase`, `useDevice`, `useDatabaseStatus`, `useSettings` from `../src/db/provider`; `useLayout`, `resolveReach`, `Button`, `Type`, `Screen` from `@corymbia/ui`; `createExpoLocationSource`, `gradeAccuracy` from `@corymbia/geo`.

**The two numbers are the largest things on the screen.** Spec §9.4: accuracy and seconds remaining are what she is standing still for, and in the acquiring state they must be legible at arm's length, in glare, without leaning in. Use `Type variant="hero"` (62px) for both. Everything else on that state is subordinate. The prototype rendered them at instrument weight, which is correct for an instrument and wrong for the field — that is the defect this task exists to fix.

Required of the layout:

- **Everything responsive during a countdown sits inside the frame with the button.** Accuracy, seconds remaining, sample count, the signed improvement since the tap, and the verdict sentence. §9.1.2 makes this a requirement, not a preference: a design that puts the countdown readout in a panel above the control has not implemented that section.
- **The control is one button.** Ready: `CAPTURE`. Acquiring: `ACCEPT NOW`. Exactly one action is ever live.
- **Live coordinates in monospace** (`Type variant="mono"`), which may sit outside the frame — they are context about the receiver, not about the convergence in hand.
- **The verdict sentence in words**, from `holdVerdict`: "Still improving — keep standing still." / "About as sharp as it gets here — accepting now costs nothing." These strings are pinned by spec §9.3; use them verbatim.
- **The acquiring state must scroll.** Rotation is unlocked, and in landscape a phone has roughly 360dp of height. Wrap the acquiring content in a `ScrollView` with `contentContainerStyle: { flexGrow: 1, justifyContent: 'center' }`, which renders identically when the content fits and keeps the override reachable when it does not. §9.1.4 requires the override reachable at every moment.
- **Placement follows the reach zone.** Call `resolveReach({ deviceClass, orientation, handedness })` with `handedness` from `useSettings()`. `bottomBand` puts the frame in a bottom-anchored band; `bottomCorners` (tablet in landscape only) anchors it to the corner on the primary side. Do not compute this from a width.

- [ ] **Step 1: Write the failing tests**

`apps/fieldkit/app/__tests__/capture.test.tsx`, mocking the db provider hooks and `createExpoLocationSource` exactly as `apps/fieldkit/app/__tests__/diagnostics.test.tsx` already does — read that file for the harness pattern. Cover:

1. Ready shows one control reading `CAPTURE`.
2. Tapping it moves to the acquiring state, and the control now reads `ACCEPT NOW`.
3. The acquiring state shows the accuracy and the seconds remaining at `hero` size (assert the rendered font size, not merely the text).
4. The verdict sentence appears verbatim, and changes with the verdict.
5. The improvement since the tap is signed, so a countdown that made the fix worse is visible.
6. The control is reachable while a countdown runs — assert it is not disabled.
7. Coordinates render in monospace.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter fieldkit test capture`
Expected: FAIL — `Cannot find module '../capture'`.

- [ ] **Step 3: Write the screen**

Structure: guard on `useDatabaseStatus()` before calling any hook that throws (`useDatabase`, `useDevice` both throw before the database is open, exactly as in `diagnostics.tsx`). Then the three-state render, with Ready and Acquiring built here and Recorded stubbed to a placeholder that Task 7 replaces.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter fieldkit test capture`
Expected: PASS — 7 tests.

- [ ] **Step 5: Prove the adjacency requirement is tested**

Move the seconds-remaining readout outside the `TrafficLightFrame`. Confirm a test fails. If none does, the tests do not constrain §9.1.2 and you must add one that does — assert the readouts are descendants of the frame, not merely present on the screen. Restore, and quote the failure.

- [ ] **Step 6: Commit**

```bash
git add apps/fieldkit/app/capture.tsx apps/fieldkit/app/__tests__/capture.test.tsx
git commit -m "feat(app): add the capture screen's ready and acquiring states"
```

---

### Task 7: Recorded — the point, its name, and what comes next

**Files:**
- Modify: `apps/fieldkit/app/capture.tsx`, `apps/fieldkit/app/__tests__/capture.test.tsx`, `apps/fieldkit/src/gallery/sections.tsx`
- Test: as above

**Interfaces:**
- Consumes: `renameRecord` from Task 4; `isProbableDuplicate`, `DUPLICATE_THRESHOLD_M` from `@corymbia/geo`; `InputAffordanceRow`, `HelpAffordance` from `@corymbia/ui`.

Spec §9.6: a saved confirmation naming the activity, then the four standard affordances — location (already complete), title, voice note, photo — in identical order everywhere in the application.

Required:

- **The recorded state reads as finished**, not as a countdown that stopped: the capture number, the final accuracy, the sample count, and how the wait ended.
- **A title field that works.** Wire it to `renameRecord`. This is the one affordance Plan 3 completes.
- **Voice note and photo are present but disabled**, with a short line saying they arrive with media capture. Do not build them; there is no media table. Leave a comment naming `InputAffordanceRow` where they will attach.
- **The duplicate guard** (§9.5): when the new pin lands within `DUPLICATE_THRESHOLD_M` of the previous one, warn and offer to continue. **It never blocks** — doctrine rule 4. The record is already written by then, so this is a warning about what just happened, not a gate before it.
- **Two ways onward**: take another reading, and leave. Until Plan 5 builds the launcher, "leave" routes to the gallery at `/`.
- **Captures land in the Inbox.** Pass `activityId: null` to `createRecord`. `createRecord` accepts `string | null` and the schema makes `sequence` null for an unfiled record, which is what makes Inbox filing possible at all. Do not create a project or an activity here — the diagnostics screen does that because it is an instrument, and doing it on the field screen would put test scaffolding in her real data.
- **Link the screen from the gallery**, as `diagnostics.tsx` is linked, so it is reachable before Plan 5 builds the launcher.

- [ ] **Step 1: Write the failing tests**

Add to `apps/fieldkit/app/__tests__/capture.test.tsx`:

1. After a countdown completes, the recorded state names the point and shows its final accuracy.
2. Typing a title and confirming calls `renameRecord` with that title and the record's id.
3. The voice and photo affordances are present and disabled.
4. A capture within the duplicate threshold of the previous one shows a warning, and the record still exists — the guard never blocks.
5. A capture beyond the threshold shows no warning.
6. "Take another reading" returns to the ready state.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter fieldkit test capture`
Expected: FAIL on the recorded-state assertions.

- [ ] **Step 3: Build the recorded state and wire the gallery link**

In `apps/fieldkit/src/gallery/sections.tsx`, add a section at the top, above Diagnostics, with a `Button` routing to `/capture` — matching how the diagnostics link is built in that file.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter fieldkit test capture`
Expected: PASS — 13 tests.

- [ ] **Step 5: Prove the duplicate guard never blocks**

Change the guard to refuse the save. Confirm test 4 fails on the record's absence. Restore. Quote the failure. Doctrine rule 4 is the rule most likely to be "improved" away by someone who thinks a duplicate should be prevented.

- [ ] **Step 6: Run the whole suite and the rules check**

Run: `pnpm turbo run test lint typecheck --force`
Expected: clean across all seven workspaces.

Run: `pnpm run lint:verify-rules`
Expected: all rules verified.

- [ ] **Step 7: Commit**

```bash
git add apps/fieldkit/app/capture.tsx apps/fieldkit/app/__tests__/capture.test.tsx apps/fieldkit/src/gallery/sections.tsx
git commit -m "feat(app): record a point, name it, and say what comes next"
```

---

## On hardware

The controller builds and installs. These cannot be tested from a desk and must be checked on the S25, and again on the 10-inch tablet when it arrives:

**Superseded, and left here as the record of what this plan asked for.** The traffic-light frame, its pulse and its rectangular perimeter were all deleted by the capture-dial plan (spec §9.2), so the first three items below have nothing to check any more. The dial's own hardware list — the ring emptying, the lock's snap and ripple, the reduced-motion branch — is in `2026-09-07-capture-dial.md`, and it is the one a tester should work from.

- ~~The frame visibly breathes at about one cycle per five seconds, reads as ongoing rather than urgent, and the grade stays unambiguous at every point in the cycle — in sunlight.~~ The frame and its pulse are deleted.
- ~~Turning on the system's reduced-motion setting mid-capture stops the motion immediately and leaves the frame steady.~~ Replaced by the dial's own reduced-motion item (§9.2.2).
- ~~The perimeter empties smoothly and completes when the countdown does.~~ Replaced by the dial's countdown ring.
- Accuracy and seconds are legible at arm's length without leaning in.
- The override stays reachable in landscape and at maximum system font scale.
- On the tablet: `resolveReach` returns `bottomCorners` only in landscape, and the frame lands under the thumb on the primary side. Switching handedness mirrors it.

---

## Self-review

**Spec coverage.** §9.1 one control, immediate record, countdown, refinement in place, override → Tasks 5, 6, 7. §9.1's `'none'` capture before lock → Task 5. §9.2 frame, grade in colour and word, dashed when poor, whole-frame pulse, perimeter countdown → Tasks 1, 2, 3. §9.3 verdict sentences and the trend rule → Task 6 (consuming `holdVerdict` unchanged). §9.4 accuracy and seconds as the largest things, coordinates in monospace, readouts inside the frame → Task 6. §9.5 duplicate guard that warns and never blocks → Task 7. §9.6 saved confirmation and the four affordances → Task 7. §5.4 reach zones and handedness → Task 6.

**Deliberately out of scope**, each with a home: voice notes and photos (Plan 4); the launcher, project selection and the Inbox screen (Plan 5); export (Plan 6); tablet layout refinement beyond reach zones (Plan 7); voice mode (Plan 8).

**`capturePrimary` is not decided here.** §5.4 says Plan 3 decides whether it acquires a new meaning or is retired. With one control there is no side to trade, and nothing in this plan reads it. Leave the column and the setting exactly where they are, and record the decision in §5.4 when Plan 5 has shown whether the launcher wants it.

**A known limit.** The pulse and the perimeter cannot be verified by test — the native driver does not advance an animated value under Jest, and a perimeter's geometry depends on a measured layout. Both are covered for their branches and their teardown, and both are on the hardware list above. Any report claiming the animation itself is tested is overstating its evidence. (Both were subsequently deleted with the frame they belonged to; the limit itself carried over unchanged to the dial's own motion.)
