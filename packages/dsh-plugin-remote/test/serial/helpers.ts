import { generateKeyPairSync, type KeyObject, sign } from "node:crypto"
import { once } from "node:events"
import { createServer, type IncomingMessage } from "node:http"
import type { Duplex } from "node:stream"
import WebSocket, { WebSocketServer } from "ws"
import { AgentConnection } from "../../src/host/serial/agent-connection"
import type { SerialGatewayHost } from "../../src/host/serial/gateway"
import { parseAgentPublicKey } from "../../src/host/serial/identity"
import {
  type AgentFrame,
  encodeFrame,
  parseServerFrame,
  type RequestFrame,
  SERIAL_PROTOCOL_VERSION,
  type SerialErrorCode,
} from "../../src/host/serial/protocol"
import type { SerialAgentInfo } from "../../src/shared/types"

export interface TestAgent {
  name: string
  privateKey: KeyObject
  authorized: { name: string; key: ReturnType<typeof parseAgentPublicKey> }
}

export const AGENT_INFO: SerialAgentInfo = {
  version: "0.1.0",
  hostname: "lab-mac",
  os: "darwin",
  arch: "arm64",
}

export function makeAgent(name = "lab-mac"): TestAgent {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519")
  const der = publicKey.export({ format: "der", type: "spki" })
  const raw = Buffer.from(der.subarray(der.length - 32))
  return {
    name,
    privateKey,
    authorized: { name, key: parseAgentPublicKey(raw.toString("base64")) },
  }
}

export function signNonce(agent: TestAgent, nonce: string): string {
  return sign(
    null,
    Buffer.from(`dsh-serial-agent auth v1\n${nonce}`, "utf8"),
    agent.privateKey,
  ).toString("base64")
}

export function authFrame(agent: TestAgent, nonce: string, protocol = SERIAL_PROTOCOL_VERSION) {
  return {
    type: "auth" as const,
    protocol,
    publicKey: agent.authorized.key.publicKey,
    signature: signNonce(agent, nonce),
    agent: AGENT_INFO,
  }
}

/** Collect WebSocket text messages so a listener registered late still sees them. */
export class WsInbox {
  readonly #messages: string[] = []
  readonly #waiters: Array<(message: string) => void> = []

  constructor(socket: WebSocket) {
    socket.on("message", (data, isBinary) => {
      if (isBinary) return
      const message = rawText(data)
      const waiter = this.#waiters.shift()
      if (waiter === undefined) this.#messages.push(message)
      else waiter(message)
    })
  }

  async next(): Promise<string> {
    const message = this.#messages.shift()
    if (message !== undefined) return message
    return await new Promise<string>((resolve) => this.#waiters.push(resolve))
  }
}

export function waitForClose(socket: WebSocket): Promise<number> {
  return new Promise<number>((resolve) => {
    socket.once("close", (code) => resolve(code))
  })
}

export function waitForCloseWithReason(
  socket: WebSocket,
): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() }))
  })
}

export async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for a condition")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

export interface UpgradeHost {
  baseUrl: string
  host: SerialGatewayHost
  close: () => Promise<void>
}

/** A real HTTP server with the same upgrade route shape the DSH web server offers. */
export async function createUpgradeHost(): Promise<UpgradeHost> {
  const server = createServer()
  const routes = new Map<
    string,
    (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
  >()
  const sockets = new Set<Duplex>()
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
  })
  server.on("upgrade", (req, socket, head) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname
    const handler = routes.get(path)
    if (handler === undefined) {
      socket.destroy()
      return
    }
    void handler(req, socket, head)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") {
    throw new Error("The test HTTP server did not get a TCP address")
  }
  return {
    baseUrl: `ws://127.0.0.1:${String(address.port)}`,
    host: {
      registerUpgrade(route) {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

export interface WsPair {
  server: WebSocket
  client: WebSocket
  url: string
  close: () => Promise<void>
}

export async function createWsPair(): Promise<WsPair> {
  const server = createServer()
  const wss = new WebSocketServer({ noServer: true })
  let resolveServer: (socket: WebSocket) => void = () => {}
  const serverSocket = new Promise<WebSocket>((resolve) => {
    resolveServer = resolve
  })
  server.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => resolveServer(ws))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") {
    throw new Error("The test HTTP server did not get a TCP address")
  }
  const url = `ws://127.0.0.1:${String(address.port)}`
  const client = new WebSocket(url)
  await once(client, "open")
  const ws = await serverSocket
  return {
    server: ws,
    client,
    url,
    async close() {
      client.terminate()
      ws.terminate()
      wss.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

export interface ConnectAgentResult {
  connection: AgentConnection
  fake: FakeSerialAgent
  pair: WsPair
}

export async function connectAgent(
  registry: { attach(connection: AgentConnection): void },
  agent: TestAgent,
  requestTimeoutMs = 500,
  handler?: AgentHandler,
): Promise<ConnectAgentResult> {
  const pair = await createWsPair()
  const connection = new AgentConnection({
    socket: pair.server,
    name: agent.authorized.name,
    publicKey: agent.authorized.key.publicKey,
    fingerprint: agent.authorized.key.fingerprint,
    info: AGENT_INFO,
    requestTimeoutMs,
    heartbeatIntervalMs: 60_000,
    heartbeatTimeoutMs: 120_000,
  })
  const fake = new FakeSerialAgent(pair.client)
  if (handler !== undefined) fake.respond(handler)
  registry.attach(connection)
  return { connection, pair, fake }
}

export interface AgentAnswer {
  result?: unknown
  error?: { code: SerialErrorCode; message: string }
}

export type AgentHandler = (request: RequestFrame) => AgentAnswer | undefined

/** The agent side of the wire protocol, driven by a test callback. */
export class FakeSerialAgent {
  readonly requests: RequestFrame[] = []
  readonly #socket: WebSocket
  #handler: AgentHandler = () => undefined

  constructor(socket: WebSocket) {
    this.#socket = socket
    socket.on("message", (data, isBinary) => {
      if (isBinary) return
      const frame = parseServerFrame(rawText(data))
      if (frame.type !== "request") return
      this.requests.push(frame)
      const answer = this.#handler(frame)
      if (answer === undefined) return
      if (answer.error !== undefined) {
        this.sendError(frame.id, answer.error.code, answer.error.message)
      } else {
        this.sendResult(frame.id, answer.result)
      }
    })
  }

  respond(handler: AgentHandler): void {
    this.#handler = handler
  }

  methods(): string[] {
    return this.requests.map((request) => request.method)
  }

  request(method: string): RequestFrame | undefined {
    return this.requests.find((request) => request.method === method)
  }

  sendResult(id: number, result: unknown): void {
    this.send({ type: "response", id, result })
  }

  sendError(id: number, code: SerialErrorCode, message: string): void {
    this.send({ type: "response", id, error: { code, message } })
  }

  sendData(handle: string, offset: number, data: Buffer): void {
    this.send({
      type: "event",
      event: "data",
      handle,
      offset,
      data: data.toString("base64"),
    })
  }

  sendClosed(handle: string, reason: string, message: string): void {
    this.send({
      type: "event",
      event: "closed",
      handle,
      reason: reason as "device-removed" | "io-error" | "orphan-timeout",
      message,
    })
  }

  private send(frame: AgentFrame): void {
    this.#socket.send(encodeFrame(frame))
  }
}

function rawText(data: WebSocket.RawData): string {
  if (Buffer.isBuffer(data)) return data.toString("utf8")
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8")
  return Buffer.from(data).toString("utf8")
}
