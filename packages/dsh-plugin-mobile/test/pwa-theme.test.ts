import { afterEach, describe, expect, it, vi } from "vitest"
import {
  installTheme,
  type MetaElement,
  observeAttributes,
  THEME_QUERY,
  type ThemeDocument,
  type ThemeWindow,
} from "../src/client/pwa/theme"
import type { BooleanSetting } from "../src/client/types"

function media(matches: boolean) {
  const listeners = new Set<() => void>()
  return {
    matches,
    addEventListener: (_type: "change", listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: "change", listener: () => void) => listeners.delete(listener),
    change(next: boolean) {
      this.matches = next
      for (const listener of [...listeners]) listener()
    },
    listeners,
  }
}

function setting(value: boolean) {
  const listeners = new Set<() => void>()
  const source: BooleanSetting & { set(next: boolean): void } = {
    get: () => value,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next: boolean) {
      value = next
      for (const listener of [...listeners]) listener()
    },
  }
  return source
}

type FakeMeta = MetaElement

function createDocument(existing?: string) {
  const head: FakeMeta[] = []
  const make = (name: string, content: string): FakeMeta => {
    const meta: FakeMeta = {
      name,
      content,
      dataset: {},
      remove() {
        const index = head.indexOf(meta)
        if (index >= 0) head.splice(index, 1)
      },
    }
    return meta
  }
  const tag = existing === undefined ? null : make("theme-color", existing)
  if (tag !== null) head.push(tag)
  const doc = {
    documentElement: { id: "html" },
    body: { id: "body" },
    head: {
      append: (node: FakeMeta) => {
        head.push(node)
      },
    },
    querySelector: (selector: string) => (selector.includes("theme-color") ? tag : null),
    createElement: (tagName: string) => make(tagName, ""),
  }
  return { doc: doc as unknown as ThemeDocument, head, tag }
}

function createWindow() {
  const theme = media(false)
  const frames = new Map<number, () => void>()
  let color = "#111111"
  let next = 1
  const win = {
    matchMedia: (query: string) => {
      if (query !== THEME_QUERY) throw new Error(`unexpected query: ${query}`)
      return theme
    },
    getComputedStyle: () => ({ backgroundColor: color }),
    requestAnimationFrame: (callback: () => void) => {
      const id = next
      next += 1
      frames.set(id, callback)
      return id
    },
    cancelAnimationFrame: (id: number) => {
      frames.delete(id)
    },
  }
  return {
    win: win as unknown as ThemeWindow,
    theme,
    frames,
    setColor(nextColor: string) {
      color = nextColor
    },
    flush() {
      const pending = [...frames.values()]
      frames.clear()
      for (const callback of pending) callback()
    },
  }
}

function createObserver() {
  const targets = new Map<object, () => void>()
  return {
    observe: (target: object, callback: () => void) => {
      targets.set(target, callback)
      return {
        disconnect() {
          targets.delete(target)
        },
      }
    },
    targets,
    fire(target: object) {
      targets.get(target)?.()
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("theme color", () => {
  it("creates the meta tag and paints the page background color", () => {
    const { doc, head } = createDocument()
    const { win } = createWindow()
    const observer = createObserver()
    const stop = installTheme(doc, win, setting(true), observer.observe)

    const meta = head.find((tag) => tag.name === "theme-color")
    expect(meta?.content).toBe("#111111")
    expect(meta?.dataset.plugin).toBe("@1outres/dsh-plugin-mobile")
    expect(observer.targets.size).toBe(2)
    stop()
  })

  it("recomputes once per animation frame on attribute and color scheme changes", () => {
    const { doc, head } = createDocument()
    const page = createWindow()
    const observer = createObserver()
    const stop = installTheme(doc, page.win, setting(true), observer.observe)
    const meta = head.find((tag) => tag.name === "theme-color")

    page.setColor("#222222")
    observer.fire(doc.documentElement)
    observer.fire(doc.body)
    expect(page.frames.size).toBe(1)
    page.flush()
    expect(meta?.content).toBe("#222222")

    page.setColor("#333333")
    page.theme.change(true)
    expect(page.frames.size).toBe(1)
    page.flush()
    expect(meta?.content).toBe("#333333")
    stop()
  })

  it("restores an existing meta tag instead of taking it over", () => {
    const { doc, head, tag } = createDocument("#ffffff")
    const { win } = createWindow()
    const observer = createObserver()
    const source = setting(true)
    const stop = installTheme(doc, win, source, observer.observe)
    expect(tag?.content).toBe("#111111")

    source.set(false)
    expect(tag?.content).toBe("#ffffff")
    expect(head).toContain(tag)
    stop()
  })

  it("removes the meta tag it created when the setting turns off", () => {
    const { doc, head } = createDocument()
    const page = createWindow()
    const observer = createObserver()
    const source = setting(true)
    const stop = installTheme(doc, page.win, source, observer.observe)
    expect(head).toHaveLength(1)

    source.set(false)
    expect(head).toHaveLength(0)
    expect(observer.targets.size).toBe(0)
    expect(page.theme.listeners.size).toBe(0)
    stop()
  })

  it("does nothing while the setting is off and starts when it turns on", () => {
    const { doc, head } = createDocument()
    const page = createWindow()
    const observer = createObserver()
    const source = setting(false)
    const stop = installTheme(doc, page.win, source, observer.observe)
    expect(head).toHaveLength(0)
    expect(observer.targets.size).toBe(0)

    source.set(true)
    expect(head).toHaveLength(1)
    expect(page.theme.listeners.size).toBe(1)
    stop()
  })

  it("restores everything on teardown and drops a pending frame", () => {
    const { doc, head } = createDocument("#ffffff")
    const page = createWindow()
    const observer = createObserver()
    const source = setting(true)
    const stop = installTheme(doc, page.win, source, observer.observe)
    observer.fire(doc.documentElement)
    expect(page.frames.size).toBe(1)

    stop()
    expect(page.frames.size).toBe(0)
    expect(head[0]?.content).toBe("#ffffff")
    expect(observer.targets.size).toBe(0)
    expect(page.theme.listeners.size).toBe(0)
  })

  it("observes attribute changes on an element", () => {
    const observed: { target: Node; options: MutationObserverInit }[] = []
    const calls: number[] = []
    class FakeMutationObserver {
      constructor(private readonly callback: () => void) {}
      observe(target: Node, options: MutationObserverInit) {
        observed.push({ target, options })
        this.callback()
      }
      disconnect() {}
    }
    vi.stubGlobal("MutationObserver", FakeMutationObserver)
    const target = {} as Node
    const observer = observeAttributes(target, () => calls.push(1))
    expect(observed).toEqual([{ target, options: { attributes: true } }])
    expect(calls).toEqual([1])
    observer.disconnect()
    vi.unstubAllGlobals()
  })
})
