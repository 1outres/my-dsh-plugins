import { describe, expect, it, vi } from "vitest"
import { createSwipeRecognizer, installSwipe } from "../src/client/swipe"

describe("swipe recognizer", () => {
  const closed = { open: true, close: false }
  const open = { open: false, close: true }

  it("opens on a rightward swipe from the left edge", () => {
    const swipe = createSwipeRecognizer()
    swipe.start(8, 300, closed)
    swipe.move(30, 302)
    expect(swipe.end(90, 305)).toBe("open")
  })

  it("ignores swipes that start away from the edge or travel too little", () => {
    const swipe = createSwipeRecognizer()
    swipe.start(60, 300, closed)
    swipe.move(120, 300)
    expect(swipe.end(160, 300)).toBeNull()
    swipe.start(8, 300, closed)
    swipe.move(30, 300)
    expect(swipe.end(40, 300)).toBeNull()
  })

  it("never acts on a gesture that turned vertical first", () => {
    const swipe = createSwipeRecognizer()
    swipe.start(8, 300, closed)
    swipe.move(10, 340)
    expect(swipe.end(120, 360)).toBeNull()
  })

  it("closes on a leftward swipe anywhere while open", () => {
    const swipe = createSwipeRecognizer()
    swipe.start(250, 300, open)
    swipe.move(230, 300)
    expect(swipe.end(150, 310)).toBe("close")
    swipe.start(250, 300, open)
    swipe.move(270, 300)
    expect(swipe.end(340, 300)).toBeNull()
  })

  it("forgets a cancelled gesture", () => {
    const swipe = createSwipeRecognizer()
    swipe.start(8, 300, closed)
    swipe.move(40, 300)
    swipe.cancel()
    expect(swipe.end(120, 300)).toBeNull()
  })
})

describe("swipe listeners", () => {
  type Listener = (event: unknown) => void

  function setup(state: { enabled: boolean; expanded: boolean; blocked: boolean }) {
    const listeners = new Map<string, Listener>()
    const options: object[] = []
    const target = {
      addEventListener: (type: string, listener: Listener, option: object) => {
        listeners.set(type, listener)
        options.push(option)
      },
      removeEventListener: (type: string) => listeners.delete(type),
    }
    const toggle = vi.fn(() => {
      state.expanded = !state.expanded
    })
    const dispose = installSwipe(target as unknown as Parameters<typeof installSwipe>[0], {
      enabled: () => state.enabled,
      expanded: () => state.expanded,
      blocked: () => state.blocked,
      toggle,
    })
    const touch = (type: string, x: number, y: number, count = 1) =>
      listeners.get(type)?.({
        target: null,
        touches:
          type === "touchend"
            ? []
            : Array.from({ length: count }, () => ({ clientX: x, clientY: y })),
        changedTouches: [{ clientX: x, clientY: y }],
      })
    const swipe = (from: number, to: number) => {
      touch("touchstart", from, 300)
      touch("touchmove", (from + to) / 2, 300)
      touch("touchend", to, 300)
    }
    return { listeners, options, toggle, dispose, touch, swipe }
  }

  it("listens passively and toggles the drawer", () => {
    const state = { enabled: true, expanded: false, blocked: false }
    const h = setup(state)
    expect(h.options.every((option) => (option as { passive?: boolean }).passive === true)).toBe(
      true,
    )
    h.swipe(6, 120)
    expect(h.toggle).toHaveBeenCalledTimes(1)
    h.swipe(200, 80)
    expect(h.toggle).toHaveBeenCalledTimes(2)
    h.dispose()
    expect(h.listeners.size).toBe(0)
  })

  it("does nothing when disabled, blocked or touched with two fingers", () => {
    const state = { enabled: false, expanded: false, blocked: false }
    const h = setup(state)
    h.swipe(6, 120)
    state.enabled = true
    state.blocked = true
    h.swipe(6, 120)
    state.blocked = false
    h.touch("touchstart", 6, 300, 2)
    h.touch("touchmove", 60, 300, 2)
    h.touch("touchend", 120, 300)
    expect(h.toggle).not.toHaveBeenCalled()
  })
})
