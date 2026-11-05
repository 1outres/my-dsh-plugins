import type {
  LlmReasoningEffortInfo,
  LlmResolvedModelInfo,
  ReasoningEffortId,
} from "@deepseek-ai/dsh-llm"
import { acceptsThinkingDisable, contextWindowOf } from "../catalog"
import { OFF_EFFORT, REASONING_EFFORTS } from "./generation"

const EFFORT_NAMES: Readonly<Record<string, string>> = {
  [OFF_EFFORT]: "Off",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
}

function effortInfo(id: string): LlmReasoningEffortInfo {
  return { id: id as ReasoningEffortId, name: EFFORT_NAMES[id] ?? id }
}

function effortsOf(model: string): LlmReasoningEffortInfo[] {
  const ids = acceptsThinkingDisable(model) ? [OFF_EFFORT, ...REASONING_EFFORTS] : REASONING_EFFORTS
  return ids.map(effortInfo)
}

/** Capabilities of one route. It declares no mid-conversation updates, so DSH sends the full tool list. */
export function modelInfo(provider: string, model: string): LlmResolvedModelInfo {
  const contextWindow = contextWindowOf(model)
  return {
    provider,
    id: model,
    name: model,
    inputModalities: ["text", "image"],
    ...(contextWindow === undefined ? {} : { context: { contextWindow } }),
    reasoning: { efforts: effortsOf(model) },
  }
}
