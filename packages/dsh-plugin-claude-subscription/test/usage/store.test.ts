import { describe, expect, it, vi } from "vitest"
import type { RateLimitSnapshot } from "../../src/usage/contract"
import { createUsageStore } from "../../src/usage/store"

const SNAPSHOT: RateLimitSnapshot = {
  observedAt: 1_800_000_000_000,
  status: "allowed",
  windows: [],
}

describe("createUsageStore", () => {
  it("keeps the latest snapshot and tells subscribers", () => {
    const store = createUsageStore()
    expect(store.current()).toBeNull()
    const seen = vi.fn()
    const off = store.subscribe(seen)
    store.record(SNAPSHOT)
    expect(store.current()).toBe(SNAPSHOT)
    expect(seen).toHaveBeenCalledWith(SNAPSHOT)
    off()
    store.record({ ...SNAPSHOT, observedAt: 1_800_000_030_000 })
    expect(seen).toHaveBeenCalledTimes(1)
    expect(store.current()?.observedAt).toBe(1_800_000_030_000)
  })
})
