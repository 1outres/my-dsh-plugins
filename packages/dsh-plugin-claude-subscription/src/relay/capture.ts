import type {
  CapturedMessage,
  JsonObject,
  NativeBlock,
  NativeStreamEvent,
  StreamCapture,
} from "../contract"
import { isObject } from "./rewrite/payload"

/** The stream cannot be read as Anthropic Messages events. */
export class CaptureError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "CaptureError"
  }
}

const FRAME_END = /\r?\n\r?\n/
const LINE_BREAK = /\r\n|\n|\r/
const LEADING_SPACES = /^ +/

const TEXT_FIELDS: ReadonlyMap<string, string> = new Map([
  ["text_delta", "text"],
  ["thinking_delta", "thinking"],
  ["signature_delta", "signature"],
])

/** A tool input made only of these characters means a call with no arguments. */
const BLANK_CHARACTERS: ReadonlySet<string> = new Set(
  "\t\n\v\f\r\x1c\x1d\x1e\x1f \x85\xa0                　",
)

function isBlank(text: string): boolean {
  return [...text].every((character) => BLANK_CHARACTERS.has(character))
}

// DSH rejects a stored value that holds a negative zero or a number that is not finite.
function storableNumber(_key: string, value: unknown): unknown {
  if (typeof value !== "number") return value
  if (!Number.isFinite(value))
    throw new RangeError("a tool input holds a number that is not finite")
  return Object.is(value, -0) ? 0 : value
}

function hasType(value: unknown): value is JsonObject & { type: string } {
  return isObject(value) && typeof value.type === "string"
}

function isCapturedMessage(value: unknown): value is CapturedMessage {
  return (
    isObject(value) &&
    value.role === "assistant" &&
    Array.isArray(value.content) &&
    isObject(value.usage) &&
    typeof value.usage.input_tokens === "number" &&
    typeof value.usage.output_tokens === "number"
  )
}

function readIndex(event: NativeStreamEvent): number {
  const { index } = event
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
    throw new CaptureError(`${event.type} has no valid index`)
  }
  return index
}

function readObject(event: NativeStreamEvent, field: string): JsonObject {
  const value = event[field]
  if (!isObject(value)) throw new CaptureError(`${event.type} has no ${field} object`)
  return value
}

/** Copies fields as plain data, so a field named `__proto__` cannot change a prototype. */
function mergeFields(target: JsonObject, source: JsonObject): void {
  for (const [key, value] of Object.entries(source)) {
    Object.defineProperty(target, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    })
  }
}

function appendText(block: NativeBlock, field: string, addition: unknown): void {
  const current = block[field] ?? ""
  if (typeof current !== "string" || typeof addition !== "string") {
    throw new CaptureError(`a ${block.type} block cannot take a text delta for ${field}`)
  }
  block[field] = current + addition
}

function addCitation(block: NativeBlock, citation: unknown): void {
  const citations = block.citations ?? []
  if (!Array.isArray(citations) || citation === undefined) {
    throw new CaptureError(`a ${block.type} block cannot take a citation`)
  }
  block.citations = [...citations, structuredClone(citation)]
}

/** Turns the bytes of a server-sent event stream into the JSON events they carry. */
class EventStreamParser {
  #pending = ""
  readonly #decoder = new TextDecoder("utf-8", { fatal: true })

  parse(chunk: Uint8Array): NativeStreamEvent[] {
    const frames = (this.#pending + this.#decode(chunk)).split(FRAME_END)
    this.#pending = frames.pop() ?? ""
    return frames
      .map(frameData)
      .filter((data) => data !== "")
      .map(parseEvent)
  }

  #decode(chunk: Uint8Array): string {
    try {
      return this.#decoder.decode(chunk, { stream: true })
    } catch (cause) {
      throw new CaptureError("the event stream is not valid UTF-8", { cause })
    }
  }
}

function frameData(frame: string): string {
  return frame
    .split(LINE_BREAK)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).replace(LEADING_SPACES, ""))
    .join("\n")
}

function parseEvent(data: string): NativeStreamEvent {
  let value: unknown
  try {
    value = JSON.parse(data)
  } catch (cause) {
    throw new CaptureError("an event does not hold valid JSON", { cause })
  }
  if (!hasType(value)) throw new CaptureError("an event has no type")
  return value
}

function readError(event: NativeStreamEvent): { type: string; message: string } {
  const { type, message } = readObject(event, "error")
  if (typeof type !== "string" || typeof message !== "string") {
    throw new CaptureError("error has no type and message")
  }
  return { type, message }
}

/** Builds the assistant message the stream describes, one event at a time. */
class MessageAssembler {
  #message: CapturedMessage | null = null
  #complete = false
  #error: StreamCapture["error"] = null
  readonly #partialInputs = new Map<number, string>()
  readonly #unparsedInputs = new Set<number>()

  get message(): CapturedMessage | null {
    return this.#message
  }

  get complete(): boolean {
    return this.#complete
  }

  get error(): StreamCapture["error"] {
    return this.#error
  }

  apply(event: NativeStreamEvent): void {
    switch (event.type) {
      case "message_start":
        this.#start(event)
        break
      case "content_block_start":
        this.#startBlock(event)
        break
      case "content_block_delta":
        this.#applyDelta(event)
        break
      case "content_block_stop":
        this.#stopBlock(event)
        break
      case "message_delta":
        this.#updateMessage(event)
        break
      case "message_stop":
        this.#stop(event)
        break
      case "error":
        this.#error ??= readError(event)
        break
    }
  }

  #started(event: NativeStreamEvent): CapturedMessage {
    if (this.#message === null) throw new CaptureError(`${event.type} came before message_start`)
    return this.#message
  }

  #blockAt(event: NativeStreamEvent, index: number): NativeBlock {
    const block = this.#started(event).content[index]
    if (block === undefined) throw new CaptureError(`${event.type} points at a missing block`)
    return block
  }

  #start(event: NativeStreamEvent): void {
    const { message } = event
    if (!isCapturedMessage(message)) throw new CaptureError("message_start has no valid message")
    this.#message = structuredClone(message)
  }

  #startBlock(event: NativeStreamEvent): void {
    const block = event.content_block
    if (!hasType(block)) throw new CaptureError("content_block_start has no typed block")
    this.#started(event).content.push(structuredClone(block))
  }

  #applyDelta(event: NativeStreamEvent): void {
    const index = readIndex(event)
    const block = this.#blockAt(event, index)
    const delta = event.delta
    if (!hasType(delta)) throw new CaptureError("content_block_delta has no typed delta")
    const field = TEXT_FIELDS.get(delta.type)
    if (field !== undefined) {
      appendText(block, field, delta[field])
    } else if (delta.type === "input_json_delta") {
      this.#appendInput(index, delta.partial_json)
    } else if (delta.type === "citations_delta") {
      addCitation(block, delta.citation)
    }
  }

  #appendInput(index: number, partialJson: unknown): void {
    if (typeof partialJson !== "string") throw new CaptureError("input_json_delta has no text")
    this.#partialInputs.set(index, (this.#partialInputs.get(index) ?? "") + partialJson)
  }

  #stopBlock(event: NativeStreamEvent): void {
    const index = readIndex(event)
    const raw = this.#partialInputs.get(index)
    if (raw === undefined) return
    this.#partialInputs.delete(index)
    const block = this.#blockAt(event, index)
    if (isBlank(raw)) {
      block.input = {}
      return
    }
    // Streamed tool input is not validated by the API. A reply cut off at max_tokens ends in
    // the middle of an argument, and that call must never run with guessed arguments.
    try {
      block.input = JSON.parse(raw, storableNumber)
    } catch {
      this.#unparsedInputs.add(index)
    }
  }

  #updateMessage(event: NativeStreamEvent): void {
    const message = this.#started(event)
    if (event.delta !== undefined) mergeFields(message, readObject(event, "delta"))
    if (event.usage !== undefined) mergeFields(message.usage, readObject(event, "usage"))
  }

  #stop(event: NativeStreamEvent): void {
    const message = this.#started(event)
    for (const index of [...this.#unparsedInputs].sort((a, b) => b - a)) {
      message.content.splice(index, 1)
    }
    this.#unparsedInputs.clear()
    this.#complete = Boolean(message.stop_reason) && this.#partialInputs.size === 0
  }
}

/**
 * Reads the upstream stream while it passes through the relay. `feed` raises a `CaptureError`
 * when the stream is not Anthropic Messages events.
 */
export class SseCapture implements StreamCapture {
  readonly #parser = new EventStreamParser()
  readonly #assembler = new MessageAssembler()

  get message(): CapturedMessage | null {
    return this.#assembler.message
  }

  get complete(): boolean {
    return this.#assembler.complete
  }

  get error(): StreamCapture["error"] {
    return this.#assembler.error
  }

  feed(chunk: Uint8Array): void {
    for (const event of this.#parser.parse(chunk)) this.#assembler.apply(event)
  }
}
