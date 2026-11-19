import { describe, expect, it, vi } from "vitest"
import { createUsageStore } from "../src/client/store"
import type { RateLimitSnapshot } from "../src/shared/contract"

const SNAPSHOT: RateLimitSnapshot = {
  observedAt: 1_800_000_000_000,
  status: "allowed",
  windows: [{ kind: "seven_day", utilization: 0.18, resetsAt: 1_800_500_000_000 }],
}

describe("createUsageStore", () => {
  it("starts disconnected with no snapshot", () => {
    expect(createUsageStore().getSnapshot()).toEqual({ connected: false, snapshot: null })
  })

  it("connects on the explicit empty state and still has no snapshot", () => {
    const store = createUsageStore()
    const seen = vi.fn()
    store.subscribe(seen)
    store.receive({ kind: "empty" })
    expect(store.getSnapshot()).toEqual({ connected: true, snapshot: null })
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it("keeps each received snapshot", () => {
    const store = createUsageStore()
    store.receive({ kind: "snapshot", snapshot: SNAPSHOT })
    expect(store.getSnapshot()).toEqual({ connected: true, snapshot: SNAPSHOT })
  })

  it("goes back to disconnected on reset", () => {
    const store = createUsageStore()
    store.receive({ kind: "snapshot", snapshot: SNAPSHOT })
    store.reset()
    expect(store.getSnapshot()).toEqual({ connected: false, snapshot: null })
  })

  it("does not publish a reset that changes nothing", () => {
    const store = createUsageStore()
    const seen = vi.fn()
    store.subscribe(seen)
    store.reset()
    expect(seen).not.toHaveBeenCalled()
  })

  it("stops notifying after unsubscribe", () => {
    const store = createUsageStore()
    const seen = vi.fn()
    const off = store.subscribe(seen)
    off()
    store.receive({ kind: "empty" })
    expect(seen).not.toHaveBeenCalled()
  })
})
