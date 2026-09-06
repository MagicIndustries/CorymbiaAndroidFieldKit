import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import {
  DEFAULT_SETTINGS,
  migrate,
  openDatabase,
  readAppliedMigrationIds,
  readSettings,
  registerDevice,
  writeSetting,
  type Database,
  type Device,
  type Settings,
} from '@corymbia/data'
import { readDeviceFacts } from './device'

type Status =
  | { state: 'opening'; error: null; applied: string[] }
  | { state: 'ready'; error: null; applied: string[] }
  | { state: 'failed'; error: Error; applied: string[] }

const DatabaseContext = createContext<{
  db: Database | null
  device: Device | null
  settings: Settings
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<void>
  status: Status
} | null>(null)

/**
 * Opens the database and runs migrations before rendering anything that reads
 * from it.
 *
 * The status is deliberately exposed rather than swallowed. A migration failure
 * on a field device is otherwise silent, and the first symptom would be an empty
 * list of records with no explanation — on a tablet, in a paddock, with no
 * console to check.
 */
export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<Database | null>(null)
  const [device, setDevice] = useState<Device | null>(null)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [status, setStatus] = useState<Status>({ state: 'opening', error: null, applied: [] })

  useEffect(() => {
    let cancelled = false

    void (async () => {
      // Hoisted above the try so it is still reachable from `catch`: without
      // this, a throw after `openDatabase()` succeeds leaves its handle
      // reachable only by the discarded local, and expo-sqlite opens a fresh
      // native connection per call with no caching — so every such failure
      // leaked a real native handle for the life of the JS process.
      let opened: Database | null = null
      try {
        opened = await openDatabase()
        const applied = await migrate(opened)
        // Register before anything can write a record: every record and event
        // carries a device foreign key, so nothing may be captured until the
        // device this app is running on is known.
        const registered = await registerDevice(opened, await readDeviceFacts())
        // Preferences load before the first render that could read them, so the
        // app never flashes the wrong theme or puts the capture controls on the
        // wrong side while it catches up (spec §7.6).
        const stored = await readSettings(opened)
        if (cancelled) {
          await opened.close()
          return
        }
        setDb(opened)
        setDevice(registered)
        setSettings(stored)
        setStatus({ state: 'ready', error: null, applied })
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error))
        let applied: string[] = []
        if (opened) {
          // The migrations that committed are durable in schema_migration even
          // though `migrate`'s own return value was lost with the throw. Read
          // it back before closing — the failure may already have left the
          // connection unusable, so fall back to an empty list rather than let
          // a secondary read failure replace the real cause below.
          try {
            applied = await readAppliedMigrationIds(opened)
          } catch {
            applied = []
          }
          try {
            await opened.close()
          } catch {
            // A failure while closing must never mask `failure`, the error
            // that actually caused this catch to run.
          }
        }
        if (cancelled) return
        setStatus({ state: 'failed', error: failure, applied })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const updateSetting = useCallback(
    async <K extends keyof Settings>(key: K, value: Settings[K]) => {
      if (!db) throw new Error('Cannot change a setting before the database is open.')
      await writeSetting(db, key, value)
      setSettings((current) => ({ ...current, [key]: value }))
    },
    [db],
  )

  return (
    <DatabaseContext.Provider value={{ db, device, settings, updateSetting, status }}>
      {children}
    </DatabaseContext.Provider>
  )
}

export function useDatabaseStatus(): Status {
  const value = useContext(DatabaseContext)
  if (!value) throw new Error('useDatabaseStatus must be used within a DatabaseProvider')
  return value.status
}

export function useDatabase(): Database {
  const value = useContext(DatabaseContext)
  if (!value) throw new Error('useDatabase must be used within a DatabaseProvider')
  if (!value.db) throw new Error('The database is not open yet; check useDatabaseStatus first.')
  return value.db
}

/**
 * The user's preferences, and a way to change one (spec §7.6).
 *
 * `updateSetting` writes through to the database and updates the in-memory copy,
 * so a preference survives a restart. An override that resets at every launch is
 * not an override.
 */
export function useSettings(): {
  settings: Settings
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<void>
} {
  const value = useContext(DatabaseContext)
  if (!value) throw new Error('useSettings must be used within a DatabaseProvider')
  return { settings: value.settings, updateSetting: value.updateSetting }
}

/** The registered device this app is running on. Every capture is attributed to it. */
export function useDevice(): Device {
  const value = useContext(DatabaseContext)
  if (!value) throw new Error('useDevice must be used within a DatabaseProvider')
  if (!value.device) throw new Error('The device is not registered yet; check useDatabaseStatus first.')
  return value.device
}
