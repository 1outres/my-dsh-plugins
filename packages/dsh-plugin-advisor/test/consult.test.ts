import { type GenerateOptions, LlmError, type StreamChunk } from "@deepseek-ai/dsh-llm"
import type { SessionId } from "@deepseek-ai/dsh-session"
import { describe, expect, it } from "vitest"
import type { AdviceRequest, AdvisorPorts, AdvisorSettings } from "../src/contract"
import { consultAdvisor } from "../src/host/consult"
import { AdvisorError } from "../src/host/errors"
import { advisorSystemPrompt } from "../src/host/prompts"
import { system, text, user } from "./support"

const SETTINGS: AdvisorSettings = {
  route: { provider: "claude", model: "opus", reasoningEffort: "high" },
  adviceWordLimit: 90,
  timeoutMs: 60000,
}

function textChunks(value: string, index = 0): StreamChunk[] {
  return [
    { type: "block-start", index, blockType: "text" },
    { type: "text-delta", index, text: value },
    { type: "block-end", index, block: { type: "text", text: value } },
  ]
}

function reasoningChunks(value: string, index: number): StreamChunk[] {
  return [
    { type: "block-start", index, blockType: "reasoning" },
    { type: "reasoning-delta", index, text: value },
    { type: "block-end", index, block: { type: "reasoning", text: value } },
  ]
}

function portsOf(stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>) {
  const calls: GenerateOptions[] = []
  const ports: AdvisorPorts = {
    stream: (options) => {
      calls.push(options)
      return stream(options)
    },
    fileText: () => "",
  }
  return { ports, calls }
}

async function* emit(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  for (const chunk of chunks) yield chunk
}

function request(overrides: Partial<AdviceRequest> = {}): AdviceRequest {
  return {
    settings: SETTINGS,
    records: { tools: [], messages: [system("Agent."), user([text("Task.")])] },
    nested: false,
    sessionId: "s1" as SessionId,
    signal: new AbortController().signal,
    ...overrides,
  }
}

async function failureCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    if (error instanceof AdvisorError) return error.code
    throw error
  }
  throw new Error("expected the consultation to fail")
}

describe("consultAdvisor", () => {
  it("sends the advisor prompt and the quoted records to the configured route", async () => {
    const { ports, calls } = portsOf(() =>
      emit([...textChunks("Plan first."), { type: "finish", reason: { kind: "stop" } }]),
    )

    await consultAdvisor(ports, request())

    expect(calls).toHaveLength(1)
    const [options] = calls
    expect(options?.provider).toBe("claude")
    expect(options?.model).toBe("opus")
    expect(options?.reasoningEffort).toBe("high")
    expect(options?.system).toBe(advisorSystemPrompt(90))
    expect(options?.purpose).toBe("advisor")
    expect(options?.sessionId).toBe("s1")
    expect(options?.tools).toBeUndefined()
    expect(options?.messages.at(-1)).toEqual({
      role: "user",
      content: [
        { type: "text", text: "The executor has just called advisor(). Give your guidance now." },
      ],
    })
  })

  it("leaves the reasoning effort out when none is set", async () => {
    const { ports, calls } = portsOf(() =>
      emit([...textChunks("ok"), { type: "finish", reason: { kind: "stop" } }]),
    )
    await consultAdvisor(
      ports,
      request({ settings: { ...SETTINGS, route: { provider: "claude", model: "opus" } } }),
    )
    expect(calls[0]).not.toHaveProperty("reasoningEffort")
  })

  it("returns the advice text without the advisor's reasoning", async () => {
    const { ports } = portsOf(() =>
      emit([
        ...reasoningChunks("thinking", 0),
        ...textChunks("Check the lock order.", 1),
        { type: "finish", reason: { kind: "stop" } },
      ]),
    )
    await expect(consultAdvisor(ports, request())).resolves.toEqual({
      advice: "Check the lock order.",
      model: "claude/opus",
      truncated: false,
    })
  })

  it("marks advice cut by the output limit as truncated", async () => {
    const { ports } = portsOf(() =>
      emit([...textChunks("Half of the"), { type: "finish", reason: { kind: "max-tokens" } }]),
    )
    await expect(consultAdvisor(ports, request())).resolves.toMatchObject({ truncated: true })
  })

  it("fails with a classified code when the stream ends in an error", async () => {
    const { ports } = portsOf(() =>
      emit([
        {
          type: "finish",
          reason: { kind: "error", failure: { code: "RATE_LIMIT", message: "slow down" } },
        },
      ]),
    )
    expect(await failureCode(consultAdvisor(ports, request()))).toBe("too_many_requests")
  })

  it("fails with a classified code when the stream throws", async () => {
    const { ports } = portsOf(() => {
      throw new LlmError("too long", "CONTEXT_WINDOW_EXCEEDED")
    })
    expect(await failureCode(consultAdvisor(ports, request()))).toBe("prompt_too_long")
  })

  it("fails as unavailable when the advisor writes no text", async () => {
    const { ports } = portsOf(() =>
      emit([...reasoningChunks("only thinking", 0), { type: "finish", reason: { kind: "stop" } }]),
    )
    expect(await failureCode(consultAdvisor(ports, request()))).toBe("unavailable")
  })

  it("fails as unavailable when the stream has no finish", async () => {
    const { ports } = portsOf(() => emit(textChunks("dangling")))
    expect(await failureCode(consultAdvisor(ports, request()))).toBe("unavailable")
  })

  it("fails as execution_time_exceeded when the advisor runs past the timeout", async () => {
    const { ports } = portsOf((options) => waitForAbort(options.signal))
    const settings = { ...SETTINGS, timeoutMs: 5 }
    expect(await failureCode(consultAdvisor(ports, request({ settings })))).toBe(
      "execution_time_exceeded",
    )
  })

  it("passes a cancellation through unchanged", async () => {
    const controller = new AbortController()
    const reason = new Error("cancelled by the user")
    const { ports } = portsOf((options) => waitForAbort(options.signal))
    const pending = consultAdvisor(ports, request({ signal: controller.signal }))
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
  })
})

async function* waitForAbort(signal: AbortSignal | undefined): AsyncIterable<StreamChunk> {
  if (signal === undefined) throw new Error("expected a signal")
  await new Promise<void>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true })
  })
  yield { type: "finish", reason: { kind: "stop" } }
}
