import type { RateLimitSnapshot } from "./contract"

/** The latest rate limit snapshot, kept in memory only. */
export interface UsageStore {
  current(): RateLimitSnapshot | null
  subscribe(listener: (snapshot: RateLimitSnapshot) => void): () => void
  record(snapshot: RateLimitSnapshot): void
}

export function createUsageStore(): UsageStore {
  let current: RateLimitSnapshot | null = null
  const listeners = new Set<(snapshot: RateLimitSnapshot) => void>()
  return {
    current() {
      return current
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    record(snapshot) {
      current = snapshot
      for (const listener of [...listeners]) listener(snapshot)
    },
  }
}
