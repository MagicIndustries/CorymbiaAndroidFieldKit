/**
 * The single clock the package writes through, so every timestamp column is
 * comparable and every repository test can freeze or advance it uniformly.
 *
 * Minimal placeholder introduced early by Task 3 (device registry), which
 * needed a timestamp source before Task 5 — where this belongs per the plan —
 * lands. Task 5 should treat this file as already present rather than
 * recreating it, extending it in place if it needs more than this.
 */
export function nowIso(): string {
  return new Date().toISOString()
}
