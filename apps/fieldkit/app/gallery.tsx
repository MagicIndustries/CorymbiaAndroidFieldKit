import { ScrollView } from 'react-native'
import { Screen } from '@corymbia/ui'
import { GallerySections } from '../src/gallery/sections'

export default function Gallery() {
  return (
    // Doctrine rule 16: every screen carries a spoken description.
    <Screen spokenDescription="Component gallery. Every primitive and composed component in the design system, rendered at its real size for review on a device.">
      <ScrollView showsVerticalScrollIndicator={false}>
        <GallerySections />
      </ScrollView>
    </Screen>
  )
}
