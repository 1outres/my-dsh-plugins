import { describe, expect, it, vi } from "vitest"
import { createBoardStore } from "../src/client/state/board"
import {
  createProjectStore,
  PROJECT_STORAGE_KEY,
  type StorageLike,
} from "../src/client/state/projects"
import { PROJECT, SNAPSHOT } from "./client-support"

function fakeStorage(initial: Record<string, string> = {}): StorageLike & {
  values: Record<string, string>
} {
  const values = { ...initial }
  return {
    values,
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value
    },
    removeItem: (key) => {
      delete values[key]
    },
  }
}

describe("project store", () => {
  it("starts from the saved project", () => {
    const storage = fakeStorage({ [PROJECT_STORAGE_KEY]: "/work/repo" })
    expect(createProjectStore(storage).getSnapshot()).toBe("/work/repo")
  })

  it("starts empty without a saved project", () => {
    expect(createProjectStore(fakeStorage()).getSnapshot()).toBeUndefined()
  })

  it("persists and clears the selection", () => {
    const storage = fakeStorage()
    const store = createProjectStore(storage)
    store.select("/work/repo")
    expect(store.getSnapshot()).toBe("/work/repo")
    expect(storage.values[PROJECT_STORAGE_KEY]).toBe("/work/repo")
    store.select(undefined)
    expect(store.getSnapshot()).toBeUndefined()
    expect(storage.values[PROJECT_STORAGE_KEY]).toBeUndefined()
  })

  it("notifies only real changes", () => {
    const store = createProjectStore(fakeStorage())
    const seen = vi.fn()
    store.subscribe(seen)
    store.select("/work/repo")
    store.select("/work/repo")
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it("keeps the selection without storage", () => {
    const store = createProjectStore(undefined)
    store.select("/work/repo")
    expect(store.getSnapshot()).toBe("/work/repo")
  })
})

describe("board store", () => {
  it("starts idle", () => {
    expect(createBoardStore().getSnapshot()).toEqual({
      project: undefined,
      status: "idle",
      snapshot: undefined,
      error: undefined,
    })
  })

  it("loads a project and receives its snapshot", () => {
    const store = createBoardStore()
    store.load(PROJECT.path)
    expect(store.getSnapshot()).toEqual({
      project: PROJECT.path,
      status: "loading",
      snapshot: undefined,
      error: undefined,
    })
    store.receive(PROJECT.path, SNAPSHOT)
    expect(store.getSnapshot()).toEqual({
      project: PROJECT.path,
      status: "ready",
      snapshot: SNAPSHOT,
      error: undefined,
    })
  })

  it("ignores a snapshot for another project", () => {
    const store = createBoardStore()
    store.load(PROJECT.path)
    store.receive("/work/other", SNAPSHOT)
    expect(store.getSnapshot().snapshot).toBeUndefined()
    expect(store.getSnapshot().status).toBe("loading")
  })

  it("keeps the last snapshot when the watch reports an error", () => {
    const store = createBoardStore()
    store.load(PROJECT.path)
    store.receive(PROJECT.path, SNAPSHOT)
    store.fail(PROJECT.path, { code: "transport", message: "offline" })
    expect(store.getSnapshot()).toMatchObject({
      status: "error",
      snapshot: SNAPSHOT,
      error: { code: "transport", message: "offline" },
    })
  })

  it("retries a failed project", () => {
    const store = createBoardStore()
    store.load(PROJECT.path)
    store.fail(PROJECT.path, { code: "transport", message: "offline" })
    store.load(PROJECT.path)
    expect(store.getSnapshot().status).toBe("loading")
    expect(store.getSnapshot().error).toBeUndefined()
  })

  it("keeps a ready board when the same project is loaded again", () => {
    const store = createBoardStore()
    store.load(PROJECT.path)
    store.receive(PROJECT.path, SNAPSHOT)
    store.load(PROJECT.path)
    expect(store.getSnapshot()).toMatchObject({ status: "ready", snapshot: SNAPSHOT })
  })

  it("clears the board when another project is loaded", () => {
    const store = createBoardStore()
    store.load(PROJECT.path)
    store.receive(PROJECT.path, SNAPSHOT)
    store.load("/work/other")
    expect(store.getSnapshot()).toMatchObject({
      project: "/work/other",
      status: "loading",
      snapshot: undefined,
    })
  })

  it("resets to idle", () => {
    const store = createBoardStore()
    store.load(PROJECT.path)
    store.reset()
    expect(store.getSnapshot()).toEqual({
      project: undefined,
      status: "idle",
      snapshot: undefined,
      error: undefined,
    })
  })
})
