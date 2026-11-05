import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { apply, inject, NAMESPACE, NODE_KEY, NODE_PRIORITY, NODE_SLOT } from "../src/client/index"
import type { ClientContext, StoredSlotEntry } from "../src/client/types"

interface StyleTag {
  dataset: Record<string, string>
  textContent: string
  removed: boolean
  remove(): void
}

let styleTags: StyleTag[] = []

beforeEach(() => {
  styleTags = []
  vi.stubGlobal("document", {
    createElement: () => {
      const tag: StyleTag = {
        dataset: {},
        textContent: "",
        removed: false,
        remove() {
          tag.removed = true
        },
      }
      return tag
    },
    head: {
      append: (tag: StyleTag) => {
        styleTags.push(tag)
      },
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function createHarness(options: { entries?: boolean } = {}) {
  const effects: (() => void)[] = []
  const registrations: { options: Record<string, unknown>; component: unknown }[] = []
  const injected: string[] = []
  const locales: string[] = []
  const stored: StoredSlotEntry[] = []

  const ctx = {
    effect: (effect: () => (() => void) | undefined) => {
      const dispose = effect()
      if (typeof dispose === "function") effects.push(dispose)
    },
    slots: {
      inject: (key: string, register: () => () => void) => {
        injected.push(key)
        return register()
      },
      register: (options: Record<string, unknown>, component: unknown) => {
        registrations.push({ options, component })
        return () => {
          registrations.splice(
            registrations.findIndex((entry) => entry.options === options),
            1,
          )
        }
      },
      ...(options.entries === false ? {} : { entries: () => stored }),
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
    sessions: {},
    uiWorkspace: {},
  }

  return {
    ctx: ctx as unknown as ClientContext,
    registrations,
    injected,
    locales,
    dispose() {
      for (const dispose of effects.reverse()) dispose()
    },
  }
}

describe("edit-message client half", () => {
  it("waits for the services the edit uses", () => {
    expect(inject).toEqual(
      expect.arrayContaining(["slots", "locale", "sessions", "uiWorkspace", "workspaces"]),
    )
  })

  it("shadows the user message renderer above the shipped one, keeping Chat's locale", () => {
    const harness = createHarness()
    apply(harness.ctx)

    expect(harness.injected).toEqual([NODE_SLOT])
    expect(harness.registrations).toHaveLength(1)
    const [entry] = harness.registrations
    expect(entry?.options).toEqual({
      name: "conversation.chat.node",
      key: "user",
      priority: NODE_PRIORITY,
      locale: "chat",
    })
    expect(NODE_KEY).toBe("user")
    expect(NODE_PRIORITY).toBeLessThan(0)
    expect(typeof entry?.component).toBe("function")
  })

  it("stays inactive when the slot registry exposes no entries", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const harness = createHarness({ entries: false })
    apply(harness.ctx)
    expect(harness.registrations).toEqual([])
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it("registers its dictionary and stylesheet and removes everything on teardown", () => {
    const harness = createHarness()
    apply(harness.ctx)

    expect(harness.locales).toEqual([NAMESPACE])
    expect(styleTags).toHaveLength(1)
    expect(styleTags[0]?.dataset.plugin).toBe("@1outres/dsh-plugin-edit-message")
    expect(styleTags[0]?.textContent).toContain(".dsh-em-action")

    harness.dispose()

    expect(styleTags[0]?.removed).toBe(true)
    expect(harness.locales).toEqual([])
    expect(harness.registrations).toEqual([])
  })
})
