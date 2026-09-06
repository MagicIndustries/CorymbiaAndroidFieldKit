/**
 * The transaction machinery both SQLite adapters share.
 *
 * It used to be duplicated: `better-sqlite3.ts` and `expo.ts` each carried
 * their own copy of the queue, the reentrancy guard and the
 * BEGIN/COMMIT/ROLLBACK control flow, differing only in how a statement is
 * executed. That is chain-of-custody code, and a duplicate has no forcing
 * function — a fix can land in the test adapter, pass every test, and never
 * reach the one adapter that actually runs on a field tablet. So the shape
 * lives here once and each adapter supplies only `run`.
 *
 * ---------------------------------------------------------------------------
 * Why there is a queue
 * ---------------------------------------------------------------------------
 *
 * SQLite has one connection here and no nested transactions, so two
 * `transaction()` calls in flight at once used to interleave: the second
 * `BEGIN` threw "cannot start a transaction within a transaction", its `catch`
 * issued a `ROLLBACK` that discarded the FIRST call's work, and the first call
 * then committed whatever the second had managed to write. Two rapid taps on
 * the capture button — each firing an un-awaited promise — is all it takes.
 *
 * For a filed record the UNIQUE index on (activity_id, sequence) turns that
 * race into a hard error: a lost capture wearing a raw SQLite message. The
 * Inbox has no activity to serialise on, but it is not the silent case this
 * used to describe: every unfiled row's `sequence` is NULL by construction
 * (`record_sequence_tracks_activity`, migration 003), so there is no Inbox
 * ordinal left to collide on. What two interleaved Inbox captures actually
 * race on now is `nextCaptureNumber`'s read-then-write —
 * `MAX(capture_number) + 1`, then INSERT — and `idx_record_capture_number` is
 * database-wide with no NULLs in it, so that race is already a hard error too.
 * The queue still earns its place: a lost capture is a bad outcome even
 * wearing a raw SQLite message instead of a silent one, and turning a loud
 * failure into no failure at all is worth doing whether or not the failure
 * would have been silent.
 *
 * Serialising here means overlapping callers queue instead. The chain holds a
 * promise that never rejects (failures are swallowed into it, and rethrown only
 * to the caller that owns them), so a transaction body that throws cannot wedge
 * every later transaction behind a rejected link.
 *
 * ---------------------------------------------------------------------------
 * Why the reentrancy guard is a timeout and not an async context
 * ---------------------------------------------------------------------------
 *
 * A transaction body must not itself call `transaction()`. Serialising turns
 * that from an error into a deadlock: the inner call waits on a queue link that
 * cannot settle until the outer body it is running inside returns. A hang has
 * no error, no stack and nothing in the log — on a field tablet mid-capture it
 * is indistinguishable from a dead device. It must be a named error.
 *
 * The previous mechanism was `AsyncLocalStorage` from `node:async_hooks`. It
 * answered the question exactly: not "is a transaction open" — which is also
 * true while a legitimately CONCURRENT caller waits its turn, and rejecting
 * those would undo the serialisation the queue exists to provide — but "did
 * this call ORIGINATE inside one", by following the body through every `await`
 * it makes without leaking to callers that merely overlap it. That reasoning
 * still holds; a plain in-flight boolean is still wrong, and would reject the
 * second of two rapid capture taps.
 *
 * What does not hold is the module. `node:async_hooks` does not exist in React
 * Native, there is no polyfill in this repo and no `metro.config.js` supplying
 * one — and `openDatabase` is a static export of this package's barrel, so
 * Metro must resolve it the instant anything imports `@corymbia/data`. The
 * outcome is a bundle failure, or worse a lenient shim that leaves the guard
 * silently inert. That `expo-sqlite` itself depends on `await-lock` is evidence
 * its maintainers hit the same wall: `await-lock` is a bare mutex with no
 * reentrancy detection, so it does not solve this half either.
 *
 * React Native offers no async-context primitive, and a call site is
 * synchronously indistinguishable from a concurrent one — there is genuinely no
 * information available at the moment of the call. What IS available is the
 * consequence: a nested call waits forever, while a concurrent call waits only
 * as long as the transactions ahead of it take. So the guard bounds the WAIT TO
 * START (not the transaction's own runtime, which may legitimately be long) and
 * treats exceeding it as a nested transaction. Imprecise, but it converts an
 * undiagnosable hang into a named, logged, stack-carrying error, which was the
 * entire point of the guard.
 *
 * The alternative considered and rejected was threading a transaction handle
 * into the body so nesting is a compile-time error. It is not actually a
 * compile-time error: the `Database` is still in lexical scope inside every
 * body, so `db.transaction(...)` still typechecks. It would change the port's
 * signature and every repository call site to buy a convention, not a
 * guarantee.
 *
 * ---------------------------------------------------------------------------
 * What the timeout does NOT catch
 * ---------------------------------------------------------------------------
 *
 * 1. It cannot tell a nested call from an honest caller queued behind a
 *    transaction that legitimately runs longer than the timeout. Such a caller
 *    gets a `NestedTransactionError` naming the wrong cause — hence the
 *    message says how long it waited and names the other possibility. Raise
 *    `transactionStartTimeoutMs` if a genuinely long unit of work exists.
 * 2. A nested call that is NOT awaited by the outer body does not deadlock: the
 *    outer body finishes, the queue advances, and the inner transaction runs as
 *    an ordinary sequential one. The old async-context guard rejected it; this
 *    one silently allows it. It still violates the port's contract, and it is
 *    still the sort of thing that produces a lost write, but nothing here
 *    reports it.
 * 3. It says nothing about two separate `Database` instances over the same
 *    file. Each has its own queue; they contend inside SQLite. That was true of
 *    the async-context guard too.
 * 4. The error arrives after the timeout, not instantly. For the timeout's
 *    duration the app looks hung — better than hung forever, worse than the
 *    immediate rejection the async-context guard gave.
 */

/**
 * How long a `transaction()` call may wait for its turn before the wait is
 * treated as a deadlock.
 *
 * Long enough that no honest transaction in this application comes close (they
 * are single-digit-millisecond writes to a local file), short enough that a
 * field user sees an error rather than deciding the tablet is dead.
 */
export const DEFAULT_TRANSACTION_START_TIMEOUT_MS = 5_000

/** Thrown when a transaction never got its turn — see the timeout reasoning above. */
export class NestedTransactionError extends Error {
  override readonly name = 'NestedTransactionError'

  constructor(waitedMs: number) {
    super(
      `Nested transaction: this transaction waited ${waitedMs}ms for its turn and never got ` +
        'one. Transactions on a database are serialised, so a transaction body that calls ' +
        'transaction() again waits for a queue that cannot advance until that body returns — a ' +
        'deadlock. Pass every statement of the unit of work to a single transaction() call ' +
        'instead of opening a second one. (If instead some transaction on this database ' +
        `legitimately takes longer than ${waitedMs}ms, raise transactionStartTimeoutMs when ` +
        'opening it.)',
    )
  }
}

/**
 * Marks a queued transaction whose caller has already given up on it. Not
 * exported: it never escapes to a caller, because the only promise it can
 * reject is the queue link, whose handlers discard both outcomes.
 */
class AbandonedTransactionError extends Error {
  override readonly name = 'AbandonedTransactionError'

  constructor() {
    super('This transaction was abandoned by its caller before it reached the head of the queue.')
  }
}

export interface TransactionRunnerOptions {
  /** Overrides {@link DEFAULT_TRANSACTION_START_TIMEOUT_MS}. Tests use a small value. */
  readonly startTimeoutMs?: number
}

/** Runs one statement against the underlying driver. The only thing adapters differ in. */
export type RunStatement = (sql: string) => Promise<void>

/**
 * Builds the `transaction` method for a `Database`, given only a way to run a
 * statement. One runner owns one queue, so it must be created once per open
 * database and never shared between connections.
 */
export function createTransactionRunner(
  run: RunStatement,
  options: TransactionRunnerOptions = {},
): <T>(fn: () => Promise<T>) => Promise<T> {
  const startTimeoutMs = options.startTimeoutMs ?? DEFAULT_TRANSACTION_START_TIMEOUT_MS

  /** The tail of the queue: a promise that resolves when the last-queued transaction is done. */
  let queue: Promise<void> = Promise.resolve()

  return function transaction<T>(fn: () => Promise<T>): Promise<T> {
    // 'waiting' until this call reaches the head of the queue; then either
    // 'running' (its body owns the connection) or 'abandoned' (its caller gave
    // up first, so the body must never run). The two are mutually exclusive and
    // both are terminal, which is what makes the race below safe.
    let state: 'waiting' | 'running' | 'abandoned' = 'waiting'

    let announceStart: () => void = () => undefined
    const started = new Promise<void>((resolve) => {
      announceStart = resolve
    })

    const mine: Promise<T> = queue.then(async (): Promise<T> => {
      if (state === 'abandoned') {
        // The caller already threw. Skip the body entirely — running it now
        // would execute a unit of work whose caller believes it failed, and in
        // the deadlock case would run it AFTER the outer transaction rolled
        // back. Rejecting rather than resolving keeps the return type honest;
        // the queue's handlers below are the only ones that will ever see it.
        throw new AbandonedTransactionError()
      }
      state = 'running'
      announceStart()

      await run('BEGIN')
      try {
        const result = await fn()
        await run('COMMIT')
        return result
      } catch (error) {
        await run('ROLLBACK')
        throw error
      }
    })

    // The next caller waits on an outcome-free link, so a rejected body — or an
    // abandoned one — cannot wedge the callers behind it.
    queue = mine.then(
      () => undefined,
      () => undefined,
    )

    return waitForTurn()

    async function waitForTurn(): Promise<T> {
      let timer: ReturnType<typeof setTimeout> | undefined
      const timedOut = new Promise<'timed-out'>((resolve) => {
        timer = setTimeout(() => resolve('timed-out'), startTimeoutMs)
      })

      const outcome = await Promise.race([started.then((): 'started' => 'started'), timedOut])
      clearTimeout(timer)

      // The state check, not the race result, is what decides. If the timer and
      // the start land in the same tick the race may report 'timed-out' for a
      // transaction that is already running, and abandoning that one would
      // reject a caller whose BEGIN has been issued.
      if (outcome === 'timed-out' && state === 'waiting') {
        state = 'abandoned'
        throw new NestedTransactionError(startTimeoutMs)
      }
      return mine
    }
  }
}
