import type { StoredFix } from '@corymbia/data'
import type { ContextStampFix } from '@corymbia/ui'

/**
 * Turns a fix as the database stores it into a fix as `ContextStamp` renders
 * it (spec §8.2).
 *
 * The two types state the same three-class distinction and are deliberately
 * not the same shape, so something has to do this and it may as well be one
 * named, tested function rather than an object literal inlined into a row:
 *
 *  - `StoredFix` ages an ambient fix in seconds, because that is the
 *    resolution the position cache keeps; `ContextStampFix` ages it in
 *    minutes, because that is the resolution a person reads at a glance.
 *    Rounded rather than truncated: 110 seconds is nearly two minutes stale,
 *    and calling it one understates the staleness, which is the direction
 *    that misleads (`docs/gps-accuracy.md`).
 *  - `StoredFix` carries the whole positional provenance — datum, provider,
 *    convention, the mocked flag, the satellite clock. None of that belongs
 *    on a list row, and dropping it here is what keeps it off one.
 *
 * `accuracyM` needs no null handling: both positioned branches get it from
 * `PositionCore`, where it is a plain `number`, and migration 003 is what
 * makes that sound — a positioned row without an accuracy cannot be stored.
 * A `'none'` fix has no accuracy at all, which is the case the union already
 * expresses rather than a null.
 *
 * **A `switch` with no `default`, on purpose.** CLAUDE.md's three-places rule:
 * the fix classes are stated by the `Fix` union, by migration 003's CHECK
 * constraints and by `ContextStampFix`. A fourth class added to any of them
 * must be a compile error here — with a `default` it would instead be a
 * silent fallthrough, which is exactly the disagreement that surfaces as a
 * row nobody refused.
 */
export function stampFixFor(fix: StoredFix): ContextStampFix {
  switch (fix.quality) {
    case 'deliberate':
      return { quality: 'deliberate', accuracyM: fix.accuracyM }
    case 'ambient':
      return {
        quality: 'ambient',
        accuracyM: fix.accuracyM,
        ageMinutes: Math.round(fix.ageSeconds / 60),
      }
    case 'none':
      return { quality: 'none' }
  }
}
