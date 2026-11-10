import { lineEndingBytes } from "../../../shared/serial"
import type { SerialTarget } from "../../../shared/types"
import type { LoggerLike } from "../../logger"
import {
  type AgentConnection,
  SerialAgentError,
  type SerialDataEvent,
  type SerialPortClosedEvent,
} from "../../serial/agent-connection"
import type { SerialAgents, SerialPortLease } from "../../serial/agents"
import { SERIAL_MAX_WRITE_BYTES, type SerialResult } from "../../serial/protocol"
import type { ShellHandle } from "../transport"

export interface SerialShellOptions {
  target: SerialTarget
  connection: AgentConnection
  registry: SerialAgents
  handle: string
  lease: SerialPortLease
  logger: LoggerLike
  /** First byte offset the agent will send. */
  from: number
}

/** One interactive console on a serial port owned by a dsh-serial-agent. */
export class SerialShell implements ShellHandle {
  readonly pid = undefined
  readonly enter: string
  readonly targetName: string

  readonly #target: SerialTarget
  readonly #registry: SerialAgents
  #handle: string
  readonly #lease: SerialPortLease
  readonly #logger: LoggerLike
  readonly #dataListeners = new Set<(chunk: string) => void>()
  readonly #exitListeners = new Set<(code: number | null) => void>()
  readonly #queue: SerialDataEvent[] = []
  readonly #pendingData: string[] = []
  #connection: AgentConnection | undefined
  #detach: (() => void) | undefined
  #registryOff: (() => void) | undefined
  #nextOffset: number
  #decoder = new TextDecoder()
  #ready = false
  #resubscribed = false
  #resyncing = false
  #exitCode: number | null = null
  #exited = false
  #shutdownTask: Promise<void> | undefined

  constructor(options: SerialShellOptions) {
    this.#target = options.target
    this.targetName = options.target.name
    this.enter = lineEndingBytes(options.target.lineEnding)
    this.#registry = options.registry
    this.#handle = options.handle
    this.#lease = options.lease
    this.#logger = options.logger
    this.#nextOffset = options.from
    this.#attach(options.connection)
    this.#registryOff = this.#registry.onChange((change) => {
      if (change.name !== this.#target.agent) return
      if (change.connection === undefined) {
        this.#detach?.()
        this.#detach = undefined
        this.#connection = undefined
        return
      }
      if (change.connection === this.#connection) return
      this.#attach(change.connection)
      void this.#resync()
    })
  }

  get exitCode(): number | null {
    return this.#exitCode
  }

  async write(data: string): Promise<void> {
    if (this.#exited) throw new Error("The serial session has already ended")
    const bytes = Buffer.from(data, "utf8")
    for (let offset = 0; offset < bytes.length; offset += SERIAL_MAX_WRITE_BYTES) {
      const connection = this.#requireConnection()
      const chunk = bytes.subarray(offset, offset + SERIAL_MAX_WRITE_BYTES)
      await connection.request("port.write", {
        handle: this.#handle,
        data: chunk.toString("base64"),
      })
    }
  }

  async sendBreak(durationMs: number): Promise<void> {
    if (this.#exited) throw new Error("The serial session has already ended")
    const connection = this.#requireConnection()
    await connection.request("port.break", { handle: this.#handle, durationMs })
  }

  onData(listener: (chunk: string) => void): () => void {
    this.#dataListeners.add(listener)
    if (this.#dataListeners.size === 1) this.#flushPending()
    return () => this.#dataListeners.delete(listener)
  }

  onExit(listener: (code: number | null) => void): () => void {
    if (this.#exited) {
      listener(this.#exitCode)
      return () => {}
    }
    this.#exitListeners.add(listener)
    return () => this.#exitListeners.delete(listener)
  }

  kill(): void {
    void this.shutdown()
  }

  /** Finish the shell and, when the agent is online, close the port. */
  async shutdown(): Promise<void> {
    if (this.#shutdownTask !== undefined) return await this.#shutdownTask
    this.#shutdownTask = this.#shutdown()
    return await this.#shutdownTask
  }

  /** Hand the buffered bytes the agent sent before its subscribe answer to the shell. */
  resolveSubscription(result: SerialResult<"port.subscribe">): void {
    if (this.#exited) return
    this.#nextOffset = result.from
    if (result.lost > 0) {
      this.#emitLost(
        result.lost,
        this.#resubscribed ? "while the agent was away" : "before the session attached",
      )
    }
    this.#ready = true
    const queued = this.#queue.splice(0)
    for (const event of queued) this.#consume(event)
  }

  async #shutdown(): Promise<void> {
    if (this.#exited) return
    const connection = this.#registry.connection(this.#target.agent)
    if (connection !== undefined && connection.fingerprint === this.#target.agentFingerprint) {
      await this.#shutdownRequest(connection, "port.unsubscribe")
      await this.#shutdownRequest(connection, "port.close")
    }
    this.#finish()
  }

  async #shutdownRequest(
    connection: AgentConnection,
    method: "port.unsubscribe" | "port.close",
  ): Promise<void> {
    try {
      await connection.request(method, { handle: this.#handle })
    } catch (error) {
      this.#logger.warn(
        `remote: serial ${method} for target ${JSON.stringify(this.#target.name)} on agent ${JSON.stringify(this.#target.agent)} (handle ${this.#handle}) failed during shutdown: ${errorMessage(error)}`,
      )
    }
  }

  async #resync(): Promise<void> {
    if (this.#exited || this.#resyncing) return
    const connection = this.#connection
    if (connection === undefined) return
    if (connection.fingerprint !== this.#target.agentFingerprint) {
      this.#emitData(
        `\r\n[dsh: the key of serial agent ${JSON.stringify(this.#target.agent)} changed; this session ended]\r\n`,
      )
      this.#finish()
      return
    }
    this.#resyncing = true
    this.#ready = false
    this.#resubscribed = true
    try {
      const result = await connection.request("port.subscribe", {
        handle: this.#handle,
        from: this.#nextOffset,
      })
      if (this.#connection !== connection) return
      this.resolveSubscription(result)
    } catch (error) {
      if (this.#exited || this.#connection !== connection) return
      if (error instanceof SerialAgentError && error.code === "unknown-handle") {
        await this.#reopen(connection)
        return
      }
      this.#resyncFailed(connection, error)
    } finally {
      this.#resyncing = false
      if (!this.#exited && this.#connection !== undefined && this.#connection !== connection) {
        void this.#resync()
      }
    }
  }

  async #reopen(connection: AgentConnection): Promise<void> {
    try {
      const opened = await connection.request("port.open", {
        path: this.#target.device,
        settings: this.#target.serial,
      })
      if (this.#exited || this.#connection !== connection) return
      this.#handle = opened.handle
      const result = await connection.request("port.subscribe", {
        handle: opened.handle,
        from: opened.start,
      })
      if (this.#exited || this.#connection !== connection) return
      this.resolveSubscription(result)
    } catch (error) {
      this.#resyncFailed(connection, error)
    }
  }

  #resyncFailed(connection: AgentConnection, error: unknown): void {
    if (this.#exited || this.#connection !== connection) return
    if (error instanceof SerialAgentError && error.code === "connection-closed") return
    const detail = error instanceof Error ? error.message : String(error)
    this.#emitData(`\r\n[dsh: could not resume the serial console: ${detail}]\r\n`)
    this.#finish()
  }

  #attach(connection: AgentConnection): void {
    this.#detach?.()
    this.#connection = connection
    const offData = connection.onData((event) => {
      if (event.handle === this.#handle) this.#onDataEvent(event)
    })
    const offClosed = connection.onPortClosed((event) => {
      if (event.handle === this.#handle) this.#onPortClosed(event)
    })
    this.#detach = () => {
      offData()
      offClosed()
    }
  }

  #onDataEvent(event: SerialDataEvent): void {
    if (this.#exited) return
    if (!this.#ready) {
      this.#queue.push(event)
      return
    }
    this.#consume(event)
  }

  #consume(event: SerialDataEvent): void {
    if (event.offset < this.#nextOffset) {
      const skip = this.#nextOffset - event.offset
      if (skip >= event.data.length) return
      this.#emitDecoded(event.data.subarray(skip))
      this.#nextOffset = event.offset + event.data.length
      return
    }
    if (event.offset > this.#nextOffset) {
      this.#emitLost(event.offset - this.#nextOffset, "while reading")
      this.#decoder = new TextDecoder()
    }
    this.#emitDecoded(event.data)
    this.#nextOffset = event.offset + event.data.length
  }

  #emitDecoded(bytes: Buffer): void {
    this.#emitData(this.#decoder.decode(bytes, { stream: true }))
  }

  #emitLost(bytes: number, when: string): void {
    this.#emitData(`\r\n[dsh: ${String(bytes)} bytes of serial output were lost ${when}]\r\n`)
  }

  #onPortClosed(event: SerialPortClosedEvent): void {
    if (this.#exited) return
    const detail = event.message.length === 0 ? event.reason : `${event.reason}: ${event.message}`
    this.#emitData(`\r\n[dsh: the serial port closed (${detail})]\r\n`)
    this.#finish()
  }

  #emitData(text: string): void {
    if (text.length === 0) return
    if (this.#dataListeners.size === 0) {
      this.#pendingData.push(text)
      return
    }
    for (const listener of [...this.#dataListeners]) listener(text)
  }

  #flushPending(): void {
    if (this.#pendingData.length === 0) return
    const text = this.#pendingData.join("")
    this.#pendingData.length = 0
    for (const listener of [...this.#dataListeners]) listener(text)
  }

  #requireConnection(): AgentConnection {
    return this.#registry.requireConnection(this.#target.agent, this.#target.agentFingerprint)
  }

  #finish(): void {
    if (this.#exited) return
    this.#exited = true
    this.#registryOff?.()
    this.#registryOff = undefined
    this.#detach?.()
    this.#detach = undefined
    this.#connection = undefined
    this.#registry.release(this.#lease)
    for (const listener of [...this.#exitListeners]) listener(null)
    this.#exitListeners.clear()
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
