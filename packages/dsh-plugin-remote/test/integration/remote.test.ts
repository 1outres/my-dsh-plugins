import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { connect } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { SecretStore } from "../../src/host/secrets/store"
import { InteractiveSessions } from "../../src/host/sessions/session"
import { AskpassServer } from "../../src/host/transport/ssh/askpass-server"
import { SshConnections } from "../../src/host/transport/ssh/connection"
import { SshTransport } from "../../src/host/transport/ssh/ssh-transport"
import type { TransportPrompter } from "../../src/host/transport/transport"
import type { RemoteTarget } from "../../src/shared/types"

const run = promisify(execFile)
const enabled = process.env.REMOTE_IT === "1"
const here = fileURLToPath(new URL(".", import.meta.url))
const compose = ["compose", "-f", `${here}compose.yml`, "-p", "dsh-remote-it"]
const sessionId = "integration"
const callId = "integration-call"

let jump: RemoteTarget
let target: RemoteTarget
let jumpPort: number

describe.skipIf(!enabled)("ssh transport integration", () => {
  let askpass: AskpassServer
  let connections: SshConnections
  let signal: AbortController
  let sshDir: string
  const secrets = new SecretStore()
  const prompter: TransportPrompter = {
    async secret() {
      return "testpass"
    },
    async hostKey() {
      return true
    },
  }

  beforeAll(async () => {
    await run("docker", [...compose, "down", "-v", "--remove-orphans"], {
      maxBuffer: 10_000_000,
    }).catch(() => undefined)
    await run("docker", [...compose, "up", "-d", "--build"], { maxBuffer: 10_000_000 })
    jumpPort = await publishedPort()
    jump = {
      name: "jump",
      transport: "ssh",
      kind: "linux",
      host: "127.0.0.1",
      user: "tester",
      port: jumpPort,
      sshOptions: ["StrictHostKeyChecking=no", "UserKnownHostsFile=/dev/null"],
      secrets: ["login"],
      initCommands: [],
    }
    target = {
      name: "target",
      transport: "ssh",
      kind: "linux",
      host: "target",
      user: "tester",
      jump: "jump",
      sshOptions: ["StrictHostKeyChecking=no", "UserKnownHostsFile=/dev/null"],
      secrets: ["login", "sudo"],
      initCommands: [],
    }
    await waitForPort(jumpPort, 60_000)
    // The test sandbox reports the host's system ssh config as owned by another user; skip that config here.
    sshDir = await mkdtemp(join(tmpdir(), "dsh-remote-ssh-"))
    await writeFile(join(sshDir, "ssh"), '#!/bin/sh\nexec ssh -F /dev/null "$@"\n', { mode: 0o700 })
    askpass = await AskpassServer.create()
    signal = new AbortController()
    secrets.set(sessionId, "jump", "login", "testpass")
    secrets.set(sessionId, "target", "login", "testpass")
    secrets.set(sessionId, "target", "sudo", "testpass")
    connections = new SshConnections(sessionId, (name) => (name === "jump" ? jump : target), {
      sshPath: join(sshDir, "ssh"),
      persistSeconds: 60,
      maxSecretRetries: 2,
      maxOutputBytes: 30000,
      maxFileBytes: 8_000_000,
      askpass,
      secrets,
    })
  }, 300_000)

  afterAll(async () => {
    signal?.abort()
    await connections?.disposeSession()
    await askpass?.dispose()
    await run("docker", [...compose, "down", "-v", "--remove-orphans"], {
      maxBuffer: 10_000_000,
    }).catch(() => undefined)
    if (sshDir !== undefined) await rm(sshDir, { recursive: true, force: true })
  }, 120_000)

  it("connects through the jump host", async () => {
    await connections.connect(jump, prompter, signal.signal)
    await connections.connect(target, prompter, signal.signal)
    expect(await connections.isConnected(target, signal.signal)).toBe(true)
  }, 120_000)

  it("runs a command and sudo on the target", async () => {
    const who = await connections.exec(
      target,
      "whoami",
      undefined,
      false,
      30_000,
      prompter,
      signal.signal,
    )
    expect(who.exitCode).toBe(0)
    expect(who.stdout.trim()).toBe("tester")
    const id = await connections.exec(
      target,
      "id -u",
      undefined,
      true,
      30_000,
      prompter,
      signal.signal,
    )
    expect(id.exitCode).toBe(0)
    expect(id.stdout.trim()).toBe("0")
  }, 120_000)

  it("reads, writes, and detects a changed file", async () => {
    const path = "/tmp/dsh-remote-it.txt"
    await connections.writeFile(
      target,
      path,
      "hello\nworld\n",
      null,
      false,
      prompter,
      signal.signal,
    )
    const read = await connections.readFile(target, path, false, prompter, signal.signal)
    expect(read.exists).toBe(true)
    expect(read.content).toBe("hello\nworld\n")
    await connections.writeFile(
      target,
      path,
      "changed\n",
      read.hash,
      false,
      prompter,
      signal.signal,
    )
    await expect(
      connections.writeFile(target, path, "stale\n", read.hash, false, prompter, signal.signal),
    ).rejects.toThrow(/changed/)
  }, 120_000)

  it("keeps one interactive shell and sends a secret", async () => {
    const transport = new SshTransport(connections)
    const sessions = new InteractiveSessions(transport, {
      defaultPromptPattern: "[>#$%]\\s*$",
      idleMs: 1500,
      sendTimeoutMs: 15_000,
      maxOutputBytes: 30000,
      secretValues: () => [],
    })
    const call = { sessionId, callId, signal: signal.signal, prompter }
    const opened = await sessions.open(target, "it", call)
    expect(opened.session.state).toBe("open")
    const echo = await sessions.send(
      opened.session.id,
      { text: "echo dsh-integration-ok", submit: true, wait: true, timeoutMs: 15_000 },
      call,
      prompter,
    )
    expect(echo.output).toContain("dsh-integration-ok")
    const sudo = await sessions.send(
      opened.session.id,
      { text: "sudo -k -S id -u", submit: true, wait: true, timeoutMs: 5000 },
      call,
      prompter,
    )
    expect(sudo.state).toBe("open")
    const answer = await sessions.send(
      opened.session.id,
      { secret: "sudo", submit: true, wait: true, timeoutMs: 10_000 },
      call,
      prompter,
    )
    expect(answer.output).toContain("0")
    expect(answer.output.includes("testpass")).toBe(false)
    expect(sessions.close(opened.session.id)).toBe(true)
  }, 120_000)
})

async function publishedPort(): Promise<number> {
  const { stdout } = await run("docker", [...compose, "port", "jump", "22"])
  const match = /:(\d+)\s*$/u.exec(stdout)
  if (match === null)
    throw new Error(`could not read the published jump port from ${JSON.stringify(stdout)}`)
  return Number(match[1])
}

async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const open = await canConnect(port)
    if (open) return
    if (Date.now() > deadline) throw new Error(`port ${String(port)} did not open`)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

async function canConnect(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = connect({ host: "127.0.0.1", port })
    socket.setTimeout(500)
    socket.once("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.once("error", () => {
      socket.destroy()
      resolve(false)
    })
    socket.once("timeout", () => {
      socket.destroy()
      resolve(false)
    })
  })
}
