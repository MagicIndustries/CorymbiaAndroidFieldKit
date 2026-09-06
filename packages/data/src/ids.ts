/**
 * Primary-key generator shared by every repository.
 *
 * Minimal placeholder introduced early by Task 3 (device registry), which
 * needed id generation before Task 5 — where this belongs per the plan —
 * lands. Deliberately avoids `crypto.randomUUID` and any native module: this
 * file sits behind the package's public barrel (`src/index.ts`), which Metro
 * bundles for Android, so anything it imports must be plain JavaScript.
 * Task 5 should treat this file as already present rather than recreating
 * it, extending it in place if it needs a stronger uniqueness guarantee.
 */
export function newId(prefix: string): string {
  const time = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 10)
  return `${prefix}-${time}-${random}`
}
