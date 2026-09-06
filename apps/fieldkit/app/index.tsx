import { ScrollView } from 'react-native'
import { Screen } from '@corymbia/ui'
import { GallerySections } from '../src/gallery/sections'

export default function Gallery() {
  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <GallerySections />
      </ScrollView>
    </Screen>
  )
}
