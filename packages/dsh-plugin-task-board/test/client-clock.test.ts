import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createClock } from "../src/client/state/clock"
import { createLocaleStore } from "../src/client/state/locale"

describe("clock", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("reads the time in whole steps so the snapshot stays stable", () => {
    let now = 125_000
    const clock = createClock(60_000, () => now)
    expect(clock.getSnapshot()).toBe(120_000)
    now = 170_000
    expect(clock.getSnapshot()).toBe(120_000)
    now = 180_000
    expect(clock.getSnapshot()).toBe(180_000)
  })

  it("ticks only while someone listens", () => {
    const clock = createClock(60_000, () => Date.now())
    const seen = vi.fn()
    const stop = clock.subscribe(seen)
    vi.advanceTimersByTime(120_000)
    expect(seen).toHaveBeenCalledTimes(2)
    stop()
    vi.advanceTimersByTime(120_000)
    expect(seen).toHaveBeenCalledTimes(2)
  })
})

describe("locale store", () => {
  it("reads the active locale and follows its changes", () => {
    let active = "en"
    const listeners = new Set<() => void>()
    const store = createLocaleStore({
      getSnapshot: () => ({ active }),
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    })
    expect(store.getSnapshot()).toBe("en")
    const seen = vi.fn()
    const stop = store.subscribe(seen)
    active = "ja"
    for (const listener of listeners) listener()
    expect(seen).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).toBe("ja")
    stop()
    expect(listeners.size).toBe(0)
  })
})
