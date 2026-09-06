import type { Migration } from '../db/migrate'
import { migration001 } from './001-projects'

/** Ordered. Never reorder or edit a shipped migration — add a new one. */
export const migrations: Migration[] = [migration001]
