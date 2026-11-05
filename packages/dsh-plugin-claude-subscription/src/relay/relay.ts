import { randomBytes } from "node:crypto"
import { once } from "node:events"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo, Socket } from "node:net"
import type { CreateRelay, Relay, RelayOptions, StreamCapture } from "../contract"
import { FailureCode, NativeFailure } from "../errors"
import { SseCapture } from "./capture"
import { retryAfterMs } from "./retry-after"
import {
  dropMessageBreakpoints,
  pinMessageBreakpoint,
  QueriedTurnMismatch,
  restoreQueriedTurn,
  stableRequestContext,
  streamToolInput,
} from "./rewrite"
import {
  clientResponseHeaders,
  DEFAULT_UPSTREAM_POLICY,
  gzipEligible,
  gzipRequestBody,
  LocalFailure,
  openUpstream,
  parseUpstreamUrl,
  type SilenceLimit,
  selectProxy,
  type UpstreamCall,
  type UpstreamPolicy,
  type UpstreamRequest,
  type UpstreamRoute,
  upstreamRequestHeaders,
} from "./upstream"

const MESSAGES_PATH = "/v1/messages"
const ERROR_BODY_LIMIT = 65_536
const DENIAL_BODY = JSON.stringify({
  type: "error",
  error: { type: "invalid_request_error", message: "DSH_MODEL_ADMISSION_CONSUMED" },
})

/** What one relay has seen. It never holds a header, a payload or the route. */
class RelayRecord {
  used = false
  denied = 0
  cancelled = false
  status: number | null = null
  requestId: string | null = null
  retryAfterMs: number | null = null
  failure: string | null = null
  unrestored: string | null = null
  errorBody: Buffer = Buffer.alloc(0)

  keepErrorBytes(chunk: Buffer): void {
    const room = ERROR_BODY_LIMIT - this.errorBody.length
    if (room > 0) this.errorBody = Buffer.concat([this.errorBody, chunk.subarray(0, room)])
  }
}

interface RewrittenPayload {
  payload: Buffer
  unrestored: string | null
}

function restoreQueried(payload: Buffer, options: RelayOptions): RewrittenPayload {
  try {
    return { payload: restoreQueriedTurn(payload, options.queried), unrestored: null }
  } catch (error) {
    if (!(error instanceof QueriedTurnMismatch)) throw error
    return { payload, unrestored: error.message }
  }
}

function rewriteAdmitted(received: Buffer, options: RelayOptions): RewrittenPayload {
  const start = options.oneShot ? dropMessageBreakpoints(received) : received
  const { payload: restored, unrestored } = restoreQueried(start, options)
  const stable = stableRequestContext(restored, options.queried)
  const pinned = pinMessageBreakpoint(stable, options.queried)
  return { payload: streamToolInput(pinned), unrestored }
}

function upstreamErrorText(body: Buffer): string {
  const text = body.toString("utf8")
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return text
  }
  const message = (parsed as { error?: { message?: unknown } } | null)?.error?.message
  return typeof message === "string" ? message : text
}

/** Only a name leaves this module. An error message may quote a host, a path or a header. */
function failureName(error: unknown): string {
  if (error instanceof LocalFailure) return error.name
  const code = (error as { code?: unknown } | null)?.code
  if (typeof code === "string" && /^[A-Z][A-Z0-9_]*$/.test(code)) return code
  return error instanceof Error && /^\w+$/.test(error.name) ? error.name : "UnknownRelayFailure"
}

type RequestKind = "messages" | "unknownRoute" | "unsupportedMethod"

function splitRequestTarget(requestUrl = ""): { path: string; query: string } {
  const start = requestUrl.indexOf("?")
  return start < 0
    ? { path: requestUrl, query: "" }
    : { path: requestUrl.slice(0, start), query: requestUrl.slice(start) }
}

function classifyRequest(request: IncomingMessage, messagesRoute: string): RequestKind {
  if (request.method !== "POST") return "unsupportedMethod"
  const { path } = splitRequestTarget(request.url)
  return path === messagesRoute && !request.headers.origin ? "messages" : "unknownRoute"
}

function ignoreError(): void {}

/**
 * Reads the whole request before it answers. Closing with unread bytes would
 * reset the connection, and the client could lose the answer.
 */
function answerLocally(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  body = "",
): void {
  request.once("end", () => {
    response.writeHead(status, {
      ...(body === "" ? {} : { "Content-Type": "application/json" }),
      "Content-Length": Buffer.byteLength(body),
      Connection: "close",
    })
    response.end(body)
  })
  request.resume()
}

async function readBody(
  request: IncomingMessage,
  control: AbortController,
  stallMs: number,
): Promise<Buffer> {
  const onStall = () => {
    control.abort(new LocalFailure("ClientStalled"))
    request.destroy()
  }
  request.socket.setTimeout(stallMs, onStall)
  try {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    return Buffer.concat(chunks)
  } finally {
    request.socket.setTimeout(0)
    request.socket.off("timeout", onStall)
  }
}

async function waitForDrain(
  response: ServerResponse,
  silence: SilenceLimit,
  control: AbortController,
  stallMs: number,
): Promise<void> {
  silence.suspend()
  const stall = setTimeout(() => control.abort(new LocalFailure("ClientStalled")), stallMs)
  try {
    await once(response, "drain", { signal: control.signal })
  } finally {
    clearTimeout(stall)
  }
  silence.resume()
}

class LoopbackRelay implements Relay {
  readonly #capture: StreamCapture = new SseCapture()
  readonly #record = new RelayRecord()
  readonly #connections = new Set<Socket>()
  readonly #options: RelayOptions
  readonly #route: UpstreamRoute
  readonly #gzipOrigins: readonly string[]
  readonly #prefix = `/admit/${randomBytes(32).toString("base64url")}`
  readonly #server: Server
  #url = ""
  #call: AbortController | null = null
  #exchange: Promise<void> | null = null
  #closing: Promise<void> | null = null

  constructor(options: RelayOptions, route: UpstreamRoute, gzipOrigins: readonly string[]) {
    this.#options = options
    this.#route = route
    this.#gzipOrigins = gzipOrigins
    // These two accept only whole numbers, and a setting in seconds may give a fraction.
    const receiveLimitMs = Math.ceil(options.timeoutMs)
    this.#server = createServer(
      { headersTimeout: receiveLimitMs, requestTimeout: receiveLimitMs },
      (request, response) => this.#onRequest(request, response),
    )
    this.#server.on("connection", (socket) => this.#onConnection(socket))
    this.#server.on("clientError", (_error, socket) => socket.destroy())
  }

  async listen(): Promise<void> {
    this.#server.listen(0, "127.0.0.1")
    await once(this.#server, "listening")
    this.#server.on("error", ignoreError)
    const { port } = this.#server.address() as AddressInfo
    this.#url = `http://127.0.0.1:${port}${this.#prefix}`
  }

  get url(): string {
    return this.#url
  }

  get used(): boolean {
    return this.#record.used
  }

  get denied(): number {
    return this.#record.denied
  }

  get status(): number | null {
    return this.#record.status
  }

  get failure(): string | null {
    return this.#record.failure
  }

  get requestId(): string | null {
    return this.#record.requestId
  }

  get retryAfterMs(): number | null {
    return this.#record.retryAfterMs
  }

  get unrestored(): string | null {
    return this.#record.unrestored
  }

  get capture(): StreamCapture {
    return this.#capture
  }

  errorText(): string {
    return upstreamErrorText(this.#record.errorBody)
  }

  abort(): void {
    this.#record.cancelled = true
    this.#call?.abort(new LocalFailure("RelayAborted"))
    for (const socket of this.#connections) socket.destroy()
  }

  close(): Promise<void> {
    this.#closing ??= this.#shutDown()
    return this.#closing
  }

  async #shutDown(): Promise<void> {
    this.abort()
    await new Promise<void>((resolve) => {
      this.#server.close(() => resolve())
      this.#server.closeAllConnections()
    })
    await this.#exchange
  }

  #onConnection(socket: Socket): void {
    // Node's server has its own handler, but only while a request is being parsed.
    socket.on("error", ignoreError)
    if (this.#record.cancelled) {
      socket.destroy()
      return
    }
    this.#connections.add(socket)
    socket.once("close", () => this.#connections.delete(socket))
  }

  #onRequest(request: IncomingMessage, response: ServerResponse): void {
    // A peer reset can raise an error on these. With no listener it would crash the host.
    request.on("error", ignoreError)
    response.on("error", ignoreError)
    const kind = classifyRequest(request, `${this.#prefix}${MESSAGES_PATH}`)
    if (kind === "unsupportedMethod") {
      answerLocally(request, response, 501)
    } else if (kind === "unknownRoute") {
      answerLocally(request, response, 404)
    } else if (this.#record.cancelled || this.#record.used) {
      this.#record.denied += 1
      answerLocally(request, response, 400, DENIAL_BODY)
    } else {
      this.#record.used = true
      this.#exchange = this.#serveAdmitted(request, response)
    }
  }

  /** Never rejects: a rejection here would crash the host process. */
  async #serveAdmitted(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const control = new AbortController()
    this.#call = control
    response.once("close", () => {
      if (!response.writableFinished) control.abort(new LocalFailure("ClientDisconnected"))
    })
    try {
      const received = await readBody(request, control, this.#options.timeoutMs)
      const upstream = await this.#buildUpstreamRequest(request, received)
      const call = await openUpstream(this.#route, upstream, control)
      await this.#forwardResponse(call, response, control)
      control.signal.throwIfAborted()
      response.end()
    } catch (error) {
      this.#recordFailure(control.signal.aborted ? control.signal.reason : error)
      response.destroy()
    } finally {
      control.abort()
    }
  }

  async #buildUpstreamRequest(
    request: IncomingMessage,
    received: Buffer,
  ): Promise<UpstreamRequest> {
    const { payload, unrestored } = rewriteAdmitted(received, this.#options)
    this.#record.unrestored = unrestored
    const { target, proxy } = this.#route
    const gzip = gzipEligible({
      target,
      proxy,
      env: this.#options.env,
      gzipOrigins: this.#gzipOrigins,
      payloadBytes: payload.length,
      contentEncoding: request.headers["content-encoding"],
    })
    const body = gzip ? await gzipRequestBody(payload) : payload
    return {
      path: `${target.basePath}${MESSAGES_PATH}${splitRequestTarget(request.url).query}`,
      headers: upstreamRequestHeaders(request.rawHeaders, {
        target,
        bodyBytes: body.length,
        gzip,
      }),
      body,
    }
  }

  async #forwardResponse(
    call: UpstreamCall,
    response: ServerResponse,
    control: AbortController,
  ): Promise<void> {
    const upstream = call.response
    const status = upstream.statusCode as number
    const requestId = upstream.headers["request-id"] || upstream.headers["x-request-id"]
    this.#record.status = status
    this.#record.requestId = typeof requestId === "string" ? requestId : null
    this.#record.retryAfterMs = retryAfterMs(upstream.headers["retry-after"], Date.now())
    response.writeHead(status, upstream.statusMessage, clientResponseHeaders(upstream.rawHeaders))
    response.flushHeaders()
    for await (const chunk of upstream) {
      if (status === 200) this.#capture.feed(chunk as Buffer)
      else this.#record.keepErrorBytes(chunk as Buffer)
      if (!response.write(chunk)) {
        await waitForDrain(response, call.silence, control, this.#options.timeoutMs)
      }
    }
  }

  #recordFailure(reason: unknown): void {
    // A complete capture is the answer. What ends the connection after it changes nothing.
    if (!this.#capture.complete) this.#record.failure ??= failureName(reason)
  }
}

/** Like `createRelay`, with the fixed connection facts open to tests. */
export async function startRelay(options: RelayOptions, policy: UpstreamPolicy): Promise<Relay> {
  const target = parseUpstreamUrl(options.upstream)
  const proxy = selectProxy(target, options.env)
  const route: UpstreamRoute = { target, proxy, tls: policy.tls, timeoutMs: options.timeoutMs }
  const relay = new LoopbackRelay(options, route, policy.gzipOrigins)
  try {
    await relay.listen()
  } catch (error) {
    throw new NativeFailure("Could not start the local relay", FailureCode.relayError, {
      cause: error,
    })
  }
  return relay
}

export const createRelay: CreateRelay = (options) => startRelay(options, DEFAULT_UPSTREAM_POLICY)
