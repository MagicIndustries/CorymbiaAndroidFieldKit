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
  /** How many captures are sitting in the Inbox. The strip appears at ≥ 1. */
  unfiledCount: number
  /** True only until the first read comes back — see `refresh` below. */
  loading: boolean
  /** Re-reads everything. Called on every focus, and callable directly. */
  refresh: () => Promise<void>
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

type Resolved = Omit<CurrentContext, 'refresh'>

const NOTHING_YET: Resolved = {
  carryOn: null,
  activityId: null,
  unfiledCount: 0,
  loading: true,
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
        unfiledCount: unfiled.length,
        loading: false,
      })
    } catch {
      if (!mounted.current || ticket !== generation.current) return
      /*
        A read that failed leaves whatever was last read successfully, and
        stops claiming to be loading. It does not blank the card: the count
        it is showing was true a moment ago, and replacing it with nothing
        because a later read failed tells her less, not more. On the first
        read there is nothing to keep, so this is the first-run card — which
        is also what a device with a genuinely empty database shows.
      */
      setResolved((current) => ({ ...current, loading: false }))
    }
  }, [db])

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

  return { ...resolved, refresh }
}
