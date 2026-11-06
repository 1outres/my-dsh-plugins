import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { apply } from "../src/client/index"
import { BACKGROUND_CSS } from "../src/client/styles"
import type { BackgroundConfig, ClientContext, ThemeSnapshot } from "../src/client/types"

// The primitives barrel carries browser-only CSS and undeclared runtime
// dependencies; these tests exercise the host wiring, so the Switch only has
// to exist.
vi.mock("@deepseek-ai/dsh-client-ui-primitives", () => ({ Switch: () => null }))

interface FakeStyle {
  setProperty(name: string, value: string): void
  removeProperty(name: string): void
  getPropertyValue(name: string): string
  readonly values: Map<string, string>
}

function createStyle(): FakeStyle {
  const values = new Map<string, string>()
  return {
    values,
    setProperty(name, value) {
      values.set(name, value)
    },
    removeProperty(name) {
      values.delete(name)
    },
    getPropertyValue(name) {
      return values.get(name) ?? ""
    },
  }
}

describe("background client half", () => {
  let config: Partial<BackgroundConfig> | undefined
  let listeners: Set<() => void>
  let overrides: Record<string, { light: string; dark: string }>[]
  let registrations: { id?: string; name: string; order?: number }[]
  let handlers: Record<string, (snapshot: ThemeSnapshot) => void>
  let theme: ThemeSnapshot
  let rootStyle: FakeStyle
  let rootAttributes: Set<string>
  let bodyStyle: FakeStyle
  let styleTags: { dataset: Record<string, string>; textContent: string; remove: () => void }[]

  const form = {
    getSnapshot: () => ({
      status: "ready" as const,
      value: config as BackgroundConfig | undefined,
      revision: 1,
      writable: true,
    }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: async (field: string, next: unknown) => {
      config = { ...(config ?? {}), [field]: next }
      for (const listener of listeners) listener()
      return true
    },
    unset: async (field: string) => {
      if (config !== undefined) delete config[field as keyof BackgroundConfig]
      for (const listener of listeners) listener()
      return true
    },
  }

  const ctx = {
    effect: (effect: () => (() => void) | undefined) => {
      effect()
    },
    on: (event: string, listener: (snapshot: ThemeSnapshot) => void) => {
      handlers[event] = listener
    },
    slots: {
      inject: (_key: string, register: () => () => void) => register(),
      register: (options: { id?: string; name: string; order?: number }) => {
        registrations.push(options)
        return () => {}
      },
    },
    locale: {
      register: () => () => {},
      bind: () => (key: string) => key,
    },
    configForms: {
      get: () => form,
      whileServed: (_namespaces: string[], register: () => () => void) => register(),
    },
    theme: {
      getTheme: () => theme,
      overrideTokens: (
        _source: string,
        tokens: Record<string, { light: string; dark: string }>,
      ) => {
        overrides.push(tokens)
        return () => {
          overrides.pop()
        }
      },
    },
  }

  beforeEach(() => {
    config = undefined
    listeners = new Set()
    overrides = []
    registrations = []
    handlers = {}
    theme = {
      active: { id: "light", colorScheme: "light", tokens: {} },
      revision: 1,
    }
    rootStyle = createStyle()
    rootAttributes = new Set()
    bodyStyle = createStyle()
    styleTags = []

    const root = {
      style: rootStyle,
      setAttribute: (name: string) => rootAttributes.add(name),
      removeAttribute: (name: string) => rootAttributes.delete(name),
    }
    const body = { style: bodyStyle, hasAttribute: () => false }
    const head = {
      append: (tag: (typeof styleTags)[number]) => styleTags.push(tag),
    }
    const documentStub = {
      baseURI: "https://dsh.example/",
      documentElement: root,
      body,
      head,
      createElement: () => {
        const tag = { dataset: {} as Record<string, string>, textContent: "", remove: () => {} }
        return tag
      },
    }

    vi.stubGlobal("document", documentStub)
    vi.stubGlobal("getComputedStyle", (element: unknown) => ({
      getPropertyValue: (name: string) => {
        if (element !== body) return ""
        if (name === "--dsw-alias-bg-base") {
          return theme.active.colorScheme === "dark" ? "#151517" : "#ffffff"
        }
        if (name === "--dsw-specific-sidebar-fill") {
          return theme.active.colorScheme === "dark" ? "#1b1b1c" : "#f9fafb"
        }
        if (name === "--dsw-alias-bg-overlay") {
          return theme.active.colorScheme === "dark" ? "#61666b" : "#e9ecf2"
        }
        return ""
      },
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("registers the settings page and stays invisible without an image", () => {
    apply(ctx as unknown as ClientContext)

    expect(styleTags).toHaveLength(1)
    expect(styleTags[0]?.dataset.plugin).toBe("@1outres/dsh-plugin-background")
    expect(registrations.some((registration) => registration.id === "background")).toBe(true)
    expect(rootAttributes.has("data-dsh-background")).toBe(false)
    expect(overrides).toHaveLength(0)
  })

  it("paints the image and makes theme surfaces translucent", async () => {
    apply(ctx as unknown as ClientContext)

    await form.set("image", "/tmp/wall paper.png")

    expect(rootAttributes.has("data-dsh-background")).toBe(true)
    expect(rootStyle.getPropertyValue("--dsh-background-image")).toBe(
      'url("https://dsh.example/api/file?path=%2Ftmp%2Fwall%20paper.png")',
    )
    expect(rootStyle.getPropertyValue("--dsh-background-blur")).toBe("0px")
    expect(rootStyle.getPropertyValue("--dsh-background-dim")).toBe("rgba(0, 0, 0, 0.3)")

    const tokens = overrides.at(-1)
    expect(tokens?.["--dsw-alias-bg-base"]).toEqual({
      light: "color-mix(in srgb, #ffffff 70%, transparent)",
      dark: "color-mix(in srgb, #ffffff 70%, transparent)",
    })
    expect(tokens?.["--dsw-specific-sidebar-fill"]).toEqual({
      light: "color-mix(in srgb, #f9fafb 70%, transparent)",
      dark: "color-mix(in srgb, #f9fafb 70%, transparent)",
    })
    expect(tokens?.["--dsw-alias-bg-overlay"]).toEqual({
      light: "color-mix(in srgb, #e9ecf2 90%, transparent)",
      dark: "color-mix(in srgb, #e9ecf2 90%, transparent)",
    })

    // Surfaces over the conversation get the opaque colors back: the
    // body-portaled Settings dialog, a fullscreen right panel and the mobile drawer.
    const css = styleTags[0]?.textContent ?? ""
    expect(css).toContain('[data-shortcut-modal="settings"]')
    expect(css).toContain('[data-sidebar-right-panel="fullscreen"]')
    expect(css).toContain('html[data-dsh-background="on"][data-dsh-mobile]')
    expect(css).toContain("--dsw-alias-bg-base: #ffffff;")
    expect(css).toContain("--dsw-alias-bg-overlay: #e9ecf2;")
    expect(css).not.toContain("color-mix")
  })

  it("re-reads the palette when the theme switches", async () => {
    apply(ctx as unknown as ClientContext)
    await form.set("image", "/tmp/bg.png")

    theme = {
      active: { id: "dark", colorScheme: "dark", tokens: {} },
      revision: 2,
    }
    handlers["theme/change"]?.(theme)

    expect(overrides.at(-1)?.["--dsw-alias-bg-base"]).toEqual({
      light: "color-mix(in srgb, #151517 70%, transparent)",
      dark: "color-mix(in srgb, #151517 70%, transparent)",
    })
    expect(styleTags[0]?.textContent).toContain("--dsw-alias-bg-base: #151517;")
  })

  it("deactivates when the image is cleared or the switch is turned off", async () => {
    apply(ctx as unknown as ClientContext)
    await form.set("image", "/tmp/bg.png")
    expect(rootAttributes.has("data-dsh-background")).toBe(true)

    await form.set("image", "")
    expect(rootAttributes.has("data-dsh-background")).toBe(false)
    expect(overrides).toHaveLength(0)
    expect(styleTags[0]?.textContent).toBe(BACKGROUND_CSS)

    await form.set("image", "/tmp/bg.png")
    await form.set("enabled", false)
    expect(rootAttributes.has("data-dsh-background")).toBe(false)
    expect(overrides).toHaveLength(0)
    expect(styleTags[0]?.textContent).toBe(BACKGROUND_CSS)
  })

  it("rejects relative image paths", async () => {
    apply(ctx as unknown as ClientContext)

    await form.set("image", "wallpaper.png")

    expect(rootAttributes.has("data-dsh-background")).toBe(false)
    expect(rootStyle.getPropertyValue("--dsh-background-image")).toBe("")
  })
})
