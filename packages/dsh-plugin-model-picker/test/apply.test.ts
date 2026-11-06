import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CONFIG_NAMESPACE } from "../src/client/config"
import type { EffortStore } from "../src/client/efforts"
import { apply, inject, SEAT, SEAT_PRIORITY } from "../src/client/index"
import { ModelPicker } from "../src/client/Picker"
import type {
  ClientContext,
  ModelDirectoryLike,
  ModelDirectoryState,
  ModelSelection,
} from "../src/client/types"

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
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
  })
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const directoryState: ModelDirectoryState = {
  current: null,
  routable: null,
  groups: [],
  failures: [],
  status: "idle",
  pending: null,
  error: null,
}

function createHarness(options: { subagents?: string[] } = {}) {
  const effects: (() => void)[] = []
  const registrations: { options: Record<string, unknown>; component: unknown }[] = []
  const injected: string[] = []
  const locales: string[] = []
  const formListeners = new Set<() => void>()
  const loads: string[] = []
  const selections: ModelSelection[] = []
  const directories = new Map<string, ModelDirectoryLike>()
  const subagents = new Set(options.subagents ?? [])

  const directoryFor = (sessionId: string): ModelDirectoryLike => {
    const existing = directories.get(sessionId)
    if (existing !== undefined) return existing
    const directory: ModelDirectoryLike = {
      store: { getSnapshot: () => directoryState, subscribe: () => () => {} },
      load: async () => {
        loads.push(sessionId)
        return directoryState
      },
      select: async (selection) => {
        selections.push(selection)
        return { ok: true, value: undefined }
      },
    }
    directories.set(sessionId, directory)
    return directory
  }

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
        getSnapshot: () => ({
          status: "ready" as const,
          value: { favorites: [{ provider: "p", model: "m" }] },
          revision: 1,
          writable: true,
        }),
        subscribe: (listener: () => void) => {
          formListeners.add(listener)
          return () => formListeners.delete(listener)
        },
        set: async () => true,
        unset: async () => true,
      }),
    },
    sessions: {
      subagentAddress: (sessionId: string) =>
        subagents.has(sessionId) ? { sessionId } : undefined,
    },
    modelDirectories: { directoryFor },
  }

  return {
    ctx: ctx as unknown as ClientContext,
    registrations,
    injected,
    locales,
    formListeners,
    loads,
    selections,
    dispose() {
      for (const dispose of effects.reverse()) dispose()
    },
  }
}

type Face = {
  available: boolean
  directory: unknown
  load: () => void
  select: (selection: ModelSelection) => Promise<unknown>
  favorites: { getSnapshot(): unknown }
  recent: { getSnapshot(): unknown }
  efforts: EffortStore
}

function faceOf(harness: ReturnType<typeof createHarness>, sessionId: string): Face {
  const inject = harness.registrations[0]?.options.inject as (sessionId: string) => Face
  return inject(sessionId)
}

describe("model-picker client half", () => {
  it("waits for the model directory service and the faces it creates directories with", () => {
    expect(inject).toEqual(
      expect.arrayContaining([
        "modelDirectories",
        "configForms",
        "sessions",
        "remote",
        "remote.session",
      ]),
    )
  })

  it("shadows the composer model seat above the shipped selector", () => {
    const harness = createHarness()
    apply(harness.ctx)

    expect(harness.injected).toEqual([SEAT])
    expect(harness.registrations).toHaveLength(1)
    const [entry] = harness.registrations
    expect(entry?.options.name).toBe("conversation.input.model")
    expect(entry?.options.priority).toBe(SEAT_PRIORITY)
    expect(SEAT_PRIORITY).toBeLessThan(0)
    expect(entry?.options.locale).toBe(CONFIG_NAMESPACE)
    expect(entry?.component).toBe(ModelPicker)
  })

  it("hands each Session its shared directory and the preference stores", async () => {
    const harness = createHarness()
    apply(harness.ctx)

    const face = faceOf(harness, "s1")
    expect(face.available).toBe(true)
    expect(face.directory).toBe(faceOf(harness, "s1").directory)
    expect(face.favorites.getSnapshot()).toEqual([{ provider: "p", model: "m" }])
    expect(face.recent.getSnapshot()).toEqual([])
    expect(face.efforts.get({ provider: "p", model: "m" })).toBeUndefined()
    face.efforts.remember({ provider: "p", model: "m" }, "high")
    expect(face.efforts.get({ provider: "p", model: "m" })).toBe("high")
    face.load()
    await expect(face.select({ provider: "p", model: "m" })).resolves.toEqual({
      ok: true,
      value: undefined,
    })
    expect(harness.loads).toEqual(["s1"])
    expect(harness.selections).toEqual([{ provider: "p", model: "m" }])
  })

  it("never loads or selects for addressed subagent Sessions", async () => {
    const harness = createHarness({ subagents: ["child"] })
    apply(harness.ctx)

    const face = faceOf(harness, "child")
    expect(face.available).toBe(false)
    face.load()
    await expect(face.select({ provider: "p", model: "m" })).resolves.toBeUndefined()
    expect(harness.loads).toEqual([])
    expect(harness.selections).toEqual([])
  })

  it("registers its dictionary and stylesheet and removes everything on teardown", () => {
    const harness = createHarness()
    apply(harness.ctx)

    expect(harness.locales).toEqual([CONFIG_NAMESPACE])
    expect(styleTags).toHaveLength(1)
    expect(styleTags[0]?.dataset.plugin).toBe("@1outres/dsh-plugin-model-picker")
    expect(styleTags[0]?.textContent).toContain(".dsh-mp-menu")
    expect(harness.formListeners.size).toBe(1)

    harness.dispose()

    expect(styleTags[0]?.removed).toBe(true)
    expect(harness.locales).toEqual([])
    expect(harness.registrations).toEqual([])
    expect(harness.formListeners.size).toBe(0)
  })
})
