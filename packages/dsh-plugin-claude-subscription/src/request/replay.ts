import { isDeepStrictEqual } from "node:util"
import type { AssistantMessage, ContentBlock } from "@deepseek-ai/dsh-llm"
import { nativeModel } from "../catalog"
import type { CapturedMessage, ReplayCarrier, ReplayProjection } from "../contract"
import { FailureCode, NativeFailure } from "../errors"

const CARRIER_KIND = "claude-subscription"
const CARRIER_VERSION = 1

export function parseToolArguments(toolName: string, raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch (cause) {
    throw new NativeFailure(
      `Arguments of the tool call to ${toolName} are not valid JSON`,
      FailureCode.invalidRequest,
      { cause },
    )
  }
}

/**
 * What DSH is told about an assistant turn: its visible text and its tool calls.
 * A stored message whose projection differs from the one saved beside its native turn was
 * edited since, so the native turn is stale.
 */
export function projectionOf(content: readonly ContentBlock[]): ReplayProjection {
  const text = content.flatMap((block) => (block.type === "text" ? [block.text] : []))
  const toolCalls = content.flatMap((block) =>
    block.type === "tool-call"
      ? [{ id: block.id, name: block.name, input: parseToolArguments(block.name, block.arguments) }]
      : [],
  )
  return { content: text.join("").trim(), toolCalls }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isReplayCarrier(value: unknown): value is ReplayCarrier {
  return (
    isObject(value) &&
    value.kind === CARRIER_KIND &&
    value.version === CARRIER_VERSION &&
    Array.isArray(value.messages) &&
    isObject(value.projection)
  )
}

/**
 * The native turns to replay for a stored assistant message, or undefined when the message
 * must be rebuilt from what DSH holds. A carrier is used only while the message still equals
 * the projection saved beside it and the request names the model that made it. After an edit
 * or a model switch its signatures would be stale.
 */
export function replayableTurns(
  message: AssistantMessage,
  requestModel: string,
): readonly CapturedMessage[] | undefined {
  const state: unknown = message.source.replayState
  const carrier = isObject(state) ? state.response : undefined
  if (!isReplayCarrier(carrier)) return undefined
  if (nativeModel(message.source.model) !== requestModel) return undefined
  return isDeepStrictEqual(carrier.projection, projectionOf(message.content))
    ? carrier.messages
    : undefined
}
