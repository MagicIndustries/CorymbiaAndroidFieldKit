import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { radii, spacing } from '@corymbia/tokens'
import {
  Button,
  CaptureDial,
  Card,
  CarryOnCard,
  ContextStamp,
  HelpAffordance,
  InputAffordanceRow,
  MediaStrip,
  NameChip,
  ProjectName,
  ToolTiles,
  Type,
  useLayout,
  useTheme,
  type CarryOn,
  type MediaStripItem,
  type ToolKind,
} from '@corymbia/ui'
import { CorymbiaMark } from '@corymbia/brand'

// Long enough that, wrapped at the two-line hero width on any device class,
// it genuinely overflows a third line — so the tail clip in ProjectName is
// actually exercised rather than merely available.
const HERO_OVERFLOW_NAME =
  'Yarra Flats and Merri Creek Confluence Riparian Restoration and Endangered Growling Grass Frog Habitat Recovery Program — North Reach, Long-Term Monitoring, Stage 2 of 7'

// Realistic project name: front-loaded with the site, back-loaded with the
// part that actually distinguishes it (the reach and stage). Middle
// truncation is only visible if the chip is forced narrower than this text's
// natural width, hence CHIP_CONSTRAINED_WIDTH below.
const CHIP_NAME = 'Yarra Flats Riparian Restoration — North Reach Stage 2'

// Narrow enough to force NameChip to truncate; wide enough that the clipped
// result is still legible as "still recognisably a name".
const CHIP_CONSTRAINED_WIDTH = 160

// `MediaStrip` sample data. These `file:///` URIs are not real files, the
// same fictional shape `MediaStrip.test.tsx` uses — this section exists to
// prove out the strip's states and layout, not photo decoding. Whether a
// photo actually *renders* on a device is exactly the thing Jest cannot see
// (the `field.mediaTile` height trap this component's own comments describe),
// so that question belongs to the hardware checklist, not this gallery.
const MEDIA_PHOTOS: MediaStripItem[] = [
  { id: 'gallery-photo-1', kind: 'photo', uri: 'file:///gallery-photo-1.jpg', durationMs: null },
  { id: 'gallery-photo-2', kind: 'photo', uri: 'file:///gallery-photo-2.jpg', durationMs: null },
  { id: 'gallery-photo-3', kind: 'photo', uri: 'file:///gallery-photo-3.jpg', durationMs: null },
  { id: 'gallery-photo-4', kind: 'photo', uri: 'file:///gallery-photo-4.jpg', durationMs: null },
]

// A single voice note. There is nothing to look at — the tile's only legible
// content is its length (see `VoiceGlyph`'s doc comment in `MediaStrip.tsx`
// for why that is drawn as SVG, not an emoji `Text` node).
const MEDIA_VOICE: MediaStripItem[] = [
  { id: 'gallery-voice-1', kind: 'voice', uri: 'file:///gallery-voice-1.m4a', durationMs: 47000 },
]

// Mixed, in attachment order — the order this section renders them, not
// grouped by kind — because that is the order a real record accumulates them
// in and the strip never reorders what it is given.
const MEDIA_MIXED: MediaStripItem[] = [
  { id: 'gallery-photo-5', kind: 'photo', uri: 'file:///gallery-photo-5.jpg', durationMs: null },
  { id: 'gallery-voice-2', kind: 'voice', uri: 'file:///gallery-voice-2.m4a', durationMs: 8200 },
  { id: 'gallery-photo-6', kind: 'photo', uri: 'file:///gallery-photo-6.jpg', durationMs: null },
]

// `CarryOnCard` renders `startedAt` as elapsed time and never as a timestamp
// (see `formatElapsed`), so a fixed date written in here would read as a
// larger and larger number of hours for the rest of the project's life. An
// offset from module load says "40 minutes ago" on the device, which is what
// the card actually looks like mid-survey.
const CARRY_ON_STARTED_AT = new Date(Date.now() - 40 * 60_000).toISOString()

// The project name is `CHIP_NAME` deliberately: it is long enough that the
// `ProjectName` inside the card has to clamp, which is the thing to look at
// on a device — a card whose hero name pushed `CAPTURE` down the screen
// would break rule 10 where it matters most.
const GALLERY_CARRY_ON: CarryOn = {
  projectName: CHIP_NAME,
  activityName: 'Reach 4 transect',
  activityKind: 'survey',
  startedAt: CARRY_ON_STARTED_AT,
  captureCount: 12,
  clientName: 'Melbourne Water',
}

// Every kind `ToolTiles` knows how to place, so the ordering table can be
// seen in full. The launcher never passes this — see `BUILT_TOOLS`.
const EVERY_TOOL: ToolKind[] = ['capture', 'records', 'media', 'batching']

// What `app/index.tsx`'s `AVAILABLE_TOOLS` really passes: the two tools that
// have a route to open. Doctrine rule 21 — the other two get no tile at all,
// which is the third row of the section below.
const BUILT_TOOLS: ToolKind[] = ['capture', 'records']

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.sm, marginBottom: spacing.xl }}>
      <Type variant="label" dim>
        {title.toUpperCase()}
      </Type>
      {children}
    </View>
  )
}

export function GallerySections() {
  const { name, setTheme, theme } = useTheme()
  const { sizeClass, deviceClass, orientation, width, height } = useLayout()
  const router = useRouter()

  return (
    <View>
      {/*
        The capture screen's only entry point until Plan 5 builds the launcher.
        Without it nothing in the app navigates to `/capture`, so none of spec
        §9.1–§9.6 can be judged on a device — which is where the parts that
        cannot be tested from a desk (the ring emptying, the lock's snap and
        ripple, glare legibility, thumb reach) actually have to be judged.
      */}
      <Section title="Capture">
        <Button
          label="Open the capture screen"
          kind="secondary"
          onPress={() => router.push('/capture')}
        />
      </Section>

      <Section title="Diagnostics">
        <Button
          label="Open the GPS and database diagnostics"
          kind="secondary"
          onPress={() => router.push('/diagnostics')}
        />
      </Section>

      <Section title="Brand bar">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <CorymbiaMark height={26} />
          <View>
            <Type variant="label" dim>
              CORYMBIA
            </Type>
            <Type variant="label">FIELD KIT</Type>
          </View>
        </View>
      </Section>

      <Section title="Layout">
        <Type dim>
          {sizeClass} · {deviceClass} · {orientation} · {Math.round(width)}×{Math.round(height)}dp
        </Type>
      </Section>

      <Section title="Theme">
        <Button
          label={`Switch to ${name === 'dark' ? 'light' : 'dark'}`}
          kind="secondary"
          onPress={() => setTheme(name === 'dark' ? 'light' : 'dark')}
        />
      </Section>

      <Section title="Buttons — every kind, standard size">
        <View style={{ gap: spacing.sm }}>
          <Button label="Primary" kind="primary" onPress={() => {}} />
          <Button label="Secondary" kind="secondary" onPress={() => {}} />
          <Button label="Primary, disabled" kind="primary" disabled onPress={() => {}} />
        </View>
      </Section>

      <Section title="Names — long, to prove the clamping">
        <Card>
          <Type variant="label" dim>
            HERO — CLAMPS TO 2 LINES, THEN CLIPS (CARD NEVER GROWS)
          </Type>
          <View style={{ height: spacing.xs }} />
          <ProjectName name={HERO_OVERFLOW_NAME} />
        </Card>

        <View style={{ height: spacing.md }} />

        <Card>
          <Type variant="label" dim>
            CHIP, CORRECT — MIDDLE TRUNCATION KEEPS THE SITE AND THE DISTINGUISHING SUFFIX
          </Type>
          <View style={{ height: spacing.xs }} />
          <NameChip name={CHIP_NAME} maxWidth={CHIP_CONSTRAINED_WIDTH} />

          <View style={{ height: spacing.md }} />

          <Type variant="label" dim>
            CHIP, FOR COMPARISON — TAIL TRUNCATION LOSES WHAT MAKES THIS PROJECT DIFFERENT FROM ANY
            OTHER "YARRA FLATS…"
          </Type>
          <View style={{ height: spacing.xs }} />
          <View
            style={{
              alignSelf: 'flex-start',
              maxWidth: CHIP_CONSTRAINED_WIDTH,
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: radii.pill,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.xs,
            }}
          >
            <Type
              variant="small"
              dim
              numberOfLines={1}
              ellipsizeMode="tail"
              accessibilityLabel={CHIP_NAME}
            >
              {CHIP_NAME}
            </Type>
          </View>

          <View style={{ height: spacing.md }} />

          <Type variant="label" dim>
            CHIP WITH A USER-SET SHORT LABEL — NO TRUNCATION NEEDED
          </Type>
          <View style={{ height: spacing.xs }} />
          <NameChip name={CHIP_NAME} shortLabel="Yarra Nth 2" maxWidth={CHIP_CONSTRAINED_WIDTH} />
        </Card>
      </Section>

      <Section title="Context stamps — all three fix classes">
        <Card>
          <View style={{ gap: spacing.sm }}>
            <ContextStamp
              fix={{ quality: 'deliberate', accuracyM: 4 }}
              place={{ name: 'Nth Reach' }}
              device="tablet"
              activity={{ name: 'Survey 3', wasFiled: true }}
            />
            <ContextStamp
              fix={{ quality: 'ambient', accuracyM: 38, ageMinutes: 4 }}
              place={{ name: 'Nth Reach', distanceM: 120 }}
              device="field-s24"
              activity={{ name: 'Survey 3', wasFiled: false }}
            />
            <ContextStamp fix={{ quality: 'none' }} device="field-s24" />
          </View>
        </Card>
      </Section>

      {/*
        THE DIAL, IN THE THREE STATES THAT CANNOT BE JUDGED FROM A DESK.

        This replaces the `⚡ SAVE NOW` / `◎ SHARPEN` pair that stood here.
        That was the two-control design, superseded by spec §9.1 after it went
        outdoors and failed — its components are gone from the codebase, so
        the gallery was teaching a design that no longer exists, on the one
        screen whose whole job is to show what the app's parts actually look
        like on a device.

        Three dials rather than one, because the difference between them is
        exactly what has to be looked at in daylight: a fix still converging,
        a capture that settled short of the crosshair (the companion ring at
        its own radius, the crosshair still visible inside it), and one locked
        onto the crosshair. The lock's own motion is not visible here — the
        ripple plays on a genuine transition into lock, not on a dial that
        mounts already locked — so that part is judged on the capture screen
        itself, through the button below.
      */}
      <Section title="Capture dial — converging, settled, locked on">
        <View style={{ gap: spacing.lg }}>
          <CaptureDial grade="fair" accuracyM={6.1} remaining={0.6} />
          <CaptureDial grade="good" accuracyM={4.2} settled />
          <CaptureDial grade="good" accuracyM={1.2} locked />
        </View>
      </Section>

      <Section title="Capture control — field size, 72dp">
        {/*
          One control, which is the whole of §9.1.4: `CAPTURE` before the tap
          and `ACCEPT NOW` during the countdown, never two at once.
        */}
        <Button
          label="CAPTURE"
          spokenLabel="Record the current fix now"
          kind="fast"
          size="field"
          onPress={() => {}}
        />
      </Section>

      <Section title="Media strip — every state">
        <View style={{ gap: spacing.md }}>
          <View>
            <Type variant="label" dim>
              EMPTY — RENDERS NOTHING AT ALL
            </Type>
            <Type dim>
              An unattached record shows no strip: no frame, no placeholder box, no "nothing here
              yet". A frame around a void costs vertical space and says only that something she did
              not do has not been done — so `MediaStrip` returns `null` rather than an empty
              container, and the line below this text is genuinely blank, not a rendering gap.
            </Type>
            <MediaStrip items={[]} testID="gallery-media-empty" />
          </View>

          <View>
            <Type variant="label" dim>
              PHOTOS ONLY — FOUR, SO THE STRIP SCROLLS RATHER THAN SHRINKING THE TILES
            </Type>
            <View style={{ height: spacing.xs }} />
            <MediaStrip items={MEDIA_PHOTOS} onPress={() => {}} testID="gallery-media-photos" />
          </View>

          <View>
            <Type variant="label" dim>
              A VOICE NOTE, SHOWN AS ITS LENGTH — THERE IS NOTHING ELSE TO SHOW
            </Type>
            <View style={{ height: spacing.xs }} />
            <MediaStrip items={MEDIA_VOICE} onPress={() => {}} testID="gallery-media-voice" />
          </View>

          <View>
            <Type variant="label" dim>
              MIXED — PHOTOS AND A VOICE NOTE, IN THE ORDER THEY WERE ATTACHED
            </Type>
            <View style={{ height: spacing.xs }} />
            <MediaStrip items={MEDIA_MIXED} onPress={() => {}} testID="gallery-media-mixed" />
          </View>

          <View>
            <Type variant="label" dim>
              WITH REMOVAL OFFERED — `onRemove` GIVEN, SO EVERY TILE CARRIES ITS ✕
            </Type>
            <View style={{ height: spacing.xs }} />
            <MediaStrip
              items={MEDIA_MIXED}
              onPress={() => {}}
              onRemove={() => {}}
              testID="gallery-media-removable"
            />
          </View>
        </View>
      </Section>

      <Section title="Input affordances — fixed order, counts, and a busy tile">
        <View style={{ gap: spacing.md }}>
          <View>
            <Type variant="label" dim>
              A TITLE ALREADY WRITTEN, NOTHING ELSE ATTACHED YET
            </Type>
            <View style={{ height: spacing.xs }} />
            <InputAffordanceRow onPress={() => {}} completed={['title']} />
          </View>

          <View>
            <Type variant="label" dim>
              A KIND THAT CAN REPEAT SHOWS A COUNT, NOT JUST A CHECK — THREE PHOTOS, ONE VOICE NOTE
            </Type>
            <View style={{ height: spacing.xs }} />
            <InputAffordanceRow
              onPress={() => {}}
              completed={['title']}
              counts={{ photo: 3, voice: 1 }}
            />
          </View>

          <View>
            <Type variant="label" dim>
              A PHOTO MID-SAVE — GENUINELY DISABLED, NOT A TAP THAT SILENTLY DOES NOTHING
            </Type>
            <View style={{ height: spacing.xs }} />
            <InputAffordanceRow
              onPress={() => {}}
              completed={['title']}
              counts={{ photo: 2 }}
              busy={['photo']}
            />
          </View>
        </View>
      </Section>

      {/*
        THE LAUNCHER'S CARD, IN BOTH OF THE STATES IT HAS.

        The launcher itself only ever shows one of these on a given device —
        whichever the database says — so this is the only place the two can be
        put beside each other and judged as a pair. The question to ask of them
        on a device is whether the first-run face reads as a beginning rather
        than as the resumed card with its contents missing.
      */}
      <Section title="Carry on with — resumed, and a first run">
        <View style={{ gap: spacing.md }}>
          <View>
            <Type variant="label" dim>
              RESUMED — WHAT SHE LANDS ON, WITH CAPTURE INSIDE THE CARD
            </Type>
            <View style={{ height: spacing.xs }} />
            <CarryOnCard
              testID="gallery-carry-on"
              carryOn={GALLERY_CARRY_ON}
              onCapture={() => {}}
              onSwitchProject={() => {}}
              onNewActivity={() => {}}
            />
          </View>

          <View>
            <Type variant="label" dim>
              A FIRST RUN — NO CAPTURE IN THE CARD, BECAUSE THERE IS NOTHING TO CARRY ON WITH
            </Type>
            <Type dim>
              Not a degraded version of the card above: with no project there is nothing for
              `CAPTURE` to be filed into, so the card offers the one thing that makes sense
              instead of a control that would look pressable and lead nowhere. Capture is still
              reachable on the launcher itself — from the tile below the card — which is what
              keeps the one-tap Impatient journey in spec §10.2 honest on a fresh install.
            </Type>
            <View style={{ height: spacing.xs }} />
            <CarryOnCard
              testID="gallery-carry-on-empty"
              carryOn={null}
              onCapture={() => {}}
              onSwitchProject={() => {}}
              onNewActivity={() => {}}
            />
          </View>
        </View>
      </Section>

      {/*
        THE TILES, AT TWO ACTIVITY KINDS AND ONCE SHORT TWO TOOLS.

        Two kinds rather than one because the ordering table is the whole
        component: a single row proves only that four tiles render. The third
        row is doctrine rule 21 — the same `survey` order as the first, with
        `media` and `batching` simply absent rather than dimmed — and the only
        way to see that it reads as a complete row of tools rather than as a
        row with two holes in it is to look at it next to the full one.
      */}
      <Section title="Tool tiles — ordered by activity kind, and short two tools">
        <View style={{ gap: spacing.md }}>
          <View>
            <Type variant="label" dim>
              SURVEY — CAPTURE AND RECORDS FLOAT TO THE TOP, BATCHING SINKS (SPEC §10.1)
            </Type>
            <View style={{ height: spacing.xs }} />
            <ToolTiles
              testID="gallery-tools-survey"
              activityKind="survey"
              available={EVERY_TOOL}
              onOpen={() => {}}
            />
          </View>

          <View>
            <Type variant="label" dim>
              SAMPLING — THE LOG LEADS, SO RECORDS COMES FIRST
            </Type>
            <View style={{ height: spacing.xs }} />
            <ToolTiles
              testID="gallery-tools-sampling"
              activityKind="sampling"
              available={EVERY_TOOL}
              onOpen={() => {}}
            />
          </View>

          <View>
            <Type variant="label" dim>
              WHAT THE LAUNCHER ACTUALLY SHOWS — NO TILE AT ALL FOR A TOOL THAT IS NOT BUILT
            </Type>
            <View style={{ height: spacing.xs }} />
            <ToolTiles
              testID="gallery-tools-built"
              activityKind="survey"
              available={BUILT_TOOLS}
              onOpen={() => {}}
            />
          </View>
        </View>
      </Section>

      <Section title="Help">
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Type>Accuracy</Type>
          <HelpAffordance
            title="Accuracy"
            body="How close this position is likely to be to where you are standing. Smaller is better. Under 5 m is good enough for a survey record."
          />
        </View>
      </Section>
    </View>
  )
}
