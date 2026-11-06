import { describe, expect, it, vi } from "vitest"
import {
  createPageStore,
  type MatchMedia,
  mediaSource,
  readPageState,
  TOUCH_QUERY,
} from "../src/client/page"

function source(initial: boolean) {
  const listeners = new Set<() => void>()
  const handle = {
    value: initial,
    set(next: boolean) {
      handle.value = next
      for (const listener of [...listeners]) listener()
    },
    listeners,
    get: () => handle.value,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return handle
}

function media(initial: boolean) {
  const listeners = new Set<() => void>()
  const handle = {
    matches: initial,
    addEventListener: (_type: "change", listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: "change", listener: () => void) => listeners.delete(listener),
    change(next: boolean) {
      handle.matches = next
      for (const listener of [...listeners]) listener()
    },
    listeners,
  }
  return handle
}

describe("page state", () => {
  it("combines the drawer and pointer signals", () => {
    expect(readPageState(true, true)).toEqual({ mobile: true, touch: true })
    expect(readPageState(true, false)).toEqual({ mobile: true, touch: false })
    expect(readPageState(false, true)).toEqual({ mobile: false, touch: true })
  })

  it("asks for a coarse pointer", () => {
    expect(TOUCH_QUERY).toBe("(hover: none) and (pointer: coarse)")
  })
})

describe("media source", () => {
  it("follows the media query", () => {
    const query = media(false)
    const matchMedia: MatchMedia = (text) => {
      expect(text).toBe(TOUCH_QUERY)
      return query
    }
    const touch = mediaSource(matchMedia, TOUCH_QUERY)
    const listener = vi.fn()
    const off = touch.subscribe(listener)
    expect(touch.get()).toBe(false)
    query.change(true)
    expect(touch.get()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    expect(query.listeners.size).toBe(0)
  })
})

describe("page store", () => {
  it("follows the drawer and the pointer type", () => {
    const drawer = source(true)
    const touch = source(true)
    const store = createPageStore({ drawer, touch })
    expect(store.getSnapshot()).toEqual({ mobile: true, touch: true })

    const listener = vi.fn()
    const off = store.subscribe(listener)
    drawer.set(false)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).toEqual({ mobile: false, touch: true })

    touch.set(false)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot()).toEqual({ mobile: false, touch: false })
    off()
    store.dispose()
  })

  it("keeps the same snapshot while nothing changes", () => {
    const drawer = source(true)
    const touch = source(false)
    const store = createPageStore({ drawer, touch })
    const before = store.getSnapshot()
    drawer.set(true)
    expect(store.getSnapshot()).toBe(before)
    store.dispose()
  })

  it("removes every subscription on dispose", () => {
    const drawer = source(true)
    const touch = source(false)
    const store = createPageStore({ drawer, touch })
    store.dispose()
    expect(drawer.listeners.size).toBe(0)
    expect(touch.listeners.size).toBe(0)
  })
})
