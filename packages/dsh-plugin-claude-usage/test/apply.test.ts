import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { apply, inject, NAMESPACE, SLOT } from "../src/client/index"
import type { ClientContext } from "../src/client/types"

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

function harness() {
  const effects: (() => void)[] = []
  const registrations: { options: Record<string, unknown>; component: unknown }[] = []
  const locales: { namespace: string; dicts: Record<string, Record<string, string>> }[] = []
  const injected: string[] = []
  let wake: (() => void) | undefined
  const stream = {
    [Symbol.asyncIterator]() {
      return stream
    },
    async next() {
      await new Promise<void>((resolve) => {
        wake = resolve
      })
      return { done: true, value: undefined }
    },
    dispose() {
      wake?.()
    },
  }
  const remote = {
    $mount: async () => async () => {},
    claudeUsage: {
      snapshots: () => stream,
      report: async () => ({
        ok: true,
        value: {
          ok: true,
          report: {
            fetchedAt: 0,
            limits: [],
            extraUsage: {
              isEnabled: false,
              monthlyLimit: null,
              usedCredits: null,
              utilization: null,
              currency: null,
            },
          },
        },
      }),
    },
  }
  const ctx = {
    effect: (effect: () => (() => void) | undefined) => {
      const dispose = effect()
      if (typeof dispose === "function") effects.push(dispose)
    },
    get: (name: string) => (name === "remote.claudeUsage" ? remote.claudeUsage : undefined),
    slots: {
      inject: (key: string, register: () => () => void) => {
        injected.push(key)
        return register()
      },
      register: (options: Record<string, unknown>, component: unknown) => {
        const entry = { options, component }
        registrations.push(entry)
        return () => {
          registrations.splice(registrations.indexOf(entry), 1)
        }
      },
    },
    locale: {
      register: (namespace: string, dicts: Record<string, Record<string, string>>) => {
        const entry = { namespace, dicts }
        locales.push(entry)
        return () => {
          locales.splice(locales.indexOf(entry), 1)
        }
      },
      bind: () => (key: string) => key,
    },
    remote,
  }
  return {
    ctx: ctx as unknown as ClientContext,
    effects,
    registrations,
    locales,
    injected,
    dispose() {
      for (const dispose of effects.reverse()) dispose()
    },
  }
}

describe("claude-usage client half", () => {
  it("waits for slots, locale and remote", () => {
    expect(inject).toEqual(expect.arrayContaining(["slots", "locale", "remote"]))
  })

  it("registers English and Japanese dictionaries", () => {
    const test = harness()
    apply(test.ctx)
    expect(test.locales.map((entry) => entry.namespace)).toEqual([NAMESPACE])
    expect(Object.keys(test.locales[0]?.dicts ?? {}).sort()).toEqual(["en", "ja"])
    test.dispose()
  })

  it("registers one bar in shell.bottom with the bridge face", async () => {
    const test = harness()
    apply(test.ctx)
    expect(test.injected).toEqual([SLOT])
    expect(test.registrations).toHaveLength(1)
    const entry = test.registrations[0]
    if (entry === undefined) throw new Error("no slot registration")
    expect(entry.options.name).toBe("shell.bottom")
    expect(entry.options.locale).toBe(NAMESPACE)
    const face = (entry.options.inject as () => Record<string, unknown>)()
    expect(face.store).toBeDefined()
    expect(typeof face.loadReport).toBe("function")
    await expect((face.loadReport as () => Promise<unknown>)()).resolves.toMatchObject({ ok: true })
    test.dispose()
  })

  it("injects its stylesheet and removes everything on teardown", () => {
    const test = harness()
    apply(test.ctx)
    expect(styleTags).toHaveLength(1)
    expect(styleTags[0]?.dataset.plugin).toBe("@1outres/dsh-plugin-claude-usage")
    expect(styleTags[0]?.textContent).toContain(".dsh-cu-bar")
    test.dispose()
    expect(styleTags[0]?.removed).toBe(true)
    expect(test.registrations).toEqual([])
    expect(test.locales).toEqual([])
  })
})
