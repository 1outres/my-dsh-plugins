import { once } from "node:events"
import { readFileSync } from "node:fs"
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from "node:http"
import { createServer as createHttpsServer } from "node:https"
import { type AddressInfo, createServer as createNetServer, type Socket } from "node:net"
import type { Relay, RelayOptions } from "../../src/contract"
import { startRelay } from "../../src/relay/relay"
import { DEFAULT_UPSTREAM_POLICY, type UpstreamPolicy } from "../../src/relay/upstream"

const FIXTURES = new URL("../fixtures/relay-tls/", import.meta.url)
/** A self-signed certificate for localhost, 127.0.0.1 and upstream.test. Tests only. */
export const TEST_CERT = readFileSync(new URL("cert.pem", FIXTURES), "utf8")
const TEST_KEY = readFileSync(new URL("key.pem", FIXTURES), "utf8")

export interface PeerCall {
  method: string
  url: string
  headers: IncomingHttpHeaders
  rawHeaders: readonly string[]
  body: Buffer
  socket: Socket
}

export type PeerReply = (call: PeerCall, response: ServerResponse) => void | Promise<void>

export interface Peer {
  readonly port: number
  readonly url: string
  readonly calls: PeerCall[]
}

async function readAll(stream: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

function peerListener(calls: PeerCall[], reply: PeerReply): RequestListener {
  return async (request, response) => {
    response.on("error", () => {})
    const body = await readAll(request).catch(() => Buffer.alloc(0))
    const call: PeerCall = {
      method: request.method ?? "",
      url: request.url ?? "",
      headers: request.headers,
      rawHeaders: request.rawHeaders,
      body,
      socket: request.socket,
    }
    calls.push(call)
    await reply(call, response)
  }
}

/** Resolves on close, also after a socket error. The socket must be reading to see a peer's end. */
export function closed(socket: Socket): Promise<void> {
  if (socket.destroyed) return Promise.resolve()
  return new Promise((resolve) => socket.once("close", () => resolve()))
}

function dispose(server: Server | ReturnType<typeof createNetServer>, sockets: Set<Socket>) {
  return async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
  }
}

function trackSockets(server: {
  on(event: "connection", listener: (socket: Socket) => void): unknown
}) {
  const sockets = new Set<Socket>()
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.on("error", () => {})
    socket.once("close", () => sockets.delete(socket))
  })
  return sockets
}

async function listen(server: Server | ReturnType<typeof createNetServer>): Promise<number> {
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  return (server.address() as AddressInfo).port
}

/** Collects what a test starts, and ends all of it afterwards. */
export class RelayHarness {
  readonly #disposers: (() => Promise<void>)[] = []

  async httpPeer(reply: PeerReply): Promise<Peer> {
    const calls: PeerCall[] = []
    const server = createServer(peerListener(calls, reply))
    const sockets = trackSockets(server)
    this.#disposers.push(dispose(server, sockets))
    const port = await listen(server)
    return { port, url: `http://127.0.0.1:${port}`, calls }
  }

  async tlsPeer(reply: PeerReply): Promise<Peer> {
    const calls: PeerCall[] = []
    const server = createHttpsServer(
      { key: TEST_KEY, cert: TEST_CERT, ALPNProtocols: ["http/1.1"] },
      peerListener(calls, reply),
    )
    server.on("tlsClientError", () => {})
    const sockets = trackSockets(server)
    this.#disposers.push(dispose(server as unknown as Server, sockets))
    const port = await listen(server as unknown as Server)
    return { port, url: `https://localhost:${port}`, calls }
  }

  /** A TCP server that hands each connection to the test, with no HTTP handling. */
  async socketPeer(onSocket: (socket: Socket) => void): Promise<{ port: number; url: string }> {
    const server = createNetServer(onSocket)
    const sockets = trackSockets(server)
    this.#disposers.push(dispose(server, sockets))
    const port = await listen(server)
    return { port, url: `http://127.0.0.1:${port}` }
  }

  async relay(
    upstream: string,
    options: Partial<RelayOptions> = {},
    policy: Partial<UpstreamPolicy> = {},
  ): Promise<Relay> {
    const relay = await startRelay(
      { upstream, timeoutMs: 5_000, queried: [], oneShot: false, env: {}, ...options },
      { ...DEFAULT_UPSTREAM_POLICY, ...policy },
    )
    this.#disposers.push(() => relay.close())
    return relay
  }

  async dispose(): Promise<void> {
    await Promise.all(this.#disposers.splice(0).map((run) => run()))
  }
}

export interface ClientOptions {
  /** Goes after the relay URL. */
  path?: string
  method?: string
  headers?: Record<string, string>
  body?: string | Buffer
}

export const MESSAGES_PATH = "/v1/messages"

export function openClient(relay: Relay, options: ClientOptions = {}) {
  const url = new URL(relay.url)
  const request = httpRequest({
    host: url.hostname,
    port: url.port,
    method: options.method ?? "POST",
    path: url.pathname + (options.path ?? MESSAGES_PATH),
    headers: options.headers,
    agent: false,
  })
  request.on("error", () => {})
  const response = new Promise<IncomingMessage>((resolve, reject) => {
    request.once("response", resolve)
    request.once("error", reject)
    request.once("close", () => reject(new Error("closed with no response")))
  })
  response.catch(() => {})
  return { request, response }
}

export interface ClientResult {
  status: number | null
  headers: IncomingHttpHeaders
  body: Buffer
  /** The connection ended before a complete response. */
  broken: boolean
}

export async function post(relay: Relay, options: ClientOptions = {}): Promise<ClientResult> {
  const { request, response } = openClient(relay, options)
  request.end(options.method === "GET" ? undefined : (options.body ?? "{}"))
  const chunks: Buffer[] = []
  let answer: IncomingMessage | undefined
  try {
    answer = await response
    for await (const chunk of answer) chunks.push(chunk as Buffer)
    return {
      status: answer.statusCode ?? null,
      headers: answer.headers,
      body: Buffer.concat(chunks),
      broken: false,
    }
  } catch {
    return {
      status: answer?.statusCode ?? null,
      headers: answer?.headers ?? {},
      body: Buffer.concat(chunks),
      broken: true,
    }
  }
}

export function sseFrame(event: object): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

const USAGE = { input_tokens: 1, output_tokens: 1 }

export const MESSAGE_START = {
  type: "message_start",
  message: { id: "first", role: "assistant", model: "fixture", content: [], usage: USAGE },
}

export function completeStream(text = "FIRST", stop = "end_turn"): string {
  return [
    MESSAGE_START,
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: stop }, usage: USAGE },
    { type: "message_stop" },
  ]
    .map(sseFrame)
    .join("")
}

export function replyStream(response: ServerResponse, body = completeStream()): void {
  response.writeHead(200, { "Content-Type": "text/event-stream" })
  response.end(body)
}

export function replyStatus(
  response: ServerResponse,
  status: number,
  body = "",
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, { "Content-Length": Buffer.byteLength(body), ...headers })
  response.end(body)
}

export function anthropicError(message: string): string {
  return JSON.stringify({ type: "error", error: { type: "invalid_request_error", message } })
}

export function neverEnds(): Promise<void> {
  return new Promise(() => {})
}
