import { acceptsThinkingDisable, supportsAdaptiveThinking } from "../catalog"
import type { JsonObject } from "../contract"
import { FailureCode, NativeFailure } from "../errors"

export const OFF_EFFORT = "off"
export const REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const

const LOWEST_EFFORT = REASONING_EFFORTS[0]

export interface GenerationInput {
  model: string
  reasoningEffort?: string
  temperature?: number
  maxTokens?: number
  stop?: readonly string[]
}

export interface Generation {
  /** Generation fields of the Messages request. The tool list is added by the caller. */
  body: JsonObject
  /** Value for `--effort`. */
  effort?: string
  /** Value for `CLAUDE_CODE_MAX_OUTPUT_TOKENS`. */
  maxOutputTokens?: number
}

interface Reasoning {
  body: JsonObject
  effort?: string
}

function invalid(message: string): NativeFailure {
  return new NativeFailure(message, FailureCode.invalidRequest)
}

function isKnownEffort(effort: string): boolean {
  return effort === OFF_EFFORT || (REASONING_EFFORTS as readonly string[]).includes(effort)
}

function reasoningOff(model: string): Reasoning {
  if (acceptsThinkingDisable(model)) {
    return {
      body: { thinking: { type: "disabled" }, context_management: { edits: [] } },
    }
  }
  // Thinking cannot be turned off here. Without an effort the CLI thinks at its own default,
  // so the lowest effort is the nearest thing to off.
  return { body: { output_config: { effort: LOWEST_EFFORT } }, effort: LOWEST_EFFORT }
}

function reasoningOn(model: string, effort: string | undefined): Reasoning {
  const body: JsonObject = {}
  if (supportsAdaptiveThinking(model)) {
    // Without `display`, 4.7 and newer models return an empty thinking text with a signature.
    body.thinking = { type: "adaptive", display: "summarized" }
  }
  if (effort !== undefined) body.output_config = { effort }
  return effort === undefined ? { body } : { body, effort }
}

function reasoningOf(model: string, effort: string | undefined): Reasoning {
  if (effort !== undefined && !isKnownEffort(effort)) {
    throw invalid(`Unsupported reasoning effort: ${effort}`)
  }
  return effort === OFF_EFFORT ? reasoningOff(model) : reasoningOn(model, effort)
}

function checkTemperature(temperature: number): void {
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 1) {
    throw invalid("temperature must be finite and between zero and one")
  }
}

function checkMaxTokens(maxTokens: number): void {
  if (!Number.isInteger(maxTokens) || maxTokens < 1) {
    throw invalid("maxTokens must be a positive integer")
  }
}

function checkStop(stop: readonly string[]): void {
  if (stop.some((sequence) => sequence === "")) {
    throw invalid("stop must be a list of nonempty strings")
  }
}

/** Turns the generation settings of a DSH request into Messages request fields. */
export function generationOf(input: GenerationInput): Generation {
  const reasoning = reasoningOf(input.model, input.reasoningEffort)
  const body: JsonObject = { ...reasoning.body }
  // Subscription models reject sampling controls, so a valid temperature is checked and dropped.
  if (input.temperature !== undefined) checkTemperature(input.temperature)
  if (input.maxTokens !== undefined) {
    checkMaxTokens(input.maxTokens)
    body.max_tokens = input.maxTokens
  }
  if (input.stop !== undefined) {
    checkStop(input.stop)
    body.stop_sequences = [...input.stop]
  }
  return {
    body,
    ...(reasoning.effort === undefined ? {} : { effort: reasoning.effort }),
    ...(input.maxTokens === undefined ? {} : { maxOutputTokens: input.maxTokens }),
  }
}
