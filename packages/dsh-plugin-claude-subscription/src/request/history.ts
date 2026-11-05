import type { ImageAttachmentRef } from "@deepseek-ai/dsh-attachment"
import type {
  AssistantMessage,
  ContentBlock,
  DeveloperMessage,
  ImageBlock,
  RequestMessage,
  ToolResultMessage,
} from "@deepseek-ai/dsh-llm"
import {
  type CapturedMessage,
  type NativeAssistantFrame,
  type NativeBlock,
  type NativeFrame,
  TOOL_PREFIX,
} from "../contract"
import { FailureCode, NativeFailure } from "../errors"
import {
  type ImageAccess,
  imageHandleText,
  offloadedImageText,
  type RequestImages,
  requestVersionOf,
} from "./images"
import { parseToolArguments, replayableTurns } from "./replay"

export interface HistoryContext {
  /** The model of the request. Signed thinking replays only for turns this model made. */
  nativeModel: string
  /** DSH tool name to the name inside the `mcp__dsh__` prefix. */
  toolNames: ReadonlyMap<string, string>
  images: RequestImages
  imageAccess(ref: ImageAttachmentRef): ImageAccess | undefined
}

function invalid(message: string): NativeFailure {
  return new NativeFailure(message, FailureCode.invalidRequest)
}

function textBlock(text: string): NativeBlock {
  return { type: "text", text }
}

function imageBlocks(block: ImageBlock, ctx: HistoryContext): NativeBlock[] {
  const access = ctx.imageAccess(block.attachment)
  if (block.offloaded === true) return [textBlock(offloadedImageText(block.attachment, access))]
  const version = requestVersionOf(block, ctx.images)
  return [
    textBlock(imageHandleText(block.attachment, version, access)),
    {
      type: "image",
      source: {
        type: "base64",
        media_type: version.mediaType,
        data: Buffer.from(version.data).toString("base64"),
      },
    },
  ]
}

function inputBlocks(content: readonly ContentBlock[], ctx: HistoryContext): NativeBlock[] {
  return content.flatMap((block): NativeBlock[] => {
    if (block.type === "text") return block.text.length > 0 ? [textBlock(block.text)] : []
    if (block.type === "image") return imageBlocks(block, ctx)
    throw invalid(`Content of type ${block.type} cannot be sent`)
  })
}

function developerBlocks(message: DeveloperMessage): NativeBlock[] {
  return message.content.flatMap((block): NativeBlock[] => {
    if (block.type === "text") return block.text.length > 0 ? [textBlock(block.text)] : []
    if (block.type === "tool-addition" || block.type === "tool-removal") return []
    throw invalid(`Developer content of type ${block.type} cannot be sent`)
  })
}

function toolResultBlock(message: ToolResultMessage, ctx: HistoryContext): NativeBlock {
  const parts = inputBlocks(message.content, ctx)
  const onlyText = parts.every((part) => part.type === "text")
  const content = onlyText ? parts.map((part) => String(part.text)).join("") : parts
  return {
    type: "tool_result",
    tool_use_id: message.toolCallId,
    content,
    ...(message.isError === true ? { is_error: true } : {}),
  }
}

function nativeNameOf(name: string, toolNames: ReadonlyMap<string, string>): string {
  const nativeName = toolNames.get(name)
  // A call outside the offered tools keeps the name the model gave it.
  return nativeName === undefined ? name : `${TOOL_PREFIX}${nativeName}`
}

function canonicalBlocks(
  message: AssistantMessage,
  toolNames: ReadonlyMap<string, string>,
): NativeBlock[] {
  return message.content.flatMap((block): NativeBlock[] => {
    switch (block.type) {
      case "text":
        return block.text.length > 0 ? [textBlock(block.text)] : []
      case "tool-call":
        return [
          {
            type: "tool_use",
            id: block.id,
            name: nativeNameOf(block.name, toolNames),
            input: parseToolArguments(block.name, block.arguments),
          },
        ]
      case "image":
        throw invalid("An image in an assistant message cannot be sent")
      default:
        return []
    }
  })
}

// The CLI sizes its local "prompt is too long" check from the newest assistant `usage`. A replayed
// turn would keep the size of the request that made it, even after compaction shrank the history.
function replayedFrame(turn: CapturedMessage): NativeAssistantFrame {
  const { usage: _usage, ...message } = structuredClone(turn)
  return { type: "assistant", message }
}

function assistantFrames(message: AssistantMessage, ctx: HistoryContext): NativeFrame[] {
  const turns = replayableTurns(message, ctx.nativeModel)
  if (turns !== undefined) return turns.map(replayedFrame)
  const content = canonicalBlocks(message, ctx.toolNames)
  return content.length === 0
    ? []
    : [{ type: "assistant", message: { role: "assistant", content } }]
}

function appendUserBlocks(frames: NativeFrame[], blocks: NativeBlock[]): void {
  if (blocks.length === 0) return
  const last = frames.at(-1)
  if (last?.type === "user") last.message.content.push(...blocks)
  else frames.push({ type: "user", message: { role: "user", content: blocks } })
}

// The CLI reads a user turn as a slash command when its last block is text that starts with "/",
// even with `--disable-slash-commands`. It may then answer by itself with no model call, drop the
// turn's other blocks, or add its own text. One leading space stops that on every replay as well.
function shieldFromCommandParsing(frame: NativeFrame): void {
  if (frame.type !== "user") return
  const { content } = frame.message
  const last = content.at(-1)
  if (last?.type !== "text" || !String(last.text).startsWith("/")) return
  content[content.length - 1] = { ...last, text: ` ${last.text}` }
}

/**
 * Builds the frames the CLI is given, one per turn. Neighbouring user-side messages share a
 * frame, because the CLI rejects two user turns in a row. The caller removes leading system
 * messages first.
 */
export function framesOf(messages: readonly RequestMessage[], ctx: HistoryContext): NativeFrame[] {
  const frames: NativeFrame[] = []
  for (const message of messages) {
    switch (message.role) {
      case "assistant":
        frames.push(...assistantFrames(message, ctx))
        break
      case "tool":
        appendUserBlocks(frames, [toolResultBlock(message, ctx)])
        break
      case "developer":
        appendUserBlocks(frames, developerBlocks(message))
        break
      case "user":
        appendUserBlocks(frames, inputBlocks(message.content, ctx))
        break
      case "system":
        throw invalid("System messages must come before the conversation history")
    }
  }
  frames.forEach(shieldFromCommandParsing)
  return frames
}
