import { normalizeRefs, sameRefs } from "./config"
import { pushRecent, RECENT_STORED } from "./model"
import type { ModelRef, Observable } from "./types"

/** Browser storage key. Versioned so a format change can start over. */
export const RECENT_STORAGE_KEY = "dsh-plugin-model-picker:recent:v1"

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface StorageEventLike {
  key: string | null
}

export interface StorageEventTarget {
  addEventListener(type: "storage", listener: (event: StorageEventLike) => void): void
  removeEventListener(type: "storage", listener: (event: StorageEventLike) => void): void
}

/** Recently selected models, most recent first, kept in this browser only. */
export interface RecentStore extends Observable<readonly ModelRef[]> {
  /** Start following other tabs' writes; returns the disposer. */
  connect(): () => void
  /** Record a model selected through the picker. */
  push(ref: ModelRef): void
}

/**
 * Keep the recent list in browser storage. Storage may be missing or refuse
 * access; the list then lives for this page only.
 */
export function createRecentStore(
  storage: StorageLike | undefined,
  events?: StorageEventTarget,
): RecentStore {
  const listeners = new Set<() => void>()

  const load = (): readonly ModelRef[] => {
    if (storage === undefined) return []
    try {
      const raw = storage.getItem(RECENT_STORAGE_KEY)
      return raw === null ? [] : normalizeRefs(JSON.parse(raw)).slice(0, RECENT_STORED)
    } catch {
      return []
    }
  }

  let snapshot = load()

  const replace = (next: readonly ModelRef[]) => {
    if (sameRefs(next, snapshot)) return
    snapshot = next
    for (const listener of [...listeners]) listener()
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    connect() {
      if (events === undefined) return () => {}
      const onStorage = (event: StorageEventLike) => {
        if (event.key === null || event.key === RECENT_STORAGE_KEY) replace(load())
      }
      events.addEventListener("storage", onStorage)
      return () => {
        events.removeEventListener("storage", onStorage)
      }
    },
    push(ref) {
      const next = pushRecent(snapshot, ref)
      try {
        storage?.setItem(RECENT_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Quota or privacy settings: keep the in-memory list.
      }
      replace(next)
    },
  }
}
