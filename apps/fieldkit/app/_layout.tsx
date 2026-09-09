import { useEffect } from 'react'
import { Stack } from 'expo-router'
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

/**
 * A native stack, deliberately — not `Slot`.
 *
 * `Slot` renders exactly one route: `SlotNavigator`
 * (`expo-router/build/views/Navigator.js`) returns
 * `descriptors[state.routes[state.index].key].render()` and nothing else, and
 * each descriptor's element is keyed by route, so the moment the index moves
 * React unmounts the previous subtree outright. There is no stack of mounted
 * screens under it. That is fatal for this application specifically: the
 * capture screen holds the whole capture state machine
 * (`src/capture/useCapture.ts`) in component-local `useState` — the phase, the
 * record, the readings, the countdown — so pushing `/camera` from the recorded
 * state destroyed it, and `router.back()` returned her to a blank `ready`
 * screen with no route back to the record she had just photographed. The photo
 * and the record were both safely in SQLite; the app simply showed no evidence
 * either had happened.
 *
 * A native stack keeps every route in the stack mounted, which is the
 * precondition for `useFocusEffect` in `capture.tsx` to mean anything: a
 * refresh on return is only a refresh if there is still something there to
 * refresh.
 *
 * `headerShown: false` preserves the appearance exactly — no screen in this
 * application has ever drawn a navigation header, and the stack's default is
 * to draw one.
 */
function Frame() {
  const { theme, name } = useTheme()
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.surface }}>
      <StatusBar style={name === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }} />
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
