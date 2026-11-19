import { describe, expect, it, vi } from "vitest"
import {
  createPositionTracker,
  popoverPosition,
  type RectLike,
} from "../src/client/popover-position"

function viewport(height: number) {
  const listeners = new Set<() => void>()
  return {
    innerHeight: height,
    addEventListener(type: "resize", listener: () => void) {
      if (type === "resize") listeners.add(listener)
    },
    removeEventListener(type: "resize", listener: () => void) {
      if (type === "resize") listeners.delete(listener)
    },
    resize() {
      for (const listener of [...listeners]) listener()
    },
    listeners,
  }
}

function element(rect: RectLike) {
  return {
    getBoundingClientRect: () => rect,
  }
}

describe("popoverPosition", () => {
  it("places the popover just above the bar and in from its left edge", () => {
    expect(popoverPosition({ left: 12, top: 500 }, 800)).toEqual({ left: 20, bottom: 304 })
  })

  it("keeps the popover above a bar shifted by a safe-area inset", () => {
    expect(popoverPosition({ left: 44, top: 700 }, 800)).toEqual({ left: 52, bottom: 104 })
  })

  it("keeps the popover at least 8px from the left edge", () => {
    expect(popoverPosition({ left: 0, top: 700 }, 800).left).toBe(8)
  })
})

describe("createPositionTracker", () => {
  it("measures the bar when it starts following it", () => {
    const tracker = createPositionTracker()
    const view = viewport(800)
    expect(tracker.getSnapshot()).toBeNull()
    tracker.follow(element({ left: 0, top: 700 }), view)
    expect(tracker.getSnapshot()).toEqual({ left: 8, bottom: 104 })
  })

  it("measures again on a resize and tells subscribers", () => {
    const tracker = createPositionTracker()
    const rect = { left: 0, top: 700 }
    const view = viewport(800)
    const seen = vi.fn()
    tracker.subscribe(seen)
    const stop = tracker.follow(element(rect), view)
    expect(tracker.getSnapshot()).toEqual({ left: 8, bottom: 104 })
    seen.mockClear()

    rect.top = 600
    view.resize()
    expect(tracker.getSnapshot()).toEqual({ left: 8, bottom: 204 })
    expect(seen).toHaveBeenCalledTimes(1)

    stop()
    rect.top = 500
    view.resize()
    expect(tracker.getSnapshot()).toEqual({ left: 8, bottom: 204 })
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it("does not publish a measurement that did not change", () => {
    const tracker = createPositionTracker()
    const view = viewport(800)
    const seen = vi.fn()
    tracker.subscribe(seen)
    const stop = tracker.follow(element({ left: 0, top: 700 }), view)
    seen.mockClear()
    view.resize()
    expect(seen).not.toHaveBeenCalled()
    stop()
  })

  it("registers and releases its resize listener", () => {
    const tracker = createPositionTracker()
    const view = viewport(800)
    const stop = tracker.follow(element({ left: 0, top: 700 }), view)
    expect(view.listeners.size).toBe(1)
    stop()
    expect(view.listeners.size).toBe(0)
  })
})
