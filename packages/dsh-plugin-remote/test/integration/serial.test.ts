import { type ChildProcess, execFile, spawn } from "node:child_process"
import { constants as fsConstants } from "node:fs"
import { access, type FileHandle, mkdtemp, open, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { SerialAgents } from "../../src/host/serial/agents"
import { SerialGateway } from "../../src/host/serial/gateway"
import { parseAgentPublicKey } from "../../src/host/serial/identity"
import type { WirePortInfo } from "../../src/host/serial/protocol"
import { InteractiveSessions } from "../../src/host/sessions/session"
import { SerialTransport } from "../../src/host/transport/serial/serial-transport"
import type { TransportCall, TransportPrompter } from "../../src/host/transport/transport"
import type { RemoteTarget, SerialSettings, SerialTarget } from "../../src/shared/types"
import { createUpgradeHost, type UpgradeHost } from "../serial/helpers"

const run = promisify(execFile)
const enabled = process.env.SERIAL_IT === "1"
const agentSource = fileURLToPath(new URL("../../../../serial-agent", import.meta.url))
const AGENT_NAME = "it-agent"
const SESSION_ID = "serial-it"
const PASSWORD = "it-enable-password"
const MARKER = "while-agent-down"
const SETTINGS: SerialSettings = {
  baudRate: 9600,
  dataBits: 8,
  parity: "none",
  stopBits: 1,
  flowControl: "none",
}

describe.skipIf(!enabled)("serial agent integration", () => {
  let directory: string
  let binary: string
  let configPath: string
  let socat: ChildProcess | undefined
  let agent: ChildProcess | undefined
  let fake: FakeSwitch | undefined
  let upgradeHost: UpgradeHost | undefined
  let gateway: SerialGateway | undefined
  let agents: SerialAgents
  let transport: SerialTransport | undefined
  let sessions: InteractiveSessions | undefined
  let target: SerialTarget
  let call: TransportCall
  let sessionId: string
  let socatLog = ""
  let agentLog = ""
  const warnings: string[] = []
  const prompter: TransportPrompter = {
    async secret() {
      return PASSWORD
    },
    async hostKey() {
      return true
    },
  }

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "dsh-serial-it-"))
    binary = await buildAgent(directory)
    const deviceA = join(directory, "dev-a")
    const deviceB = join(directory, "dev-b")

    socat = spawn(
      "socat",
      ["-d", "-d", `pty,raw,echo=0,link=${deviceA}`, `pty,raw,echo=0,link=${deviceB}`],
      { stdio: ["ignore", "ignore", "pipe"] },
    )
    socat.stderr?.on("data", (chunk: Buffer) => {
      socatLog += chunk.toString("utf8")
    })
    await waitForPath(deviceA, 10_000)
    await waitForPath(deviceB, 10_000)

    const identityPath = join(directory, "identity")
    await run(binary, ["keygen", "--identity", identityPath])
    const printed = await run(binary, ["pubkey", "--identity", identityPath])
    const publicKey = /^publicKey: (.+)$/mu.exec(printed.stdout)?.[1]
    if (publicKey === undefined) {
      throw new Error(`pubkey did not print a publicKey: ${printed.stdout}`)
    }
    const authorized = { name: AGENT_NAME, key: parseAgentPublicKey(publicKey) }
    agents = new SerialAgents([authorized])

    upgradeHost = await createUpgradeHost()
    gateway = new SerialGateway(agents, {
      path: "/remote-serial/agent",
      requestTimeoutMs: 5000,
    })
    gateway.attach(upgradeHost.host)

    configPath = join(directory, "agent.json")
    await writeFile(
      configPath,
      JSON.stringify({
        server: `${upgradeHost.baseUrl}/remote-serial/agent`,
        identityFile: identityPath,
        allow: [deviceA],
        bufferBytes: 1 << 20,
        orphanTimeout: "0s",
        logLevel: "debug",
      }),
    )

    fake = new FakeSwitch(deviceB, PASSWORD)
    await fake.start()

    target = {
      name: "core-sw",
      transport: "serial",
      kind: "network",
      agent: AGENT_NAME,
      agentFingerprint: authorized.key.fingerprint,
      device: deviceA,
      serial: SETTINGS,
      lineEnding: "cr",
      secrets: ["enable"],
      initCommands: [],
    }
    transport = new SerialTransport({
      sessionId: SESSION_ID,
      agents,
      replayBytes: 4096,
      logger: { warn: (message) => warnings.push(message) },
    })
    sessions = new InteractiveSessions((candidate) => transportFor(candidate), {
      defaultPromptPattern: "[>#$%]\\s*$",
      idleMs: 300,
      sendTimeoutMs: 5000,
      maxOutputBytes: 30000,
      secretValues: () => [PASSWORD],
    })
    call = {
      sessionId: SESSION_ID,
      callId: "serial-it-call",
      signal: new AbortController().signal,
      prompter,
    }

    await startAgent()
  }, 180_000)

  afterAll(async () => {
    try {
      sessions?.dispose()
      await transport?.disposeSession()
      await stopAgent()
      gateway?.dispose()
      await upgradeHost?.close()
      await fake?.stop()
      await terminate(socat)
      expect(warnings).toEqual([])
    } finally {
      if (directory !== undefined) await rm(directory, { recursive: true, force: true })
    }
  }, 120_000)

  it("lists the device before a session opens it", async () => {
    const ports = await listPorts()
    expect(ports.find((port) => port.path === target.device)).toMatchObject({
      path: target.device,
      open: false,
    })
  })

  it("opens a session and reaches the prompt with an empty line", async () => {
    const opened = await sessions?.open(target, "it", call)
    if (opened === undefined) throw new Error("the session manager is not ready")
    expect(opened.session.state).toBe("open")
    sessionId = opened.session.id
    const result = await send({ text: "", submit: true, wait: true, timeoutMs: 5000 })
    expect(result.output).toContain("Switch>")
    expect(result.reason).toBe("prompt")
  }, 30_000)

  it("runs show version and stops on the prompt", async () => {
    const result = await send({ text: "show version", submit: true, wait: true, timeoutMs: 5000 })
    expect(result.reason).toBe("prompt")
    expect(result.output).toContain("Version 15.2")
  }, 30_000)

  it("enables with a secret and redacts the password", async () => {
    const enable = await send({ text: "enable", submit: true, wait: true, timeoutMs: 5000 })
    expect(enable.output).toContain("Password:")
    const answer = await send({ secret: "enable", submit: true, wait: true, timeoutMs: 5000 })
    expect(answer.reason).toBe("prompt")
    expect(answer.output).toContain("Switch#")
    expect(answer.output.includes(PASSWORD)).toBe(false)
  }, 30_000)

  it("sends a BREAK through the session", async () => {
    const result = await sessions?.sendBreak(sessionId, 200)
    expect(result).toEqual({ sessionId, durationMs: 200 })
  })

  it("resumes the console after the agent restarts", async () => {
    await stopAgent()
    if (fake === undefined) throw new Error("the fake switch is not ready")
    await fake.feed(`${MARKER}\r\n`)
    await startAgent()
    try {
      await waitForCondition(
        () => sessionText().includes(MARKER),
        20_000,
        "the session to show the bytes written while the agent was down",
      )
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nsession:\n${sessionText()}\nagent log:\n${agentLog}\nsocat log:\n${socatLog}`,
      )
    }
    expect(sessionText()).not.toContain("bytes of serial output were lost")
    const prompt = await send({ text: "", submit: true, wait: true, timeoutMs: 5000 })
    expect(prompt.reason).toBe("prompt")
    expect(prompt.output).toContain("Switch#")
  }, 60_000)

  it("closes the session and the agent closes the port", async () => {
    expect(sessions?.close(sessionId)).toBe(true)
    await waitForCondition(
      async () => {
        const ports = await listPorts()
        return ports.find((port) => port.path === target.device)?.open === false
      },
      10_000,
      "the agent to close the serial port",
    )
  }, 30_000)

  async function send(input: {
    text?: string
    secret?: string
    submit: boolean
    wait: boolean
    timeoutMs: number
  }) {
    if (sessions === undefined) throw new Error("the session manager is not ready")
    return await sessions.send(sessionId, input, call, prompter)
  }

  function sessionText(): string {
    if (sessions === undefined) return ""
    return sessions.read(sessionId, 1, 2000).lines.join("\n")
  }

  function transportFor(targetToUse: RemoteTarget): SerialTransport {
    if (transport === undefined) throw new Error("the serial transport is not ready")
    if (targetToUse.transport !== "serial") throw new Error("the test only uses serial targets")
    return transport
  }

  async function listPorts(): Promise<WirePortInfo[]> {
    const connection = agents.connection(AGENT_NAME)
    if (connection === undefined) throw new Error("the serial agent is offline")
    return (await connection.request("ports.list", {})).ports
  }

  async function startAgent(): Promise<void> {
    agentLog = ""
    agent = spawn(binary, ["run", "--config", configPath], {
      stdio: ["ignore", "ignore", "pipe"],
    })
    agent.stderr?.on("data", (chunk: Buffer) => {
      agentLog += chunk.toString("utf8")
      if (agentLog.length > 20_000) agentLog = agentLog.slice(-20_000)
    })
    try {
      await waitForCondition(
        () => agents.online(AGENT_NAME),
        20_000,
        "the serial agent to connect to the gateway",
      )
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nagent log:\n${agentLog}`,
      )
    }
  }

  async function stopAgent(): Promise<void> {
    const child = agent
    agent = undefined
    if (child === undefined || child.exitCode !== null) return
    await terminate(child)
    await waitForCondition(
      () => !agents.online(AGENT_NAME),
      5000,
      "the gateway to notice that the agent stopped",
    )
  }

  async function buildAgentInto(directoryToUse: string): Promise<string> {
    const binaryPath = join(directoryToUse, "dsh-serial-agent")
    await run("go", ["build", "-o", binaryPath, "./cmd/dsh-serial-agent"], {
      cwd: agentSource,
      env: { ...process.env, CGO_ENABLED: "0" },
    })
    return binaryPath
  }

  async function buildAgent(directoryToUse: string): Promise<string> {
    const provided = process.env.SERIAL_AGENT_BIN
    if (provided !== undefined && provided.length > 0) return provided
    return await buildAgentInto(directoryToUse)
  }
})

class FakeSwitch {
  readonly #path: string
  readonly #password: string
  #handle: FileHandle | undefined
  #task: Promise<void> | undefined
  #stopped = false
  #pending = ""
  #mode: "user" | "password" | "enable" = "user"

  constructor(path: string, password: string) {
    this.#path = path
    this.#password = password
  }

  async start(): Promise<void> {
    this.#handle = await open(this.#path, fsConstants.O_RDWR | fsConstants.O_NONBLOCK)
    this.#task = this.#readLoop()
  }

  async feed(text: string): Promise<void> {
    await this.#write(Buffer.from(text, "utf8"))
  }

  async stop(): Promise<void> {
    this.#stopped = true
    await this.#task
    await this.#handle?.close()
  }

  async #readLoop(): Promise<void> {
    const handle = this.#handle
    if (handle === undefined) throw new Error("the fake switch is not open")
    const buffer = Buffer.alloc(4096)
    while (!this.#stopped) {
      let bytesRead: number
      try {
        ;({ bytesRead } = await handle.read(buffer, 0, buffer.length, null))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EAGAIN") {
          await delay(5)
          continue
        }
        if (this.#stopped) return
        throw error
      }
      if (bytesRead === 0) {
        await delay(5)
        continue
      }
      const chunk = Buffer.from(buffer.subarray(0, bytesRead))
      await this.#write(chunk)
      await this.#consume(chunk.toString("utf8"))
    }
  }

  async #consume(text: string): Promise<void> {
    this.#pending += text
    for (;;) {
      const index = this.#pending.indexOf("\r")
      if (index < 0) return
      const line = this.#pending.slice(0, index)
      this.#pending = this.#pending.slice(index + 1)
      await this.#onLine(line)
    }
  }

  async #onLine(line: string): Promise<void> {
    if (this.#mode === "password") {
      if (line === this.#password) {
        this.#mode = "enable"
        await this.#respond("Switch#")
      } else {
        await this.#respond("Password:")
      }
      return
    }
    if (this.#mode === "user" && line === "enable") {
      this.#mode = "password"
      await this.#respond("Password:")
      return
    }
    if (line === "show version") {
      await this.#respond(
        `Cisco IOS Software, Version 15.2(4)M\r\n${this.#mode === "enable" ? "Switch#" : "Switch>"}`,
      )
      return
    }
    await this.#respond(this.#mode === "enable" ? "Switch#" : "Switch>")
  }

  async #respond(text: string): Promise<void> {
    await this.#write(Buffer.from(`\r\n${text}`, "utf8"))
  }

  async #write(data: Buffer): Promise<void> {
    const handle = this.#handle
    if (handle === undefined) return
    let offset = 0
    while (offset < data.length) {
      try {
        const { bytesWritten } = await handle.write(
          data.subarray(offset),
          0,
          data.length - offset,
          null,
        )
        offset += bytesWritten
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EAGAIN") {
          await delay(5)
          continue
        }
        if (this.#stopped) return
        throw error
      }
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForPath(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const exists = await access(path).then(
      () => true,
      () => false,
    )
    if (exists) return
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${path}`)
    await delay(25)
  }
}

async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await predicate()) return
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await delay(25)
  }
}

async function terminate(child: ChildProcess | undefined): Promise<void> {
  if (child === undefined || child.exitCode !== null) return
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve())
  })
  child.kill("SIGTERM")
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000)
  timer.unref()
  await exited
  clearTimeout(timer)
}
