import { describe, expect, it } from "vitest"
import type { RememberedMode, SessionCreateRequest, SessionCreateValue } from "../src/contract"
import { apply, inject, name } from "../src/index"

class FakeController {
  readonly requests: SessionCreateRequest[] = []
  emit: ((sessionId: string, agentPreset: string) => void) | undefined

  async create(request: SessionCreateRequest): Promise<SessionCreateValue> {
    this.requests.push(request)
    this.emit?.("s1", request.agentPreset ?? "standard")
    return { sessionId: "s", agentPreset: request.agentPreset ?? "standard" }
  }
}

interface ContextOptions {
  records?: Record<string, RememberedMode>
  workspaces?: Record<string, string>
  sessions?: Record<string, { cwd?: string; origin?: "subagent" }>
}

function createContext(options: ContextOptions = {}) {
  const controller = new FakeController()
  const records = new Map(Object.entries(options.records ?? {}))
  const paths = new Map(Object.entries(options.workspaces ?? {}))
  const facts = new Map(Object.entries(options.sessions ?? {}))
  const opened: unknown[] = []
  const closed: number[] = []
  const disposers: (() => void)[] = []
  const listeners = new Map<string, (...args: unknown[]) => unknown>()
  const info: string[] = []
  const warnings: string[] = []

  const domain = {
    table: () => ({
      get: (key: string) => records.get(key),
      put: async (key: string, value: RememberedMode) => {
        records.set(key, value)
      },
      delete: async (key: string) => records.delete(key),
    }),
    close: async () => {
      closed.push(1)
    },
  }

  const ctx = {
    logger: {
      info: (message: string) => info.push(message),
      warn: (message: string) => warnings.push(message),
    },
    effect: (run: () => (() => void) | undefined) => {
      const dispose = run()
      if (dispose !== undefined) disposers.push(dispose)
    },
    on: (event: string, listener: (...args: unknown[]) => unknown) => {
      listeners.set(event, listener)
      return () => listeners.delete(event)
    },
    storageDomain: {
      open: async (spec: unknown) => {
        opened.push(spec)
        return domain
      },
    },
    sessionController: controller,
    agentPresets: { list: async () => [{ id: "standard" }, { id: "cordis" }] },
    sessions: {
      get: (sessionId: string) => {
        const header = facts.get(sessionId)
        return header === undefined ? undefined : { header }
      },
    },
    workspaceRegistry: {
      get: (workspaceId: string) => {
        const path = paths.get(workspaceId)
        return path === undefined ? undefined : { path }
      },
    },
  }

  return {
    ctx,
    controller,
    records,
    paths,
    facts,
    opened,
    closed,
    listeners,
    info,
    warnings,
    dispose() {
      for (const dispose of disposers.reverse()) dispose()
    },
  }
}

describe("mode-memory host entry", () => {
  it("declares its name and services", () => {
    expect(name).toBe("mode-memory")
    expect(inject).toEqual([
      "sessionController",
      "agentPresets",
      "storageDomain",
      "sessions",
      "workspaceRegistry",
    ])
  })

  it("opens the mode_memory domain and closes it on dispose", async () => {
    const h = createContext()
    await apply(h.ctx as never)
    expect(h.opened).toHaveLength(1)
    expect(h.opened[0]).toMatchObject({
      name: "mode_memory",
      version: 1,
      invalidRecords: "backup-and-skip",
      tables: { projects: {} },
    })
    expect(h.closed).toEqual([])
    h.dispose()
    expect(h.closed).toEqual([1])
  })

  it("installs the create hook and removes it on dispose", async () => {
    const h = createContext()
    await apply(h.ctx as never)
    expect(Object.hasOwn(h.controller, "create")).toBe(true)
    h.dispose()
    expect(Object.hasOwn(h.controller, "create")).toBe(false)
  })

  it("gives a remembered preset to a create without one", async () => {
    const h = createContext({
      workspaces: { w1: "/work/repo/" },
      records: { "/work/repo": { agentPreset: "cordis", updatedAt: 1 } },
    })
    await apply(h.ctx as never)
    await h.controller.create({ workspaceId: "w1" })
    expect(h.controller.requests[0]?.agentPreset).toBe("cordis")
  })

  it("ignores the Host's default reset inside a create", async () => {
    const h = createContext({ sessions: { s1: { cwd: "/work/repo" } } })
    await apply(h.ctx as never)
    const listener = h.listeners.get("agent-preset/selected")
    expect(listener).toBeDefined()
    h.controller.emit = (sessionId, agentPreset) => {
      listener?.(sessionId, agentPreset)
    }
    await h.controller.create({ cwd: "/work/repo" })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(h.records.size).toBe(0)
  })

  it("remembers a selection for the session's project", async () => {
    const h = createContext({ sessions: { s1: { cwd: "/work/repo/" } } })
    await apply(h.ctx as never)
    expect(h.listeners.has("agent-preset/selected")).toBe(true)
    h.listeners.get("agent-preset/selected")?.("s1", "ptc")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(h.records.get("/work/repo")?.agentPreset).toBe("ptc")
  })

  it("ignores a selection from a subagent", async () => {
    const h = createContext({ sessions: { s1: { cwd: "/work/repo", origin: "subagent" } } })
    await apply(h.ctx as never)
    h.listeners.get("agent-preset/selected")?.("s1", "ptc")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(h.records.size).toBe(0)
  })

  it("stops intercepting after dispose", async () => {
    const h = createContext({
      records: { "/work/repo": { agentPreset: "cordis", updatedAt: 1 } },
    })
    await apply(h.ctx as never)
    h.dispose()
    await h.controller.create({ cwd: "/work/repo" })
    expect(h.controller.requests[0]?.agentPreset).toBeUndefined()
  })
})
