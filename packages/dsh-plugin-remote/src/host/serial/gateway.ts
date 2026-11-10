import { randomBytes } from "node:crypto"
import type { IncomingMessage } from "node:http"
import type { Duplex } from "node:stream"
import WebSocket, { WebSocketServer } from "ws"
import { AgentConnection } from "./agent-connection"
import type { SerialAgents } from "./agents"
import { verifyAuthSignature } from "./identity"
import {
  type AuthFrame,
  encodeFrame,
  parseHandshakeFrame,
  type RejectedFrame,
  SERIAL_CLOSE,
  SERIAL_HANDSHAKE_TIMEOUT_MS,
  SERIAL_HEARTBEAT_INTERVAL_MS,
  SERIAL_HEARTBEAT_TIMEOUT_MS,
  SERIAL_MAX_FRAME_BYTES,
  SERIAL_PROTOCOL_VERSION,
} from "./protocol"

/** The one method the gateway needs from the DSH web server. */
export interface SerialGatewayHost {
  registerUpgrade(route: {
    path: string
    handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
  }): () => void
}

export interface SerialGatewayOptions {
  path: string
  requestTimeoutMs: number
  handshakeTimeoutMs?: number
  heartbeatIntervalMs?: number
  heartbeatTimeoutMs?: number
}

/** Accepts dsh-serial-agent connections on one exact upgrade path. */
export class SerialGateway {
  readonly #agents: SerialAgents
  readonly #options: SerialGatewayOptions
  readonly #server: WebSocketServer
  #removeRoute: (() => void) | undefined
  #disposed = false

  constructor(agents: SerialAgents, options: SerialGatewayOptions) {
    this.#agents = agents
    this.#options = options
    this.#server = new WebSocketServer({
      noServer: true,
      maxPayload: SERIAL_MAX_FRAME_BYTES,
    })
  }

  attach(host: SerialGatewayHost): () => void {
    if (this.#disposed) throw new Error("The serial gateway is already closed")
    if (this.#removeRoute !== undefined) throw new Error("The serial gateway is already attached")
    const remove = host.registerUpgrade({
      path: this.#options.path,
      handler: (req, socket, head) => {
        this.#handleUpgrade(req, socket, head)
      },
    })
    this.#removeRoute = remove
    return () => {
      if (this.#removeRoute === remove) this.#removeRoute = undefined
      remove()
    }
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#removeRoute?.()
    this.#removeRoute = undefined
    for (const client of this.#server.clients) client.terminate()
    this.#server.close()
  }

  #handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (req.headers.origin !== undefined) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
      socket.destroy()
      return
    }
    this.#server.handleUpgrade(req, socket, head, (ws) => {
      this.#beginHandshake(ws)
    })
  }

  #beginHandshake(ws: WebSocket): void {
    const nonce = randomBytes(32).toString("base64")
    let active = true
    const cleanup = (): void => {
      active = false
      clearTimeout(timer)
      ws.off("message", onMessage)
      ws.off("close", onClose)
      ws.off("error", onError)
    }
    const fail = (code: number, reason: string, rejection?: RejectedFrame): void => {
      if (!active) return
      cleanup()
      if (rejection !== undefined && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(encodeFrame(rejection))
        } catch {
          // The close below is the outcome that matters.
        }
      }
      if (ws.readyState === WebSocket.OPEN) ws.close(code, reason)
    }
    const onClose = (): void => {
      cleanup()
    }
    const onError = (): void => {}
    const onMessage = (data: WebSocket.RawData, isBinary: boolean): void => {
      if (!active) return
      if (isBinary) {
        fail(SERIAL_CLOSE.protocol, "protocol error")
        return
      }
      let frame: AuthFrame
      try {
        frame = parseHandshakeFrame(rawText(data))
      } catch {
        fail(SERIAL_CLOSE.protocol, "protocol error")
        return
      }
      if (frame.protocol !== SERIAL_PROTOCOL_VERSION) {
        fail(SERIAL_CLOSE.auth, "protocol", {
          type: "rejected",
          code: "protocol",
          message: `The gateway speaks serial protocol ${String(SERIAL_PROTOCOL_VERSION)}, not ${String(frame.protocol)}`,
        })
        return
      }
      const authorized = this.#agents.findByPublicKey(frame.publicKey)
      if (authorized === undefined) {
        fail(SERIAL_CLOSE.unknownKey, "unknown key", {
          type: "rejected",
          code: "unknown-key",
          message: "This public key is not listed in serialAgents",
        })
        return
      }
      let valid = false
      try {
        valid = verifyAuthSignature(nonce, frame.signature, authorized.key.key)
      } catch {
        valid = false
      }
      if (!valid) {
        fail(SERIAL_CLOSE.auth, "bad signature", {
          type: "rejected",
          code: "bad-signature",
          message: "The handshake signature did not verify",
        })
        return
      }
      cleanup()
      ws.send(encodeFrame({ type: "welcome", name: authorized.name }))
      const connection = new AgentConnection({
        socket: ws,
        name: authorized.name,
        publicKey: authorized.key.publicKey,
        fingerprint: authorized.key.fingerprint,
        info: frame.agent,
        requestTimeoutMs: this.#options.requestTimeoutMs,
        heartbeatIntervalMs: this.#options.heartbeatIntervalMs ?? SERIAL_HEARTBEAT_INTERVAL_MS,
        heartbeatTimeoutMs: this.#options.heartbeatTimeoutMs ?? SERIAL_HEARTBEAT_TIMEOUT_MS,
      })
      this.#agents.attach(connection)
    }
    const timer = setTimeout(() => {
      fail(SERIAL_CLOSE.handshakeTimeout, "handshake timeout")
    }, this.#options.handshakeTimeoutMs ?? SERIAL_HANDSHAKE_TIMEOUT_MS)
    timer.unref()
    ws.on("message", onMessage)
    ws.on("close", onClose)
    ws.on("error", onError)
    ws.send(encodeFrame({ type: "challenge", protocol: SERIAL_PROTOCOL_VERSION, nonce }))
  }
}

function rawText(data: WebSocket.RawData): string {
  if (Buffer.isBuffer(data)) return data.toString("utf8")
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8")
  return Buffer.from(data).toString("utf8")
}
