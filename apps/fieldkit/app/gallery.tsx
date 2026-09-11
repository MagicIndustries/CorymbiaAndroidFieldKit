import { ScrollView } from 'react-native'
import { Screen } from '@corymbia/ui'
import { GallerySections } from '../src/gallery/sections'

/**
 * The component gallery, on a route of its own since Plan 5 gave `/` to the
 * launcher (spec §10.1).
 *
 * **It moved rather than being deleted.** It is how every component in
 * `@corymbia/ui` gets judged at its real size on a real device in real glare,
 * and for several of them — states that only appear mid-capture, or only with
 * a particular fixture — it is the only place they can be seen at all. A
 * screenshot in a pull request is not that.
 *
 * It is reached from the bottom of the launcher, below the work: see the
 * comment on `launcher-gallery` in `index.tsx` for why there and not
 * somewhere more convenient.
 */
export default function Gallery() {
  return (
    // Doctrine rule 16: every screen carries a spoken description.
    <Screen
      testID="gallery-screen"
      spokenDescription="Component gallery. Every primitive and composed component in the design system, rendered at its real size for review on a device."
    >
      <ScrollView showsVerticalScrollIndicator={false}>
        <GallerySections />
      </ScrollView>
    </Screen>
  )
}
