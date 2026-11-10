import WebSocket from "ws"
import type { SerialAgentInfo } from "../../shared/types"
import {
  type AgentFrame,
  encodeFrame,
  parseAgentFrame,
  SERIAL_CLOSE,
  SERIAL_HEARTBEAT_INTERVAL_MS,
  SERIAL_HEARTBEAT_TIMEOUT_MS,
  type SerialErrorCode,
  type SerialMethod,
  type SerialParams,
  type SerialResult,
  serialMethodSchemas,
} from "./protocol"

export type SerialAgentFailureCode = SerialErrorCode | "timeout" | "connection-closed" | "protocol"

/** One failed serial request, carrying the agent error code when there is one. */
export class SerialAgentError extends Error {
  readonly code: SerialAgentFailureCode

  constructor(code: SerialAgentFailureCode, message: string) {
    super(message)
    this.name = "SerialAgentError"
    this.code = code
  }
}

export interface SerialDataEvent {
  handle: string
  offset: number
  data: Buffer
}

export interface SerialPortClosedEvent {
  handle: string
  reason: string
  message: string
}

export interface AgentConnectionOptions {
  socket: WebSocket
  name: string
  publicKey: string
  fingerprint: string
  info: SerialAgentInfo
  requestTimeoutMs: number
  heartbeatIntervalMs?: number
  heartbeatTimeoutMs?: number
}

interface PendingRequest {
  method: SerialMethod
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
  signal?: AbortSignal
  onAbort?: () => void
}

/** One authenticated dsh-serial-agent socket. */
export class AgentConnection {
  readonly name: string
  readonly publicKey: string
  readonly fingerprint: string
  readonly info: SerialAgentInfo

  readonly #socket: WebSocket
  readonly #requestTimeoutMs: number
  readonly #pending = new Map<number, PendingRequest>()
  readonly #dataListeners = new Set<(event: SerialDataEvent) => void>()
  readonly #portClosedListeners = new Set<(event: SerialPortClosedEvent) => void>()
  readonly #closeListeners = new Set<() => void>()
  readonly #heartbeat: ReturnType<typeof setInterval>
  readonly #heartbeatTimeoutMs: number
  #nextId = 1
  #lastSeen = Date.now()
  #closed = false

  constructor(options: AgentConnectionOptions) {
    this.#socket = options.socket
    this.name = options.name
    this.publicKey = options.publicKey
    this.fingerprint = options.fingerprint
    this.info = options.info
    this.#requestTimeoutMs = options.requestTimeoutMs
    this.#socket.on("message", this.#onMessage)
    this.#socket.on("pong", this.#touch)
    this.#socket.on("close", this.#onClose)
    this.#socket.on("error", this.#onError)
    this.#heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? SERIAL_HEARTBEAT_TIMEOUT_MS
    this.#heartbeat = setInterval(
      () => this.#beat(),
      options.heartbeatIntervalMs ?? SERIAL_HEARTBEAT_INTERVAL_MS,
    )
    this.#heartbeat.unref()
  }

  get closed(): boolean {
    return this.#closed
  }

  async request<M extends SerialMethod>(
    method: M,
    params: SerialParams<M>,
    signal?: AbortSignal,
  ): Promise<SerialResult<M>> {
    if (this.#closed || this.#socket.readyState !== WebSocket.OPEN) {
      throw new SerialAgentError(
        "connection-closed",
        `The serial agent ${JSON.stringify(this.name)} is offline`,
      )
    }
    if (signal?.aborted === true) throw abortReason(signal)
    const id = this.#nextId++
    return await new Promise<SerialResult<M>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#settle(id)
        reject(
          new SerialAgentError(
            "timeout",
            `The serial agent ${JSON.stringify(this.name)} did not answer ${method} within ${String(this.#requestTimeoutMs)} ms`,
          ),
        )
      }, this.#requestTimeoutMs)
      timer.unref()
      const pending: PendingRequest = {
        method,
        resolve: (value) => resolve(value as SerialResult<M>),
        reject,
        timer,
      }
      if (signal !== undefined) {
        pending.signal = signal
        pending.onAbort = () => {
          this.#settle(id)
          reject(abortReason(signal))
        }
        signal.addEventListener("abort", pending.onAbort, { once: true })
      }
      this.#pending.set(id, pending)
      try {
        this.#socket.send(encodeFrame({ type: "request", id, method, params }))
      } catch (error) {
        this.#settle(id)
        reject(
          new SerialAgentError(
            "connection-closed",
            `Could not send request ${method} to serial agent ${JSON.stringify(this.name)}: ${errorMessage(error)}`,
          ),
        )
      }
    })
  }

  onData(listener: (event: SerialDataEvent) => void): () => void {
    this.#dataListeners.add(listener)
    return () => this.#dataListeners.delete(listener)
  }

  onPortClosed(listener: (event: SerialPortClosedEvent) => void): () => void {
    this.#portClosedListeners.add(listener)
    return () => this.#portClosedListeners.delete(listener)
  }

  onClose(listener: () => void): () => void {
    this.#closeListeners.add(listener)
    return () => this.#closeListeners.delete(listener)
  }

  close(code: number, reason: string): void {
    if (this.#closed) return
    if (this.#socket.readyState === WebSocket.CLOSED) {
      this.#onClose()
      return
    }
    this.#socket.close(code, reason)
  }

  readonly #touch = (): void => {
    this.#lastSeen = Date.now()
  }

  readonly #onMessage = (data: WebSocket.RawData, isBinary: boolean): void => {
    this.#touch()
    if (this.#closed) return
    if (isBinary) {
      this.#protocolFailure("The serial agent sent a binary frame")
      return
    }
    let frame: AgentFrame
    try {
      frame = parseAgentFrame(rawText(data))
    } catch (error) {
      this.#protocolFailure(errorMessage(error))
      return
    }
    if (frame.type === "response") this.#onResponse(frame)
    else if (frame.event === "data") {
      const event = {
        handle: frame.handle,
        offset: frame.offset,
        data: Buffer.from(frame.data, "base64"),
      }
      for (const listener of [...this.#dataListeners]) listener(event)
    } else {
      const event = { handle: frame.handle, reason: frame.reason, message: frame.message }
      for (const listener of [...this.#portClosedListeners]) listener(event)
    }
  }

  #onResponse(frame: Extract<AgentFrame, { type: "response" }>): void {
    const pending = this.#pending.get(frame.id)
    if (pending === undefined) return
    if ("error" in frame) {
      this.#settle(frame.id)
      pending.reject(new SerialAgentError(frame.error.code, frame.error.message))
      return
    }
    const schema = serialMethodSchemas[pending.method].result
    const parsed = schema.safeParse(frame.result)
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) =>
          issue.path.length === 0 ? issue.message : `${issue.path.join(".")}: ${issue.message}`,
        )
        .join("; ")
      this.#protocolFailure(`The serial agent sent an invalid ${pending.method} result: ${detail}`)
      return
    }
    this.#settle(frame.id)
    pending.resolve(parsed.data)
  }

  readonly #beat = (): void => {
    if (this.#closed) return
    if (Date.now() - this.#lastSeen > this.#heartbeatTimeoutMs) {
      this.#socket.terminate()
      return
    }
    try {
      this.#socket.ping()
    } catch {
      this.#socket.terminate()
    }
  }

  readonly #onError = (): void => {
    this.#touch()
  }

  readonly #onClose = (): void => {
    if (this.#closed) return
    this.#closed = true
    clearInterval(this.#heartbeat)
    this.#rejectAll(
      new SerialAgentError(
        "connection-closed",
        `The connection to serial agent ${JSON.stringify(this.name)} closed`,
      ),
    )
    for (const listener of [...this.#closeListeners]) listener()
    this.#closeListeners.clear()
  }

  #settle(id: number): void {
    const pending = this.#pending.get(id)
    if (pending === undefined) return
    this.#pending.delete(id)
    clearTimeout(pending.timer)
    if (pending.signal !== undefined && pending.onAbort !== undefined) {
      pending.signal.removeEventListener("abort", pending.onAbort)
    }
  }

  #rejectAll(error: Error): void {
    const pending = [...this.#pending.values()]
    this.#pending.clear()
    for (const request of pending) {
      clearTimeout(request.timer)
      if (request.signal !== undefined && request.onAbort !== undefined) {
        request.signal.removeEventListener("abort", request.onAbort)
      }
      request.reject(error)
    }
  }

  #protocolFailure(message: string): void {
    if (this.#closed) return
    const error = new SerialAgentError("protocol", message)
    this.#rejectAll(error)
    if (this.#socket.readyState === WebSocket.OPEN) {
      this.#socket.close(SERIAL_CLOSE.protocol, "protocol error")
    }
  }
}

function rawText(data: WebSocket.RawData): string {
  if (Buffer.isBuffer(data)) return data.toString("utf8")
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8")
  return Buffer.from(data).toString("utf8")
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("The tool call was cancelled")
}
