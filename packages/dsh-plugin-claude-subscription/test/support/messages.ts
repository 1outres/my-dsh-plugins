import {
  type AssistantMessage,
  type ContentBlock,
  createAssistantMessage,
  createDeveloperMessage,
  createSystemMessage,
  createToolResultMessage,
  createUserMessage,
  type DeveloperMessage,
  type SystemMessage,
  ToolCallId,
  type ToolResultMessage,
  type UserMessage,
} from "@deepseek-ai/dsh-llm"
import { PROVIDER_ID, type ReplayCarrier } from "../../src/contract"

export const text = (value: string): ContentBlock => ({ type: "text", text: value })

export const reasoning = (value: string): ContentBlock => ({ type: "reasoning", text: value })

export const toolCall = (id: string, name: string, input: unknown = {}): ContentBlock => ({
  type: "tool-call",
  id: ToolCallId(id),
  name,
  arguments: typeof input === "string" ? input : JSON.stringify(input),
})

export function user(content: string | ContentBlock[]): UserMessage {
  return createUserMessage({
    content: typeof content === "string" ? [text(content)] : content,
    source: { kind: "user" },
  })
}

export function system(value: string): SystemMessage {
  return createSystemMessage(value)
}

export function developer(content: ContentBlock[]): DeveloperMessage {
  return createDeveloperMessage({ content, source: { kind: "user" } })
}

export function assistant(
  content: ContentBlock[],
  replayState?: { response: unknown },
  model = "sonnet",
): AssistantMessage {
  return createAssistantMessage({
    content,
    source: { provider: PROVIDER_ID, model, ...(replayState === undefined ? {} : { replayState }) },
  })
}

export function toolResult(
  callId: string,
  content: string | ContentBlock[],
  isError = false,
): ToolResultMessage {
  return createToolResultMessage({
    callId: ToolCallId(callId),
    content: typeof content === "string" ? [text(content)] : content,
    isError,
  })
}

export function withCarrier(carrier: ReplayCarrier): { response: ReplayCarrier } {
  return { response: carrier }
}
