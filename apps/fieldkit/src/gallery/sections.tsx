import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { radii, spacing } from '@corymbia/tokens'
import {
  Button,
  Card,
  ContextStamp,
  HelpAffordance,
  InputAffordanceRow,
  NameChip,
  ProjectName,
  Type,
  useLayout,
  useTheme,
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
        cannot be tested from a desk (the pulse, the perimeter, glare
        legibility, thumb reach) actually have to be judged.
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
            CHIP, CORRECT — MIDDLE TRUNCATION KEEPS THE SITE AND THE
            DISTINGUISHING SUFFIX
          </Type>
          <View style={{ height: spacing.xs }} />
          <NameChip name={CHIP_NAME} maxWidth={CHIP_CONSTRAINED_WIDTH} />

          <View style={{ height: spacing.md }} />

          <Type variant="label" dim>
            CHIP, FOR COMPARISON — TAIL TRUNCATION LOSES WHAT MAKES THIS
            PROJECT DIFFERENT FROM ANY OTHER "YARRA FLATS…"
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
          <NameChip
            name={CHIP_NAME}
            shortLabel="Yarra Nth 2"
            maxWidth={CHIP_CONSTRAINED_WIDTH}
          />
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

      <Section title="Capture controls — field size, 72dp">
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button label="⚡ SAVE NOW" spokenLabel="Save now" kind="fast" size="field" onPress={() => {}} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label="◎ SHARPEN"
              spokenLabel="Sharpen the fix"
              kind="accurate"
              size="field"
              onPress={() => {}}
            />
          </View>
        </View>
      </Section>

      <Section title="Input affordances — fixed order">
        <InputAffordanceRow onPress={() => {}} completed={['title']} />
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
