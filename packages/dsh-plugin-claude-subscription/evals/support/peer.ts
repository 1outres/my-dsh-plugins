import { once } from "node:events"
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http"
import type { AddressInfo } from "node:net"
import type { JsonObject, NativeBlock } from "../../src/contract"

export const USAGE = {
  input_tokens: 101,
  output_tokens: 37,
  cache_read_input_tokens: 211,
  cache_creation_input_tokens: 313,
}

const REQUEST_ID = "req_eval_fixture"

export interface PeerRequest {
  path: string
  headers: IncomingHttpHeaders
  raw: Buffer
  body: JsonObject
  /** Unique per request, as the API's are. The CLI merges replayed turns that share an id. */
  messageId: string
}

/** How one Messages request ends. */
export type Answer =
  /** `stop` null ends the body cleanly with no `message_stop`. */
  | {
      kind: "stream"
      blocks: readonly NativeBlock[]
      stop: string | null
      stopDetails?: JsonObject
    }
  /** The same bytes as a `stream`, each in its own write, so every character can split. */
  | { kind: "split"; blocks: readonly NativeBlock[]; stop: string }
  /** A 200 whose stream ends in the API's own `error` event. */
  | { kind: "errorEvent"; blocks: readonly NativeBlock[]; error: JsonObject }
  /** Sends a part of the stream, then resets the connection. */
  | { kind: "reset"; blocks: readonly NativeBlock[] }
  | { kind: "status"; status: number; body: string }
  /** Sends only the response head and waits for the other side to go. */
  | { kind: "hang" }

function streamedFields(block: NativeBlock): JsonObject {
  switch (block.type) {
    case "text":
      return { text: "" }
    case "thinking":
      return { thinking: "", signature: "" }
    case "tool_use":
      return { input: {} }
    case "redacted_thinking":
      return {}
    default:
      throw new Error(`The peer cannot stream a ${block.type} block`)
  }
}

function blockDeltas(block: NativeBlock): JsonObject[] {
  switch (block.type) {
    case "text":
      return [{ type: "text_delta", text: block.text }]
    case "thinking":
      return [
        { type: "thinking_delta", thinking: block.thinking },
        { type: "signature_delta", signature: block.signature },
      ]
    case "tool_use":
      return [{ type: "input_json_delta", partial_json: JSON.stringify(block.input) }]
    default:
      return []
  }
}

function blockEvents(block: NativeBlock, index: number): JsonObject[] {
  return [
    {
      type: "content_block_start",
      index,
      content_block: { ...block, ...streamedFields(block) },
    },
    ...blockDeltas(block).map((delta) => ({ type: "content_block_delta", index, delta })),
    { type: "content_block_stop", index },
  ]
}

function openingEvents(blocks: readonly NativeBlock[], request: PeerRequest): JsonObject[] {
  return [
    {
      type: "message_start",
      message: {
        id: request.messageId,
        type: "message",
        role: "assistant",
        model: request.body.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: USAGE,
      },
    },
    ...blocks.flatMap(blockEvents),
  ]
}

function closingEvents(stop: string, stopDetails: JsonObject | undefined): JsonObject[] {
  return [
    {
      type: "message_delta",
      delta: {
        stop_reason: stop,
        stop_sequence: null,
        ...(stopDetails === undefined ? {} : { stop_details: stopDetails }),
      },
      usage: USAGE,
    },
    { type: "message_stop" },
  ]
}

function sse(events: readonly JsonObject[]): string {
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("")
}

function streamHead(response: ServerResponse): void {
  response.writeHead(200, { "content-type": "text/event-stream", "request-id": REQUEST_ID })
}

async function writeByteByByte(bytes: Buffer, response: ServerResponse): Promise<void> {
  for (const byte of bytes) {
    response.write(Buffer.of(byte))
    await new Promise((done) => setImmediate(done))
  }
  response.end()
}

/** A loopback Messages server. It forms no opinion and answers what the case told it to. */
export class Peer {
  readonly requests: PeerRequest[] = []
  /** Every request that was not `POST /v1/messages`. */
  readonly others: string[] = []
  answer: (request: PeerRequest) => Answer = () => {
    throw new Error("The case set no answer")
  }
  readonly #server: Server
  readonly #entered = Promise.withResolvers<void>()
  readonly #disconnected = Promise.withResolvers<void>()

  constructor() {
    this.#server = createServer((request, response) => {
      void this.#serve(request, response)
    })
  }

  async listen(): Promise<void> {
    this.#server.listen(0, "127.0.0.1")
    await once(this.#server, "listening")
  }

  get url(): string {
    const { port } = this.#server.address() as AddressInfo
    return `http://127.0.0.1:${port}`
  }

  get last(): PeerRequest {
    const last = this.requests.at(-1)
    if (last === undefined) throw new Error("The peer has seen no Messages request")
    return last
  }

  /** Settles when the first Messages request has been read. */
  get entered(): Promise<void> {
    return this.#entered.promise
  }

  /** Settles when the other side has closed a `hang` response. */
  get disconnected(): Promise<void> {
    return this.#disconnected.promise
  }

  async close(): Promise<void> {
    const closed = once(this.#server, "close")
    this.#server.close()
    this.#server.closeAllConnections()
    await closed
  }

  async #serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    const raw = Buffer.concat(chunks)
    const path = request.url ?? ""
    if (request.method !== "POST" || path.split("?")[0] !== "/v1/messages") {
      this.others.push(`${request.method} ${path}`)
      response.writeHead(404).end()
      return
    }
    const seen: PeerRequest = {
      path,
      headers: request.headers,
      raw,
      body: JSON.parse(raw.toString("utf8")) as JsonObject,
      messageId: `msg_eval_${this.requests.length + 1}`,
    }
    this.requests.push(seen)
    this.#entered.resolve()
    this.#respond(this.answer(seen), seen, response)
  }

  #respond(answer: Answer, request: PeerRequest, response: ServerResponse): void {
    switch (answer.kind) {
      case "status":
        response.writeHead(answer.status, {
          "content-type": "application/json",
          "request-id": REQUEST_ID,
        })
        response.end(answer.body)
        return
      case "hang":
        streamHead(response)
        response.flushHeaders()
        response.once("close", () => this.#disconnected.resolve())
        return
      case "reset":
        streamHead(response)
        response.write(sse(openingEvents(answer.blocks, request)), () => response.destroy())
        return
      case "stream": {
        const closing = answer.stop === null ? [] : closingEvents(answer.stop, answer.stopDetails)
        streamHead(response)
        response.end(sse([...openingEvents(answer.blocks, request), ...closing]))
        return
      }
      case "errorEvent":
        streamHead(response)
        response.end(
          sse([...openingEvents(answer.blocks, request), { type: "error", error: answer.error }]),
        )
        return
      case "split": {
        const [start, ...rest] = openingEvents(answer.blocks, request)
        const events = [
          ...(start === undefined ? [] : [start]),
          { type: "ping" },
          ...rest,
          ...closingEvents(answer.stop, undefined),
        ]
        streamHead(response)
        void writeByteByByte(Buffer.from(sse(events)), response)
      }
    }
  }
}
