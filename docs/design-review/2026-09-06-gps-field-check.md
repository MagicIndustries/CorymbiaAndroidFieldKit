# GPS and database field check — S25

Run this **outside, with a clear view of the sky**. Open the app, tap
**Open the GPS and database diagnostics** on the launcher screen.

The point of this trip is to replace guesses with measurements. Two numbers set
thresholds for the capture screen in the next plan, so write them down even if
everything looks fine:

- **cold-start time** — from opening the screen to the first single-figure accuracy
- **best accuracy reached** — the lowest ± metres you see, and how long it took

## The one that matters most

Watch the **verdict**. It should read `improving` while accuracy is falling, and
`plateaued` once it settles.

**If it never says `plateaued` outdoors, the threshold is wrong** — and the capture
control would tell her to keep holding a fix that stopped improving a minute ago.
Note how long you had to hold before it flipped, or that it never did.

## Checks

- [ ] First launch: migrations report as applied. Close and reopen: they report as already current.
- [ ] The permission prompt appears; granting it starts readings flowing.
- [ ] Accuracy reaches single-figure metres. **Note how long from cold.**
- [ ] The grade moves `poor` → `fair` → `good` as the fix settles.
- [ ] The verdict reads `improving`, then `plateaued`. **Note the time, or that it never flipped.**
- [ ] Hold for about five seconds, release. The saved record shows a sample count of
      roughly one per second **plus one** — the reading already on screen when you
      pressed is included — and a small spread.
- [ ] Save an ambient fix. Its age in seconds grows as the fix gets older.
- [ ] Save a second pin on the same spot: the duplicate warning appears.
- [ ] Records list shows per-activity sequence numbers starting at 1.
- [ ] Force-stop the app, relaunch, reopen the screen: **the records are visible on
      arrival**, without pressing anything.
- [ ] Change the capture-control side and the handedness. Force-stop, relaunch:
      both survive. A preference that resets at launch is not a preference.
- [ ] The DEVICE panel reports a plausible model and OS, and registers as `phone`.
      Note anything the platform declines to report, so the gaps are known rather
      than assumed.
- [ ] The mocked flag reads `no` — not `not reported`. Those are different, and the
      difference is deliberate: a fix that cannot show it was not spoofed is not
      evidence. If you have a mock-location app, enable it once and confirm the flag
      flips; a chain-of-custody guard nobody has seen fire is not a guard.

## If something misbehaves

Screenshot it into this folder. The failure modes worth capturing are: the verdict
never plateauing, accuracy stalling in double figures, a device row appearing twice
after a relaunch, or a save reporting an error rather than a record.
