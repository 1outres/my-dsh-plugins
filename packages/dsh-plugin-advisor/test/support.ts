import type { ContentBlock, Message, ToolSchema } from "@deepseek-ai/dsh-llm"

let counter = 0

function idOf(): string {
  counter += 1
  return `m${counter}`
}

export function system(text: string): Message {
  return {
    id: idOf(),
    role: "system",
    source: { kind: "system-prompt" },
    content: [{ type: "text", text }],
  } as unknown as Message
}

export function user(content: ContentBlock[], kind = "user"): Message {
  return { id: idOf(), role: "user", source: { kind }, content } as unknown as Message
}

export function assistant(content: ContentBlock[]): Message {
  return {
    id: idOf(),
    role: "assistant",
    source: { kind: "model", provider: "deepseek", model: "v4" },
    content,
  } as unknown as Message
}

export function toolResult(callId: string, text: string, isError = false): Message {
  return {
    id: idOf(),
    role: "tool",
    source: { kind: "tool", callId },
    toolCallId: callId,
    content: [{ type: "text", text }],
    ...(isError ? { isError: true } : {}),
  } as unknown as Message
}

export function developer(content: ContentBlock[]): Message {
  return { id: idOf(), role: "developer", source: { kind: "user" }, content } as unknown as Message
}

export function text(value: string): ContentBlock {
  return { type: "text", text: value }
}

export function call(id: string, name: string, args: string): ContentBlock {
  return { type: "tool-call", id, name, arguments: args } as unknown as ContentBlock
}

export function reasoning(value: string): ContentBlock {
  return { type: "reasoning", text: value }
}

export const READ_TOOL: ToolSchema = {
  name: "read",
  description: "Read a file.",
  parameters: { type: "object", properties: { path: { type: "string" } } },
}
