import { Slot } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaView } from 'react-native'
import { darkTheme } from '@corymbia/tokens'

export default function RootLayout() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: darkTheme.colors.surface }}>
      <StatusBar style="light" />
      <Slot />
    </SafeAreaView>
  )
}
