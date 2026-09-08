# Media capture: the checks only the device can answer

Plan 4 added photos and voice notes to a captured record. Everything below is a question the
test suite cannot answer — layout that needs a real layout engine, platform behaviour that only
exists on Android, and file operations that only exist on a real filesystem.

**This is not a formality.** Across this plan, four separate versions of the voice screen passed
their full test suite and were wrong on the device; two of those were found only by reading the
bundled Kotlin. A green suite is evidence about the code, not about the phone.

## Before you start

**Run `npx expo prebuild --platform android`.** `app.json` gained the camera config plugin,
`CAMERA`, `RECORD_AUDIO`, a microphone permission string and `barcodeScannerEnabled: false`.
None of that reaches the Android manifest without prebuild, and both the camera and the voice
screen then fail at runtime with no useful message.

Then take a **release** build (`npx expo run:android --variant release`) so the JavaScript
bundle is embedded and the phone needs no development machine attached.

Run everything on the S25 **and** on the 10.36-inch tablet. The tablet has never run this app.

## The voice screen

The voice note screen went through five review passes. Three of them were verified green and
were **wrong on the device** — the first branched on a 500 ms poller and discarded real speech
as a stray tap; the second left the button reading "Stop" after the recorder stopped on its
own, so the next tap recorded over the lost note; the third watched a signal the bundled Kotlin
never moves on Android for any of the three causes its own comment named. Everything below is a
question a mock cannot answer, and the history says that is exactly where this screen fails.

Take a **release** build so the JS bundle is embedded, and run these on the tablet as well as
the S25 — the tablet has never run this app.

1. **Does an interrupted recording tell her anything at all?** Start a note, then make the
   recorder fail — kill the media server over adb, or start a recording in another app to take
   the microphone. Expect the button to return to "Record" within about a second and a red
   sentence saying the recording stopped on its own and was not saved. **If the button still
   says "Stop", the event is not reaching JS and this has failed the same way pass 3 did.**
2. **Can she record again straight afterwards?** Immediately after that message, record five
   seconds and stop. Expect a normal note, no crash, and nothing mentioning "already prepared".
   That is the entire reason the forced stop exists.
3. **Press Record again very fast.** Within a second of the interruption message, and again
   straight after a deliberate too-short tap (Record, Stop inside a second, Record again at
   once). Expect nothing to claim the note you just started "stopped on its own", and no voice
   note on the record that you did not finish. Either would be the stale-event bug on hardware.
4. **Ring the phone mid-recording.** Have someone call, answer, hang up, then stop the note.
   Write down what actually happened: any message, whether it attached, and — on playback —
   whether the audio goes silent from the moment the call started. The likely answer is that
   nothing on screen changes and it records silence. That is a platform limitation nothing in
   JavaScript can fix, and it belongs in the field notes rather than left implied.
5. **Does an interruption ever hand back a file?** Note whether any interruption says "was
   saved" or "was not saved". Everything read off the native source says it will always be "not
   saved" on Android with the current preset. If you ever see "was saved", play that note back
   and confirm it is not a broken file.
6. **Does the timer stop?** During an interruption message, watch the elapsed readout for ten
   seconds. It must sit still.
7. **Is a real note's length right?** Record against a stopwatch for exactly 30 s and stop
   deliberately; the stored duration should be within a second. Then a 2 s note (must be kept)
   and a 0.5 s tap (must be discarded as too short) — and check the cache directory afterwards
   to confirm the discarded file is actually gone.

## Everything else

### The rest

1. **Take a photo on a record.** Confirm the count on the Photo tile goes to 1 and the
   thumbnail actually appears — the tile's image height was changed from a percentage to an
   explicit token value because a percentage against a parent with only `minHeight` is a Yoga
   trap that can resolve to zero, invisible to Jest.
2. **Take three more.** Confirm the strip scrolls horizontally rather than shrinking the tiles
   to fit.
3. **Record a voice note.** Confirm the elapsed time visibly moves while recording — a frozen
   timer means the recorder never actually started.
4. **Play it back.** Confirm it is the note just recorded, not a previous one.
5. **Remove a photo.** Confirm it disappears and the remaining photos keep their order. Then
   tap deliberately near the boundary between two adjacent tiles: their remove hit regions meet
   exactly there with zero margin (an 8dp tile gap exactly absorbs 8dp of hitSlop expansion on
   each side), so confirm the photo you meant to remove is the one that goes, not its neighbour.
6. **Force-quit the app and reopen the record.** Confirm every attachment — photos and voice
   notes both — is still there. This is the one check that proves files landed in
   `Paths.document` and not somewhere the OS can reclaim without warning (see
   `docs/media-storage.md` §4).
7. **Deny the camera permission, then reopen the camera screen.** Confirm it explains where to
   turn the permission back on, rather than showing a dead viewfinder. Do the same for the
   microphone on the voice screen.
8. **Turn the device sideways on the camera screen.** Confirm the shutter is still reachable.
   Issue #7 covers the capture screen's own landscape layout; note here anything the camera
   screen visibly shares with that problem, or confirms it does not.
9. **The navigation shell changed from `Slot` to `Stack`** — the fix for a bug where pressing
   Photo destroyed all recorded state (the capture screen unmounted under `Slot` and came back
   blank, with no route back to the record). Nothing in Jest can see this. After taking a
   photo, confirm the capture screen still shows the same record: its capture number and
   accuracy are unchanged, not reset. Also check the hardware back button and the back gesture
   both behave sensibly, that no header bar appeared where none should be, and that the
   safe-area insets still look right on both a phone and the tablet.
10. **The cold-start position.** The ambient cache refreshes when the capture screen mounts.
    Launch the app fresh, go straight to a record and attach a photo *without* ever visiting
    the capture screen, and note whether the resulting `media_added` event carries a position
    or none. Both are legitimate outcomes (spec §8.2 names cold start as a legitimate "none")
    — the point of this check is to know which one actually happens on this device rather than
    assume it.
11. **A cross-directory file move, on the real filesystem.** The photo/voice save path moves
    the captured file from the camera's or recorder's own temporary directory into
    `Paths.document/media`. The unit tests exercise this against an in-memory fake whose
    reported file size is snapshotted at construction rather than read live — confirm on
    device that a real photo's byte size (visible in, e.g., a file manager or `adb shell ls
    -la`) matches what actually got written, and that the move itself completes cleanly across
    the two real directories rather than merely in the fake's model of them.

## Where the reasoning lives

- `docs/media-storage.md` — why files are named by media id, the file-then-row ordering, and
  why `Paths.document` rather than `Paths.cache`.
- `docs/ui-doctrine.md` — the counts-and-busy rule the affordance row now carries.
- Spec §8.2 (deliberate versus ambient positioning), §9.6 (what follows a pin) and §12.1
  (storage).
- Issue #7 — the capture screen's landscape layout, which item 8 below touches on.
