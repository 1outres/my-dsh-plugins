import { describe, expect, it, vi } from "vitest"
import {
  DEFAULT_LONG_PRESS,
  dispatchContextMenu,
  installLongPress,
  type LongPressHost,
  type LongPressOptions,
  longPressIgnored,
} from "../src/client/long-press"

const IGNORED =
  "input, textarea, select, [role='menu'], [contenteditable]:not([contenteditable='false'])"

interface FakeNode {
  readonly tag?: "input" | "textarea" | "select" | "div"
  readonly role?: "menu"
  readonly contenteditable?: "true" | "false"
  readonly parent?: FakeNode
}

/** A fake element whose closest() knows the selectors the predicate asks for. */
function el(node: FakeNode = {}) {
  return {
    ...node,
    closest(selector: string): unknown {
      if (selector !== IGNORED) return null
      for (let current: FakeNode | undefined = node; current !== undefined; ) {
        if (
          current.tag === "input" ||
          current.tag === "textarea" ||
          current.tag === "select" ||
          current.role === "menu" ||
          (current.contenteditable !== undefined && current.contenteditable !== "false")
        ) {
          return current
        }
        current = current.parent
      }
      return null
    },
  }
}

describe("long press targets", () => {
  it("leaves form controls and open menus to the browser", () => {
    expect(longPressIgnored(el({ tag: "input" }))).toBe(true)
    expect(longPressIgnored(el({ tag: "textarea" }))).toBe(true)
    expect(longPressIgnored(el({ tag: "select" }))).toBe(true)
    expect(longPressIgnored(el({ role: "menu" }))).toBe(true)
  })

  it("leaves editable surfaces to the browser", () => {
    expect(longPressIgnored(el({ contenteditable: "true" }))).toBe(true)
    expect(longPressIgnored(el({ contenteditable: "false" }))).toBe(false)
    expect(longPressIgnored(el({ parent: { contenteditable: "true" } }))).toBe(true)
    expect(
      longPressIgnored(el({ contenteditable: "false", parent: { contenteditable: "true" } })),
    ).toBe(true)
  })

  it("starts on ordinary elements and on nothing", () => {
    expect(longPressIgnored(el({ tag: "div" }))).toBe(false)
    expect(longPressIgnored(null)).toBe(false)
    expect(longPressIgnored(undefined)).toBe(false)
  })
})

type Listener = (event: unknown) => void

function createTimers() {
  let next = 1
  const delays: number[] = []
  const running = new Map<number, { handler: () => void; delay: number }>()
  return {
    delays,
    setTimeout: (handler: () => void, delay: number) => {
      const handle = next
      next += 1
      delays.push(delay)
      running.set(handle, { handler, delay })
      return handle as unknown as ReturnType<typeof setTimeout>
    },
    clearTimeout: (handle: ReturnType<typeof setTimeout>) => {
      running.delete(handle as unknown as number)
    },
    flush() {
      const entries = [...running.entries()]
      running.clear()
      for (const [, entry] of entries) entry.handler()
    },
    get size() {
      return running.size
    },
  }
}

interface SetupState {
  enabled: boolean
  ignored: boolean
  handled: boolean
}

function setup(
  state: SetupState = { enabled: true, ignored: false, handled: true },
  options?: LongPressOptions,
) {
  const listeners = new Map<string, { listener: Listener; options: object }>()
  const target = {
    addEventListener: (type: string, listener: Listener, option: object) => {
      listeners.set(type, { listener, options: option })
    },
    removeEventListener: (type: string) => listeners.delete(type),
  }
  const timers = createTimers()
  const open = vi.fn((_target: unknown, _x: number, _y: number) => state.handled)
  const clearSelection = vi.fn()
  const host: LongPressHost = {
    enabled: () => state.enabled,
    ignored: () => state.ignored,
    open,
    clearSelection,
  }
  const dispose = installLongPress(
    target as unknown as Parameters<typeof installLongPress>[0],
    host,
    timers,
    options,
  )
  const fire = (type: string, event: unknown) => {
    listeners.get(type)?.listener(event)
  }
  const touch = (type: string, x: number, y: number, count = 1, touchTarget: unknown = {}) => {
    fire(type, {
      target: touchTarget,
      touches:
        type === "touchend" || type === "touchcancel"
          ? []
          : Array.from({ length: count }, () => ({ clientX: x, clientY: y })),
    })
  }
  const menu = (trusted: boolean) => {
    const event = {
      isTrusted: trusted,
      defaultPrevented: false,
      preventDefault: () => {
        event.defaultPrevented = true
      },
      stopImmediatePropagation: vi.fn(),
    }
    fire("contextmenu", event)
    return event
  }
  const click = () => {
    const event = {
      isTrusted: true,
      defaultPrevented: false,
      preventDefault: () => {
        event.defaultPrevented = true
      },
      stopImmediatePropagation: vi.fn(),
    }
    fire("click", event)
    return event
  }
  return { state, listeners, timers, open, clearSelection, dispose, touch, menu, click }
}

describe("long press listeners", () => {
  it("uses a 500ms press, a 10px slop and a 700ms click window by default", () => {
    expect(DEFAULT_LONG_PRESS).toEqual({ delay: 500, slop: 10, clickWindow: 700 })
  })

  it("opens the menu after the delay and clears the selection it made", () => {
    const h = setup()
    const card = { name: "card" }
    h.touch("touchstart", 10, 20, 1, card)
    expect(h.open).not.toHaveBeenCalled()
    h.timers.flush()
    expect(h.open).toHaveBeenCalledWith(card, 10, 20)
    expect(h.clearSelection).toHaveBeenCalledTimes(1)
  })

  it("keeps the selection and the click when no menu takes the press", () => {
    const h = setup({ enabled: true, ignored: false, handled: false })
    h.touch("touchstart", 10, 20)
    h.timers.flush()
    expect(h.open).toHaveBeenCalledTimes(1)
    expect(h.clearSelection).not.toHaveBeenCalled()
    expect(h.click().defaultPrevented).toBe(false)
  })

  it("cancels when the finger travels past the slop on either axis", () => {
    const h = setup()
    h.touch("touchstart", 100, 100)
    h.touch("touchmove", 110, 100)
    expect(h.timers.size).toBe(1)
    h.touch("touchmove", 111, 100)
    expect(h.timers.size).toBe(0)

    h.touch("touchstart", 100, 100)
    h.touch("touchmove", 100, 89)
    expect(h.timers.size).toBe(0)

    h.timers.flush()
    expect(h.open).not.toHaveBeenCalled()
  })

  it("cancels on a second finger, a lifted finger or a cancelled touch", () => {
    const h = setup()
    h.touch("touchstart", 10, 10)
    h.touch("touchstart", 10, 10, 2)
    expect(h.timers.size).toBe(0)

    h.touch("touchstart", 10, 10)
    h.touch("touchmove", 10, 10, 2)
    expect(h.timers.size).toBe(0)

    h.touch("touchstart", 10, 10)
    h.touch("touchend", 10, 10)
    expect(h.timers.size).toBe(0)

    h.touch("touchstart", 10, 10)
    h.touch("touchcancel", 10, 10)
    expect(h.timers.size).toBe(0)

    h.timers.flush()
    expect(h.open).not.toHaveBeenCalled()
  })

  it("does not start when disabled or on an ignored target, and reads it every touch", () => {
    const h = setup({ enabled: false, ignored: false, handled: true })
    h.touch("touchstart", 1, 2)
    expect(h.timers.size).toBe(0)

    h.state.enabled = true
    h.state.ignored = true
    h.touch("touchstart", 1, 2)
    expect(h.timers.size).toBe(0)

    h.state.ignored = false
    h.touch("touchstart", 1, 2)
    expect(h.timers.size).toBe(1)
  })

  it("uses the injected delay, slop and click window", () => {
    const h = setup(undefined, { delay: 300, slop: 5, clickWindow: 400 })
    h.touch("touchstart", 0, 0)
    expect(h.timers.delays).toEqual([300])
    h.touch("touchmove", 6, 0)
    expect(h.timers.size).toBe(0)

    h.touch("touchstart", 0, 0)
    h.timers.flush()
    h.touch("touchend", 0, 0)
    expect(h.timers.delays).toEqual([300, 300, 400])
  })

  it("lets a trusted event through and treats its prevented dispatch as handled", () => {
    const h = setup()
    const row = { name: "row" }
    h.touch("touchstart", 30, 40, 1, row)

    const trusted = h.menu(true)
    expect(trusted.defaultPrevented).toBe(false)
    expect(trusted.stopImmediatePropagation).not.toHaveBeenCalled()
    expect(h.timers.size).toBe(1)

    trusted.preventDefault()
    h.timers.flush()
    expect(h.open).not.toHaveBeenCalled()
    expect(h.clearSelection).toHaveBeenCalledTimes(1)

    const lifted = h.click()
    expect(lifted.defaultPrevented).toBe(true)
    expect(lifted.stopImmediatePropagation).toHaveBeenCalledTimes(1)
  })

  it("stays out of the way when a trusted event was not prevented", () => {
    const h = setup()
    h.touch("touchstart", 30, 40)
    h.menu(true)
    h.timers.flush()
    expect(h.clearSelection).not.toHaveBeenCalled()
    expect(h.click().defaultPrevented).toBe(false)
  })

  it("ignores the untrusted event it dispatched itself", () => {
    const h = setup()
    h.touch("touchstart", 1, 2)
    const ours = h.menu(false)
    expect(ours.defaultPrevented).toBe(false)
    expect(ours.stopImmediatePropagation).not.toHaveBeenCalled()
    expect(h.timers.size).toBe(1)
    h.timers.flush()
    expect(h.open).toHaveBeenCalledTimes(1)
  })

  it("blocks a trusted event after the menu already opened", () => {
    const h = setup()
    h.touch("touchstart", 5, 6)
    h.timers.flush()
    expect(h.open).toHaveBeenCalledTimes(1)

    const trusted = h.menu(true)
    expect(trusted.defaultPrevented).toBe(true)
    expect(trusted.stopImmediatePropagation).toHaveBeenCalledTimes(1)
  })

  it("stops the next click after a handled press only once", () => {
    const h = setup()
    h.touch("touchstart", 5, 6)
    h.timers.flush()

    expect(h.click().defaultPrevented).toBe(true)
    expect(h.click().defaultPrevented).toBe(false)
  })

  it("does not block a trusted event after the finger lifts", () => {
    const h = setup()
    h.touch("touchstart", 5, 6)
    h.timers.flush()
    h.touch("touchend", 5, 6)

    const trusted = h.menu(true)
    expect(trusted.defaultPrevented).toBe(false)
    expect(trusted.stopImmediatePropagation).not.toHaveBeenCalled()
  })

  it("stops the click that lifts a handled press once", () => {
    const h = setup()
    h.touch("touchstart", 5, 6)
    h.timers.flush()
    h.touch("touchend", 5, 6)

    expect(h.click().defaultPrevented).toBe(true)
    expect(h.click().defaultPrevented).toBe(false)
  })

  it("lets a click through after the click window", () => {
    const h = setup()
    h.touch("touchstart", 5, 6)
    h.timers.flush()
    h.touch("touchend", 5, 6)
    expect(h.timers.size).toBe(1)

    h.timers.flush()
    expect(h.click().defaultPrevented).toBe(false)
  })

  it("starts the click window when the finger lifts after the Android check", () => {
    const h = setup()
    h.touch("touchstart", 5, 6)
    const trusted = h.menu(true)
    trusted.preventDefault()
    h.timers.flush()
    expect(h.clearSelection).toHaveBeenCalledTimes(1)
    expect(h.timers.size).toBe(0)

    h.touch("touchend", 5, 6)
    expect(h.timers.size).toBe(1)
    expect(h.click().defaultPrevented).toBe(true)
  })

  it("cancels the click window on the next touchstart", () => {
    const h = setup()
    h.touch("touchstart", 5, 6)
    h.timers.flush()
    h.touch("touchend", 5, 6)
    expect(h.timers.size).toBe(1)

    h.touch("touchstart", 5, 6)
    h.touch("touchend", 5, 6)
    expect(h.timers.size).toBe(0)
  })

  it("clears the click window timer on dispose", () => {
    const h = setup()
    h.touch("touchstart", 5, 6)
    h.timers.flush()
    h.touch("touchend", 5, 6)
    expect(h.timers.size).toBe(1)

    h.dispose()
    expect(h.timers.size).toBe(0)
  })

  it("forgets the handled press on the next touchstart", () => {
    const h = setup()
    h.touch("touchstart", 5, 6)
    h.timers.flush()

    h.touch("touchstart", 5, 6)
    h.touch("touchend", 5, 6)
    expect(h.click().defaultPrevented).toBe(false)
  })

  it("listens in capture, keeps touches passive, and removes every listener", () => {
    const h = setup()
    expect([...h.listeners.keys()].sort()).toEqual(
      ["click", "contextmenu", "touchend", "touchmove", "touchstart", "touchcancel"].sort(),
    )
    for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"]) {
      expect(h.listeners.get(type)?.options).toMatchObject({ passive: true, capture: true })
    }
    expect(h.listeners.get("contextmenu")?.options).toMatchObject({ capture: true })
    expect(h.listeners.get("click")?.options).toMatchObject({ capture: true })

    h.dispose()
    expect(h.listeners.size).toBe(0)
  })
})

describe("context menu dispatch", () => {
  class FakeEvent {
    defaultPrevented = false
    constructor(
      readonly type: string,
      readonly init: MouseEventInit,
    ) {}
    preventDefault() {
      this.defaultPrevented = true
    }
  }

  it("builds a bubbling contextmenu event and reports whether a menu took it", () => {
    const created: { type: string; init: MouseEventInit }[] = []
    const target = {
      dispatchEvent: (event: FakeEvent) => {
        event.preventDefault()
        return false
      },
    }

    const handled = dispatchContextMenu(target as unknown as EventTarget, 12, 34, (type, init) => {
      const event = new FakeEvent(type, init)
      created.push({ type, init })
      return event as unknown as MouseEvent
    })

    expect(handled).toBe(true)
    expect(created).toEqual([
      {
        type: "contextmenu",
        init: {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: 12,
          clientY: 34,
          button: 2,
        },
      },
    ])
  })

  it("reports false when nothing took the event or there is no element", () => {
    const target = { dispatchEvent: () => true }
    const create = (type: string, init: MouseEventInit) =>
      new FakeEvent(type, init) as unknown as MouseEvent
    expect(dispatchContextMenu(target as unknown as EventTarget, 1, 2, create)).toBe(false)
    expect(() => dispatchContextMenu(null, 1, 2)).not.toThrow()
    expect(dispatchContextMenu(null, 1, 2)).toBe(false)
  })
})
