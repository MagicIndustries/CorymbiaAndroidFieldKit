import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { getClient, listRecords, listUnfiledRecords, readCurrentContext } from '@corymbia/data'
import type { CarryOn } from '@corymbia/ui'
import { useDatabase } from '../db/provider'

/**
 * What the launcher resumes into, and what the capture screen files into
 * (spec §10.1).
 *
 * The repository half of this is `readCurrentContext` in `@corymbia/data`,
 * which already answers "which activity is she in" — including the fallback
 * to the most recently started one when the stored id no longer names a live
 * activity. **Nothing here re-implements any of that.** This hook is the two
 * things the repository cannot do: turn that answer into the exact shape
 * `CarryOnCard` renders, and keep it fresh as she comes and goes.
 */
export type CurrentContext = {
  /** The card's contents, or `null` on a genuine first run — never a stub. */
  carryOn: CarryOn | null
  /**
   * The activity a capture taken right now belongs to, or `null` for the
   * Inbox — handed straight to `useCapture` (see `CaptureDeps.activityId`).
   *
   * Separate from `carryOn` rather than read off it, because `CarryOn` is a
   * presentation type: it carries the names a person reads and deliberately
   * carries no id at all (doctrine rule 6 keeps ids off the screen). The
   * screen needs both, and only one of them is renderable.
   */
  activityId: string | null
  /**
   * The project that activity belongs to, or `null` on a genuine first run.
   *
   * Separate from `carryOn` for the same reason `activityId` is: `CarryOn`
   * carries the project's NAME and no id at all (doctrine rule 6). The
   * launcher needs the id — "New activity" starts one in the project she is
   * already in, and `/new-activity` cannot create against a name.
   */
  projectId: string | null
  /** How many captures are sitting in the Inbox. The strip appears at ≥ 1. */
  unfiledCount: number
  /** True only until the first read comes back — see `refresh` below. */
  loading: boolean
  /**
   * Why the last read failed, or null when the last one succeeded.
   *
   * **A failed read is not a fresh install, and the difference is the whole
   * reason this field exists.** Before it, any throw from the four queries
   * left `carryOn` at its initial `null` and the launcher drew its first-run
   * face: "No project yet, so there is nothing to carry on with" — a claim
   * about her data, said out loud by a screen reader, on the screen she opens
   * most (doctrine rules 16 and 20). Nothing on screen distinguished that
   * from a lost selection, and the hardware checklist lists exactly that
   * sentence on reopen as a *failure* to report.
   *
   * The `Error` rather than a sentence: the sentence a person reads belongs to
   * the screen that shows it (`index.tsx`'s `messageFor`), which is where
   * `records.tsx` and `projects.tsx` keep theirs too.
   */
  error: Error | null
  /** Re-reads everything. Called on every focus, and callable directly. */
  refresh: () => Promise<void>
  /**
   * The activity a capture *written now* belongs to — the same answer as
   * `activityId`, except that it waits for the first read when that read has
   * not landed yet, instead of answering `null` because it has not.
   *
   * **This exists for the few milliseconds between a screen mounting and its
   * read coming back.** `capture.tsx` reads the context here rather than
   * taking it as a navigation parameter, so on a cold launch straight onto
   * `/capture` there is a window where `activityId` is `null` only because
   * nobody has looked yet. A tap in that window used to write a record with
   * `activityId: null` AND `contextActivityId: null` — filed to the Inbox
   * with no trace of where she was, and §8.3 makes the context half
   * unrevisable, so the Inbox could never suggest where it belonged.
   *
   * It is a function returning a promise rather than a value so that the
   * answer is read from the read itself, not from a React render: resolving a
   * promise does not guarantee the component has re-rendered with the new
   * props by the time the awaiting code continues, and a value refreshed by
   * rendering would still be stale in exactly the window this closes.
   *
   * It never rejects — a failed read resolves it with whatever was last known,
   * which on a first run is `null`, the Inbox, a supported destination.
   */
  settledActivityId: () => Promise<string | null>
}

/**
 * What is shown where a project's client has been soft-deleted out from under
 * it. `project.client_id` is `NOT NULL REFERENCES client(id)` (migration
 * 001), so there is always a client id; `getClient` reads a deleted row as
 * absent, and that is the one case this covers. Naming the gap is honest;
 * printing the id would put an id in front of her (doctrine rule 6), and
 * printing nothing would leave the card looking like it had simply lost a
 * line.
 */
const UNKNOWN_CLIENT = 'Client unknown'

type Resolved = Omit<CurrentContext, 'refresh' | 'settledActivityId'>

const NOTHING_YET: Resolved = {
  carryOn: null,
  activityId: null,
  projectId: null,
  unfiledCount: 0,
  loading: true,
  error: null,
}

/** A promise settled by hand, for `settledActivityId` to wait on. */
type Deferred = { promise: Promise<void>; settle: () => void }

function deferred(): Deferred {
  // The executor runs synchronously, so `settle` is the real one by the time
  // this returns — no definite assignment assertion needed.
  let settle: () => void = () => undefined
  const promise = new Promise<void>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

/**
 * A thrown value as an `Error`, because `CurrentContext.error` is typed as one
 * and a repository can in principle reject with anything. The same shape
 * `records.tsx` and `projects.tsx` use before formatting their sentence.
 */
function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause))
}

export function useCurrentContext(): CurrentContext {
  const db = useDatabase()
  const [resolved, setResolved] = useState<Resolved>(NOTHING_YET)

  /**
   * Guards the `setState` after the awaits: she can leave the launcher —
   * `CAPTURE` is live on it, so leaving is one tap — while the reads are
   * still in flight.
   */
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  /**
   * Which read the state currently belongs to, exactly as `capture.tsx`'s
   * media refresh does it and for the same reason: launcher → capture → back
   * → records → back happens in a couple of seconds in the field, each
   * return starts a read without cancelling the one before it, and two in
   * flight can resolve in either order. Every read takes a ticket and only
   * the holder of the current one may write, which is last-request-wins
   * rather than last-response-wins — an older read finishing last cannot put
   * a stale capture count or a vanished Inbox strip back on screen.
   */
  const generation = useRef(0)

  /**
   * The answer `settledActivityId` gives, kept where a read can write it and
   * an `await` can read it without a render in between — see that field's own
   * note for why a rendered value would not do.
   */
  const settledActivity = useRef<string | null>(null)

  /**
   * Settled when the first read has come back, successfully or not.
   *
   * Lazily created once and then kept: a `useRef(deferred())` would build a
   * new promise on every render, and a countdown re-renders this hook's
   * callers several times a second.
   */
  const firstRead = useRef<Deferred | null>(null)
  if (firstRead.current === null) firstRead.current = deferred()
  const firstReadDone = firstRead.current

  /*
    Settled on unmount as well, and that is not tidiness. `useCapture` awaits
    this immediately before writing its row; a screen that goes away with the
    first read still in flight would otherwise leave that await pending for
    ever and the record would never be written at all — losing the capture,
    which is worse than the null destination this whole seam exists to
    prevent. Settling here resolves it with whatever was last known.
  */
  useEffect(() => {
    return () => {
      firstReadDone.settle()
    }
  }, [firstReadDone])

  const refresh = useCallback(async (): Promise<void> => {
    generation.current += 1
    const ticket = generation.current

    try {
      const context = await readCurrentContext(db)

      /*
        Two queries answering two different questions, and they are not
        interchangeable: `listRecords` counts what is IN this activity and
        `listUnfiledRecords` counts what is in no activity at all. Reporting
        one for both would be invisible on a device — the numbers would look
        plausible either way — so `useCurrentContext.test.ts` pins them apart
        with different counts.

        `getClient` is the third because `CarryOn` wants a client NAME and
        `Project` carries only a `clientId`.
      */
      const [unfiled, records, client] = await Promise.all([
        listUnfiledRecords(db),
        context === null ? Promise.resolve([]) : listRecords(db, context.activity.id),
        context === null ? Promise.resolve(null) : getClient(db, context.project.clientId),
      ])

      if (!mounted.current || ticket !== generation.current) return

      settledActivity.current = context === null ? null : context.activity.id

      setResolved({
        carryOn:
          context === null
            ? null
            : {
                projectName: context.project.name,
                activityName: context.activity.name,
                // `Activity['kind']` and `CarryOn['activityKind']` are the
                // same five words declared in two packages, and this
                // assignment is what makes a drift between them a compile
                // error rather than a card that renders a blank label.
                activityKind: context.activity.kind,
                startedAt: context.activity.startedAt,
                captureCount: records.length,
                clientName: client === null ? UNKNOWN_CLIENT : client.name,
              },
        activityId: context === null ? null : context.activity.id,
        projectId: context === null ? null : context.project.id,
        unfiledCount: unfiled.length,
        loading: false,
        error: null,
      })
    } catch (cause) {
      if (!mounted.current || ticket !== generation.current) return
      /*
        A read that failed leaves whatever was last read successfully, and
        stops claiming to be loading. It does not blank the card: the count
        it is showing was true a moment ago, and replacing it with nothing
        because a later read failed tells her less, not more. On the first
        read there is nothing to keep, so there is no card — and the screen
        shows the failure and a way to try again rather than the first-run
        face, which would be a claim about her data (doctrine rules 16 and
        20). `index.tsx` is where that branch is drawn.
      */
      setResolved((current) => ({ ...current, loading: false, error: asError(cause) }))
    } finally {
      /*
        Only the current read may settle this. A superseded one finishing
        first would otherwise hand `settledActivityId` the answer of a read
        whose result was thrown away — and the newer read, which is about to
        land, settles it with the right one a moment later.
      */
      if (ticket === generation.current) firstReadDone.settle()
    }
  }, [db, firstReadDone])

  /**
   * Stable across renders, so a caller may hold it (`capture.tsx` hands it
   * straight to `useCapture`, which reads its deps on every render but must
   * not see a new identity each time).
   */
  const settledActivityId = useCallback(async (): Promise<string | null> => {
    await firstReadDone.promise
    return settledActivity.current
  }, [firstReadDone])

  /**
   * Re-read every time the launcher becomes the focused route, not once on
   * mount. She returns here constantly — from a capture, from filing, from
   * creating a project — and every one of those changes something this hook
   * reports. `useFocusEffect` fires on first focus too, so this REPLACES a
   * mount effect rather than sitting beside one; keeping both would read
   * everything twice on every entry.
   *
   * It lives in the hook rather than in the screen so that the fetch and the
   * ticket that orders it cannot be separated: a second caller of this hook
   * gets the freshness without having to remember the effect.
   *
   * **`loading` is deliberately not set back to true here.** It marks the
   * first read only. A refresh that blanked the card would take `CAPTURE`
   * off the screen for a frame every single time she came back from one,
   * which is the opposite of §10.1's "open the application and capture as
   * fast as possible" — so a re-read replaces the numbers when it lands and
   * changes nothing before then.
   */
  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )

  return { ...resolved, refresh, settledActivityId }
}
