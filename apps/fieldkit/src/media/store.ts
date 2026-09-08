import { createExpoMediaStore, type MediaStore } from '@corymbia/media'

/**
 * The `MediaStore` this application writes photos and voice notes through —
 * one instance, shared by every screen that attaches or removes a file, the
 * same way `DatabaseProvider` (`src/db/provider.tsx`) opens one database for
 * the whole app rather than a fresh connection per screen.
 *
 * A store built per call would still point at the same `media/` directory —
 * `createExpoMediaStore` carries no per-instance state of its own — so this
 * is not about correctness of a single call. It matters the moment two
 * caller is `useAttachMedia`'s rollback today, and a purge — the settings
 * screen spec §12.1 describes, which is NOT built (see
 * `docs/media-storage.md` §5) — is the second one this module is waiting for,
 * since it would list and remove from the same directory this store writes
 * into. Two independently constructed stores
 * would still agree on paths, but importing this one module-level instance
 * everywhere is what makes "the app's media store" a single, findable thing
 * rather than a convention every call site has to remember to follow.
 */
export const mediaStore: MediaStore = createExpoMediaStore()
