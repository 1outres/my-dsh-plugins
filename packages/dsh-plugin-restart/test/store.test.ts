import { describe, expect, it } from "vitest"
import type { ResumeRecord } from "../src/contract"
import { createResumeStore } from "../src/host/store"

function fakeTable(initial: [string, ResumeRecord][] = []) {
  const records = new Map(initial)
  return {
    records,
    get: (key: string) => records.get(key),
    put: async (key: string, value: ResumeRecord) => {
      records.set(key, value)
    },
    delete: async (key: string) => records.delete(key),
  }
}

describe("resume store", () => {
  it("keeps one record under the fixed key", async () => {
    const table = fakeTable()
    const store = createResumeStore(table)
    expect(store.read()).toBeUndefined()
    await store.save({ sessionId: "s1", requestedAt: 5 })
    expect(table.records.get("pending")).toEqual({ sessionId: "s1", requestedAt: 5 })
    expect(store.read()).toEqual({ sessionId: "s1", requestedAt: 5 })
    expect(await store.clear()).toBe(true)
    expect(store.read()).toBeUndefined()
    expect(await store.clear()).toBe(false)
  })

  it("reads a stored record", () => {
    const store = createResumeStore(fakeTable([["pending", { sessionId: "s9", requestedAt: 1 }]]))
    expect(store.read()).toEqual({ sessionId: "s9", requestedAt: 1 })
  })
})
