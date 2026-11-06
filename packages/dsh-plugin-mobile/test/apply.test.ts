import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { type DrawerFace, DrawerOverlay, HeaderMenuButton } from "../src/client/components"
import { NAMESPACE } from "../src/client/config"
import { apply, HEADER_SLOT, inject, OVERLAY_SLOT, SETTINGS_SLOT } from "../src/client/index"
import { MOBILE_ATTRIBUTE, NO_PULL_ATTRIBUTE, TOUCH_ATTRIBUTE } from "../src/client/styles"
import type { ClientContext, MobileConfig } from "../src/client/types"
import { HEIGHT_VARIABLE } from "../src/client/viewport"

interface FakeNode {
  tag: string
  name: string
  content: string
  textContent: string
  dataset: Record<string, string | undefined>
  remove(): void
}

type Listener = (...args: unknown[]) => void

function createPage(options: { narrow: boolean; touch: boolean }) {
  const head: FakeNode[] = []
  const node = (tag: string): FakeNode => {
    const created: FakeNode = {
      tag,
      name: "",
      content: "",
      textContent: "",
      dataset: {},
      remove() {
        head.splice(head.indexOf(created), 1)
      },
    }
    return created
  }
  const viewport = node("meta")
  viewport.name = "viewport"
  viewport.content = "width=device-width, initial-scale=1"
  head.push(viewport)

  const attributes = new Set<string>()
  const props = new Map<string, string>()
  const documentListeners = new Map<string, Listener>()
  const windowListeners = new Map<string, Listener>()
  const viewportListeners = new Map<string, Listener>()

  const query = (matches: boolean) => ({
    matches,
    addEventListener: () => {},
    removeEventListener: () => {},
  })

  vi.stubGlobal("document", {
    head: { append: (added: FakeNode) => head.push(added) },
    createElement: node,
    querySelector: (selector: string) => {
      const name = /name="([^"]+)"/.exec(selector)?.[1]
      return head.find((tag) => tag.name === name) ?? null
    },
    documentElement: {
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
    },
    addEventListener: (type: string, listener: Listener) => documentListeners.set(type, listener),
    removeEventListener: (type: string) => documentListeners.delete(type),
  })
  vi.stubGlobal("window", {
    matchMedia: (text: string) =>
      query(text.includes("max-width") ? options.narrow : options.touch),
    addEventListener: (type: string, listener: Listener) => windowListeners.set(type, listener),
    removeEventListener: (type: string) => windowListeners.delete(type),
    visualViewport: {
      width: 390,
      height: 760,
      scale: 1,
      addEventListener: (type: string, listener: Listener) => viewportListeners.set(type, listener),
      removeEventListener: (type: string) => viewportListeners.delete(type),
    },
    innerHeight: 760,
    scrollY: 0,
    scrollTo: () => {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  })

  return {
    head,
    viewport,
    attributes,
    props,
    documentListeners,
    windowListeners,
    viewportListeners,
  }
}

function createHarness() {
  const effects: (() => void)[] = []
  const registrations: { options: Record<string, unknown>; component: unknown }[] = []
  const locales: string[] = []
  const formListeners = new Set<() => void>()
  let value: Partial<MobileConfig> = {}
  const toggleSidebar = vi.fn()

  const ctx = {
    effect: (run: () => (() => void) | undefined) => {
      const dispose = run()
      if (typeof dispose === "function") effects.push(dispose)
    },
    slots: {
      inject: (_key: string, register: () => () => void) => register(),
      register: (options: Record<string, unknown>, component: unknown) => {
        const entry = { options, component }
        registrations.push(entry)
        return () => {
          registrations.splice(registrations.indexOf(entry), 1)
        }
      },
    },
    locale: {
      register: (namespace: string) => {
        locales.push(namespace)
        return () => {
          locales.splice(locales.indexOf(namespace), 1)
        }
      },
      bind: () => (key: string) => key,
    },
    configForms: {
      get: () => ({
        getSnapshot: () => ({ status: "ready", value, writable: true }),
        subscribe: (listener: () => void) => {
          formListeners.add(listener)
          return () => formListeners.delete(listener)
        },
        set: async (field: string, next: unknown) => {
          value = { ...value, [field]: next }
          for (const listener of [...formListeners]) listener()
          return true
        },
        unset: async () => true,
      }),
      whileServed: (_namespaces: readonly string[], register: () => () => void) => register(),
    },
    layout: { toggleSidebar },
  }
  return {
    ctx: ctx as unknown as ClientContext,
    registrations,
    locales,
    toggleSidebar,
    configure(next: Partial<MobileConfig>) {
      value = next
      for (const listener of [...formListeners]) listener()
    },
    dispose() {
      for (const dispose of effects.reverse()) dispose()
    },
  }
}

function entry(h: ReturnType<typeof createHarness>, slot: string) {
  const found = h.registrations.find((registration) => registration.options.name === slot)
  if (found === undefined) throw new Error(`no registration in ${slot}`)
  return found
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("mobile client half", () => {
  it("waits for the slot, locale, settings and layout services", () => {
    expect(inject).toEqual(["slots", "locale", "configForms", "layout"])
  })

  it("adds the header menu button and the drawer overlay", () => {
    createPage({ narrow: true, touch: true })
    const h = createHarness()
    apply(h.ctx)

    expect(entry(h, HEADER_SLOT).component).toBe(HeaderMenuButton)
    expect(entry(h, HEADER_SLOT).options.locale).toBe(NAMESPACE)
    expect(entry(h, OVERLAY_SLOT).component).toBe(DrawerOverlay)
    expect(entry(h, OVERLAY_SLOT).options.id).toBe("mobile-drawer")
    expect(entry(h, SETTINGS_SLOT).options).toMatchObject({ id: "mobile", locale: NAMESPACE })
    expect((entry(h, SETTINGS_SLOT).options.label as () => string)()).toBe("nav")

    const face = (entry(h, HEADER_SLOT).options.inject as () => DrawerFace)()
    expect(face.mode.getSnapshot()).toEqual({ mobile: true, touch: true })
    face.toggle()
    expect(h.toggleSidebar).toHaveBeenCalledTimes(1)
  })

  it("marks a narrow touch screen and fits the page to the keyboard", () => {
    const page = createPage({ narrow: true, touch: true })
    const h = createHarness()
    apply(h.ctx)

    expect([...page.attributes].sort()).toEqual(
      [MOBILE_ATTRIBUTE, NO_PULL_ATTRIBUTE, TOUCH_ATTRIBUTE].sort(),
    )
    expect(page.props.get(HEIGHT_VARIABLE)).toBe("760px")
    expect(page.viewport.content).toContain("viewport-fit=cover")
    expect(page.windowListeners.has("keydown")).toBe(true)
    expect(page.documentListeners.has("touchstart")).toBe(true)
  })

  it("leaves a wide desktop page alone", () => {
    const page = createPage({ narrow: false, touch: false })
    const h = createHarness()
    apply(h.ctx)
    expect(page.attributes.size).toBe(0)
    expect(page.props.size).toBe(0)
  })

  it("follows settings changes without a reload", () => {
    const page = createPage({ narrow: true, touch: true })
    const h = createHarness()
    apply(h.ctx)

    h.configure({ fitKeyboard: false, blockPullToRefresh: false })
    expect(page.props.has(HEIGHT_VARIABLE)).toBe(false)
    expect(page.attributes.has(NO_PULL_ATTRIBUTE)).toBe(false)
    expect(page.attributes.has(MOBILE_ATTRIBUTE)).toBe(true)

    h.configure({ mode: "off" })
    expect(page.attributes.size).toBe(0)

    h.configure({})
    expect(page.attributes.has(MOBILE_ATTRIBUTE)).toBe(true)
    expect(page.props.get(HEIGHT_VARIABLE)).toBe("760px")
  })

  it("removes everything on teardown", () => {
    const page = createPage({ narrow: true, touch: true })
    const h = createHarness()
    apply(h.ctx)
    expect(page.head.some((tag) => tag.dataset.plugin === "@1outres/dsh-plugin-mobile")).toBe(true)

    h.dispose()
    expect(h.registrations).toEqual([])
    expect(h.locales).toEqual([])
    expect(page.head).toEqual([page.viewport])
    expect(page.viewport.content).toBe("width=device-width, initial-scale=1")
    expect(page.attributes.size).toBe(0)
    expect(page.props.size).toBe(0)
    expect(page.windowListeners.size).toBe(0)
    expect(page.documentListeners.size).toBe(0)
    expect(page.viewportListeners.size).toBe(0)
  })
})
