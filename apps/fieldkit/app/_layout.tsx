import { Slot } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
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
    <SafeAreaProvider>
      <ThemeProvider>
        <Frame />
      </ThemeProvider>
    </SafeAreaProvider>
  )
}
