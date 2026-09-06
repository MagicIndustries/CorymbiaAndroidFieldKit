/**
 * ISO-8601 with the device's UTC offset, rather than a bare `Z`.
 *
 * Spec §7.4 keeps GPS time alongside device time because field tablets drift.
 * Keeping the offset means a record also remembers the local time it was taken
 * at, which is what a field notebook would have recorded and what makes a
 * dataset readable months later.
 */
export function nowIso(date: Date = new Date()): string {
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const pad = (n: number): string => String(Math.floor(Math.abs(n))).padStart(2, '0')
  const offset =
    offsetMinutes === 0 ? 'Z' : `${sign}${pad(offsetMinutes / 60)}:${pad(offsetMinutes % 60)}`

  const local = new Date(date.getTime() + offsetMinutes * 60_000)
  return `${local.toISOString().slice(0, 19)}${offset}`
}
