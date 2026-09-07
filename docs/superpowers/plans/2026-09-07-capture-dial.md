# The Capture Dial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rectangular traffic-light frame with the dial settled against animated mockups on the device — a countdown ring, the accuracy drawn as a real shrinking radius, and a crosshair the fix locks onto.

**Architecture:** One new component in `@corymbia/ui` replaces two existing ones. `TrafficLightFrame` and `CaptureFramePerimeter` are deleted, not deprecated — nothing outside the capture screen uses them, and leaving a superseded component beside its replacement is how the wrong one gets picked next time. Nothing below the screen changes: `useCapture`, `holdVerdict`, `averageReadings` and the repositories are untouched.

**Tech Stack:** Expo SDK ~57, React Native 0.86, TypeScript ~6 strict with `noUncheckedIndexedAccess`, `react-native-svg` 15.15.4, Jest with `jest-expo` and `@testing-library/react-native`.

## Global Constraints

- Components consume semantic tokens from `@corymbia/tokens` only — never a raw hex value, never the raw ramp, including in test files. The lint grants exactly one test exemption, `packages/tokens/src/__tests__/**` (see the RULE 1 block in `eslint.config.mjs`), because that is where the ramp's own values are pinned and asserting ramp against ramp would prove nothing. Nothing in this plan touches that package, so for everything here the rule is absolute.
- Only `packages/ui/src/layout/useLayout.ts` reads window dimensions. A view measuring its own box with `onLayout` is not a window dimension and is permitted.
- `@corymbia/ui` must not import from `@corymbia/geo` — the dial is told its grade, it computes nothing about GPS.
- TypeScript strict with `noUncheckedIndexedAccess`; no casts or non-null assertions.
- Only the root `eslint.config.mjs` governs lint; add no per-package config.
- Colour never carries meaning alone (doctrine rule 9). The grade has a word; the lock has a word.
- **The radius always means metres.** Every drawn radius comes from one mapping anchored on the crosshair. A radius chosen to look right is the defect this design exists to remove.
- Never `git add -A` or `git add .` — the working tree carries pre-existing deletions under `.agents/skills/tauri/` that must stay out of every commit.
- Do not run `npx expo run:android`; it never exits. The controller builds and installs.

**Read `docs/superpowers/specs/2026-09-05-corymbia-field-kit-design.md` §9.2, §9.2.1, §9.2.2 and §9.4 before starting.** They were rewritten for this design and they carry the reasoning, not just the requirements.

---

## File structure

| File | Responsibility |
| --- | --- |
| `packages/ui/src/capture/dialGeometry.ts` | The metres-to-radius mapping and the ring's dash arithmetic. Pure, exported, and tested directly — the geometry must be verifiable without rendering. |
| `packages/ui/src/capture/CaptureDial.tsx` | The dial: ring, accuracy circle, crosshair, lock. |
| `packages/ui/src/capture/index.ts` | Barrel. |
| `apps/fieldkit/app/capture.tsx` | Consumes the dial in place of the frame. |
| **Deleted** | `TrafficLightFrame.tsx`, `CaptureFramePerimeter.tsx` and their tests. |

---

### Task 1: The geometry, as pure functions

**Files:**
- Create: `packages/ui/src/capture/dialGeometry.ts`
- Test: `packages/ui/src/capture/__tests__/dialGeometry.test.ts`

**Interfaces:**
- Produces:
  - `TARGET_RADIUS_PX = 26`, `TARGET_METRES = 1.4`, `OUTER_RADIUS_PX = 118`, `OUTER_METRES = 7.5`
  - `radiusForMetres(metres: number): number`
  - `ringDash(radius: number, remaining: number): { dasharray: number; dashoffset: number }`
  - `isLocked(radiusPx: number): boolean`

`TARGET_METRES` is the floor the S25 actually reached outdoors (spec §9.1's table). Everything else is scaled against that pair, which is what makes "a good fix lands on the crosshair" a consequence rather than a decoration.

- [ ] **Step 1: Write the failing tests**

```ts
import {
  OUTER_METRES, OUTER_RADIUS_PX, TARGET_METRES, TARGET_RADIUS_PX,
  isLocked, radiusForMetres, ringDash,
} from '../dialGeometry'

describe('radiusForMetres', () => {
  it('puts the measured floor exactly on the crosshair, which is what makes a good fix land on it', () => {
    expect(radiusForMetres(TARGET_METRES)).toBeCloseTo(TARGET_RADIUS_PX, 5)
  })

  it('puts the run\'s opening accuracy at the outer radius', () => {
    expect(radiusForMetres(OUTER_METRES)).toBeCloseTo(OUTER_RADIUS_PX, 5)
  })

  it('is monotonic, because a worse fix must never draw smaller than a better one', () => {
    const series = [7.5, 5.2, 4.2, 3.1, 2.5, 2.0, 1.7, 1.4]
    const radii = series.map(radiusForMetres)
    radii.slice(1).forEach((r, i) => expect(r).toBeLessThan(radii[i] ?? Infinity))
  })

  it('keeps a poor fix outside the crosshair, so it visibly never locks', () => {
    expect(radiusForMetres(12)).toBeGreaterThan(TARGET_RADIUS_PX + 20)
    expect(isLocked(radiusForMetres(12))).toBe(false)
  })

  it('never returns a radius that would draw outside the ring or invert', () => {
    expect(radiusForMetres(0)).toBeGreaterThan(0)
    expect(radiusForMetres(500)).toBeLessThanOrEqual(OUTER_RADIUS_PX + 12)
    expect(Number.isFinite(radiusForMetres(Number.NaN))).toBe(true)
  })
})

describe('ringDash', () => {
  it('is fully drawn with the whole wait remaining and fully withdrawn at none', () => {
    const full = ringDash(130, 1)
    expect(full.dashoffset).toBeCloseTo(0, 5)
    const empty = ringDash(130, 0)
    expect(empty.dashoffset).toBeCloseTo(empty.dasharray, 5)
  })

  it('empties rather than fills as the wait runs down', () => {
    expect(ringDash(130, 0.25).dashoffset).toBeGreaterThan(ringDash(130, 0.75).dashoffset)
  })

  it('clamps a fraction outside nought to one rather than wrapping', () => {
    expect(ringDash(130, 2).dashoffset).toBeCloseTo(0, 5)
    expect(ringDash(130, -1).dashoffset).toBeCloseTo(ringDash(130, 0).dasharray, 5)
  })
})

describe('isLocked', () => {
  it('locks at the crosshair and just inside it', () => {
    expect(isLocked(TARGET_RADIUS_PX)).toBe(true)
    expect(isLocked(TARGET_RADIUS_PX - 4)).toBe(true)
  })

  it('does not lock while the circle is still outside the crosshair', () => {
    expect(isLocked(TARGET_RADIUS_PX + 6)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @corymbia/ui test dialGeometry`
Expected: FAIL — `Cannot find module '../dialGeometry'`.

- [ ] **Step 3: Implement**

A logarithmic mapping anchored on the two measured pairs, clamped at both ends so no input can produce a negative, NaN or out-of-ring radius. Document each constant against the measurement it came from. `ringDash` returns the circumference as `dasharray` and `circumference * (1 - remaining)` as `dashoffset` — offset grows as the stroke is withdrawn.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @corymbia/ui test dialGeometry`
Expected: PASS.

- [ ] **Step 5: Prove two tests are real**

Invert the dash direction (`remaining` for `1 - remaining`); confirm the emptying test fails. Restore. Then change `TARGET_METRES` to 2.0; confirm the crosshair test fails. Restore. Quote both.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/capture/dialGeometry.ts packages/ui/src/capture/__tests__/dialGeometry.test.ts
git commit -m "feat(ui): the dial's geometry, anchored on the measured floor"
```

---

### Task 2: The dial — ring, accuracy circle, crosshair

**Files:**
- Create: `packages/ui/src/capture/CaptureDial.tsx`
- Modify: `packages/ui/src/capture/index.ts`, `packages/ui/src/index.ts`
- Test: `packages/ui/src/capture/__tests__/CaptureDial.test.tsx`

**Interfaces:**
- Consumes: everything from Task 1; `useTheme`, `Type`; `Svg`, `Circle`, `Line`, `G` from `react-native-svg`.
- Produces:
  - `type FixGradeName = 'good' | 'fair' | 'poor'` (moved here from the deleted frame)
  - `CaptureDial(props: { grade: FixGradeName; accuracyM: number; remaining?: number; locked?: boolean; children?: React.ReactNode })`

`remaining` absent means no countdown is running: the ring's track renders but no progress stroke. The dial is live at all times; a countdown is not.

**The dial is told everything.** It computes no grade, no lock state and no accuracy — the screen does that, so `@corymbia/ui` takes no dependency on `@corymbia/geo`.

- [ ] **Step 1: Write the failing tests**

Cover, each as its own test: the grade word renders for all three grades; the ring stroke and the accuracy circle both carry the status colour for the grade; the accuracy circle's radius equals `radiusForMetres` for the accuracy given; the ring's `strokeDashoffset` equals `ringDash`'s for the fraction given; no progress stroke renders when `remaining` is absent; and the crosshair renders at `TARGET_RADIUS_PX`.

Assert on the rendered SVG elements, not on props you pass straight through. **Note the trap this codebase has already hit:** `react-native-svg` folds a `strokeDashoffset` of exactly `0` to `null` on the native host props, so assert at a fraction that round-trips — `0.25` is known to work — rather than at a full or empty ring.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @corymbia/ui test CaptureDial`
Expected: FAIL — `Cannot find module '../CaptureDial'`.

- [ ] **Step 3: Implement**

One `Svg` at a fixed viewBox, scaled by its container. Layer order matters: the ring track, the ring progress, the accuracy circle and its outline, then the crosshair on top — the crosshair must never be obscured by the circle closing over it. Semantic tokens for every colour: `statusGood` / `statusFair` / `statusPoor` for the grade, `surfaceSunken` for the ring's track, `textDim` for the unlit crosshair.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @corymbia/ui test CaptureDial`
Expected: PASS.

- [ ] **Step 5: Prove the wiring is real**

Swap `strokeDasharray` and `strokeDashoffset` on the ring; confirm a test fails. Restore. Then pass a radius computed by something other than `radiusForMetres`; confirm a test fails. Restore. Quote both. Geometry that is correct but handed to nothing is the exact defect that shipped once already on this branch's predecessor.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/capture packages/ui/src/index.ts
git commit -m "feat(ui): the capture dial"
```

---

### Task 3: The lock

**Files:**
- Modify: `packages/ui/src/capture/CaptureDial.tsx`
- Test: `packages/ui/src/capture/__tests__/CaptureDial.test.tsx`

Spec §9.2.1. When the circle closes onto the crosshair, four things happen together and they must land in one beat:

- **the circle snaps** briefly inside the crosshair — about 4.5px over roughly a quarter-second — then eases back to rest on it;
- **its interior fills and its outline firms** — fill opacity roughly 0.15 to 0.45, outline weight roughly 1.75 to 4;
- **the crosshair lights** in the grade colour and thickens;
- **a ripple goes outward once** — two rings, the second trailing the first by about 190ms, reaching about 84px beyond the crosshair, holding near full opacity for the first third then falling away. **Once, then nothing.**

Arriving at the right size and doing nothing is the complaint this task exists to answer: the moment must be visible from peripheral vision, not inferred from a radius.

- [ ] **Step 1: Write the failing tests**

Assert: the crosshair carries the grade colour when locked and the dim token when not; the accuracy circle's fill opacity and outline weight are greater when locked than when not; the ripple elements are absent when not locked; and that a locked dial exposes the lock in a way the screen can render a word from.

Motion cannot be asserted under Jest — the animated values do not advance. Test the **states** and the **branch**, and say plainly in the report that the motion itself is on the device checklist.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @corymbia/ui test CaptureDial`

- [ ] **Step 3: Implement**

Drive the lock treatment from an `Animated.Value` started when `locked` turns true and reset when it turns false, so a dial that mounts already locked does not replay the ripple. **Respect reduced motion per §9.2.2**: with it on, render the locked *state* — filled circle, lit crosshair, no ripple — and run no animation. The state is the information; the ripple is the emphasis.

- [ ] **Step 4: Run to verify they pass**

- [ ] **Step 5: Prove the reduced-motion branch is real**

Remove the reduced-motion guard; confirm a test fails. Restore, and quote it. Note the trap: a timer count cannot distinguish "never started" from "started and stopped" — assert on the animation being started, not on what is left running.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/capture
git commit -m "feat(ui): the lock, and its one ripple"
```

---

### Task 4: The screen adopts the dial

**Files:**
- Modify: `apps/fieldkit/app/capture.tsx`, `apps/fieldkit/app/__tests__/capture.test.tsx`

**Interfaces:**
- Consumes: `CaptureDial`, `radiusForMetres`, `isLocked` from `@corymbia/ui`; `gradeAccuracy` from `@corymbia/geo`.

The screen computes the grade and the lock — the dial is told both. Required:

- **The accuracy is the largest thing on the screen** (§9.4), at `hero`. **The seconds are no longer hero-sized**: the ring answers "how much longer" without being read, so the number sits with the sample count and the improvement. Two numbers at the same size compete; one number and a moving ring do not.
- Coordinates above the dial in monospace, small.
- Everything that responds during a countdown stays inside the dial's block with the button (§9.1.2) — that adjacency requirement survives the redesign unchanged.
- The lock adds `· LOCKED ON` to the grade chip and changes the verdict sentence. Colour and motion never carry it alone.
- `remaining` is the **continuous** fraction the hook already exposes, not the ceil-ed integer seconds. A ring fed whole seconds steps fifteen times and never reaches empty.

- [ ] **Step 1: Write the failing tests**

Cover: the dial renders in the acquiring state; the accuracy renders at hero and the seconds do not; the grade chip gains the lock label when locked and not before; and the readouts remain descendants of the dial's block — assert descendancy, because presence-and-size does not constrain a layout requirement.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter fieldkit test capture`

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run to verify they pass**

- [ ] **Step 5: Prove two tests are real**

Feed the ring `secondsRemaining` instead of the continuous fraction; confirm a test fails. Restore. Move a readout outside the dial's block; confirm a test fails. Restore. Quote both.

- [ ] **Step 6: Commit**

```bash
git add apps/fieldkit/app/capture.tsx apps/fieldkit/app/__tests__/capture.test.tsx
git commit -m "feat(app): the capture screen adopts the dial"
```

---

### Task 5: Delete what it replaces, and settle the pulse

**Files:**
- Delete: `packages/ui/src/capture/TrafficLightFrame.tsx`, `CaptureFramePerimeter.tsx` and their test files
- Modify: `packages/ui/src/capture/index.ts`, `docs/ui-doctrine.md`, `docs/superpowers/specs/2026-09-05-corymbia-field-kit-design.md`

**The frame and its perimeter are deleted, not deprecated.** Nothing outside the capture screen imports them — verify that before deleting rather than assuming — and a superseded component left beside its replacement is how the wrong one gets picked next time.

**The pulse goes with them, and this is a decision to record rather than a deletion to make quietly.** The frame pulsed because it was static: motion was the only way a rectangle could say "still working, stand still". The dial is already in motion for the whole wait — the ring emptying, the circle shrinking — so a breath on top would be a third moving thing competing with two that carry information. Removing it is a simplification the new design earns, not a feature dropped.

Record in §9.2: the pulse existed to animate a static frame, the dial does not need it, and a future reader should not reintroduce it as a missing feature.

- [ ] **Step 1: Confirm nothing else imports them**

Run: `grep -rn "TrafficLightFrame\|CaptureFramePerimeter\|perimeterGeometry" --include=*.ts --include=*.tsx packages apps`
Expected: matches only in the files being deleted and the barrel. If anything else appears, stop and report it.

- [ ] **Step 2: Delete, and update the barrel**

- [ ] **Step 3: Update the doctrine and the spec**

`docs/ui-doctrine.md`'s rule 9 and rule 17 rows reference the frame by name; point them at the dial. Add the pulse decision to §9.2.

- [ ] **Step 4: Run everything**

Run: `pnpm turbo run test lint typecheck --force`
Expected: clean across all seven workspaces.

Run: `pnpm run lint:verify-rules`
Expected: all rules verified.

- [ ] **Step 5: Commit**

```bash
git add packages/ui docs/ui-doctrine.md docs/superpowers/specs/2026-09-05-corymbia-field-kit-design.md
git commit -m "refactor(ui): delete the frame the dial replaces, and retire the pulse with it"
```

---

## On hardware

The controller builds and installs. These decide whether the design works and none can be settled from a desk:

- **The lock is unmistakable at a glance** — the snap, the fill, the lit crosshair and the ripple landing as one beat. *Wrong:* you notice the circle has stopped moving before you notice it locked.
- **The ripple is a confirmation, not an alarm** on a screen watched all day. *Wrong:* it draws the eye back after you have looked away, or reads as an error.
- **A poor fix visibly never locks** — the circle stops outside the crosshair, the crosshair stays dim, no ripple, no label. *Wrong:* it reads as a fault in the app rather than a fact about the fix.
- **The accuracy is legible at arm's length in midday glare**, release build, outdoors.
- **The ring empties smoothly** and reaches empty exactly as the countdown ends. *Wrong:* visible once-a-second steps, or a sliver left at zero.
- **Reduced motion**: with it on, the dial still shows the locked state — filled circle, lit crosshair, the word — and simply does not ripple. *Wrong:* the lock becomes invisible.
- **Landscape and maximum font scale**: the dial fits, and the button stays reachable.
- **A capture that starts already at the floor locks on the first frame** the countdown ring appears on, because the collected samples are seeded synchronously with the tap's own reading. *Wrong:* the ripple reads as a glitch on that first frame rather than as a confirmation.
- **The resting accuracy circle is largest exactly when it is faintest** — 0.15 opacity at big radii, early in a countdown — and the whole design's claim is that the circle makes convergence visible at a glance in outdoor glare. *Wrong:* it is hard to make out early in the wait, which would be a legibility regression the lock work introduced as a side effect.

## Self-review

**Spec coverage.** §9.2 dial, ring, accuracy-as-radius, crosshair, honest mapping → Tasks 1, 2. §9.2's "a poor fix never locks" → Task 1's geometry test and Task 3. §9.2.1 the lock → Task 3. §9.2.2 reduced motion → Task 3. §9.4 accuracy hero, seconds subordinate → Task 4. §9.1.2 adjacency → Task 4.

**Deliberately unchanged:** `useCapture`, `holdVerdict`, `averageReadings`, the repositories, the duplicate guard, the recorded state, and the Inbox routing. This plan is the dial and its adoption, nothing else.

**A known limit.** No test here can assert motion — Jest does not advance an animated value under the native driver. Every task that animates tests its states and its branches and says so; the motion is on the hardware list. A report claiming the animation itself is tested is overstating its evidence.
