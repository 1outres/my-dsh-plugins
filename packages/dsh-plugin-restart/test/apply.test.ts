import type { Agent } from "@deepseek-ai/dsh-agent"
import type { UserMessage } from "@deepseek-ai/dsh-llm"
import type { ToolDefinition, ToolRegistrationOptions } from "@deepseek-ai/dsh-tools"
import { describe, expect, it, vi } from "vitest"
import { Config } from "../src/config"
import type { ResumeRecord } from "../src/contract"
import { apply, inject, name } from "../src/index"

interface ContextOptions {
  appExit?: boolean
  ready?: "committed" | "pending" | "missing"
  inject?: "now" | "later"
  record?: ResumeRecord
  preset?: string
  rootId?: string
  resolve?: { agent: Agent } | { error: { message: string } }
}

const SAFE_CONFIG = { forceExitAfterMs: 600000 }

function createContext(options: ContextOptions = {}) {
  const info: string[] = []
  const warn: string[] = []
  const disposers: (() => void)[] = []
  const listeners = new Map<string, (...args: never[]) => unknown>()
  const records = new Map<string, ResumeRecord>()
  if (options.record !== undefined) records.set("pending", options.record)
  const opened: unknown[] = []
  const closed: number[] = []
  const registered: {
    definition: ToolDefinition
    options: ToolRegistrationOptions | undefined
  }[] = []
  const followups: UserMessage[] = []
  const resolved: string[] = []
  const injected: string[][] = []
  const exits: number[] = []
  const readyListeners = new Set<() => void>()
  const sessionListeners: ((controller: unknown) => void)[] = []
  const readyCommitted = options.ready === "committed"

  const agent = {
    id: "a1",
    session: { id: "s1" },
    status: "idle",
    ctx: {},
    followup: (message: UserMessage) => {
      followups.push(message)
    },
    whenIdle: async () => {},
  }

  const table = {
    get: (key: string) => records.get(key),
    put: async (key: string, value: ResumeRecord) => {
      records.set(key, value)
    },
    delete: async (key: string) => records.delete(key),
  }

  const domain = {
    table: () => table,
    close: async () => {
      closed.push(1)
    },
  }

  const controller = {
    resolveAgent: async (sessionId: string) => {
      resolved.push(sessionId)
      return options.resolve ?? { agent }
    },
  }

  const appReady = {
    onReady(listener: () => void) {
      if (readyCommitted) {
        listener()
        return () => {}
      }
      readyListeners.add(listener)
      return () => {
        readyListeners.delete(listener)
      }
    },
  }

  const ctx = {
    logger: {
      info: (message: string) => info.push(message),
      warn: (message: string) => warn.push(message),
      error: (message: string) => warn.push(message),
      debug: () => {},
    },
    effect: (run: () => (() => void) | undefined | Promise<void>) => {
      const dispose = run()
      if (typeof dispose === "function") disposers.push(dispose)
    },
    on: (event: string, listener: (...args: never[]) => unknown) => {
      listeners.set(event, listener)
      return () => listeners.delete(event)
    },
    get: (service: string): unknown => {
      if (service === "appExit") return options.appExit === false ? undefined : exit
      if (service === "appReady") return options.ready === "missing" ? undefined : appReady
      if (service === "sessionTitle") return { get: () => ({ title: "My session" }) }
      if (service === "sessionController") return controller
      return undefined
    },
    inject: (deps: string[], callback: (webCtx: unknown) => void) => {
      injected.push(deps)
      const webCtx = { sessionController: controller, effect: ctx.effect, get: ctx.get }
      if (options.inject === "later") sessionListeners.push(callback)
      else callback(webCtx)
    },
    tools: {
      register: (definition: ToolDefinition, registration: ToolRegistrationOptions | undefined) => {
        registered.push({ definition, options: registration })
      },
    },
    agents: {
      list: () => [agent],
      get: (id: string) => (id === agent.id ? agent : undefined),
    },
    agentPresets: {
      composedPreset: () => options.preset ?? "cordis",
    },
    subagents: {
      rootOf: () => ({ id: options.rootId ?? agent.id }),
    },
    storageDomain: {
      open: async (spec: unknown) => {
        opened.push(spec)
        return domain
      },
    },
  }

  function exit(code: number) {
    exits.push(code)
  }

  return {
    ctx,
    agent,
    opened,
    closed,
    registered,
    followups,
    resolved,
    injected,
    exits,
    info,
    warn,
    listeners,
    records,
    dispose() {
      for (const dispose of disposers.reverse()) dispose()
    },
    commitReady() {
      for (const listener of [...readyListeners]) listener()
    },
    commitSessions() {
      for (const listener of sessionListeners) {
        listener({ sessionController: controller, effect: ctx.effect, get: ctx.get })
      }
    },
  }
}

const flush = async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

const run = async (fixture: ReturnType<typeof createContext>, options = {}) => {
  await apply(fixture.ctx as never, Config({ ...SAFE_CONFIG, ...options }))
}

describe("restart host entry", () => {
  it("declares its name and services", () => {
    expect(name).toBe("restart")
    expect(inject).toEqual(["tools", "agents", "agentPresets", "subagents", "storageDomain"])
  })

  it("opens the restart_resume domain and closes it on dispose", async () => {
    const fixture = createContext()
    await run(fixture)
    expect(fixture.opened).toHaveLength(1)
    expect(fixture.opened[0]).toMatchObject({
      name: "restart_resume",
      version: 1,
      invalidRecords: "backup-and-skip",
      tables: { requests: {} },
    })
    expect(fixture.closed).toEqual([])
    fixture.dispose()
    expect(fixture.closed).toEqual([1])
  })

  it("registers the restart tool for a root Creator session", async () => {
    const fixture = createContext()
    await run(fixture)
    expect(fixture.registered).toHaveLength(1)
    const registration = fixture.registered[0]
    expect(registration?.definition.name).toBe("restart_harness")
    expect(await registration?.options?.when?.({ agent: fixture.agent } as never)).toBe(true)
  })

  it("withholds the tool when the launcher cannot end the process", async () => {
    const fixture = createContext({ appExit: false })
    await run(fixture)
    expect(fixture.warn.join(" ")).toContain("appExit")
    expect(await fixture.registered[0]?.options?.when?.({ agent: fixture.agent } as never)).toBe(
      false,
    )
  })

  it("withholds the tool from a sub-agent", async () => {
    const fixture = createContext({ rootId: "root" })
    await run(fixture)
    expect(await fixture.registered[0]?.options?.when?.({ agent: fixture.agent } as never)).toBe(
      false,
    )
  })

  it("listens for disposed agents", async () => {
    const fixture = createContext()
    await run(fixture)
    expect(fixture.listeners.has("agent/disposed")).toBe(true)
  })

  it("stores the resume request and asks the launcher to exit", async () => {
    const fixture = createContext()
    await run(fixture)
    const concludeTurn = vi.fn()
    await fixture.registered[0]?.definition.execute({ resume_note: "check the log" }, {
      agent: fixture.agent,
      concludeTurn,
    } as never)
    await flush()
    expect(fixture.records.get("pending")).toEqual({
      sessionId: "s1",
      note: "check the log",
      requestedAt: expect.any(Number),
    })
    expect(fixture.exits).toEqual([75])
    expect(concludeTurn).toHaveBeenCalledTimes(1)
  })

  it("resumes the stored session once startup is ready", async () => {
    const fixture = createContext({
      ready: "committed",
      record: { sessionId: "s1", note: "run the tests", requestedAt: Date.now() },
    })
    await run(fixture)
    await flush()
    expect(fixture.resolved).toEqual(["s1"])
    expect(fixture.records.size).toBe(0)
    expect(fixture.followups).toHaveLength(1)
    const message = fixture.followups[0]
    expect(message?.source).toEqual({ kind: "restart" })
    const text = message?.content[0]
    expect(text).toMatchObject({ type: "text" })
    expect(JSON.stringify(text)).toContain("run the tests")
    expect(fixture.info.join(" ")).toContain("s1")
  })

  it("waits for readiness before it resumes", async () => {
    const fixture = createContext({
      ready: "pending",
      record: { sessionId: "s1", requestedAt: Date.now() },
    })
    await run(fixture)
    await flush()
    expect(fixture.resolved).toEqual([])
    fixture.commitReady()
    await flush()
    expect(fixture.resolved).toEqual(["s1"])
  })

  it("waits for the session controller before it resumes", async () => {
    const fixture = createContext({
      ready: "committed",
      inject: "later",
      record: { sessionId: "s1", requestedAt: Date.now() },
    })
    await run(fixture)
    await flush()
    expect(fixture.injected).toEqual([["sessionController"]])
    expect(fixture.resolved).toEqual([])
    fixture.commitSessions()
    await flush()
    expect(fixture.resolved).toEqual(["s1"])
  })

  it("resumes without a launcher readiness signal", async () => {
    const fixture = createContext({
      ready: "missing",
      record: { sessionId: "s1", requestedAt: Date.now() },
    })
    await run(fixture)
    await flush()
    expect(fixture.resolved).toEqual(["s1"])
  })

  it("does not resume after the plugin is disposed", async () => {
    const fixture = createContext({
      ready: "pending",
      record: { sessionId: "s1", requestedAt: Date.now() },
    })
    await run(fixture)
    fixture.dispose()
    fixture.commitReady()
    await flush()
    expect(fixture.resolved).toEqual([])
  })

  it("logs a session it cannot resume", async () => {
    const fixture = createContext({
      ready: "committed",
      record: { sessionId: "s1", requestedAt: Date.now() },
      resolve: { error: { message: "session was deleted" } },
    })
    await run(fixture)
    await flush()
    expect(fixture.warn.join(" ")).toContain("session was deleted")
    expect(fixture.followups).toEqual([])
  })
})
