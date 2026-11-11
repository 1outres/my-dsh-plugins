import { describe, expect, it } from "vitest"
import type {
  CreateSession,
  LoggerPort,
  ModeMemoryStore,
  PresetRosterEntry,
  RememberedMode,
  SessionCreateRequest,
  SessionCreateValue,
  SessionFacts,
} from "../src/contract"
import { ModeMemory } from "../src/host/memory"
import { createCreateScope } from "../src/host/scope"

const PROJECT = "/work/repo"
const OTHER = "/work/other"

interface HarnessOptions {
  roster?: readonly PresetRosterEntry[] | (() => Promise<readonly PresetRosterEntry[]>)
  records?: Record<string, RememberedMode>
  workspaces?: Record<string, string>
  sessions?: Record<string, SessionFacts>
  respond?: (request: SessionCreateRequest) => Promise<SessionCreateValue>
  duringCreate?: (memory: ModeMemory) => Promise<void> | void
  store?: ModeMemoryStore
}

function createHarness(options: HarnessOptions = {}) {
  const records = new Map(Object.entries(options.records ?? {}))
  const remembered: [string, string][] = []
  const forgotten: string[] = []
  const store: ModeMemoryStore = options.store ?? {
    get: (project) => records.get(project),
    remember: async (project, agentPreset) => {
      remembered.push([project, agentPreset])
      records.set(project, { agentPreset, updatedAt: 7 })
    },
    forget: async (project) => {
      forgotten.push(project)
      records.delete(project)
    },
  }
  const info: string[] = []
  const warnings: string[] = []
  const logger: LoggerPort = {
    info: (message) => info.push(message),
    warn: (message) => warnings.push(message),
  }
  let rosterReads = 0
  const roster = {
    list: async () => {
      rosterReads += 1
      if (typeof options.roster === "function") return options.roster()
      return options.roster ?? [{ id: "standard" }, { id: "cordis" }]
    },
  }
  const paths = new Map(Object.entries(options.workspaces ?? {}))
  const workspaces = { pathOf: (workspaceId: string) => paths.get(workspaceId) }
  const facts = new Map(Object.entries(options.sessions ?? {}))
  const sessions = { factsOf: (sessionId: string) => facts.get(sessionId) }
  const calls: SessionCreateRequest[] = []
  const scope = createCreateScope()
  const memory = new ModeMemory({ store, roster, workspaces, sessions, logger, scope })
  const create: CreateSession = async (request) => {
    calls.push(request)
    if (options.duringCreate !== undefined) await options.duringCreate(memory)
    if (options.respond !== undefined) return options.respond(request)
    return { sessionId: "s-new", agentPreset: request.agentPreset ?? "standard" }
  }
  return {
    memory,
    scope,
    records,
    remembered,
    forgotten,
    info,
    warnings,
    rosterReads: () => rosterReads,
    paths,
    facts,
    calls,
    create,
  }
}

describe("ModeMemory.intercept", () => {
  it("creates unchanged without a project path", async () => {
    const h = createHarness()
    const request = { sessionId: "s" }
    await h.memory.intercept(request, h.create)
    expect(h.calls[0]).toBe(request)
    expect(h.records.size).toBe(0)
    expect(h.rosterReads()).toBe(0)
  })

  it("does not remember an explicit preset without a project path", async () => {
    const h = createHarness()
    await h.memory.intercept({ agentPreset: "cordis" }, h.create)
    expect(h.remembered).toEqual([])
  })

  it("uses the workspace path as the project", async () => {
    const h = createHarness({
      workspaces: { w1: "/work/repo/" },
      records: { [PROJECT]: { agentPreset: "cordis", updatedAt: 1 } },
    })
    const request = { sessionId: "s", workspaceId: "w1", cwd: OTHER }
    await h.memory.intercept(request, h.create)
    expect(h.calls[0]).toEqual({ ...request, agentPreset: "cordis" })
    expect(h.calls[0]).not.toBe(request)
    expect(h.rosterReads()).toBe(1)
  })

  it("uses the request cwd when no workspace is named", async () => {
    const h = createHarness({
      records: { [PROJECT]: { agentPreset: "cordis", updatedAt: 1 } },
    })
    await h.memory.intercept({ cwd: "/work/repo/" }, h.create)
    expect(h.calls[0]).toEqual({ cwd: "/work/repo/", agentPreset: "cordis" })
  })

  it("does not fall back to cwd for an unknown workspace", async () => {
    const h = createHarness({
      records: { [PROJECT]: { agentPreset: "cordis", updatedAt: 1 } },
    })
    const request = { workspaceId: "missing", cwd: PROJECT }
    await h.memory.intercept(request, h.create)
    expect(h.calls[0]).toBe(request)
    expect(h.rosterReads()).toBe(0)
  })

  it("creates unchanged when nothing is remembered", async () => {
    const h = createHarness()
    const request = { cwd: PROJECT }
    await h.memory.intercept(request, h.create)
    expect(h.calls[0]).toBe(request)
    expect(h.rosterReads()).toBe(0)
  })

  it("keeps an explicit preset and remembers the preset that ran", async () => {
    const h = createHarness({
      workspaces: { w1: PROJECT },
      respond: async () => ({ sessionId: "s-new", agentPreset: "standard" }),
    })
    const request = { workspaceId: "w1", agentPreset: "cordis" }
    const result = await h.memory.intercept(request, h.create)
    expect(h.calls[0]).toBe(request)
    expect(result.agentPreset).toBe("standard")
    expect(h.remembered).toEqual([[PROJECT, "standard"]])
  })

  it("falls back to the requested preset when the result names none", async () => {
    const h = createHarness({
      respond: async () => ({ sessionId: "s-new" }),
    })
    await h.memory.intercept({ cwd: PROJECT, agentPreset: "cordis" }, h.create)
    expect(h.remembered).toEqual([[PROJECT, "cordis"]])
  })

  it("does not fail the create when remembering fails", async () => {
    const h = createHarness({
      store: {
        get: () => undefined,
        remember: async () => {
          throw new Error("disk full")
        },
        forget: async () => {},
      },
      respond: async () => ({ sessionId: "s-new", agentPreset: "cordis" }),
    })
    const result = await h.memory.intercept({ cwd: PROJECT, agentPreset: "ptc" }, h.create)
    expect(result).toEqual({ sessionId: "s-new", agentPreset: "cordis" })
    expect(h.warnings).toHaveLength(1)
    expect(h.warnings[0]).toContain("disk full")
  })

  it("applies a remembered preset the roster still offers", async () => {
    const h = createHarness({
      records: { [PROJECT]: { agentPreset: "cordis", updatedAt: 1 } },
    })
    await h.memory.intercept({ cwd: PROJECT }, h.create)
    expect(h.calls[0]).toEqual({ cwd: PROJECT, agentPreset: "cordis" })
    expect(h.warnings).toEqual([])
    expect(h.forgotten).toEqual([])
  })

  it("forgets a preset the roster no longer offers", async () => {
    const h = createHarness({
      roster: [{ id: "standard" }],
      records: { [PROJECT]: { agentPreset: "cordis", updatedAt: 1 } },
    })
    const request = { cwd: PROJECT }
    await h.memory.intercept(request, h.create)
    expect(h.forgotten).toEqual([PROJECT])
    expect(h.records.has(PROJECT)).toBe(false)
    expect(h.calls[0]).toBe(request)
    expect(h.info).toHaveLength(1)
    expect(h.info[0]).toContain("cordis")
  })

  it("forgets a broken preset", async () => {
    const h = createHarness({
      roster: [{ id: "cordis", broken: "bad composition" }],
      records: { [PROJECT]: { agentPreset: "cordis", updatedAt: 1 } },
    })
    const request = { cwd: PROJECT }
    await h.memory.intercept(request, h.create)
    expect(h.forgotten).toEqual([PROJECT])
    expect(h.records.has(PROJECT)).toBe(false)
    expect(h.calls[0]).toBe(request)
    expect(h.info).toHaveLength(1)
  })

  it("still creates when forgetting fails", async () => {
    const h = createHarness({
      roster: [{ id: "standard" }],
      store: {
        get: () => ({ agentPreset: "cordis", updatedAt: 1 }),
        remember: async () => {},
        forget: async () => {
          throw new Error("delete failed")
        },
      },
    })
    const request = { cwd: PROJECT }
    await h.memory.intercept(request, h.create)
    expect(h.calls[0]).toBe(request)
    expect(h.warnings.some((message) => message.includes("delete failed"))).toBe(true)
  })

  it("keeps the memory when the roster cannot be read", async () => {
    const h = createHarness({
      roster: async () => {
        throw new Error("registry offline")
      },
      records: { [PROJECT]: { agentPreset: "cordis", updatedAt: 1 } },
    })
    const request = { cwd: PROJECT }
    await h.memory.intercept(request, h.create)
    expect(h.calls[0]).toBe(request)
    expect(h.records.has(PROJECT)).toBe(true)
    expect(h.forgotten).toEqual([])
    expect(h.warnings).toHaveLength(1)
    expect(h.warnings[0]).toContain("registry offline")
  })

  it("ignores a selection emitted synchronously inside a create", async () => {
    const h = createHarness({
      sessions: { s1: { cwd: PROJECT } },
      duringCreate: (memory) => {
        void memory.onPresetSelected("s1", "standard")
      },
    })
    await h.memory.intercept({ cwd: PROJECT }, h.create)
    expect(h.remembered).toEqual([])
  })

  it("ignores a selection emitted after an await inside a create", async () => {
    const h = createHarness({
      sessions: { s1: { cwd: PROJECT } },
      duringCreate: async (memory) => {
        await Promise.resolve()
        await memory.onPresetSelected("s1", "standard")
      },
    })
    await h.memory.intercept({ cwd: PROJECT }, h.create)
    expect(h.remembered).toEqual([])
  })

  it("remembers an explicit preset once even if a selection fires inside", async () => {
    const h = createHarness({
      sessions: { s1: { cwd: PROJECT } },
      respond: async () => ({ sessionId: "s-new", agentPreset: "cordis" }),
      duringCreate: async (memory) => {
        await memory.onPresetSelected("s1", "standard")
      },
    })
    await h.memory.intercept({ cwd: PROJECT, agentPreset: "ptc" }, h.create)
    expect(h.remembered).toEqual([[PROJECT, "cordis"]])
  })

  it("leaves the scope inactive when the create returns", async () => {
    const h = createHarness()
    await h.memory.intercept({ cwd: PROJECT }, h.create)
    expect(h.scope.active()).toBe(false)
  })

  it("passes a create failure through unchanged", async () => {
    const failure = new Error("cannot create")
    const h = createHarness({
      respond: async () => {
        throw failure
      },
    })
    await expect(h.memory.intercept({ cwd: PROJECT }, h.create)).rejects.toBe(failure)
  })

  it("passes a remembered-create failure through unchanged", async () => {
    const failure = new Error("cannot create")
    const h = createHarness({
      records: { [PROJECT]: { agentPreset: "cordis", updatedAt: 1 } },
      respond: async () => {
        throw failure
      },
    })
    await expect(h.memory.intercept({ cwd: PROJECT }, h.create)).rejects.toBe(failure)
    expect(h.remembered).toEqual([])
  })
})

describe("ModeMemory.onPresetSelected", () => {
  it("remembers a selection emitted outside a create", async () => {
    const h = createHarness({ sessions: { s1: { cwd: PROJECT } } })
    await h.memory.onPresetSelected("s1", "standard")
    expect(h.remembered).toEqual([[PROJECT, "standard"]])
  })

  it("remembers a live session's choice by its normalized cwd", async () => {
    const h = createHarness({ sessions: { s1: { cwd: "/work/repo/" } } })
    await h.memory.onPresetSelected("s1", "cordis")
    expect(h.remembered).toEqual([[PROJECT, "cordis"]])
  })

  it("ignores an unknown session", async () => {
    const h = createHarness()
    await h.memory.onPresetSelected("missing", "cordis")
    expect(h.remembered).toEqual([])
  })

  it("ignores a subagent session even with a cwd", async () => {
    const h = createHarness({ sessions: { s1: { cwd: PROJECT, origin: "subagent" } } })
    await h.memory.onPresetSelected("s1", "cordis")
    expect(h.remembered).toEqual([])
  })

  it("ignores a session without a cwd", async () => {
    const h = createHarness({ sessions: { s1: {} } })
    await h.memory.onPresetSelected("s1", "cordis")
    expect(h.remembered).toEqual([])
  })

  it("ignores a session with an empty cwd", async () => {
    const h = createHarness({ sessions: { s1: { cwd: "" } } })
    await h.memory.onPresetSelected("s1", "cordis")
    expect(h.remembered).toEqual([])
  })

  it("logs and swallows a write failure", async () => {
    const h = createHarness({
      sessions: { s1: { cwd: PROJECT } },
      store: {
        get: () => undefined,
        remember: async () => {
          throw new Error("write failed")
        },
        forget: async () => {},
      },
    })
    await expect(h.memory.onPresetSelected("s1", "cordis")).resolves.toBeUndefined()
    expect(h.warnings).toHaveLength(1)
    expect(h.warnings[0]).toContain("write failed")
  })
})
