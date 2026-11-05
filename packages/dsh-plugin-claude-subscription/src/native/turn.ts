import type {
  CapturedMessage,
  JsonObject,
  NativeBlock,
  NativeCompletion,
  NativeStreamEvent,
  NativeUsage,
  Relay,
} from "../contract"
import { FailureCode, NativeFailure } from "../errors"
import {
  loggedOutFailure,
  nativeAnswerFailure,
  upstreamFailure,
  withoutRelayRoute,
} from "./failures"

interface NativeErrorAnswer {
  code: string | undefined
  text: string
}

/** What the CLI has said so far about one model call. */
export interface TurnState {
  assistants: JsonObject[]
  results: JsonObject[]
  /** The CLI's stream reached `message_stop`. */
  stopped: boolean
  /** Text deltas in order, to compare with the final message. */
  streamedText: string
  nativeError: NativeErrorAnswer | null
}

/** How the process ended, as far as the runner looked. */
export type TurnEnding = { fast: true } | { fast: false; exitCode: number | null }

export function newTurnState(): TurnState {
  return { assistants: [], results: [], stopped: false, streamedText: "", nativeError: null }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function protocolFailure(what: string, stderrTail: string): NativeFailure {
  return new NativeFailure(`${what}${stderrTail}`, FailureCode.nativeProtocol)
}

function blocksOf(message: JsonObject): NativeBlock[] {
  return Array.isArray(message.content) ? (message.content as NativeBlock[]) : []
}

function textOf(blocks: readonly NativeBlock[]): string {
  return blocks
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("")
}

function recordAssistant(state: TurnState, event: JsonObject, stderrTail: () => string): void {
  const { message } = event
  if (!isObject(message) || !Array.isArray(message.content)) {
    throw protocolFailure("Native assistant event holds no message", stderrTail())
  }
  if (event.error || message.error) {
    const code = typeof event.error === "string" ? event.error : undefined
    state.nativeError = {
      code,
      text: blocksOf(message)
        .filter((block) => block.type === "text")
        .map((block) => String(block.text ?? ""))
        .join("\n"),
    }
    return
  }
  state.assistants.push(message)
}

function recordStreamEvent(
  state: TurnState,
  event: JsonObject,
  stderrTail: () => string,
): NativeStreamEvent {
  const inner = event.event
  if (!isObject(inner) || typeof inner.type !== "string") {
    throw protocolFailure("Native stream_event holds no event", stderrTail())
  }
  if (inner.type === "message_stop") state.stopped = true
  const { delta } = inner
  if (isObject(delta) && delta.type === "text_delta" && typeof delta.text === "string") {
    state.streamedText += delta.text
  }
  return inner as NativeStreamEvent
}

/** Takes in one stream-json object. Returns the raw stream event to pass on, if it holds one. */
export function recordEvent(
  state: TurnState,
  event: JsonObject,
  stderrTail: () => string,
): NativeStreamEvent | null {
  switch (event.type) {
    case "assistant":
      recordAssistant(state, event, stderrTail)
      return null
    case "result":
      state.results.push(event)
      return null
    case "stream_event":
      return recordStreamEvent(state, event, stderrTail)
    default:
      return null
  }
}

function endedWithToolCall(result: JsonObject, blocks: readonly NativeBlock[]): boolean {
  return result.subtype === "error_max_turns" && blocks.some((block) => block.type === "tool_use")
}

/**
 * A clean admitted answer returns at the CLI's `result` event. Its exit code, any later stdout and
 * a hang past the limit are then never read: the answer is already complete, and the drain ends
 * a CLI that will not exit.
 */
export function fastEligible(result: JsonObject, relay: Relay, state: TurnState): boolean {
  const message = relay.capture.message
  if (message === null) return false
  const admittedCleanly =
    relay.used && relay.status === 200 && relay.capture.complete && relay.denied === 0
  if (!admittedCleanly || !state.stopped || state.nativeError !== null) return false
  if (message.stop_reason === "refusal") return false
  const succeeded = result.subtype === "success" && !result.is_error
  return succeeded || endedWithToolCall(result, message.content)
}

function isUsage(value: unknown): value is NativeUsage {
  return (
    isObject(value) &&
    typeof value.input_tokens === "number" &&
    typeof value.output_tokens === "number"
  )
}

function assertTextMatches(streamed: string, blocks: readonly NativeBlock[], tail: string): void {
  if (!textOf(blocks).startsWith(streamed)) {
    throw protocolFailure("Native final text differs from the incremental stream", tail)
  }
}

/** Messages of an unused relay come from the CLI. Replay needs each to carry a usage field. */
function asCaptured(message: JsonObject, usage: NativeUsage): CapturedMessage {
  return {
    ...message,
    role: "assistant",
    content: blocksOf(message),
    usage: isUsage(message.usage) ? message.usage : usage,
  }
}

interface FinalAnswer {
  messages: readonly JsonObject[]
  stopped: boolean
  usageOf: (result: JsonObject) => unknown
}

function finalAnswer(state: TurnState, relay: Relay, nativeError: string | null): FinalAnswer {
  if (!relay.used) {
    return {
      messages: state.assistants,
      stopped: state.stopped,
      usageOf: (result) => result.usage,
    }
  }
  const message = relay.capture.message
  if (relay.status !== 200 || !relay.capture.complete || message === null) {
    throw upstreamFailure(relay, nativeError)
  }
  return { messages: [message], stopped: true, usageOf: () => message.usage }
}

function failureOfNativeError(
  error: NativeErrorAnswer,
  relay: Relay,
  stderrTail: string,
): NativeFailure {
  if (error.code === "authentication_failed" && !relay.used) {
    return loggedOutFailure(error.text, stderrTail)
  }
  return nativeAnswerFailure(error.code, error.text, stderrTail)
}

function assertProcessSucceeded(
  result: JsonObject,
  blocks: readonly NativeBlock[],
  ending: TurnEnding,
  stderrTail: string,
): void {
  const exitCode = ending.fast ? 0 : ending.exitCode
  const atTurnLimit = endedWithToolCall(result, blocks) && (ending.fast || ending.exitCode === 1)
  if (atTurnLimit) return
  if (exitCode !== 0 || result.is_error || result.subtype !== "success") {
    throw protocolFailure(`Native request failed: ${String(result.subtype)}`, stderrTail)
  }
}

/**
 * Decides the outcome of a call that ran to its end. The relay's capture is the final message
 * whenever the relay was used. Raises the mapped `NativeFailure` otherwise.
 */
export function finishTurn(
  state: TurnState,
  relay: Relay,
  ending: TurnEnding,
  stderrTail: string,
): NativeCompletion {
  const nativeError =
    state.nativeError === null
      ? null
      : { ...state.nativeError, text: withoutRelayRoute(state.nativeError.text, relay.url) }
  const answer = finalAnswer(state, relay, nativeError?.text ?? null)
  const refused = relay.used && answer.messages[0]?.stop_reason === "refusal"
  // After a denied retry or a refusal, the relay's answer stands, whatever the CLI made of it.
  const relayAnswerStands = relay.denied > 0 || refused
  if (nativeError !== null && !relayAnswerStands) {
    throw failureOfNativeError(nativeError, relay, stderrTail)
  }
  const [result] = state.results
  if (
    state.results.length !== 1 ||
    result === undefined ||
    answer.messages.length === 0 ||
    !answer.stopped
  ) {
    throw protocolFailure(
      "Incomplete native response: assistant, message_stop and one result required",
      stderrTail,
    )
  }
  const blocks = answer.messages.flatMap(blocksOf)
  if (!relayAnswerStands) assertProcessSucceeded(result, blocks, ending, stderrTail)
  const usage = answer.usageOf(result)
  if (!isUsage(usage))
    throw protocolFailure("Native result missing complete token usage", stderrTail)
  assertTextMatches(state.streamedText, blocks, stderrTail)
  return {
    assistants: answer.messages.map((message) => asCaptured(message, usage)),
    usage,
    requestId: relay.requestId,
    blockedRequests: relay.denied,
    unrestored: relay.unrestored,
  }
}
