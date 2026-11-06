import { describe, expect, it } from "vitest"
import { DEFAULT_CONFIG } from "../src/client/config"
import {
  createModeStore,
  type MediaQueryLike,
  resolveMobile,
  TOUCH_QUERY,
  widthQuery,
} from "../src/client/mode"
import type { MobileConfig } from "../src/client/types"

class FakeQuery implements MediaQueryLike {
  matches: boolean
  listeners = new Set<() => void>()
  constructor(matches: boolean) {
    this.matches = matches
  }
  addEventListener(_type: "change", listener: () => void) {
    this.listeners.add(listener)
  }
  removeEventListener(_type: "change", listener: () => void) {
    this.listeners.delete(listener)
  }
  set(matches: boolean) {
    this.matches = matches
    for (const listener of [...this.listeners]) listener()
  }
}

function media(width: number, touch: boolean) {
  const queries = new Map<string, FakeQuery>()
  const matchMedia = (query: string) => {
    let found = queries.get(query)
    if (found === undefined) {
      const max = /max-width: ([\d.]+)px/.exec(query)
      found = new FakeQuery(max === null ? touch : width <= Number(max[1]))
      queries.set(query, found)
    }
    return found
  }
  return { matchMedia, queries }
}

describe("layout mode", () => {
  it("compares the width strictly below the breakpoint", () => {
    expect(widthQuery(768)).toBe("(max-width: 767.98px)")
  })

  it("follows the mode setting", () => {
    expect(resolveMobile("auto", true)).toBe(true)
    expect(resolveMobile("auto", false)).toBe(false)
    expect(resolveMobile("always", false)).toBe(true)
    expect(resolveMobile("off", true)).toBe(false)
  })

  it("reports a narrow touch screen and follows width changes", () => {
    const { matchMedia, queries } = media(390, true)
    const store = createModeStore(matchMedia, () => DEFAULT_CONFIG)
    expect(store.getSnapshot()).toEqual({ mobile: true, touch: true })

    let calls = 0
    store.subscribe(() => {
      calls += 1
    })
    const before = store.getSnapshot()
    queries.get(TOUCH_QUERY)?.set(true)
    expect(store.getSnapshot()).toBe(before)
    expect(calls).toBe(0)

    queries.get(widthQuery(768))?.set(false)
    expect(store.getSnapshot()).toEqual({ mobile: false, touch: true })
    expect(calls).toBe(1)
  })

  it("rebuilds the width query when the breakpoint changes", () => {
    const { matchMedia, queries } = media(700, false)
    let config: MobileConfig = { ...DEFAULT_CONFIG }
    const store = createModeStore(matchMedia, () => config)
    expect(store.getSnapshot().mobile).toBe(true)

    config = { ...config, breakpoint: 600 }
    store.refresh()
    expect(store.getSnapshot().mobile).toBe(false)
    expect(queries.get(widthQuery(768))?.listeners.size).toBe(0)

    config = { ...config, mode: "always" }
    store.refresh()
    expect(store.getSnapshot().mobile).toBe(true)

    store.dispose()
    expect(queries.get(widthQuery(600))?.listeners.size).toBe(0)
    expect(queries.get(TOUCH_QUERY)?.listeners.size).toBe(0)
  })
})
