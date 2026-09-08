# How media attachments are stored

This document explains four decisions about where a photo or voice note ends up on disk and
in the database, and why each one is the way it is. None of the four is derivable just by
reading the code that implements it — each is the survivor of a rejected alternative, and the
alternative is exactly what a future change is likely to reach for. Spec §12.1 is the design
source; this document is the "why", written down once so it does not have to be rediscovered.

The code lives in `packages/media/src/naming.ts` and `packages/media/src/store/expo.ts`
(the file side), `packages/data/src/migrations/005-media.ts` and
`packages/data/src/repositories/media.ts` (the row side), and
`apps/fieldkit/src/media/useAttachMedia.ts` (the pipeline that drives both together).

---

## 1. Why files are named by the media id, and nothing else

A stored file is named `<media id>.<extension>` — `med_k3j9f2.jpg`, say — in one flat
directory. Three richer names were each tried and rejected, in that order, over the life of
spec §12.1, and all three failed for the same underlying reason: **a path must not depend on
anything that can change.**

- **Not the title.** A title is editable, so the name it produced today can be wrong tomorrow.
  It can be duplicated across records, so two photos would want the same name. It can be
  blanked, so a record with no title has no name to give its photo. And it can contain a
  slash, which is not a character a filesystem path can absorb from free text without either
  rejecting it or silently writing somewhere unintended.
- **Not a project directory.** An earlier draft filed each attachment's bytes under the
  project it belonged to. That cannot hold once records are refilable between projects — an
  Inbox record gets filed, or a record moves from one activity to another — because the file
  would have to move too, on a device that can lose power mid-move. A half-finished move on a
  dying battery leaves a row pointing at a file that is no longer where the row says it is.
- **Not the record id plus an index.** The record id is stable, but the _index_ — first photo,
  second photo — is not. Removing the first of three photos moves every index after it down by
  one, and with it every filename those indexes were embedded in. Worse, because deletion here
  is soft (§3 below), the file the removed attachment was using is still sitting on disk under
  its old name when a new attachment arrives to claim that same index — a collision between a
  live file and a supposedly-freed name.

All three rejected names share the same shape: they derive a path from something mutable, and
the path silently goes stale the moment that thing changes. **This is the third time that
exact failure was designed out of this one spec section** — title, then project directory,
then record-plus-index, each one caught and rejected for the identical reason. Writing it down
here is what makes this the last time: the next contributor reaching for a "more readable"
filename should find this paragraph before they find the same failure the hard way.

The media row's own id is minted once (`newMediaId`, `packages/data/src/repositories/media.ts`)
and never changes for the life of the row. That is what makes it safe to build a path from.
The record an attachment belongs to, and its display position within that record, are both
columns — `record_id` and `ordinal` — because a mutable relationship belongs in a column that
can be updated in place, not baked into a path that would have to be rewritten to match.
Human-readable names (project, sequence, title slug) are applied only at export time, where
the project and the sequence are both known and settled, and nothing downstream depends on
them the way the stored path does.

## 2. File before row, and the failure that ordering chooses

Attaching a photo or a voice note is not one write, it is two: bytes land on disk, and a row
describing them lands in the `media` table. `useAttachMedia.ts`'s `attachOne` always does the
file first — mint the media id, derive the filename from it, write the bytes to storage — and
only inserts the row once that write has succeeded.

That ordering is a deliberate choice between two possible failure modes, not an accident of
implementation order. A crash between the two steps — the app killed, the device losing power,
the OS reclaiming memory — leaves whichever step already ran and abandons the other. File
first means that gap leaves an **orphaned file with no row**: bytes sitting in the media
directory that nothing in the database points at. Row first would mean the opposite gap, a
**row with no file behind it**. The two are not equally bad. An orphaned file is invisible and
harmless — it costs a little storage until a deliberate purge finds and clears it, and nothing
that reads the database ever notices it exists. A row with no file is a broken record: the
media strip renders a tile, the tile has nothing to show, and an export bundle produces a
manifest entry pointing at a file that was never there. File-then-row is the ordering under
which the only possible failure is the recoverable one.

The same reasoning holds inside `attachMedia` itself (`packages/data/src/repositories/media.ts`):
the `media_added` event is appended _before_ the row insert, within the same transaction, so
that if the insert is refused — the unique file-name collision, most obviously — the
transaction's rollback is what a test can actually observe undoing. If the row insert on its
own path is refused after the file has already been written, `attachOne`'s catch block removes
the file it just wrote, restoring the orphan-free state; if that removal itself fails, the
original insert failure is what gets reported, because a leaked file is recoverable later and
the insert failure is the thing she needs to hear about right now.

## 3. Deletion is soft, so a filename must never be reused

Removing an attachment (`removeMedia`, same file) does not delete its row or its bytes. It
flags the row's `deleted_at` column and leaves both exactly where they are. The file survives
on disk until a deliberate purge, run later from settings, actually clears it — a decision
that exists so a removal made in error, or a purge that never gets run because the device is
never plugged into anything, does not silently cost her a photo she thought was safe.

That has one consequence that is easy to get backwards: **a filename must never be handed to a
second attachment, even after the first one that used it has been removed.** The bytes it
names are still there, awaiting a purge that may be weeks away, and a new capture claiming
that name would silently overwrite them — one record's photo becoming another's, with both
rows still looking correct until someone opens the file and finds the wrong image behind it.

This is exactly why the two unique indexes migration 005 puts on `media` are not written the
same way, and why that difference is deliberate rather than an inconsistency to "fix":

- **`idx_media_file_name` is a full unique index, covering every row including deleted ones.**
  A filename can never be reused for the life of the database, because the constraint has no
  `WHERE` clause carving deleted rows out of its view.
- **`idx_media_record_ordinal` is a partial unique index, `WHERE deleted_at IS NULL`.** Display
  position is not the same kind of fact as a filename — reusing an ordinal after its attachment
  is removed is exactly what should happen, so the record's remaining attachments still occupy
  a tidy, gap-tolerant sequence of positions rather than being frozen around a hole left by
  something no longer shown. (`nextOrdinal`, in the same repository file, only ever reads live
  rows for precisely this reason — see its own doc comment for the gap this narrower rule still
  leaves: removing the middle of three attachments leaves positions 1, 3, 4 rather than
  renumbering everything back down to 1, 2, 3.)

Making these two indexes match each other — adding `WHERE deleted_at IS NULL` to the file-name
index, on the reasoning that "the other one has it, so this one should too" — is the change
that looks like tidying and is actually the bug: it would let a soft-deleted attachment's
filename be reused by whatever gets captured next, silently overwriting bytes a purge has not
yet had the chance to clear. The two indexes differ on purpose. Say so before someone
"corrects" it.

## 4. Why `Paths.document`, and not `Paths.cache`

`createExpoMediaStore` (`packages/media/src/store/expo.ts`) writes every attachment under
`Paths.document`, SDK 57's directory "safe from being deleted by the system" — deliberately
not `Paths.cache`, the directory the same SDK describes as one the system can clear whenever
the device is short on storage.

The reason is not a style preference between the two APIs, it is what each one actually costs
if chosen wrongly here. Android is free to reclaim `Paths.cache` under storage pressure at any
time, with no warning to the app and no error surfaced to the code that wrote there. A field
device filling up with a day's photos and voice notes — the exact moment this app exists to
serve — is precisely when that pressure is most likely to occur. If the media directory lived
under `Paths.cache`, the failure mode would not be a crash or a caught exception to handle; it
would be files quietly vanishing while their rows in the `media` table kept right on existing,
pointing at bytes that used to be there. Nothing in the app would notice until someone opened
the record later — most plausibly at export, at the end of the trip, the single worst possible
moment to discover a day's photos are gone. `Paths.document` is the one choice under which that
failure cannot happen silently: the system does not reclaim it, so a row that names a file
there can trust the file is still where it says.
