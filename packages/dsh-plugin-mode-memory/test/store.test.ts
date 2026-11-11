import { describe, expect, it, vi } from "vitest"
import type { MemoryTable, RememberedMode } from "../src/contract"
import { createModeMemoryStore } from "../src/host/store"

function fakeTable(initial: Record<string, RememberedMode> = {}) {
  const records = new Map(Object.entries(initial))
  const puts: [string, RememberedMode][] = []
  const table: MemoryTable = {
    get: (key) => records.get(key),
    put: async (key, value) => {
      puts.push([key, value])
      records.set(key, value)
    },
    delete: async (key) => records.delete(key),
  }
  return { table, records, puts }
}

describe("createModeMemoryStore", () => {
  it("reads a stored choice", () => {
    const { table } = fakeTable({ "/work/repo": { agentPreset: "cordis", updatedAt: 3 } })
    const store = createModeMemoryStore(table, () => 9)
    expect(store.get("/work/repo")).toEqual({ agentPreset: "cordis", updatedAt: 3 })
    expect(store.get("/work/other")).toBeUndefined()
  })

  it("writes a new choice with the current time", async () => {
    const { table, puts } = fakeTable()
    const now = vi.fn(() => 1234)
    const store = createModeMemoryStore(table, now)
    await store.remember("/work/repo", "cordis")
    expect(now).toHaveBeenCalledTimes(1)
    expect(puts).toEqual([["/work/repo", { agentPreset: "cordis", updatedAt: 1234 }]])
  })

  it("does not write the same preset again", async () => {
    const { table, puts } = fakeTable({
      "/work/repo": { agentPreset: "cordis", updatedAt: 3 },
    })
    const now = vi.fn(() => 99)
    const store = createModeMemoryStore(table, now)
    await store.remember("/work/repo", "cordis")
    expect(puts).toEqual([])
    expect(now).not.toHaveBeenCalled()
  })

  it("writes a different preset with a fresh time", async () => {
    const { table, puts } = fakeTable({
      "/work/repo": { agentPreset: "cordis", updatedAt: 3 },
    })
    const store = createModeMemoryStore(table, () => 99)
    await store.remember("/work/repo", "ptc")
    expect(puts).toEqual([["/work/repo", { agentPreset: "ptc", updatedAt: 99 }]])
  })

  it("forgets a choice", async () => {
    const { table, records } = fakeTable({
      "/work/repo": { agentPreset: "cordis", updatedAt: 3 },
    })
    const store = createModeMemoryStore(table, () => 9)
    await store.forget("/work/repo")
    expect(records.has("/work/repo")).toBe(false)
    expect(store.get("/work/repo")).toBeUndefined()
  })
})
