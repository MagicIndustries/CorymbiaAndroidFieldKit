import React from 'react'
import { View } from 'react-native'
import { spacing } from '@corymbia/tokens'
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

const LONG_NAME = 'Yarra Flats Riparian Restoration — North Reach Stage 2'

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
  const { name, setTheme } = useTheme()
  const { sizeClass, deviceClass, orientation, width, height } = useLayout()

  return (
    <View>
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

      <Section title="Names — long, to prove the clamping">
        <Card>
          <ProjectName name={LONG_NAME} />
          <View style={{ height: spacing.sm }} />
          <NameChip name={LONG_NAME} />
          <View style={{ height: spacing.xs }} />
          <NameChip name={LONG_NAME} shortLabel="Yarra Nth 2" />
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
