import type { UsageState, UsageStore } from "./types"

const DISCONNECTED: UsageState = { connected: false, snapshot: null }

export function createUsageStore(): UsageStore {
  let state = DISCONNECTED
  const listeners = new Set<() => void>()
  const publish = (next: UsageState): void => {
    state = next
    for (const listener of [...listeners]) listener()
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    receive(item) {
      publish(
        item.kind === "empty"
          ? { connected: true, snapshot: null }
          : { connected: true, snapshot: item.snapshot },
      )
    },
    reset() {
      if (state === DISCONNECTED) return
      publish(DISCONNECTED)
    },
  }
}
