import type { Migration } from '../db/migrate'
import { migration001 } from './001-projects'
import { migration002 } from './002-devices'
import { migration003 } from './003-records'
import { migration004 } from './004-settings'

/** Ordered. Never reorder or edit a shipped migration — add a new one. */
export const migrations: Migration[] = [migration001, migration002, migration003, migration004]
