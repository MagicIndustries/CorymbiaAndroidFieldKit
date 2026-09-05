/**
 * Doctrine rule 12: names carry an optional user-controlled short label.
 * When blank we fall back to the full name and let the component truncate it —
 * no heuristic shortens an ecologist's project name better than she does, and a
 * bad guess is worse than a clean ellipsis.
 */
export function resolveDisplayName({
  name,
  shortLabel,
}: {
  name: string
  shortLabel?: string | null
}): string {
  const trimmed = shortLabel?.trim()
  return trimmed ? trimmed : name
}
