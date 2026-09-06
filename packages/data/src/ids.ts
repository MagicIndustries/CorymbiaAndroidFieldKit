/**
 * Time-ordered, prefixed identifiers.
 *
 * Lexicographic order matching creation order matters because these ids end up
 * in exported filenames and in the event log, where sorting by id should not
 * shuffle a day's captures. The timestamp is milliseconds since the epoch in
 * base 36, left-padded so the width stays constant into the year 5000, followed
 * by randomness to separate ids created in the same millisecond.
 *
 * A monotonic counter breaks ties between ids minted in the same millisecond —
 * routine, since creating a record writes an event in the same transaction. It
 * increments while the clock hasn't advanced since the last id and resets the
 * moment it does, and is itself zero-padded so it compares correctly as a string.
 *
 * The random suffix stays so ids minted on two different devices — which
 * necessarily don't share the counter's process-local state — cannot collide.
 *
 * Structure: `prefix_TTTTTTTTTCCCCRRRRRRR` where T is 9 chars (timestamp in base 36),
 * C is 4 chars (counter in base 36), and R is 8 chars (random in base 36).
 *
 * Deliberately avoids `crypto.randomUUID` and any native module: this file
 * sits behind the package's public barrel (`src/index.ts`), which Metro
 * bundles for Android, so anything it imports must be plain JavaScript.
 */
const TIME_WIDTH = 9
const COUNTER_WIDTH = 4
const RANDOM_WIDTH = 8

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

function randomSuffix(length: number): string {
  let out = ''
  for (let i = 0; i < length; i += 1) {
    out += Math.floor(Math.random() * 36).toString(36)
  }
  return out
}

export function newId(prefix: string): string {
  const time = Date.now()
  const sequence = nextSequence(time)
  const timePart = time.toString(36).padStart(TIME_WIDTH, '0')
  const counterPart = sequence.toString(36).padStart(COUNTER_WIDTH, '0')
  const random = randomSuffix(RANDOM_WIDTH)
  return `${prefix}_${timePart}${counterPart}${random}`
}
