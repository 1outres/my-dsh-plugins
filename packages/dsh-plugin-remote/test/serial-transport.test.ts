import { afterEach, describe, expect, it } from "vitest"
import type { AgentConnection } from "../src/host/serial/agent-connection"
import { SerialAgents } from "../src/host/serial/agents"
import type { RequestFrame } from "../src/host/serial/protocol"
import { InteractiveSessions } from "../src/host/sessions/session"
import type { SerialShell } from "../src/host/transport/serial/serial-shell"
import { SerialTransport } from "../src/host/transport/serial/serial-transport"
import type { TransportCall, TransportPrompter } from "../src/host/transport/transport"
import type { SerialTarget } from "../src/shared/types"
import {
  type AgentAnswer,
  type AgentHandler,
  connectAgent,
  type FakeSerialAgent,
  makeAgent,
  type TestAgent,
  type WsPair,
  waitFor,
} from "./serial/helpers"

const DEFAULT_SETTINGS = {
  baudRate: 9600,
  dataBits: 8 as const,
  parity: "none" as const,
  stopBits: 1 as const,
  flowControl: "none" as const,
}

interface OpenOptions {
  reused?: boolean
  start?: number
  end?: number
  subscribeFrom?: number
  lost?: number
}

function openResponder(options: OpenOptions = {}): AgentHandler {
  return (request: RequestFrame): AgentAnswer | undefined => {
    const params = request.params as Record<string, unknown>
    switch (request.method) {
      case "ports.list":
        return { result: { ports: [{ path: "/dev/ttyUSB0", open: false }] } }
      case "port.open":
        return {
          result: {
            handle: "p1",
            reused: options.reused ?? false,
            start: options.start ?? 0,
            end: options.end ?? 0,
          },
        }
      case "port.subscribe":
        return {
          result: {
            from: options.subscribeFrom ?? (params.from as number),
            lost: options.lost ?? 0,
          },
        }
      case "port.write":
        return { result: { written: Buffer.from(params.data as string, "base64").length } }
      case "port.break":
      case "port.unsubscribe":
      case "port.close":
        return { result: {} }
    }
    return undefined
  }
}

interface Rig {
  agent: TestAgent
  agents: SerialAgents
  transport: SerialTransport
  target: SerialTarget
  connection: AgentConnection
  pair: WsPair
  fake: FakeSerialAgent
  call: TransportCall
  warnings: string[]
}

const rigs: Rig[] = []

afterEach(async () => {
  while (rigs.length > 0) {
    const rig = rigs.pop()
    if (rig === undefined) continue
    await rig.transport.disposeSession()
    rig.connection.close(1000, "test done")
    await rig.pair.close()
  }
})

async function createRig(
  options: { sessionId?: string; replayBytes?: number; targetName?: string } = {},
): Promise<Rig> {
  const agent = makeAgent()
  const agents = new SerialAgents([agent.authorized])
  const connection = await connectAgent(agents, agent)
  const target: SerialTarget = {
    name: options.targetName ?? "core-sw",
    transport: "serial",
    kind: "network",
    agent: agent.name,
    agentFingerprint: agent.authorized.key.fingerprint,
    device: "/dev/ttyUSB0",
    serial: { ...DEFAULT_SETTINGS },
    lineEnding: "cr",
    secrets: [],
    initCommands: [],
  }
  const warnings: string[] = []
  const transport = new SerialTransport({
    sessionId: options.sessionId ?? "session-1",
    agents,
    replayBytes: options.replayBytes ?? 50,
    logger: { warn: (message) => warnings.push(message) },
  })
  const prompter: TransportPrompter = {
    async secret() {
      return "secret"
    },
    async hostKey() {
      return true
    },
  }
  const call: TransportCall = {
    sessionId: options.sessionId ?? "session-1",
    callId: "call-1",
    signal: new AbortController().signal,
    prompter,
  }
  const rig: Rig = {
    agent,
    agents,
    transport,
    target,
    connection: connection.connection,
    pair: connection.pair,
    fake: connection.fake,
    call,
    warnings,
  }
  rigs.push(rig)
  rig.fake.respond(openResponder())
  return rig
}

async function open(rig: Rig): Promise<SerialShell> {
  return (await rig.transport.openShell(rig.target, rig.call)) as SerialShell
}

function tick(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("serial transport", () => {
  it("connects only when the agent is online and offers the device", async () => {
    const rig = await createRig()
    await expect(rig.transport.connect(rig.target, rig.call)).resolves.toBeUndefined()
    expect(await rig.transport.isConnected(rig.target, "session-1")).toBe(true)
    await expect(
      rig.transport.connect({ ...rig.target, device: "/dev/ttyUSB9" }, rig.call),
    ).rejects.toThrow(/not offered/)
  })

  it("refuses a target whose agent key changed", async () => {
    const rig = await createRig()
    await expect(
      rig.transport.connect({ ...rig.target, agentFingerprint: "SHA256:changed" }, rig.call),
    ).rejects.toThrow(/key of serial agent .* changed/)
  })

  it("opens a fresh port at its current end and forwards data", async () => {
    const rig = await createRig()
    const shell = await open(rig)
    expect(shell.enter).toBe("\r")
    expect(rig.fake.methods()).toEqual(["port.open", "port.subscribe"])
    expect(rig.fake.request("port.open")?.params).toEqual({
      path: "/dev/ttyUSB0",
      settings: DEFAULT_SETTINGS,
    })
    expect(rig.fake.request("port.subscribe")?.params).toEqual({ handle: "p1", from: 0 })
    const chunks: string[] = []
    shell.onData((chunk) => chunks.push(chunk))
    rig.fake.sendData("p1", 0, Buffer.from("hello"))
    await tick()
    expect(chunks.join("")).toBe("hello")
  })

  it("replays the last serialReplayBytes of an open port", async () => {
    const rig = await createRig({ replayBytes: 50 })
    rig.fake.respond(openResponder({ reused: true, start: 0, end: 100 }))
    await open(rig)
    expect(rig.fake.request("port.subscribe")?.params).toEqual({ handle: "p1", from: 50 })
  })

  it("never subscribes before the oldest buffered byte", async () => {
    const rig = await createRig({ replayBytes: 4096 })
    rig.fake.respond(openResponder({ reused: true, start: 20, end: 100 }))
    await open(rig)
    expect(rig.fake.request("port.subscribe")?.params).toEqual({ handle: "p1", from: 20 })
  })

  it("writes in chunks of at most 64 KiB", async () => {
    const rig = await createRig()
    const shell = await open(rig)
    const text = "x".repeat(70_000)
    await shell.write(text)
    const writes = rig.fake.requests.filter((request) => request.method === "port.write")
    expect(writes).toHaveLength(2)
    const decoded = writes.map((request) =>
      Buffer.from((request.params as { data: string }).data, "base64"),
    )
    expect(decoded[0]).toHaveLength(65_536)
    expect(Buffer.concat(decoded).toString("utf8")).toBe(text)
  })

  it("sends a BREAK", async () => {
    const rig = await createRig()
    const shell = await open(rig)
    await shell.sendBreak(250)
    expect(rig.fake.request("port.break")?.params).toEqual({ handle: "p1", durationMs: 250 })
  })

  it("decodes UTF-8 sequences split across events", async () => {
    const rig = await createRig()
    const shell = await open(rig)
    const chunks: string[] = []
    shell.onData((chunk) => chunks.push(chunk))
    rig.fake.sendData("p1", 0, Buffer.from([0xe2, 0x82]))
    rig.fake.sendData("p1", 2, Buffer.from([0xac]))
    await tick()
    expect(chunks.join("")).toBe("€")
  })

  it("resubscribes from the next offset and reports lost bytes after a reconnect", async () => {
    const rig = await createRig()
    const shell = await open(rig)
    const chunks: string[] = []
    shell.onData((chunk) => chunks.push(chunk))
    rig.fake.sendData("p1", 0, Buffer.from("abc"))
    await tick()

    rig.connection.close(1000, "network drop")
    await waitFor(() => !rig.agents.online(rig.agent.name))
    const reconnected = await connectAgent(
      rig.agents,
      rig.agent,
      500,
      openResponder({ subscribeFrom: 10, lost: 7 }),
    )
    rigs.push({
      ...rig,
      connection: reconnected.connection,
      pair: reconnected.pair,
      fake: reconnected.fake,
    })
    await waitFor(() => reconnected.fake.request("port.subscribe") !== undefined)
    expect(reconnected.fake.request("port.subscribe")?.params).toEqual({
      handle: "p1",
      from: 3,
    })
    await tick()
    expect(chunks.join("")).toContain(
      "[dsh: 7 bytes of serial output were lost while the agent was away]",
    )
    reconnected.fake.sendData("p1", 10, Buffer.from("def"))
    await tick()
    expect(chunks.join("")).toContain("def")
  })

  it("reopens the port when a restarted agent lost its handles", async () => {
    const rig = await createRig()
    const shell = await open(rig)
    const chunks: string[] = []
    shell.onData((chunk) => chunks.push(chunk))
    rig.fake.sendData("p1", 0, Buffer.from("abc"))
    await tick()

    rig.connection.close(1000, "agent stopped")
    await waitFor(() => !rig.agents.online(rig.agent.name))
    let subscribes = 0
    const reconnected = await connectAgent(rig.agents, rig.agent, 500, (request) => {
      switch (request.method) {
        case "port.subscribe":
          subscribes += 1
          if (subscribes === 1) {
            return { error: { code: "unknown-handle", message: "the port is gone" } }
          }
          return { result: { from: 0, lost: 0 } }
        case "port.open":
          return { result: { handle: "p2", reused: false, start: 0, end: 0 } }
      }
      return undefined
    })
    rigs.push({
      ...rig,
      connection: reconnected.connection,
      pair: reconnected.pair,
      fake: reconnected.fake,
    })
    await waitFor(() => subscribes === 2)
    expect(reconnected.fake.request("port.open")?.params).toEqual({
      path: "/dev/ttyUSB0",
      settings: DEFAULT_SETTINGS,
    })
    expect(
      reconnected.fake.requests.filter((request) => request.method === "port.subscribe")[1]?.params,
    ).toEqual({
      handle: "p2",
      from: 0,
    })
    reconnected.fake.sendData("p2", 0, Buffer.from("while away"))
    await tick()
    expect(chunks.join("")).toContain("while away")
    expect(chunks.join("")).not.toContain("bytes of serial output were lost")
  })

  it("ends the shell when the agent closes the port", async () => {
    const rig = await createRig()
    const shell = await open(rig)
    const chunks: string[] = []
    shell.onData((chunk) => chunks.push(chunk))
    const exited = new Promise<number | null>((resolve) => shell.onExit(resolve))
    rig.fake.sendClosed("p1", "device-removed", "The cable was pulled")
    expect(await exited).toBeNull()
    expect(shell.exitCode).toBeNull()
    expect(rig.agents.leaseOf(rig.agent.name, "/dev/ttyUSB0")).toBeUndefined()
    expect(chunks.join("")).toContain("device-removed")
  })

  it("closes the port and frees the lease before close resolves", async () => {
    const rig = await createRig()
    const shell = await open(rig)
    const exited = new Promise<number | null>((resolve) => shell.onExit(resolve))
    await shell.close()
    expect(rig.fake.methods()).toContain("port.unsubscribe")
    expect(rig.fake.methods()).toContain("port.close")
    expect(await exited).toBeNull()
    expect(rig.agents.leaseOf(rig.agent.name, "/dev/ttyUSB0")).toBeUndefined()
    expect(rig.warnings).toEqual([])

    const reopened = await open(rig)
    expect(reopened.exitCode).toBeNull()
    await reopened.close()
  })

  it("releases the port when the session manager closes the session", async () => {
    const rig = await createRig()
    const sessions = new InteractiveSessions(() => rig.transport, {
      defaultPromptPattern: "[>#$%]\\s*$",
      idleMs: 20,
      sendTimeoutMs: 200,
      maxOutputBytes: 30_000,
      secretValues: () => [],
    })
    const opened = await sessions.open(rig.target, "console", rig.call)
    expect(await sessions.close(opened.session.id)).toBe(true)
    expect(rig.fake.methods()).toContain("port.unsubscribe")
    expect(rig.fake.methods()).toContain("port.close")
    expect(rig.agents.leaseOf(rig.agent.name, "/dev/ttyUSB0")).toBeUndefined()

    const reopened = await open(rig)
    expect(reopened.exitCode).toBeNull()
    await reopened.close()
  })

  it("reports a failed port close and still frees the lease", async () => {
    const rig = await createRig()
    const shell = await open(rig)
    rig.fake.respond((request: RequestFrame): AgentAnswer | undefined => {
      if (request.method === "port.unsubscribe") {
        return { error: { code: "io", message: "unsubscribe failed" } }
      }
      if (request.method === "port.close") {
        return { error: { code: "io", message: "close failed" } }
      }
      return openResponder()(request)
    })
    await expect(shell.close()).rejects.toThrow(/port\.unsubscribe failed/)
    await expect(shell.close()).rejects.toThrow(/port\.close failed/)
    await expect(shell.close()).rejects.toThrow(/orphanTimeout/)
    expect(rig.agents.leaseOf(rig.agent.name, "/dev/ttyUSB0")).toBeUndefined()
    expect(rig.warnings).toEqual([])
  })

  it("reports an offline agent and still frees the lease", async () => {
    const rig = await createRig()
    const shell = await open(rig)
    rig.connection.close(1000, "network drop")
    await waitFor(() => !rig.agents.online(rig.agent.name))
    const before = rig.fake.requests.length
    await expect(shell.close()).rejects.toThrow(/offline/)
    await expect(shell.close()).rejects.toThrow(/orphanTimeout/)
    expect(rig.fake.requests).toHaveLength(before)
    expect(rig.agents.leaseOf(rig.agent.name, "/dev/ttyUSB0")).toBeUndefined()
  })

  it("logs a failed close when the caller cannot wait", async () => {
    const rig = await createRig()
    const shell = await open(rig)
    rig.fake.respond((request: RequestFrame): AgentAnswer | undefined => {
      if (request.method === "port.close") {
        return { error: { code: "io", message: "close failed" } }
      }
      return openResponder()(request)
    })
    shell.kill()
    await waitFor(() => rig.warnings.length === 1)
    expect(rig.warnings[0]).toContain("port.close failed")
    expect(rig.warnings[0]).toContain("core-sw")
    expect(rig.warnings[0]).toContain("lab-mac")
    expect(rig.warnings[0]).toContain("close failed")
    expect(rig.warnings[0]).toContain("orphanTimeout")
    expect(rig.agents.leaseOf(rig.agent.name, "/dev/ttyUSB0")).toBeUndefined()
  })

  it("refuses to write while the agent is offline", async () => {
    const rig = await createRig()
    const shell = await open(rig)
    rig.connection.close(1000, "network drop")
    await waitFor(() => !rig.agents.online(rig.agent.name))
    await expect(shell.write("x")).rejects.toThrow(/offline/)
    await expect(shell.write("x")).rejects.toThrow(/port stays open on the agent/)
  })

  it("refuses a port that another root session already leases", async () => {
    const rig = await createRig({ sessionId: "session-1", targetName: "core-sw" })
    const second = await createRig({ sessionId: "session-2", targetName: "other-sw" })
    const sharedRig = second
    sharedRig.agents = rig.agents
    sharedRig.transport = new SerialTransport({
      sessionId: "session-2",
      agents: rig.agents,
      replayBytes: 50,
      logger: { warn: () => {} },
    })
    sharedRig.target = { ...rig.target, name: "other-sw" }
    sharedRig.call = { ...rig.call, sessionId: "session-2" }
    const first = await open(rig)
    const sameSession = new SerialTransport({
      sessionId: "session-1",
      agents: rig.agents,
      replayBytes: 50,
      logger: { warn: () => {} },
    })
    await expect(
      sameSession.openShell({ ...rig.target, name: "third-sw" }, rig.call),
    ).rejects.toThrow(/in this session/)
    await expect(sharedRig.transport.openShell(sharedRig.target, sharedRig.call)).rejects.toThrow(
      /already used by another session/,
    )
    await first.close()
  })
})
