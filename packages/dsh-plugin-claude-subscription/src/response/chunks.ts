import type {
  ContentBlock,
  FinishReason,
  LlmFailure,
  ReplayEnvelope,
  StreamChunk,
  ToolCallBlock,
} from "@deepseek-ai/dsh-llm"
import type {
  CapturedMessage,
  JsonObject,
  NativeBlock,
  NativeCompletion,
  NativeStreamEvent,
  ReplayCarrier,
  ReplayProjection,
} from "../contract"
import { FailureCode, NativeFailure } from "../errors"
import { isCutOff, isRefusal, refusalFailure, usageOf } from "./finish"
import { isLosslessJson } from "./lossless"
import {
  dshToolName,
  invertToolNames,
  type NativeToolNames,
  withOfferedToolNames,
} from "./tool-names"

type DisplayKind = "text" | "reasoning"

/** A text or thinking block. It takes a DSH index only when it has something to show. */
interface DisplayBlock {
  kind: DisplayKind
  index: number | undefined
  text: string
  closed: boolean
}

interface ToolCallStream {
  kind: "tool-call"
  index: number
  id: string
  name: string
}

type StreamedBlock = DisplayBlock | ToolCallStream | { kind: "hidden" }

export interface ChunkTranslatorOptions {
  /** DSH tool name to the name inside the prefix, from the prepared request. */
  toolNames: ReadonlyMap<string, string>
  projectionOf(content: readonly ContentBlock[]): ReplayProjection
}

/**
 * Turns one native answer into DSH chunks.
 *
 * The DSH assembler builds a tool call from its deltas even with no `block-end`, and the DSH loop
 * runs every tool call in a message that finished with `stop` or `tool-calls`. So a tool call only
 * becomes runnable through `complete`, and a streamed call the final message does not hold fails
 * the whole answer instead of finishing cleanly.
 */
export class ChunkTranslator {
  private readonly names: NativeToolNames
  private readonly projectionOf: ChunkTranslatorOptions["projectionOf"]
  private readonly streamed = new Map<number, StreamedBlock>()
  private readonly settled = new Map<number, ContentBlock>()
  private nextIndex = 0

  constructor(options: ChunkTranslatorOptions) {
    this.names = invertToolNames(options.toolNames)
    this.projectionOf = options.projectionOf
  }

  event(event: NativeStreamEvent): StreamChunk[] {
    switch (event.type) {
      case "content_block_start":
        return this.startBlock(event)
      case "content_block_delta":
        return this.applyDelta(event)
      case "content_block_stop":
        return this.stopBlock(event)
      default:
        return []
    }
  }

  /** @throws NativeFailure when the final message contradicts what was streamed. */
  complete(completion: NativeCompletion): StreamChunk[] {
    const { assistants } = completion
    const usage: StreamChunk = { type: "usage", usage: usageOf(completion.usage) }
    if (isRefusal(assistants)) {
      return [usage, finishChunk({ kind: "error", failure: refusalFailure(assistants) })]
    }

    const blocks = assistants.flatMap((message) => message.content)
    const hasToolUse = blocks.some(isToolUse)
    const display = this.settleDisplay(blocks)
    if (isCutOff(assistants)) {
      // DSH drops tool calls from a max-tokens message, and a replayed tool_use with no result
      // would be rejected, so such a turn replays from its stored blocks instead.
      const replayState = hasToolUse ? undefined : this.replayState(completion)
      return [...display, usage, finishChunk({ kind: "max-tokens" }, replayState)]
    }

    const toolCalls = this.settleToolCalls(blocks)
    if (!hasToolUse && !hasVisibleText(blocks)) {
      return [...display, usage, finishChunk({ kind: "error", failure: EMPTY_RESPONSE })]
    }
    const reason: FinishReason = { kind: hasToolUse ? "tool-calls" : "stop" }
    return [...display, ...toolCalls, usage, finishChunk(reason, this.replayState(completion))]
  }

  private startBlock(event: NativeStreamEvent): StreamChunk[] {
    const nativeIndex = blockIndexOf(event)
    if (this.streamed.has(nativeIndex)) malformed(`block ${nativeIndex} started twice`)
    const block = objectField(event, "content_block")
    switch (block.type) {
      case "text":
        return this.startDisplay(nativeIndex, "text", block.text)
      case "thinking":
        return this.startDisplay(nativeIndex, "reasoning", block.thinking)
      case "tool_use":
        return this.startToolCall(nativeIndex, block)
      default:
        this.streamed.set(nativeIndex, { kind: "hidden" })
        return []
    }
  }

  private startDisplay(nativeIndex: number, kind: DisplayKind, initial: unknown): StreamChunk[] {
    const block = newDisplayBlock(kind)
    this.streamed.set(nativeIndex, block)
    return typeof initial === "string" ? this.appendDisplay(block, initial) : []
  }

  private startToolCall(nativeIndex: number, block: JsonObject): StreamChunk[] {
    const id = stringField(block, "id")
    const name = dshToolName(stringField(block, "name"), this.names)
    const index = this.takeIndex()
    this.streamed.set(nativeIndex, { kind: "tool-call", index, id, name })
    return [
      { type: "block-start", index, blockType: "tool-call" },
      { type: "tool-call-delta", index, id: toolCallId(id), name, argumentsDelta: "" },
    ]
  }

  private applyDelta(event: NativeStreamEvent): StreamChunk[] {
    const nativeIndex = blockIndexOf(event)
    const block = this.streamed.get(nativeIndex)
    if (block === undefined) malformed(`delta for block ${nativeIndex}, which never started`)
    if (block.kind === "hidden") return []
    const delta = objectField(event, "delta")
    switch (delta.type) {
      case "text_delta":
        if (block.kind !== "text") malformed(`text delta for a ${block.kind} block`)
        return this.appendDisplay(block, stringField(delta, "text"))
      case "thinking_delta":
        if (block.kind !== "reasoning") malformed(`thinking delta for a ${block.kind} block`)
        return this.appendDisplay(block, stringField(delta, "thinking"))
      case "input_json_delta":
        if (block.kind !== "tool-call") malformed(`tool input delta for a ${block.kind} block`)
        return [
          {
            type: "tool-call-delta",
            index: block.index,
            id: toolCallId(block.id),
            argumentsDelta: stringField(delta, "partial_json"),
          },
        ]
      default:
        return []
    }
  }

  private appendDisplay(block: DisplayBlock, text: string): StreamChunk[] {
    if (text === "") return []
    const chunks: StreamChunk[] = []
    if (block.index === undefined) {
      block.index = this.takeIndex()
      chunks.push({ type: "block-start", index: block.index, blockType: block.kind })
    }
    block.text += text
    chunks.push(
      block.kind === "text"
        ? { type: "text-delta", index: block.index, text }
        : { type: "reasoning-delta", index: block.index, text },
    )
    return chunks
  }

  private stopBlock(event: NativeStreamEvent): StreamChunk[] {
    const block = this.streamed.get(blockIndexOf(event))
    if (block === undefined) malformed("stop for a block that never started")
    return block.kind === "text" || block.kind === "reasoning" ? this.closeDisplay(block) : []
  }

  private closeDisplay(block: DisplayBlock): StreamChunk[] {
    if (block.index === undefined || block.closed) return []
    block.closed = true
    const content = displayContent(block.kind, block.text)
    this.settled.set(block.index, content)
    return [{ type: "block-end", index: block.index, block: content }]
  }

  private settleDisplay(blocks: readonly NativeBlock[]): StreamChunk[] {
    const finals = blocks.flatMap(displayOf)
    const streamed = [...this.streamed.values()].filter(isDisplayBlock)
    const lost = streamed.slice(finals.length).find((block) => block.text !== "")
    if (lost !== undefined) malformed(`the final message lost streamed ${lost.kind}`)

    return finals.flatMap((final, position) => {
      const block = streamed[position] ?? newDisplayBlock(final.kind)
      if (block.kind !== final.kind) malformed("final block kinds differ from the stream")
      return this.settleOneDisplay(block, final.text)
    })
  }

  private settleOneDisplay(block: DisplayBlock, final: string): StreamChunk[] {
    const matches = block.closed ? block.text === final : final.startsWith(block.text)
    if (!matches && block.kind === "text") {
      malformed("the final text differs from the incremental stream")
    }
    if (block.closed) return []
    const chunks = matches ? this.appendDisplay(block, final.slice(block.text.length)) : []
    if (!matches) block.text = final
    return [...chunks, ...this.closeDisplay(block)]
  }

  private settleToolCalls(blocks: readonly NativeBlock[]): StreamChunk[] {
    const calls = blocks.filter(isToolUse)
    const finalIds = new Set(calls.map((call) => stringField(call, "id")))
    const streamed = [...this.streamed.values()].filter(isToolCallStream)
    const lost = streamed.find((call) => !finalIds.has(call.id))
    if (lost !== undefined) malformed(`the tool call to ${lost.name} has no complete arguments`)

    return calls.flatMap((call) => {
      const id = stringField(call, "id")
      const name = dshToolName(stringField(call, "name"), this.names)
      const args = JSON.stringify(inputObjectOf(call))
      const open = streamed.find((candidate) => candidate.id === id)
      const index = open?.index ?? this.takeIndex()
      const content: ToolCallBlock = {
        type: "tool-call",
        id: toolCallId(id),
        name,
        arguments: args,
      }
      this.settled.set(index, content)
      const opening: StreamChunk[] =
        open !== undefined
          ? []
          : [
              { type: "block-start", index, blockType: "tool-call" },
              { type: "tool-call-delta", index, id: toolCallId(id), name, argumentsDelta: args },
            ]
      return [...opening, { type: "block-end", index, block: content }]
    })
  }

  private replayState(completion: NativeCompletion): ReplayEnvelope | undefined {
    const messages = completion.assistants.map((message) =>
      withOfferedToolNames(message, this.names),
    )
    if (!isReplayable(messages)) return undefined
    const carrier: ReplayCarrier = {
      kind: "claude-subscription",
      version: 1,
      messages,
      projection: this.projectionOf(this.settledInOrder()),
    }
    return isLosslessJson(carrier) ? { response: carrier } : undefined
  }

  private settledInOrder(): ContentBlock[] {
    return [...this.settled.entries()].sort(([a], [b]) => a - b).map(([, block]) => block)
  }

  private takeIndex(): number {
    const index = this.nextIndex
    this.nextIndex += 1
    return index
  }
}

/** The terminal chunk for a failed call. Partial blocks before it never become a stored message. */
export function failureChunk(
  failure: NativeFailure,
  signal: AbortSignal | undefined,
): Extract<StreamChunk, { type: "finish" }> {
  const aborted = failure.code === FailureCode.aborted || signal?.aborted === true
  return {
    type: "finish",
    reason: { kind: aborted ? "aborted" : "error", failure: failure.failure as LlmFailure },
  }
}

const EMPTY_RESPONSE = {
  code: FailureCode.emptyResponse,
  message: "The model finished with no text and no tool call.",
}

function finishChunk(reason: FinishReason, replayState?: ReplayEnvelope): StreamChunk {
  return { type: "finish", reason, ...(replayState === undefined ? {} : { replayState }) }
}

function newDisplayBlock(kind: DisplayKind): DisplayBlock {
  return { kind, index: undefined, text: "", closed: false }
}

function displayContent(kind: DisplayKind, text: string): ContentBlock {
  return { type: kind, text }
}

function displayOf(block: NativeBlock): { kind: DisplayKind; text: string }[] {
  if (block.type === "text") return [{ kind: "text", text: stringOrEmpty(block.text) }]
  if (block.type === "thinking") return [{ kind: "reasoning", text: stringOrEmpty(block.thinking) }]
  return []
}

// The API rejects an assistant turn that holds thinking alone, and a thinking block without its
// signature. DSH also stores only values that survive a JSON round trip.
function isReplayable(messages: readonly CapturedMessage[]): boolean {
  const blocks = messages.flatMap((message) => message.content)
  const hasAnswer = blocks.some(
    (block) => isToolUse(block) || (block.type === "text" && stringOrEmpty(block.text) !== ""),
  )
  const unsigned = blocks.some(
    (block) => block.type === "thinking" && stringOrEmpty(block.signature) === "",
  )
  return hasAnswer && !unsigned
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function hasVisibleText(blocks: readonly NativeBlock[]): boolean {
  return blocks.some((block) => block.type === "text" && stringOrEmpty(block.text) !== "")
}

function inputObjectOf(call: NativeBlock): JsonObject {
  const { input } = call
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    malformed(`the tool call to ${String(call.name)} has no input object`)
  }
  return input as JsonObject
}

function isToolUse(block: NativeBlock): boolean {
  return block.type === "tool_use"
}

function isDisplayBlock(block: StreamedBlock): block is DisplayBlock {
  return block.kind === "text" || block.kind === "reasoning"
}

function isToolCallStream(block: StreamedBlock): block is ToolCallStream {
  return block.kind === "tool-call"
}

function toolCallId(id: string): ToolCallBlock["id"] {
  return id as ToolCallBlock["id"]
}

function blockIndexOf(event: NativeStreamEvent): number {
  const index = event.index
  if (typeof index !== "number" || !Number.isInteger(index)) malformed("event with no block index")
  return index
}

function objectField(source: JsonObject, field: string): JsonObject {
  const value = source[field]
  if (typeof value !== "object" || value === null) malformed(`event with no ${field}`)
  return value as JsonObject
}

function stringField(source: JsonObject, field: string): string {
  const value = source[field]
  if (typeof value !== "string") malformed(`block with no ${field}`)
  return value
}

function malformed(detail: string): never {
  throw new NativeFailure(`Malformed Claude Code stream: ${detail}`, FailureCode.nativeProtocol)
}
