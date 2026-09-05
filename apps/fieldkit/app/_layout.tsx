import { Slot } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaView } from 'react-native'
import { ThemeProvider, useTheme } from '@corymbia/ui'

function Frame() {
  const { theme, name } = useTheme()
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.surface }}>
      <StatusBar style={name === 'dark' ? 'light' : 'dark'} />
      <Slot />
    </SafeAreaView>
  )
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <Frame />
    </ThemeProvider>
  )
}
