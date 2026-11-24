import { useSyncExternalStore } from "react"
import type { SnapshotStore } from "./state/store"

export function useSnapshot<T>(store: SnapshotStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
