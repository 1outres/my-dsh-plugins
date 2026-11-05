import { describe, expect, it } from "vitest"
import { apply, archivedIdsOf, Config, inject } from "../src/index"

const state = { initialized: true, workspaceIds: ["w"], archivedSessionIds: ["s1"] }

describe("reading the archive set", () => {
  it("reads the registry state write", () => {
    expect(
      archivedIdsOf({ domain: "workspace", table: "", key: "", operation: "put", value: state }),
    ).toEqual(["s1"])
  })

  it("treats an older state without the field as an empty set", () => {
    const value = { initialized: true, workspaceIds: [] }
    expect(
      archivedIdsOf({ domain: "workspace", table: "", key: "", operation: "put", value }),
    ).toEqual([])
  })

  it("ignores other domains, tables, deletions and malformed values", () => {
    const put = { table: "", key: "", operation: "put" as const }
    expect(archivedIdsOf({ ...put, domain: "settings", value: state })).toBeUndefined()
    expect(
      archivedIdsOf({ ...put, domain: "workspace", table: "workspaces", key: "w", value: state }),
    ).toBeUndefined()
    expect(
      archivedIdsOf({ domain: "workspace", table: "", key: "", operation: "deleted" }),
    ).toBeUndefined()
    expect(
      archivedIdsOf({ ...put, domain: "workspace", value: { archivedSessionIds: [] } }),
    ).toBeUndefined()
    expect(
      archivedIdsOf({
        ...put,
        domain: "workspace",
        value: { workspaceIds: [], archivedSessionIds: [1] },
      }),
    ).toBeUndefined()
  })
})

describe("host half", () => {
  it("waits for the registry, the Session logs and the live Session store", () => {
    expect(inject).toEqual(["workspaceRegistry", "sessionPersistence", "sessions"])
  })

  it("defaults to ~/.dsh/scratchpad with the root registered", () => {
    expect(Config({})).toEqual({ root: "~/.dsh/scratchpad", registerRoot: true })
  })

  function createContext() {
    const listeners = new Map<string, (...args: unknown[]) => unknown>()
    const warnings: string[] = []
    const effects: string[] = []
    const ctx = {
      logger: { info: () => {}, warn: (message: string) => warnings.push(message) },
      on: (name: string, listener: (...args: unknown[]) => unknown) => {
        listeners.set(name, listener)
        return () => listeners.delete(name)
      },
      effect: (_run: () => unknown, label: string) => {
        effects.push(label)
      },
      get: () => undefined,
      waterfall: async () => [],
      workspaceRegistry: { list: () => [], archivedSessionIds: [] },
      sessionPersistence: { list: async () => [] },
      sessions: { get: () => undefined, list: () => [] },
    }
    return { ctx, listeners, warnings, effects }
  }

  it("listens for new Agents and registry writes", () => {
    const { ctx, listeners, effects } = createContext()
    apply(ctx as never, { root: "/tmp/scratchpad", registerRoot: true })
    expect([...listeners.keys()]).toEqual(["agent/created", "domain/changed"])
    expect(effects).toEqual(["scratchpad: archive bookkeeping"])
    // Listeners swallow their own failures: a throw in agent/created would fail the Session.
    expect(() =>
      listeners.get("agent/created")?.({ agent: { id: "x" }, source: "startup" }),
    ).not.toThrow()
  })

  it("stays inactive on a relative root", () => {
    const { ctx, listeners, warnings } = createContext()
    apply(ctx as never, { root: "scratch", registerRoot: true })
    expect(listeners.size).toBe(0)
    expect(warnings).toEqual([expect.stringContaining("not an absolute path")])
  })
})
