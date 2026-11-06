import { describe, expect, it, vi } from "vitest"
import {
  HEIGHT_VARIABLE,
  installMeta,
  KEYBOARD_ATTRIBUTE,
  measureViewport,
  mergeViewportContent,
  trackViewport,
  VIEWPORT_ADDITIONS,
} from "../src/client/viewport"

describe("viewport metadata", () => {
  it("adds the keys and keeps everything else in order", () => {
    expect(mergeViewportContent("width=device-width, initial-scale=1", VIEWPORT_ADDITIONS)).toBe(
      "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
    )
    expect(
      mergeViewportContent("width=device-width,viewport-fit=auto,,user-scalable", {
        "viewport-fit": "cover",
      }),
    ).toBe("width=device-width, viewport-fit=cover, user-scalable")
  })

  interface FakeMeta {
    name: string
    content: string
    dataset: Record<string, string | undefined>
    removed: boolean
    remove(): void
  }

  function fakeDocument(existing: Record<string, string>) {
    const head: FakeMeta[] = []
    const make = (name: string, content: string): FakeMeta => {
      const meta: FakeMeta = {
        name,
        content,
        dataset: {},
        removed: false,
        remove() {
          meta.removed = true
          head.splice(head.indexOf(meta), 1)
        },
      }
      return meta
    }
    for (const [name, content] of Object.entries(existing)) head.push(make(name, content))
    return {
      head: {
        append: (node: unknown) => {
          head.push(node as FakeMeta)
        },
      },
      querySelector: (selector: string) => {
        const name = /name="([^"]+)"/.exec(selector)?.[1]
        return head.find((meta) => meta.name === name) ?? null
      },
      createElement: () => make("", ""),
      tags: head,
    }
  }

  it("patches the viewport, adds home-screen tags, and restores on dispose", () => {
    const doc = fakeDocument({
      viewport: "width=device-width, initial-scale=1",
      "apple-mobile-web-app-title": "Mine",
    })
    const dispose = installMeta(doc)
    const viewport = doc.tags.find((meta) => meta.name === "viewport")
    expect(viewport?.content).toContain("viewport-fit=cover")
    expect(doc.tags.map((meta) => meta.name)).toEqual([
      "viewport",
      "apple-mobile-web-app-title",
      "apple-mobile-web-app-capable",
      "mobile-web-app-capable",
    ])
    expect(doc.tags.find((meta) => meta.name === "apple-mobile-web-app-title")?.content).toBe(
      "Mine",
    )

    dispose()
    expect(viewport?.content).toBe("width=device-width, initial-scale=1")
    expect(doc.tags.map((meta) => meta.name)).toEqual(["viewport", "apple-mobile-web-app-title"])
  })

  it("creates and removes a viewport tag when the page has none", () => {
    const doc = fakeDocument({})
    const dispose = installMeta(doc)
    expect(doc.tags[0]?.name).toBe("viewport")
    dispose()
    expect(doc.tags).toEqual([])
  })
})

describe("keyboard measurement", () => {
  const phone = { width: 390, height: 760, scale: 1 }

  it("starts a baseline at the first measure and sees no keyboard", () => {
    const first = measureViewport(phone, undefined, 760)
    expect(first).toEqual({ height: 760, keyboard: false, baseline: { width: 390, height: 760 } })
  })

  it("treats a large shrink as the keyboard and a toolbar change as not", () => {
    const { baseline } = measureViewport(phone, undefined, 760)
    expect(measureViewport({ ...phone, height: 700 }, baseline, 760).keyboard).toBe(false)
    const open = measureViewport({ ...phone, height: 420 }, baseline, 760)
    expect(open.keyboard).toBe(true)
    expect(open.height).toBe(420)
    expect(open.baseline.height).toBe(760)
  })

  it("resets the baseline on rotation", () => {
    const { baseline } = measureViewport(phone, undefined, 760)
    const landscape = measureViewport({ width: 844, height: 300, scale: 1 }, baseline, 300)
    expect(landscape).toEqual({
      height: 300,
      keyboard: false,
      baseline: { width: 844, height: 300 },
    })
  })

  it("ignores the visual viewport while pinch-zoomed", () => {
    const { baseline } = measureViewport(phone, undefined, 760)
    const zoomed = measureViewport({ width: 195, height: 380, scale: 2 }, baseline, 760)
    expect(zoomed).toEqual({ height: 760, keyboard: false, baseline })
  })

  function fakeWindow() {
    const listeners = new Map<string, () => void>()
    const frames: (() => void)[] = []
    const viewport = {
      width: 390,
      height: 760,
      scale: 1,
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    }
    const win = {
      visualViewport: viewport,
      innerHeight: 760,
      scrollY: 0,
      scrollTo: vi.fn(),
      requestAnimationFrame: (callback: () => void) => frames.push(callback),
      cancelAnimationFrame: vi.fn(),
    }
    const props = new Map<string, string>()
    const attributes = new Set<string>()
    const root = {
      style: {
        setProperty: (name: string, value: string) => props.set(name, value),
        removeProperty: (name: string) => props.delete(name),
      },
      toggleAttribute: (name: string, force: boolean) => {
        if (force) attributes.add(name)
        else attributes.delete(name)
        return force
      },
      removeAttribute: (name: string) => attributes.delete(name),
    }
    return { win, viewport, listeners, frames, props, attributes, root }
  }

  it("publishes the visible height and undoes the iOS document scroll", () => {
    const f = fakeWindow()
    const dispose = trackViewport(f.win, f.root)
    expect(f.props.get(HEIGHT_VARIABLE)).toBe("760px")
    expect(f.attributes.has(KEYBOARD_ATTRIBUTE)).toBe(false)

    f.viewport.height = 412.4
    f.win.scrollY = 300
    f.listeners.get("resize")?.()
    f.listeners.get("scroll")?.()
    expect(f.frames).toHaveLength(1)
    f.frames.shift()?.()
    expect(f.props.get(HEIGHT_VARIABLE)).toBe("412px")
    expect(f.attributes.has(KEYBOARD_ATTRIBUTE)).toBe(true)
    expect(f.win.scrollTo).toHaveBeenCalledWith(0, 0)

    dispose()
    expect(f.listeners.size).toBe(0)
    expect(f.props.has(HEIGHT_VARIABLE)).toBe(false)
    expect(f.attributes.has(KEYBOARD_ATTRIBUTE)).toBe(false)
  })

  it("does nothing without the Visual Viewport API", () => {
    const f = fakeWindow()
    const dispose = trackViewport({ ...f.win, visualViewport: undefined }, f.root)
    expect(f.props.size).toBe(0)
    dispose()
  })
})
