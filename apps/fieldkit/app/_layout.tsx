import { useEffect } from 'react'
import { Slot } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { ThemeProvider, useTheme } from '@corymbia/ui'
import { DatabaseProvider, useSettings } from '../src/db/provider'

/**
 * Applies the saved theme preference once settings finish loading, and keeps
 * following it if it changes later (e.g. from a future settings screen).
 *
 * This exists because `ThemeProvider` only accepts a preference through its
 * `initial` prop, consumed once into `useState` on mount — later changes to
 * that prop are ignored. Settings load asynchronously, strictly after
 * `ThemeProvider` has already mounted (it has to: `ThemeProvider` must exist
 * before `DatabaseProvider`, so there is something to render a database error
 * with). So passing the stored theme as `initial` can never work — the value
 * `initial` would need is not read yet at the moment `initial` is consumed.
 * This bridge is the actual fix: it watches the *loaded* preference and pushes
 * it into `ThemeProvider` via `setTheme` whenever it changes, rather than
 * trying to seed `ThemeProvider` once at construction time. Do not "simplify"
 * this away by passing `initial` — it does not work, for the reason above.
 */
function ThemePreferenceBridge() {
  const { setTheme } = useTheme()
  const { settings } = useSettings()

  useEffect(() => {
    setTheme(settings.theme)
  }, [settings.theme, setTheme])

  return null
}

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
        <DatabaseProvider>
          <ThemePreferenceBridge />
          <Frame />
        </DatabaseProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  )
}
