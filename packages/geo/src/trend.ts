import type { Reading } from './classify'

export type HoldVerdict = 'improving' | 'plateaued'

/** How many of the most recent readings the verdict considers. */
const WINDOW = 4
/** Below this much improvement across the window, holding is not buying anything. */
const MEANINGFUL_IMPROVEMENT_M = 0.5

/**
 * Whether continuing to hold is still worth it (spec §9.3).
 *
 * The verdict comes from the **observed trend**, never from an estimate of what
 * the hardware might achieve. The screen says "Still improving — keep holding"
 * or "About as sharp as it gets here", and both must be true when said: telling
 * her to keep waiting for an improvement that is not coming wastes the one thing
 * she has least of in the field.
 *
 * Only the most recent readings count, so an improvement that happened ten
 * seconds ago cannot claim to be happening now.
 *
 * With too little evidence the answer is "improving" — the generous default,
 * letting her wait a moment longer rather than telling her to stop early.
 */
export function holdVerdict(readings: Reading[]): HoldVerdict {
  if (readings.length < 2) return 'improving'

  const recent = readings.slice(-WINDOW)
  const first = recent[0]
  const last = recent[recent.length - 1]
  if (!first || !last) return 'improving'

  return first.accuracyM - last.accuracyM >= MEANINGFUL_IMPROVEMENT_M ? 'improving' : 'plateaued'
}
