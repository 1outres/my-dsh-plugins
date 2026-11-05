import {
  type AssistantMessage,
  BlockAssembler,
  createAssistantMessage,
  type FinishReason,
  type GenerateOptions,
  type RequestMessage,
  type StreamChunk,
  type ToolSchema,
} from "@deepseek-ai/dsh-llm"
import { PROVIDER_ID } from "../../src/contract"
import type { Rig } from "./rig"

export const MODEL = "claude-sonnet-5-5"

export const READ_FILE: ToolSchema = {
  name: "read_file",
  description: "Read a fixture",
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
}

export function requestOf(
  messages: readonly RequestMessage[],
  extra: Partial<GenerateOptions> = {},
): GenerateOptions {
  return { provider: PROVIDER_ID, model: MODEL, messages: [...messages], ...extra }
}

/** One finished model call, as the DSH loop sees it. */
export interface Call {
  chunks: StreamChunk[]
  finish: FinishReason
  seconds: number
  assembler: BlockAssembler
  /** The assistant message the DSH loop would store. */
  stored: AssistantMessage
}

export async function call(rig: Rig, options: GenerateOptions): Promise<Call> {
  const started = performance.now()
  const chunks: StreamChunk[] = []
  const assembler = new BlockAssembler()
  for await (const chunk of rig.adapter.stream(options)) {
    chunks.push(chunk)
    assembler.push(chunk)
  }
  const { replayState } = assembler
  return {
    chunks,
    finish: assembler.finish,
    seconds: (performance.now() - started) / 1000,
    assembler,
    stored: createAssistantMessage({
      content: assembler.blocks(),
      source: {
        provider: PROVIDER_ID,
        model: options.model,
        ...(replayState === undefined ? {} : { replayState }),
      },
    }),
  }
}

export function textOf(result: Call): string {
  return result.assembler
    .blocks()
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
}

export function reasoningOf(result: Call): string {
  return result.assembler
    .blocks()
    .flatMap((block) => (block.type === "reasoning" ? [block.text] : []))
    .join("")
}

export function toolCallsOf(result: Call) {
  return result.assembler.blocks().flatMap((block) => (block.type === "tool-call" ? [block] : []))
}
