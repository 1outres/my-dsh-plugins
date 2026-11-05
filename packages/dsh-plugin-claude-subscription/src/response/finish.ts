import type { LlmFailure, TokenUsage } from "@deepseek-ai/dsh-llm"
import type { CapturedMessage, NativeUsage } from "../contract"

const CONTENT_FILTER_CODE = "CONTENT_FILTER"
const CUT_OFF_STOP_REASONS = new Set(["max_tokens", "model_context_window_exceeded"])

export function isRefusal(assistants: readonly CapturedMessage[]): boolean {
  return assistants.some((message) => message.stop_reason === "refusal")
}

export function isCutOff(assistants: readonly CapturedMessage[]): boolean {
  return assistants.some((message) => CUT_OFF_STOP_REASONS.has(message.stop_reason ?? ""))
}

export function refusalFailure(assistants: readonly CapturedMessage[]): LlmFailure {
  const details = assistants.find((message) => message.stop_details !== undefined)?.stop_details
  return { code: CONTENT_FILTER_CODE, message: refusalMessage(details) }
}

function refusalMessage(details: CapturedMessage["stop_details"]): string {
  const explanation = details?.explanation
  if (typeof explanation === "string" && explanation.trim() !== "") return explanation.trim()
  const category = details?.category
  if (typeof category === "string" && category !== "") {
    return `provider refusal category: ${category}`
  }
  return "The provider refused this request."
}

export function usageOf(usage: NativeUsage): TokenUsage {
  const cacheRead = usage.cache_read_input_tokens
  const cacheWrite = usage.cache_creation_input_tokens
  const reasoning = usage.output_tokens_details?.thinking_tokens
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.input_tokens + usage.output_tokens + (cacheRead ?? 0) + (cacheWrite ?? 0),
    ...(cacheRead === undefined ? {} : { cacheReadTokens: cacheRead }),
    ...(cacheWrite === undefined ? {} : { cacheWriteTokens: cacheWrite }),
    ...(reasoning === undefined ? {} : { reasoningTokens: reasoning }),
  }
}
