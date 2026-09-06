export type Reading = {
  latitude: number
  longitude: number
  accuracyM: number
  altitudeM: number | null
  /** Vertical accuracy where the platform reports it. */
  verticalAccuracyM?: number | null
  /** Whether the platform flagged this as coming from a mock provider (spec §7.5). */
  isMocked?: boolean
  timestampMs: number
}

export type FixGrade = 'good' | 'fair' | 'poor'

/**
 * The thresholds the capture screen's traffic-light frame is built on (spec §9.2).
 * Boundaries fall on the safer side: exactly 5 m is fair, not good, because a
 * frame that claims a good fix it does not have is worse than one that is
 * cautious.
 */
export const GRADE_THRESHOLDS = { good: 5, fair: 15 } as const

export function gradeAccuracy(accuracyM: number): FixGrade {
  if (accuracyM < GRADE_THRESHOLDS.good) return 'good'
  if (accuracyM < GRADE_THRESHOLDS.fair) return 'fair'
  return 'poor'
}
