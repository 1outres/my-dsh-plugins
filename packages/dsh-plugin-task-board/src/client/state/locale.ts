import type { LocaleSource } from "../types"
import type { SnapshotStore } from "./store"

export function createLocaleStore(source: LocaleSource): SnapshotStore<string> {
  return {
    getSnapshot: () => source.getSnapshot().active,
    subscribe: (listener) => source.subscribe(listener),
  }
}
