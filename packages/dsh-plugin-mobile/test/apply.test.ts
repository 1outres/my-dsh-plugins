import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NAMESPACE } from "../src/client/config"
import { DRAWER_ATTRIBUTE } from "../src/client/drawer"
import { FRAME_ANCHOR } from "../src/client/frame"
import { apply, inject, SETTINGS_SLOT } from "../src/client/index"
import { TOUCH_QUERY } from "../src/client/page"
import { THEME_QUERY } from "../src/client/pwa/theme"
import { STANDALONE_QUERY } from "../src/client/pwa/worker"
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

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function createPage(options: { phone: boolean; touch: boolean }) {
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
  const touch = media(options.touch)
  const standalone = media(false)
  const themeMode = media(false)
  const state = { drawer: options.phone }
  const mutationCallbacks: (() => void)[] = []
  const frame = {
    isConnected: true,
    hasAttribute: (name: string) => name === DRAWER_ATTRIBUTE && state.drawer,
  }
  const registrations: { url: string; options: { scope: string } }[] = []
  const unregistered: string[] = []
  const serviceWorker = {
    register: async (url: string, options: { scope: string }) => {
      registrations.push({ url, options })
      return { active: null, unregister: async () => true }
    },
    getRegistration: async () => ({
      active: { scriptURL: "/dsh-mobile-sw.js" },
      unregister: async () => {
        unregistered.push("/dsh-mobile-sw.js")
        return true
      },
    }),
  }

  class FakeMutationObserver {
    constructor(private readonly callback: () => void) {}
    observe() {
      mutationCallbacks.push(this.callback)
    }
    disconnect() {}
  }
  vi.stubGlobal("MutationObserver", FakeMutationObserver)

  vi.stubGlobal("document", {
    head: { append: (added: FakeNode) => head.push(added) },
    body: {},
    createElement: node,
    querySelector: (selector: string) => {
      if (selector === FRAME_ANCHOR) return { parentElement: frame }
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
      hasAttribute: (name: string) => attributes.has(name),
    },
    addEventListener: (type: string, listener: Listener) => documentListeners.set(type, listener),
    removeEventListener: (type: string) => documentListeners.delete(type),
  })
  vi.stubGlobal("window", {
    matchMedia: (text: string) => {
      if (text === TOUCH_QUERY) return touch
      if (text === STANDALONE_QUERY) return standalone
      if (text === THEME_QUERY) return themeMode
      throw new Error(`unexpected media query: ${text}`)
    },
    isSecureContext: true,
    navigator: {
      serviceWorker,
      userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
      platform: "Linux x86_64",
      maxTouchPoints: 0,
    },
    getComputedStyle: () => ({ backgroundColor: "rgb(32, 33, 36)" }),
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
    touch,
    standalone,
    themeMode,
    registrations,
    unregistered,
    setDrawer(next: boolean) {
      state.drawer = next
      for (const callback of mutationCallbacks) callback()
    },
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

  it("adds only its Settings page; the Harness owns the drawer chrome", () => {
    createPage({ phone: true, touch: true })
    const h = createHarness()
    apply(h.ctx)

    expect(h.registrations.map((registration) => registration.options.name)).toEqual([
      SETTINGS_SLOT,
    ])
    expect(entry(h, SETTINGS_SLOT).options).toMatchObject({ id: "mobile", locale: NAMESPACE })
    expect((entry(h, SETTINGS_SLOT).options.label as () => string)()).toBe("nav")
  })

  it("marks a phone page and fits it to the keyboard", () => {
    const page = createPage({ phone: true, touch: true })
    const h = createHarness()
    apply(h.ctx)

    expect([...page.attributes].sort()).toEqual(
      [MOBILE_ATTRIBUTE, NO_PULL_ATTRIBUTE, TOUCH_ATTRIBUTE].sort(),
    )
    expect(page.props.get(HEIGHT_VARIABLE)).toBe("760px")
    expect(page.viewport.content).toContain("viewport-fit=cover")
    expect(page.windowListeners.has("keydown")).toBe(true)
    expect(page.documentListeners.has("touchstart")).toBe(true)
    expect(page.documentListeners.has("focusin")).toBe(true)
  })

  it("follows the Harness when the drawer closes", () => {
    const page = createPage({ phone: true, touch: true })
    const h = createHarness()
    apply(h.ctx)

    page.setDrawer(false)
    expect([...page.attributes]).toEqual([TOUCH_ATTRIBUTE])
    expect(page.props.size).toBe(0)
  })

  it("leaves a wide desktop page alone", () => {
    const page = createPage({ phone: false, touch: false })
    const h = createHarness()
    apply(h.ctx)
    expect(page.attributes.size).toBe(0)
    expect(page.props.size).toBe(0)
    expect(h.registrations).toHaveLength(1)
  })

  it("follows settings changes without a reload", () => {
    const page = createPage({ phone: true, touch: true })
    const h = createHarness()
    apply(h.ctx)

    h.configure({ fitKeyboard: false, blockPullToRefresh: false })
    expect(page.props.has(HEIGHT_VARIABLE)).toBe(false)
    expect(page.attributes.has(NO_PULL_ATTRIBUTE)).toBe(false)
    expect(page.attributes.has(MOBILE_ATTRIBUTE)).toBe(true)

    h.configure({ fitKeyboard: true, blockPullToRefresh: true })
    expect(page.props.get(HEIGHT_VARIABLE)).toBe("760px")
    expect(page.attributes.has(NO_PULL_ATTRIBUTE)).toBe(true)
  })

  it("registers the service worker and unregisters it when the setting turns off", async () => {
    const page = createPage({ phone: false, touch: false })
    const h = createHarness()
    apply(h.ctx)
    await flush()
    expect(page.registrations).toEqual([{ url: "./dsh-mobile-sw.js", options: { scope: "./" } }])

    h.configure({ serviceWorker: false })
    await flush()
    expect(page.unregistered).toEqual(["/dsh-mobile-sw.js"])
  })

  it("keeps the service worker registered on teardown", async () => {
    const page = createPage({ phone: false, touch: false })
    const h = createHarness()
    apply(h.ctx)
    await flush()

    h.dispose()
    await flush()
    expect(page.unregistered).toEqual([])
    expect(page.standalone.listeners.size).toBe(0)
  })

  it("paints the title bar color and removes its meta tag on teardown", () => {
    const page = createPage({ phone: false, touch: false })
    const h = createHarness()
    apply(h.ctx)

    const meta = page.head.find((tag) => tag.name === "theme-color")
    expect(meta?.content).toBe("rgb(32, 33, 36)")
    expect(meta?.dataset.plugin).toBe("@1outres/dsh-plugin-mobile")
    expect(page.themeMode.listeners.size).toBe(1)

    h.dispose()
    expect(page.head.some((tag) => tag.name === "theme-color")).toBe(false)
    expect(page.themeMode.listeners.size).toBe(0)
  })

  it("captures the install prompt while applied", () => {
    const page = createPage({ phone: false, touch: false })
    const h = createHarness()
    apply(h.ctx)

    expect(page.windowListeners.has("beforeinstallprompt")).toBe(true)
    expect(page.windowListeners.has("appinstalled")).toBe(true)

    h.dispose()
    expect(page.windowListeners.has("beforeinstallprompt")).toBe(false)
    expect(page.windowListeners.has("appinstalled")).toBe(false)
  })

  it("removes everything on teardown", () => {
    const page = createPage({ phone: true, touch: true })
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
    expect(page.touch.listeners.size).toBe(0)
    expect(page.standalone.listeners.size).toBe(0)
    expect(page.themeMode.listeners.size).toBe(0)
  })
})
