import { describe, expect, it } from "vitest"
import type { AgentPort, AgentStatus, ResumeRecord, ResumeStore } from "../src/contract"
import { RestartCoordinator } from "../src/host/coordinator"

interface Deferred {
  readonly promise: Promise<void>
  resolve(): void
}

function deferred(): Deferred {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

interface FakeAgentOptions {
  id?: string
  sessionId?: string
  title?: string
  status?: AgentStatus
}

interface FakeAgent extends AgentPort {
  state: AgentStatus
  readonly followups: string[]
  start(): void
  becomeIdle(): void
}

function fakeAgent(options: FakeAgentOptions = {}): FakeAgent {
  let idle = deferred()
  const agent: FakeAgent = {
    id: options.id ?? "a1",
    sessionId: options.sessionId ?? "s1",
    title: options.title,
    state: options.status ?? "idle",
    followups: [],
    status() {
      return agent.state
    },
    whenIdle() {
      return idle.promise
    },
    followup(text: string) {
      agent.followups.push(text)
    },
    start() {
      agent.state = "running"
    },
    becomeIdle() {
      agent.state = "idle"
      idle.resolve()
      idle = deferred()
    },
  }
  return agent
}

interface FixtureOptions {
  agents?: FakeAgent[]
  exitCode?: number
  now?: number
  save?: (record: ResumeRecord) => Promise<void>
}

function createFixture(options: FixtureOptions = {}) {
  const agents = options.agents ?? []
  const events: string[] = []
  const saved: ResumeRecord[] = []
  const exits: number[] = []
  const armed: number[] = []
  const info: string[] = []
  const warn: string[] = []
  const store: ResumeStore = {
    read: () => undefined,
    clear: async () => false,
    save:
      options.save ??
      (async (record) => {
        events.push("save")
        saved.push(record)
      }),
  }
  const coordinator = new RestartCoordinator({
    agents: { list: () => agents },
    store,
    launcher: {
      exit(code) {
        events.push("exit")
        exits.push(code)
      },
    },
    watchdog: {
      arm() {
        events.push("arm")
        armed.push(1)
      },
    },
    clock: () => options.now ?? 1_000,
    logger: {
      info: (message) => info.push(message),
      warn: (message) => warn.push(message),
    },
    exitCode: options.exitCode ?? 75,
  })
  return { coordinator, saved, exits, armed, info, warn, events }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe("restart coordinator", () => {
  it("waits for the caller to go idle, then stores the request and exits", async () => {
    const caller = fakeAgent({ status: "running" })
    const fixture = createFixture({ agents: [caller] })
    fixture.coordinator.request(caller, "deploy it")
    expect(fixture.exits).toEqual([])
    caller.becomeIdle()
    await flush()
    expect(fixture.saved).toEqual([{ sessionId: "s1", note: "deploy it", requestedAt: 1_000 }])
    expect(fixture.exits).toEqual([75])
    expect(fixture.armed).toHaveLength(1)
    expect(fixture.events).toEqual(["save", "exit", "arm"])
  })

  it("refuses a second request while one is pending", async () => {
    const caller = fakeAgent({ status: "running" })
    const fixture = createFixture({ agents: [caller] })
    fixture.coordinator.request(caller, undefined)
    expect(() => fixture.coordinator.request(caller, undefined)).toThrow(/already pending/)
  })

  it("refuses while another session runs and names it", () => {
    const caller = fakeAgent({ status: "running" })
    const other = fakeAgent({
      id: "a2",
      sessionId: "s2",
      title: "Fix the build",
      status: "running",
    })
    const fixture = createFixture({ agents: [caller, other] })
    expect(() => fixture.coordinator.request(caller, undefined)).toThrow(
      'Cannot restart DeepSeek Harness while other sessions are running: s2 ("Fix the build"). Stop them first.',
    )
  })

  it("ignores the caller's own running state", () => {
    const caller = fakeAgent({ status: "running" })
    const fixture = createFixture({ agents: [caller] })
    expect(() => fixture.coordinator.request(caller, undefined)).not.toThrow()
  })

  it("waits for the stored record before it asks for the exit", async () => {
    const gate = deferred()
    const caller = fakeAgent({ status: "running" })
    const fixture = createFixture({
      agents: [caller],
      save: async () => {
        await gate.promise
      },
    })
    fixture.coordinator.request(caller, undefined)
    caller.becomeIdle()
    await flush()
    expect(fixture.exits).toEqual([])
    gate.resolve()
    await flush()
    expect(fixture.exits).toEqual([75])
  })

  it("cancels when another session started running meanwhile", async () => {
    const caller = fakeAgent({ status: "running" })
    const other = fakeAgent({ id: "a2", sessionId: "s2" })
    const fixture = createFixture({ agents: [caller, other] })
    fixture.coordinator.request(caller, undefined)
    other.start()
    caller.becomeIdle()
    await flush()
    expect(fixture.exits).toEqual([])
    expect(fixture.saved).toEqual([])
    expect(caller.followups).toHaveLength(1)
    expect(caller.followups[0]).toContain("s2")
    expect(caller.followups[0]).toMatch(/cancelled/)
  })

  it("can be asked again after a cancellation", async () => {
    const caller = fakeAgent({ status: "running" })
    const other = fakeAgent({ id: "a2", sessionId: "s2" })
    const fixture = createFixture({ agents: [caller, other] })
    fixture.coordinator.request(caller, undefined)
    other.start()
    caller.becomeIdle()
    await flush()
    other.becomeIdle()
    expect(() => fixture.coordinator.request(caller, undefined)).not.toThrow()
  })

  it("cancels silently when the session that asked is closed", async () => {
    const caller = fakeAgent({ status: "running" })
    const fixture = createFixture({ agents: [caller] })
    fixture.coordinator.request(caller, undefined)
    fixture.coordinator.onAgentDisposed("a1")
    caller.becomeIdle()
    await flush()
    expect(fixture.exits).toEqual([])
    expect(caller.followups).toEqual([])
    expect(fixture.info.join(" ")).toMatch(/closed/)
  })

  it("keeps the note out of the record when there is none", async () => {
    const caller = fakeAgent({ status: "running" })
    const fixture = createFixture({ agents: [caller] })
    fixture.coordinator.request(caller, undefined)
    caller.becomeIdle()
    await flush()
    expect(fixture.saved[0]).toEqual({ sessionId: "s1", requestedAt: 1_000 })
    expect(Object.hasOwn(fixture.saved[0] ?? {}, "note")).toBe(false)
  })

  it("tells the caller when the resume record cannot be stored", async () => {
    const caller = fakeAgent({ status: "running" })
    const fixture = createFixture({
      agents: [caller],
      save: async () => {
        throw new Error("disk is full")
      },
    })
    fixture.coordinator.request(caller, undefined)
    caller.becomeIdle()
    await flush()
    expect(fixture.exits).toEqual([])
    expect(fixture.armed).toEqual([])
    expect(fixture.warn.join(" ")).toContain("disk is full")
    expect(caller.followups[0]).toMatch(/did not restart/)
    expect(() => fixture.coordinator.request(caller, undefined)).not.toThrow()
  })

  it("refuses a request once the exit was asked for", async () => {
    const caller = fakeAgent({ status: "running" })
    const fixture = createFixture({ agents: [caller] })
    fixture.coordinator.request(caller, undefined)
    caller.becomeIdle()
    await flush()
    expect(() => fixture.coordinator.request(caller, undefined)).toThrow(/already restarting/)
  })
})
