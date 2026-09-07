import { averageReadings } from './average'
import type { Reading } from './classify'

export type HoldVerdict = 'improving' | 'plateaued'

/**
 * The measured run these constants are derived from.
 *
 * Samsung S25, outdoors, readings at 1 Hz. `raw` is each reading's own
 * accuracy estimate; `avg` is what `averageReadings` reported over every
 * sample up to and including it — the figure the capture frame prints and the
 * figure that would be written to the record.
 *
 * ```
 *  n   raw   avg          n   raw   avg
 *  1   7.5   7.5         12   5.1   1.7
 *  2   7.2   5.2         13   5.0   1.7
 *  3   6.8   4.1         14   4.8   1.6
 *  4   6.7   3.5         15   4.7   1.6
 *  5   6.3   3.1         16   4.6   1.5
 *  6   6.1   2.7         17   4.4   1.5
 *  7   5.8   2.5         18   4.4   1.5
 *  8   5.8   2.3         19   4.3   1.4
 *  9   5.6   2.1         20   4.2   1.4
 * 10   5.4   2.0         21   4.2   1.4
 * 11   5.2   1.8
 * ```
 *
 * The raw column is noisy per reading; the avg column is smooth and falls
 * monotonically. Stored records from the same session, each a real capture,
 * say what the wait actually buys:
 *
 * ```
 *  ~4 s  n=5   ±1.6 m
 *  ~6 s  n=7   ±1.5 m
 * ~11 s  n=12  ±1.2 m
 * ~15 s  n=16  ±1.3 m
 *  20 s  n=21  ±1.0 to ±1.4 m across several runs
 *  60 s  n=61  ±1.1 m, spread ±1.3 m
 * ```
 *
 * The curve is flat from about ten seconds. Sixty seconds was no better than
 * twenty — the 60 s run measured ±1.1 m, inside the ±1.0–1.4 m spread the
 * 20 s runs themselves span — because `averageReadings` floors the reported
 * accuracy at a third of the best single reading: once enough samples have
 * accumulated the floor binds (at n=13 in the run above) and further samples
 * are inert — only a better individual reading moves the number.
 *
 * All of this is one device, one site, one session under clear sky. Treat it
 * as a starting point for this hardware, not as a claim about Android GPS
 * receivers in general.
 */

/**
 * The number of samples that must have accumulated before a plateau can be
 * claimed at all. Below it the answer is always `'improving'`.
 *
 * **Ten, because the measured curve is flat from about ten seconds and not
 * before.** At 1 Hz that is ten samples. The stored records above are one
 * number from n≈10 onward — ±1.2 m at n=12, ±1.3 m at n=16, ±1.0 to ±1.4 m at
 * n=21, ±1.1 m at n=61, all inside the run-to-run spread of a single wait —
 * while below it they are genuinely and measurably worse (±1.6 m at n=5,
 * ±1.5 m at n=7). So before ten samples a plateau claim is false by
 * construction on the run measured — though run-to-run variance at a fixed
 * duration is large enough (see `docs/gps-accuracy.md` §5) that this is a
 * dependable floor for when a plateau claim may be made, not a claim that any
 * one capture below it is demonstrably still improving.
 *
 * This is the guard that makes the defect this rule was rewritten for
 * impossible. The old rule declared `plateaued` at n=2, 0.6 s after the tap,
 * on the run above — which with auto-finish enabled would have ended the
 * capture at ±5.2 m when waiting reaches ±1.4 m, a four-times worse fix.
 */
const MIN_SAMPLES = 10

/**
 * How many readings back the comparison reaches: four, so the verdict is about
 * the last four seconds at 1 Hz and an improvement that happened ten seconds
 * ago cannot claim to be happening now.
 *
 * Pinned by the measured run. The averaged accuracy improves across a
 * trailing window of four by 0.775 m at n=10, 0.640 m at n=11, 0.549 m at
 * n=12, 0.444 m at n=13, and less thereafter. Against the threshold below that
 * puts the first plateau at n=13, ~12 s after the tap — inside the flat part
 * of the stored-record curve. A window of three would put it at n=11 and a
 * window of five at n=15, so four is not interchangeable with its neighbours;
 * `trend.test.ts` asserts the n=13 crossing directly.
 */
const WINDOW = 4

/**
 * How much the averaged accuracy must improve across that window for holding
 * to still be buying something, in metres.
 *
 * **Bracketed by the measurement, not chosen for feel — and not chosen to
 * land on any particular sample count either.** The window improvements above
 * fall through 0.549 m at n=12 and 0.444 m at n=13. Any threshold in the open
 * bracket (0.444, 0.549] crosses at the same point on this run, n=13; its
 * midpoint is (0.444 + 0.549) / 2 = 0.4965, which rounds to **0.5 m** — the
 * value furthest from either neighbouring measurement, and so the most
 * tolerant of noise in both directions. Nothing about the countdown length
 * enters this: the bracket comes entirely from where the measured curve
 * itself bends.
 *
 * Sanity check on the scale: 0.5 m across 4 s is 0.125 m/s, and the same run
 * improved by only 0.267 m over the eight seconds from n=13 to n=21
 * (0.033 m/s) — the tail is comfortably inside "plateaued", not sitting on
 * the boundary.
 */
const MEANINGFUL_IMPROVEMENT_M = 0.5

/**
 * What `averageReadings` reported at each prefix of the hold — entry `i` is
 * the accuracy over readings `0..i` — or `null` at a prefix it refused (every
 * reading carrying an unusable accuracy, which only a mock or broken provider
 * produces).
 *
 * **Cost.** This is `n` calls to `averageReadings`, each O(n), so O(n²) in the
 * sample count. That is deliberate and it does not matter here: a hold is
 * bounded by the countdown, at most 60 s at 1 Hz, and measured at n=61 the
 * whole series takes 0.16 ms on a desktop JS engine — against a screen that
 * re-renders four times a second. Reimplementing the accuracy calculation in
 * one incremental pass would be O(n) but would duplicate the floor in
 * `average.ts`, and two copies of the floor is exactly the drift that puts a
 * different number on the record from the one on screen.
 */
function averagedAccuracySeries(readings: Reading[]): (number | null)[] {
  const series: (number | null)[] = []
  for (let end = 1; end <= readings.length; end++) {
    try {
      series.push(averageReadings(readings.slice(0, end)).accuracyM)
    } catch {
      series.push(null)
    }
  }
  return series
}

/**
 * Whether continuing to hold is still worth it (spec §9.3).
 *
 * The verdict comes from the **observed trend**, never from an estimate of what
 * the hardware might achieve. The screen says "Still improving — keep standing
 * still" or "About as sharp as it gets here", and both must be true when said:
 * telling her to keep waiting for an improvement that is not coming wastes the one thing
 * she has least of in the field, and ending a capture that was still converging
 * writes a worse fix onto the record permanently.
 *
 * Three properties, each of which the previous rule got wrong on the hardware
 * run documented above:
 *
 * 1. **It judges the averaged accuracy, not each reading's own estimate.** The
 *    averaged figure is the number the frame prints and the number that would
 *    be stored; it falls smoothly and monotonically. Each reading's raw
 *    estimate jitters by half a metre between consecutive samples, which is
 *    how the old rule read "no meaningful improvement" at n=2 — 7.5 m then
 *    7.2 m — while the averaged fix was in the middle of falling from 7.5 m to
 *    1.4 m.
 * 2. **It cannot claim a plateau before `MIN_SAMPLES`.** The generous default
 *    with too little evidence is to let her wait.
 * 3. **It does not flap.** The verdict is `'plateaued'` if the window has
 *    failed to improve at *any* point from `MIN_SAMPLES` onward, not only at
 *    the newest reading, so a verdict once given is never taken back. The old
 *    rule alternated plateaued/improving/plateaued/improving across n=2 to
 *    n=12 of the measured run while the fix was improving monotonically and
 *    fast. Latching is also what the verdict *means* once auto-finish is on:
 *    the plateau ends the capture, so a verdict that could be withdrawn would
 *    be a statement about a capture that no longer exists.
 *
 *    The latch is not unconditionally safe, though: it can outlive the
 *    evidence that earned it. A run that plateaus on a mediocre floor and then
 *    receives a markedly sharper reading — a sudden clearer view of the sky —
 *    keeps reading `'plateaued'` even though the averaged fix has genuinely
 *    started improving again. With auto-finish on this is unreachable, because
 *    the capture already ended the moment the plateau first latched; it can
 *    only be observed by continuing to collect readings after a plateau with
 *    auto-finish off. The latch is still the right call — a verdict that could
 *    be withdrawn mid-capture would be worse — but this function should not be
 *    read as claiming the trend can never reverse in fact, only that it is
 *    never reported as having done so.
 */
export function holdVerdict(readings: Reading[]): HoldVerdict {
  if (readings.length < MIN_SAMPLES) return 'improving'

  const accuracy = averagedAccuracySeries(readings)

  for (let n = MIN_SAMPLES; n <= readings.length; n++) {
    // Indexed access under `noUncheckedIndexedAccess`, discharged by a check
    // rather than a cast. `MIN_SAMPLES` is larger than `WINDOW + 1`, so both
    // subscripts are in range on every iteration — but the type system cannot
    // carry that here, and a prefix `averageReadings` refused carries no
    // opinion about the trend either way, so both cases take the same exit:
    // this window says nothing, and silence is not a plateau.
    const before = accuracy[n - 1 - WINDOW]
    const now = accuracy[n - 1]
    if (before == null || now == null) continue

    if (before - now < MEANINGFUL_IMPROVEMENT_M) return 'plateaued'
  }

  return 'improving'
}
