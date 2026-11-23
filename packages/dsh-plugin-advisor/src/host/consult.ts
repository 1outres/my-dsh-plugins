import {
  BlockAssembler,
  type FinishReason,
  type GenerateOptions,
  HarnessError,
  ReasoningEffortId,
  type StreamChunk,
} from "@deepseek-ai/dsh-llm"
import type { Advice, AdviceRequest, AdvisorPorts, AdvisorRoute } from "../contract"
import { AdvisorError, classifyFailureCode } from "./errors"
import { advisorSystemPrompt } from "./prompts"
import { renderRecords } from "./transcript"

export async function consultAdvisor(ports: AdvisorPorts, request: AdviceRequest): Promise<Advice> {
  const { route } = request.settings
  const timeout = AbortSignal.timeout(request.settings.timeoutMs)
  const options: GenerateOptions = {
    provider: route.provider,
    model: route.model,
    ...(route.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(route.reasoningEffort) }),
    system: advisorSystemPrompt(request.settings.adviceWordLimit),
    messages: renderRecords(request.records, {
      nested: request.nested,
      fileText: (ref) => ports.fileText(ref),
    }),
    sessionId: request.sessionId,
    purpose: "advisor",
    signal: AbortSignal.any([request.signal, timeout]),
  }
  try {
    return await readAdvice(ports.stream(options), route)
  } catch (error) {
    if (request.signal.aborted) throw error
    if (timeout.aborted) {
      throw new AdvisorError(
        "execution_time_exceeded",
        `the advisor did not answer within ${request.settings.timeoutMs} ms`,
      )
    }
    throw asAdvisorError(error)
  }
}

async function readAdvice(
  stream: AsyncIterable<StreamChunk>,
  route: AdvisorRoute,
): Promise<Advice> {
  const assembler = new BlockAssembler()
  let finish: FinishReason | undefined
  for await (const chunk of stream) {
    assembler.push(chunk)
    if (chunk.type === "finish") finish = chunk.reason
  }
  if (finish === undefined) throw new AdvisorError("unavailable", "the advisor stream ended early")
  if (finish.kind === "error" || finish.kind === "aborted") {
    throw new AdvisorError(classifyFailureCode(finish.failure.code), finish.failure.message)
  }
  if (finish.kind === "tool-calls") {
    throw new AdvisorError("unavailable", "the advisor tried to call a tool")
  }
  const advice = assembler
    .blocks()
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n\n")
    .trim()
  if (advice === "") throw new AdvisorError("unavailable", "the advisor returned no text")
  return {
    advice,
    model: `${route.provider}/${route.model}`,
    truncated: finish.kind === "max-tokens",
  }
}

function asAdvisorError(error: unknown): AdvisorError {
  if (error instanceof AdvisorError) return error
  if (error instanceof HarnessError)
    return new AdvisorError(classifyFailureCode(error.code), error.message)
  return new AdvisorError("unavailable", error instanceof Error ? error.message : String(error))
}
