import { describe, expect, it, vi } from "vitest"
import {
  createPositionTracker,
  popoverPosition,
  type RectLike,
} from "../src/client/popover-position"

function rect(left: number, top: number, width = 240, height = 42): RectLike {
  return { left, top, right: left + width, bottom: top + height, width }
}

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

function element(bounds: RectLike) {
  return {
    getBoundingClientRect: () => bounds,
  }
}

describe("popoverPosition", () => {
  it("opens above a wide row, aligned to its left edge", () => {
    expect(popoverPosition(rect(20, 700), 800, true)).toEqual({
      left: 20,
      bottom: 104,
      width: 240,
    })
  })

  it("caps the wide popover at 260px", () => {
    expect(popoverPosition(rect(20, 700, 400), 800, true).width).toBe(260)
  })

  it("opens to the right of a rail row, aligned to its bottom", () => {
    expect(popoverPosition(rect(0, 700, 36, 36), 800, false)).toEqual({
      left: 44,
      bottom: 64,
    })
  })
})

describe("createPositionTracker", () => {
  it("measures the row when it starts following it", () => {
    const tracker = createPositionTracker()
    const view = viewport(800)
    expect(tracker.getSnapshot()).toBeNull()
    tracker.follow(element(rect(0, 700)), view, true)
    expect(tracker.getSnapshot()).toEqual({ left: 0, bottom: 104, width: 240 })
  })

  it("measures again on a resize and tells subscribers", () => {
    const tracker = createPositionTracker()
    const bounds = rect(0, 700)
    const view = viewport(800)
    const seen = vi.fn()
    tracker.subscribe(seen)
    const stop = tracker.follow(element(bounds), view, true)
    expect(tracker.getSnapshot()).toEqual({ left: 0, bottom: 104, width: 240 })
    seen.mockClear()

    bounds.top = 600
    bounds.bottom = 642
    view.resize()
    expect(tracker.getSnapshot()).toEqual({ left: 0, bottom: 204, width: 240 })
    expect(seen).toHaveBeenCalledTimes(1)

    stop()
    bounds.top = 500
    view.resize()
    expect(tracker.getSnapshot()).toEqual({ left: 0, bottom: 204, width: 240 })
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it("does not publish a measurement that did not change", () => {
    const tracker = createPositionTracker()
    const view = viewport(800)
    const seen = vi.fn()
    tracker.subscribe(seen)
    const stop = tracker.follow(element(rect(0, 700)), view, true)
    seen.mockClear()
    view.resize()
    expect(seen).not.toHaveBeenCalled()
    stop()
  })

  it("switches to the rail placement when it follows again", () => {
    const tracker = createPositionTracker()
    const view = viewport(800)
    const stopWide = tracker.follow(element(rect(0, 700)), view, true)
    stopWide()
    tracker.follow(element(rect(0, 700, 36, 36)), view, false)
    expect(tracker.getSnapshot()).toEqual({ left: 44, bottom: 64 })
  })

  it("registers and releases its resize listener", () => {
    const tracker = createPositionTracker()
    const view = viewport(800)
    const stop = tracker.follow(element(rect(0, 700)), view, true)
    expect(view.listeners.size).toBe(1)
    stop()
    expect(view.listeners.size).toBe(0)
  })
})
