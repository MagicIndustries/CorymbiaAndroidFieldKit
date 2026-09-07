# How the field kit works out its GPS accuracy

This document explains the number the app puts next to a sample position — the
"± 4 m" figure — where it comes from, how holding the SHARPEN control changes
it, and why it is calculated the cautious way rather than the flattering way.

It is written for the person using the app in the field, not for a
statistician. The formulas are here because they have to be somewhere, but each
one is explained in words as well.

The code lives in `packages/geo/src/average.ts`.

---

## 1. What Android's accuracy figure actually means

Every position Android hands the app comes with an accuracy in metres. It is
tempting to read "5 m" as "the phone is within 5 m of the truth". It does not
mean that.

It means: **the receiver believes there is roughly a 68% chance the true
position is within a circle of that radius.** One time in three, near enough,
the truth is outside the circle. It is a confidence radius, not a guarantee,
and not a worst case.

The figure is the receiver's own estimate, computed from things it can observe:

- **How many satellites it can see, and where they are in the sky.** Satellites
  spread evenly across the sky give a sharp fix. Satellites bunched together —
  common in a gully, under a ridge, or against a building — give a smeared one.
  This is what "satellite geometry" or "dilution of precision" refers to.
- **Signal strength and noise** on each satellite it is tracking.
- **Whether the signal arrived directly or bounced.** A signal that reflects off
  rock, water, a shed roof or a tree trunk before reaching the antenna has
  travelled further than the straight-line distance, so it reports the phone as
  further from that satellite than it is. This is **multipath**, and it is the
  single biggest reason a fix under canopy or beside a cliff is worse than one
  in an open paddock.
- **Atmospheric delay** through the ionosphere and troposphere, partly modelled
  and partly guessed at.

Two consequences worth carrying into the field:

- The estimate can itself be wrong. A receiver in bad multipath sometimes
  reports a confident-looking number for a position that is tens of metres out.
- A better number is not always achievable. If the sky is half-blocked, no
  amount of standing still will produce a 3 m fix, because the limiting factor
  is not randomness — it is the geometry and the reflections, and those do not
  average away.

That second point is the reason for the floor described in section 5.

---

## 2. What a hold collects

When you press and hold SHARPEN on the capture screen, the app does not throw
away the readings it already had and take a fresh one. It **keeps every reading
the receiver produces while you hold**, each one a complete little record:

- latitude and longitude,
- the receiver's accuracy estimate for that reading, in metres,
- altitude, where the platform supplies it,
- a timestamp,
- a flag saying whether the reading came from a mock location provider.

A typical hold looks like a receiver settling down as it acquires more
satellites and refines its solution. Something like:

| # | accuracy |
|---|----------|
| 1 | 40 m |
| 2 | 20 m |
| 3 | 10 m |
| 4 | 6 m |
| 5 | 5 m |
| 6 | 4 m |

Six readings, but they are plainly not six equally good opinions. The 40 m
reading was the receiver guessing; the 4 m reading was the receiver reasonably
sure. Any sensible way of combining them has to say so.

---

## 3. Combining the readings: inverse-variance weighting

Each reading is given a **weight**, and the weight is:

```
w = 1 / accuracy²
```

In words: **a reading counts in proportion to how sharp it claims to be, and
the effect is squared.** A reading good to 2 m does not count twice as much as
one good to 4 m — it counts four times as much. A reading good to 4 m counts a
hundred times as much as one good to 40 m.

That squaring is not arbitrary. An accuracy figure is a radius of uncertainty,
and the natural statistical measure of uncertainty is its square (the variance).
Weighting by one-over-variance is the standard, provably best way of combining
measurements of the same quantity that have different reliabilities — if the
errors are random and independent, no other set of weights gives a tighter
answer.

### The position

```
latitude  = Σ(w × latitude)  / Σw
longitude = Σ(w × longitude) / Σw
```

In words: **add up every reading's coordinate after multiplying it by that
reading's weight, then divide by the total weight.** The fix lands near the
readings the receiver was confident about, and the poor early readings barely
move it. That is the entire point of holding the control — before this change,
the app took a plain average, so a 40 m reading taken in the first second
dragged the final position exactly as hard as the 4 m reading taken in the
last.

### The accuracy

```
combined accuracy = 1 / √(Σw)
```

In words: **add up all the weights, take the square root, and invert it.** More
readings means more total weight means a smaller number, so accuracy improves
as you hold — but a poor reading adds almost no weight, so holding through a
run of bad readings barely improves anything. Which is honest: it did not
actually help.

### Worked example

Using the six readings from section 2:

| accuracy | w = 1 / accuracy² |
|----------|-------------------|
| 40 m | 1 / 1600 = 0.000625 |
| 20 m | 1 / 400  = 0.0025 |
| 10 m | 1 / 100  = 0.01 |
| 6 m  | 1 / 36   = 0.027778 |
| 5 m  | 1 / 25   = 0.04 |
| 4 m  | 1 / 16   = 0.0625 |
| **Σw** | **0.143403** |

```
combined accuracy = 1 / √0.143403 = 1 / 0.378686 = 2.64 m
```

So the app reports **2.64 m**.

Notice what the weights show at a glance: the 4 m reading contributes 0.0625 of
the 0.1434 total — about 44% of the answer on its own — while the 40 m reading
contributes 0.000625, or about 0.4%. The good reading is a hundred times as
influential as the bad one, without the bad one having to be thrown away.

### Why this replaced the old calculation

The old formula took the *best* single reading and divided it by the square
root of how many readings there were: `4 / √6 = 1.63 m`. It ignored the quality
of every reading except one, so a hold that collected five terrible readings and
one good one reported a better figure than the good reading alone — and the
position it reported was a plain average that the five terrible readings had
pulled around. The two halves of the calculation disagreed with each other.

For the example above the old code reported 1.63 m for a fix the readings
support at about 2.64 m. That is not a rounding difference; it is a claim of
sub-2-metre survey precision that the hardware never delivered.

### It is a generalisation, not a replacement

If every reading in a hold has the same accuracy σ, then every weight is the
same, `Σw = n / σ²`, and the formula reduces to:

```
1 / √(n/σ²) = σ / √n
```

which is exactly the familiar "averaging n readings improves accuracy by √n".
So the new maths does not contradict the old rule of thumb — it is the same
rule, extended to the realistic case where the readings are not all equally
good. Four readings all good to 8 m still report 4 m, just as they always did.

---

## 4. What does *not* get weighted, and why

### Spread

`spreadM` is the **greatest distance from the computed fix to any single
reading**, and it is deliberately *not* weighted. Every reading counts, however
poor.

This is the independent honesty check on the whole procedure. The accuracy
figure is built out of what the receiver *claims* about itself. The spread is
built out of what the readings actually *did*. If a reading landed 60 m away,
the spread says 60 m no matter how little weight that reading carried in the
average.

So the two numbers answer different questions:

- **Accuracy** — how sharp does the receiver believe this fix is?
- **Spread** — how much did the readings actually disagree with each other?

A tight spread and a good accuracy is a fix to trust. **A good accuracy with a
wide spread is the pattern to be suspicious of**: it usually means multipath,
where the receiver is confidently reporting positions that jump around. If the
app shows you a 3 m accuracy and a 40 m spread, walk a few metres into clearer
sky and hold again.

(Since the fix is now the weighted mean, the spread is measured from the
weighted mean too — it is the distance from the position actually recorded to
the furthest reading.)

### Altitude

Altitude stays a **plain, unweighted average** of the readings that have one.

The weights are built from *horizontal* accuracy. Horizontal and vertical error
in GNSS are not the same quantity and are not even reliably proportional —
vertical error is typically one and a half to three times horizontal, and
depends on satellite geometry in a different way. Weighting altitude by
`1 / horizontal²` would be borrowing a number that describes something else and
dressing the result up as a vertical uncertainty.

### Vertical accuracy

Android does supply a vertical accuracy on most devices, and the app records it.
The device adapter maps it onto every reading, and a held fix stores **the
largest figure any of the contributing readings gave**.

Three things about that rule are deliberate:

- **It is not weighted, by anything.** For the reason just given: the weights
  describe horizontal error, and a vertical uncertainty built out of them would
  be the wrong number wearing the right label.
- **It is the worst reading's figure, not the average of them, and it claims no
  improvement from averaging.** The horizontal figure is allowed to improve with
  more samples because independent random error genuinely averages away. Vertical
  error over a hold of a few seconds is not independent — it is dominated by the
  same satellite geometry and the same reflections for the whole hold — so the
  argument that justifies the horizontal improvement does not carry across. And
  not every reading necessarily reports a vertical accuracy; averaging the ones
  that did would quietly assume the silent ones were just as good.
- **It travels with the altitude it describes.** Only readings that supplied a
  height are considered, and if no reading supplied one there is no vertical
  accuracy to report. A vertical uncertainty attached to no altitude is
  provenance about nothing.

Where no contributing reading reported a vertical accuracy, the field is stored
as NULL — absent, not guessed, the same rule the rest of the record follows.

---

## 5. The floor: never better than a third of the best reading

After the weighted accuracy is calculated, one last rule applies:

```
reported accuracy = the larger of (combined accuracy, best single reading / 3)
```

So a hold whose best single reading was 6 m can never report better than 2 m,
no matter how long it is held.

**Why.** The maths in section 3 assumes the errors in the readings are random
and independent — that they scatter around the true position, so adding more of
them lets the scatter cancel out. Some GPS error genuinely behaves that way:
receiver noise, small timing jitter. Averaging removes it.

But a large part of GPS error does not behave that way at all:

- **Multipath** — the reflection off the cliff is in the same place for the
  whole minute you stand there, pushing every reading the same way.
- **Satellite geometry** — the satellites barely move in a two-minute hold, so a
  bad geometric configuration biases every reading identically.
- **Atmospheric delay** — the modelling error is essentially constant over a
  hold.

These are **systematic** errors: a consistent push in one direction, shared by
every reading. Averaging a hundred readings that are all pushed 8 m east gives
you a very precise estimate of a position 8 m east of the truth. The scatter
shrinks; the error does not.

Without a floor, the formula would happily report sub-metre accuracy from a
long hold on a phone that is physically incapable of it, and would write that
figure permanently onto the record. The floor at a third of the best reading is
a blunt instrument, but it is on the right side: it lets averaging deliver the
real improvement it can (up to a factor of three) and then stops it claiming
what the hardware never earned.

### In practice the floor binds after about ten seconds

This is not a rare edge case reserved for very long holds. It is what normally
happens, and it is the reason the countdown is short.

Measured on a Samsung S25 outdoors, readings arriving once a second: the
combined figure fell below a third of the best single reading at the
**thirteenth** reading and stayed there. From that moment the reported accuracy
was **exactly** the best single reading divided by three, and every further
reading was inert — it added weight to a total that was no longer being used.
Only a *better individual reading* moved the number after that.

This is one device, one site, one session under clear sky — a starting point
for this hardware, not an established property of Android GPS. With that
caveat carried through everything below:

- **Accuracy is flat from about ten seconds.** Stored captures from that
  session: ±1.6 m at 5 readings, ±1.5 m at 7, then ±1.0–1.4 m from 12 readings
  through 61 — specifically ±1.2 m at 12, ±1.3 m at 16, ±1.0 to ±1.4 m at 21
  across several runs, and ±1.1 m at 61. Sixty seconds was **no better** than
  twenty: ±1.1 m sits inside the ±1.0–1.4 m the twenty-second runs themselves
  span. It was not worse — an earlier version of this document overstated
  that, and the sixty-second figure does not support it.
- **Run-to-run variance at a fixed duration exceeds the difference between
  durations, and that is the stronger and better-supported finding.** The
  stored twenty-second runs alone span spreads of ±0.3 m, ±0.6 m, ±1.0 m,
  ±2.2 m and ±2.6 m, and the one stored sixty-second run's ±1.3 m spread sits
  inside that range — so "longer waits degrade spread" is not something two
  runs can establish, and this data does not support it either; an earlier
  version of this document made that claim and it is withdrawn. What the same
  records *do* support: two twenty-second captures in the same session
  produced accuracies of ±1.0 m and ±2.8 m — a wider gap than any measured
  difference between twenty seconds and sixty. Conditions and satellite
  geometry at the moment of capture dominate the result, and waiting longer
  cannot rescue a fix that started out bad — which is a better argument for a
  short wait than any claim about spread ever was.
- **The mechanism, described above, is the floor binding.** From the reading
  it binds at, every further sample is inert, and only a better individual
  reading — never more of them — moves the number.

So a longer hold is not obviously a safer hold on this hardware: once the
floor binds, more time does not reliably buy a better fix, and the run-to-run
spread at a single duration is large enough to swamp whatever a longer wait
might otherwise offer. That measurement is what sets the capture screen's
fifteen-second countdown **cap** — a safety net for a run whose fix never
settles, not an expected duration — and what lets the countdown end itself,
which is the normal way it ends, the moment the fix stops improving; see
`packages/geo/src/trend.ts`.

---

## 6. Readings with impossible accuracy figures

A healthy Android location provider does not emit these. A **mock provider** —
a test harness, a spoofing app, a simulator — can and does, which is why
`Reading` carries an `isMocked` flag at all. The app has to survive them without
producing a nonsense number.

Three cases are rejected:

**Zero accuracy.** A reading claiming 0 m is claiming to be perfect. Its weight
would be `1 / 0² = ∞`: it would seize the entire position and drive the reported
accuracy to 0 m. That is precisely the optimistic figure this whole calculation
exists to prevent, so a zero-accuracy reading is given **no weight at all**.

**Negative accuracy.** A negative radius is meaningless. It is also a trap: the
weight formula squares the accuracy, so `-1 m` would otherwise sail through as a
perfectly respectable weight of 1. The accuracy is therefore checked *before* it
is squared, and a negative reading gets **no weight**.

**NaN or infinite accuracy.** A provider that reports a non-number has told us
nothing about the reading's quality, so the reading gets no vote on where the
fix lies — and, just as importantly, is kept out of the arithmetic, where it
would otherwise turn the entire result into NaN. (The same check catches
absurdly tiny values whose square underflows to zero and produces an infinite
weight.)

**What happens to a rejected reading.** It is not deleted. It still counts in
`sampleCount`, and it still widens `spreadM` if it sits far from the fix — the
spread has to keep showing a wild reading even when the weighting has learned to
ignore it. It is also kept out of the "best reading" used for the floor, so a
mock reading claiming 0 m cannot drag the floor down to zero.

**If every reading is rejected**, the app refuses: `averageReadings` throws
`Cannot average readings that carry no usable accuracy.` There is no defensible
position to report (nothing in the set says which reading to believe) and
certainly no defensible accuracy. This is the same answer an empty list of
readings gets, for the same reason — inventing provenance is worse than failing
loudly. Every plausible route to this state involves a mock or broken provider,
and in that state the sample should not be recorded as if it were surveyed.

---

## 7. Where this number ends up

The accuracy figure is not just screen decoration. It is stored permanently on
the record as provenance, alongside the spread and the sample count, and when
records are submitted it becomes the **Victorian Biodiversity Atlas's mandatory
"Positional accuracy (metres)" field**.

DEECA uses that field to decide which records are fit for which purpose. It
filters what appears in public extracts, and it governs whether a record can be
relied on for site-scale work — habitat mapping, referrals under planning
overlays, threatened-species assessments where the difference between 5 m and
50 m is the difference between two management units.

So an optimistic figure there is not a cosmetic bug. It is:

- **A misstatement to a government dataset.** The record asserts a precision the
  observation never had, and it asserts it in the field the Atlas trusts to be
  accurate.
- **Contamination of other people's work.** Records are extracted and reused. A
  record claiming 1.6 m when it deserved 2.6 m may be admitted to an analysis
  that should have excluded it, and nothing downstream can detect the error.
- **Irreversible in practice.** The reading was taken once, in the field, at a
  moment that will not recur. There is no way to go back and establish what the
  accuracy really was.

An honest number that is worse than you would like costs a record its place in
some analyses. A dishonest number that is better than the truth corrupts the
analyses it is admitted to. That asymmetry is the reason every judgement call in
this document — the weighting, the floor, the separate spread, the refusal to
weight altitude, the rejection of impossible readings — is resolved toward the
more conservative answer.
