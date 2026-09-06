/**
 * Record kinds and their attribute validators (spec §7.2).
 *
 * `pin` is the only kind in this implementation. Its title, description and
 * position are real columns, so it has no kind-specific attributes at all —
 * which is why there is no schema library here. Adding one to validate an empty
 * object would be four dependencies earning nothing. When a kind gains real
 * fields, revisit that decision rather than extending these by hand forever.
 */
export type RecordKind = 'pin'

export type PinAttributes = Record<string, never>

const ALLOWED_KEYS: Record<RecordKind, readonly string[]> = {
  pin: [],
}

export function validateAttributes(kind: RecordKind, value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Attributes for a ${kind} must be an object, received ${typeof value}`)
  }
  // Reject non-plain objects (Date, RegExp, class instances, etc.)
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`Attributes for a ${kind} must be a plain object`)
  }
  const allowed = ALLOWED_KEYS[kind]
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unexpected.length > 0) {
    throw new Error(
      `Unexpected attribute(s) for a ${kind}: ${unexpected.join(', ')}. ` +
        `Add the field to ALLOWED_KEYS in kinds.ts, or store it in a real column.`,
    )
  }
  return value as Record<string, unknown>
}

export function serialiseAttributes(kind: RecordKind, value: unknown): string {
  return JSON.stringify(validateAttributes(kind, value))
}
