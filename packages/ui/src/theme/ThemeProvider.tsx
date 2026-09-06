import React, { createContext, useCallback, useMemo, useState } from 'react'
import { useColorScheme } from 'react-native'
import { darkTheme, lightTheme, type Theme, type ThemeName } from '@corymbia/tokens'

export type ThemePreference = ThemeName | 'system'

export type ThemeContextValue = {
  theme: Theme
  name: ThemeName
  preference: ThemePreference
  setTheme: (next: ThemePreference) => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

type SystemColorScheme = ReturnType<typeof useColorScheme>

/** Dark is the product default; light exists for glare (spec §5.2). */
function resolve(preference: ThemePreference, system: SystemColorScheme): ThemeName {
  if (preference !== 'system') return preference
  return system === 'light' ? 'light' : 'dark'
}

export function ThemeProvider({
  children,
  initial = 'system',
}: {
  children: React.ReactNode
  initial?: ThemePreference
}) {
  const system = useColorScheme()
  const [preference, setPreference] = useState<ThemePreference>(initial)

  const setTheme = useCallback((next: ThemePreference) => setPreference(next), [])

  const value = useMemo<ThemeContextValue>(() => {
    const name = resolve(preference, system)
    return {
      name,
      preference,
      theme: name === 'light' ? lightTheme : darkTheme,
      setTheme,
    }
  }, [preference, system, setTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
