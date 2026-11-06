import { describe, expect, it, vi } from "vitest"
import { normalizeConfig, normalizeRefs, refKey } from "../src/client/config"
import { createEffortStore, EFFORTS_STORAGE_KEY, EFFORTS_STORED } from "../src/client/efforts"
import { createFavoritesStore } from "../src/client/favorites"
import { RECENT_STORED } from "../src/client/model"
import {
  createRecentStore,
  RECENT_STORAGE_KEY,
  type StorageEventLike,
  type StorageLike,
} from "../src/client/recent"
import type { ConfigForm, ConfigFormSnapshot, ModelPickerConfig } from "../src/client/types"

describe("config", () => {
  it("keys pairs without joining ids that contain slashes", () => {
    expect(refKey("a/b", "c")).not.toBe(refKey("a", "b/c"))
  })

  it("keeps well-formed unique pairs only", () => {
    expect(
      normalizeRefs([
        { provider: "p", model: "m" },
        { provider: "p", model: "m" },
        { provider: "", model: "m" },
        { provider: "p" },
        "p/m",
        null,
        { provider: "q", model: "n", extra: true },
      ]),
    ).toEqual([
      { provider: "p", model: "m" },
      { provider: "q", model: "n" },
    ])
    expect(normalizeConfig(undefined)).toEqual({ favorites: [] })
  })
})

function fakeForm(initial: Partial<ModelPickerConfig>, writable = true) {
  let value: Partial<ModelPickerConfig> = initial
  const listeners = new Set<() => void>()
  let snapshot: ConfigFormSnapshot<ModelPickerConfig> = {
    status: "ready",
    value: value as ModelPickerConfig,
    revision: 1,
    writable,
  }
  const writes: unknown[] = []
  let answer: (accepted: boolean) => void = () => {}
  const form: ConfigForm<ModelPickerConfig> = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: (field, next) => {
      writes.push([field, next])
      return new Promise<boolean>((resolve) => {
        answer = resolve
      })
    },
    unset: async () => true,
  }
  return {
    form,
    writes,
    listeners,
    accept(next: boolean) {
      answer(next)
    },
    publish(next: Partial<ModelPickerConfig>) {
      value = next
      snapshot = { ...snapshot, value: value as ModelPickerConfig, revision: 2 }
      for (const listener of listeners) listener()
    },
  }
}

describe("favorites store", () => {
  it("reads the settings entry and follows its updates once connected", () => {
    const fake = fakeForm({ favorites: [{ provider: "p", model: "a" }] })
    const store = createFavoritesStore(fake.form)
    expect(store.getSnapshot()).toEqual([{ provider: "p", model: "a" }])
    const disconnect = store.connect()
    const seen = vi.fn()
    store.subscribe(seen)
    fake.publish({ favorites: [] })
    expect(store.getSnapshot()).toEqual([])
    expect(seen).toHaveBeenCalledTimes(1)
    disconnect()
    expect(fake.listeners.size).toBe(0)
  })

  it("shows a toggle at once and keeps it when the Host accepts", async () => {
    const fake = fakeForm({ favorites: [] })
    const store = createFavoritesStore(fake.form)
    store.connect()
    const result = store.toggle({ provider: "p", model: "x/y" })
    expect(store.getSnapshot()).toEqual([{ provider: "p", model: "x/y" }])
    expect(fake.writes).toEqual([["favorites", [{ provider: "p", model: "x/y" }]]])
    fake.accept(true)
    await expect(result).resolves.toBe(true)
    expect(store.getSnapshot()).toEqual([{ provider: "p", model: "x/y" }])
  })

  it("falls back to the Host list when a write is refused", async () => {
    const fake = fakeForm({ favorites: [{ provider: "p", model: "a" }] })
    const store = createFavoritesStore(fake.form)
    store.connect()
    const result = store.toggle({ provider: "p", model: "a" })
    expect(store.getSnapshot()).toEqual([])
    fake.accept(false)
    await expect(result).resolves.toBe(false)
    expect(store.getSnapshot()).toEqual([{ provider: "p", model: "a" }])
  })

  it("refuses to toggle a read-only entry", async () => {
    const fake = fakeForm({ favorites: [] }, false)
    const store = createFavoritesStore(fake.form)
    await expect(store.toggle({ provider: "p", model: "a" })).resolves.toBe(false)
    expect(fake.writes).toEqual([])
  })
})

function memoryStorage(
  initial?: string,
  key: string = RECENT_STORAGE_KEY,
): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  if (initial !== undefined) data.set(key, initial)
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
  }
}

describe("recent store", () => {
  it("loads valid pairs from storage and ignores malformed data", () => {
    const stored = memoryStorage(JSON.stringify([{ provider: "p", model: "a" }, 3]))
    expect(createRecentStore(stored).getSnapshot()).toEqual([{ provider: "p", model: "a" }])
    expect(createRecentStore(memoryStorage("{not json")).getSnapshot()).toEqual([])
    expect(createRecentStore(undefined).getSnapshot()).toEqual([])
  })

  it("records the newest model first and writes the capped list", () => {
    const storage = memoryStorage()
    const store = createRecentStore(storage)
    for (let index = 0; index < RECENT_STORED + 3; index += 1) {
      store.push({ provider: "p", model: String(index) })
    }
    store.push({ provider: "p", model: "5" })
    const list = store.getSnapshot()
    expect(list).toHaveLength(RECENT_STORED)
    expect(list[0]).toEqual({ provider: "p", model: "5" })
    expect(JSON.parse(storage.data.get(RECENT_STORAGE_KEY) ?? "[]")).toEqual(list)
  })

  it("keeps working in memory when storage refuses writes", () => {
    const store = createRecentStore({
      getItem: () => null,
      setItem: () => {
        throw new Error("quota")
      },
    })
    store.push({ provider: "p", model: "a" })
    expect(store.getSnapshot()).toEqual([{ provider: "p", model: "a" }])
  })

  it("follows writes from other tabs while connected", () => {
    const storage = memoryStorage()
    let handler: ((event: StorageEventLike) => void) | undefined
    const events = {
      addEventListener: (_type: "storage", listener: (event: StorageEventLike) => void) => {
        handler = listener
      },
      removeEventListener: () => {
        handler = undefined
      },
    }
    const store = createRecentStore(storage, events)
    const disconnect = store.connect()
    const seen = vi.fn()
    store.subscribe(seen)
    storage.data.set(RECENT_STORAGE_KEY, JSON.stringify([{ provider: "p", model: "b" }]))
    handler?.({ key: "other" })
    expect(seen).not.toHaveBeenCalled()
    handler?.({ key: RECENT_STORAGE_KEY })
    expect(store.getSnapshot()).toEqual([{ provider: "p", model: "b" }])
    expect(seen).toHaveBeenCalledTimes(1)
    disconnect()
    expect(handler).toBeUndefined()
  })
})

describe("effort store", () => {
  it("loads the level remembered for each model and ignores malformed data", () => {
    const stored = memoryStorage(
      JSON.stringify([
        { provider: "p", model: "a", effort: "high" },
        { provider: "p", model: "b" },
        { provider: "p", model: "c", effort: "" },
        { provider: "p", model: "a", effort: "low" },
        3,
      ]),
      EFFORTS_STORAGE_KEY,
    )
    const store = createEffortStore(stored)
    expect(store.get({ provider: "p", model: "a" })).toBe("high")
    expect(store.get({ provider: "p", model: "b" })).toBeUndefined()
    expect(store.get({ provider: "p", model: "c" })).toBeUndefined()
    expect(
      createEffortStore(memoryStorage("{not json", EFFORTS_STORAGE_KEY)).get({
        provider: "p",
        model: "a",
      }),
    ).toBeUndefined()
    expect(createEffortStore(undefined).get({ provider: "p", model: "a" })).toBeUndefined()
  })

  it("remembers a level per model, newest first, and forgets one reset to Default", () => {
    const storage = memoryStorage(undefined, EFFORTS_STORAGE_KEY)
    const store = createEffortStore(storage)
    store.remember({ provider: "p", model: "a" }, "high")
    store.remember({ provider: "p", model: "b" }, "low")
    store.remember({ provider: "p", model: "a" }, "xhigh")
    expect(store.get({ provider: "p", model: "a" })).toBe("xhigh")
    expect(store.get({ provider: "p", model: "b" })).toBe("low")
    expect(JSON.parse(storage.data.get(EFFORTS_STORAGE_KEY) ?? "[]")).toEqual([
      { provider: "p", model: "a", effort: "xhigh" },
      { provider: "p", model: "b", effort: "low" },
    ])
    store.remember({ provider: "p", model: "a" }, undefined)
    expect(store.get({ provider: "p", model: "a" })).toBeUndefined()
    expect(JSON.parse(storage.data.get(EFFORTS_STORAGE_KEY) ?? "[]")).toEqual([
      { provider: "p", model: "b", effort: "low" },
    ])
  })

  it("caps the stored models", () => {
    const storage = memoryStorage(undefined, EFFORTS_STORAGE_KEY)
    const store = createEffortStore(storage)
    for (let index = 0; index < EFFORTS_STORED + 3; index += 1) {
      store.remember({ provider: "p", model: String(index) }, "high")
    }
    expect(store.get({ provider: "p", model: String(EFFORTS_STORED + 2) })).toBe("high")
    expect(store.get({ provider: "p", model: "0" })).toBeUndefined()
    expect(JSON.parse(storage.data.get(EFFORTS_STORAGE_KEY) ?? "[]")).toHaveLength(EFFORTS_STORED)
  })

  it("keeps working in memory when storage refuses writes", () => {
    const store = createEffortStore({
      getItem: () => null,
      setItem: () => {
        throw new Error("quota")
      },
    })
    store.remember({ provider: "p", model: "a" }, "high")
    expect(store.get({ provider: "p", model: "a" })).toBe("high")
  })

  it("follows writes from other tabs while connected", () => {
    const storage = memoryStorage(undefined, EFFORTS_STORAGE_KEY)
    let handler: ((event: StorageEventLike) => void) | undefined
    const events = {
      addEventListener: (_type: "storage", listener: (event: StorageEventLike) => void) => {
        handler = listener
      },
      removeEventListener: () => {
        handler = undefined
      },
    }
    const store = createEffortStore(storage, events)
    const disconnect = store.connect()
    storage.data.set(
      EFFORTS_STORAGE_KEY,
      JSON.stringify([{ provider: "p", model: "a", effort: "low" }]),
    )
    handler?.({ key: "other" })
    expect(store.get({ provider: "p", model: "a" })).toBeUndefined()
    handler?.({ key: EFFORTS_STORAGE_KEY })
    expect(store.get({ provider: "p", model: "a" })).toBe("low")
    disconnect()
    expect(handler).toBeUndefined()
  })
})
