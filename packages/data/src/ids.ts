/**
 * Primary-key generator shared by every repository.
 *
 * Ids must sort lexicographically in creation order: they end up in exported
 * filenames and in an append-only event log, where sorting by id must not
 * shuffle a day's captures. That guarantee rests on two things most naive
 * "timestamp + random" generators get wrong:
 *
 * - The timestamp is base-36 but zero-padded to a fixed width, so a shorter
 *   encoding never sorts ahead of a longer one. Nine base-36 digits cover
 *   about 3.2 million years of millisecond timestamps from the epoch, so the
 *   width never needs to grow.
 * - A monotonic counter breaks ties between ids minted in the same
 *   millisecond — routine, since creating a record writes an event in the
 *   same transaction. It increments while the clock hasn't advanced since
 *   the last id and resets the moment it does, and is itself zero-padded so
 *   it compares correctly as a string.
 *
 * The random suffix stays so ids minted on two different devices — which
 * necessarily don't share the counter's process-local state — cannot
 * collide.
 *
 * Deliberately avoids `crypto.randomUUID` and any native module: this file
 * sits behind the package's public barrel (`src/index.ts`), which Metro
 * bundles for Android, so anything it imports must be plain JavaScript.
 */
const TIME_WIDTH = 9
const COUNTER_WIDTH = 4

let lastTime = 0
let counter = 0

function nextSequence(time: number): number {
  if (time === lastTime) {
    counter += 1
  } else {
    lastTime = time
    counter = 0
  }
  return counter
}

export function newId(prefix: string): string {
  const time = Date.now()
  const sequence = nextSequence(time)
  const timePart = time.toString(36).padStart(TIME_WIDTH, '0')
  const counterPart = sequence.toString(36).padStart(COUNTER_WIDTH, '0')
  const random = Math.random().toString(36).slice(2, 10)
  return `${prefix}-${timePart}-${counterPart}-${random}`
}
