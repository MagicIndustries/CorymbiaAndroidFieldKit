/**
 * Whether `accuracyM` is a usable claim of positional accuracy: a finite,
 * positive number of metres.
 *
 * Shared by `average.ts` (which builds inverse-variance weights from it — see
 * `weightOf`) and `ambient-cache.ts` (which refuses to let a reading failing
 * this enter the cache at all), so the two cannot silently drift apart on
 * what "usable" means. A rule enforced twice in two places is a rule that
 * will disagree with itself later; this is the one place it is written down.
 *
 * Two kinds of nonsense are rejected, neither of which a healthy Android
 * location provider emits but both of which a mock provider — or, for the
 * ambient cache, a device adapter with nothing to report — can:
 *
 * - **Zero or negative accuracy.** Zero would claim a perfect reading, which
 *   no real fix is. A negative figure is meaningless as a radius. Neither is
 *   a claim of quality.
 * - **NaN or Infinity.** A provider that reports no usable figure has told us
 *   nothing about the reading's quality. The device adapter maps a missing
 *   platform accuracy to `Number.POSITIVE_INFINITY`, which is not a poor
 *   measurement — a poor measurement is welcome — it is the absence of one.
 */
export function isUsableAccuracy(accuracyM: number): boolean {
  return Number.isFinite(accuracyM) && accuracyM > 0
}
