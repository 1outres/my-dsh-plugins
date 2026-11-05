import type {
  CapturedMessage,
  NativeBlock,
  NativeCompletion,
  NativeStreamEvent,
} from "../../src/contract"

export const start = (index: number, content_block: NativeBlock): NativeStreamEvent => ({
  type: "content_block_start",
  index,
  content_block,
})

export const delta = (index: number, value: Record<string, unknown>): NativeStreamEvent => ({
  type: "content_block_delta",
  index,
  delta: value,
})

export const stop = (index: number): NativeStreamEvent => ({ type: "content_block_stop", index })

export function textEvents(index: number, ...parts: string[]): NativeStreamEvent[] {
  return [
    start(index, { type: "text", text: "" }),
    ...parts.map((text) => delta(index, { type: "text_delta", text })),
    stop(index),
  ]
}

export function thinkingEvents(index: number, ...parts: string[]): NativeStreamEvent[] {
  return [
    start(index, { type: "thinking", thinking: "", signature: "" }),
    ...parts.map((thinking) => delta(index, { type: "thinking_delta", thinking })),
    delta(index, { type: "signature_delta", signature: "sig" }),
    stop(index),
  ]
}

export function toolEvents(
  index: number,
  id: string,
  name: string,
  ...parts: string[]
): NativeStreamEvent[] {
  return [
    start(index, { type: "tool_use", id, name, input: {} }),
    ...parts.map((partial_json) => delta(index, { type: "input_json_delta", partial_json })),
    stop(index),
  ]
}

export function captured(
  content: NativeBlock[],
  stop_reason: string,
  extra: Partial<CapturedMessage> = {},
): CapturedMessage {
  return {
    id: "msg_1",
    role: "assistant",
    content,
    stop_reason,
    usage: { input_tokens: 10, output_tokens: 5 },
    ...extra,
  }
}

export function completion(...assistants: CapturedMessage[]): NativeCompletion {
  return {
    assistants,
    usage: assistants[0]?.usage ?? { input_tokens: 10, output_tokens: 5 },
    requestId: "req_1",
    blockedRequests: 0,
    unrestored: null,
  }
}
