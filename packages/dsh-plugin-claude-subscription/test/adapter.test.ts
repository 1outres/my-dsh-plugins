import type { ImageAttachmentRef } from "@deepseek-ai/dsh-attachment"
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from "@deepseek-ai/dsh-llm"
import { BlockAssembler } from "@deepseek-ai/dsh-llm"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { type AdapterDeps, ClaudeSubscriptionAdapter } from "../src/adapter"
import type {
  DiscoveredModel,
  NativeCompletion,
  NativeDeps,
  NativeStreamEvent,
  PluginSettings,
  PreparedRequest,
} from "../src/contract"
import { FailureCode, NativeFailure } from "../src/errors"
import { captured, completion, delta, start, textEvents } from "./support/native-stream"

const ROUTE = "claude-subscription"

const PREPARED: PreparedRequest = {
  nativeModel: "claude-opus-5-5[1m]",
  system: "system",
  frames: [],
  extraBody: {},
  manifest: [],
  toolNames: new Map([["probe", "probe"]]),
  sessionId: "session",
  oneShot: false,
}

const OPTIONS: GenerateOptions = { provider: ROUTE, model: "opus", messages: [] }

const IMAGE_TARGET = { width: 10, height: 20, maxBytes: 30 }

const HELLO = completion(captured([{ type: "text", text: "hello" }], "end_turn"))

function modelInfoFake(provider: string, model: string): LlmResolvedModelInfo {
  return {
    provider,
    id: model,
    name: model,
    inputModalities: ["text", "image"],
    context: { contextWindow: 200000 },
  }
}

function scriptedRun(
  events: readonly NativeStreamEvent[],
  outcome: NativeCompletion | Error,
): AdapterDeps["run"] {
  return async function* () {
    yield* events
    if (outcome instanceof Error) throw outcome
    return outcome
  }
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

describe("ClaudeSubscriptionAdapter", () => {
  let settings: PluginSettings
  let native: NativeDeps
  let discover: ReturnType<typeof vi.fn<AdapterDeps["discover"]>>
  let reportDiscovery: ReturnType<typeof vi.fn<AdapterDeps["reportDiscovery"]>>
  let warn: ReturnType<typeof vi.fn<AdapterDeps["warn"]>>

  function adapter(overrides: Partial<AdapterDeps> = {}) {
    return new ClaudeSubscriptionAdapter({
      prepare: async () => PREPARED,
      run: scriptedRun(textEvents(0, "hello"), HELLO),
      discover,
      modelInfo: modelInfoFake,
      imageTarget: () => IMAGE_TARGET,
      projectionOf: () => ({ content: "hello", toolCalls: [] }),
      native,
      reportDiscovery,
      warn,
      ...overrides,
    })
  }

  beforeEach(() => {
    settings = {
      command: "claude",
      claudeConfigDir: "",
      claudeCodeTelemetry: true,
      readIdleTimeoutSeconds: 1800,
    }
    native = { settings: () => settings } as unknown as NativeDeps
    discover = vi.fn<AdapterDeps["discover"]>(
      async (): Promise<DiscoveredModel[]> => [
        { id: "opus", name: "Opus 5.5", description: "usage credits" },
        { id: "sonnet", name: "Sonnet 5.5" },
      ],
    )
    reportDiscovery = vi.fn<AdapterDeps["reportDiscovery"]>()
    warn = vi.fn<AdapterDeps["warn"]>()
  })

  describe("route metadata", () => {
    it("names the provider", () => {
      expect(adapter().providerInfo(ROUTE)).toEqual({ id: ROUTE, name: "Claude Subscription" })
    })

    it("uses the normal retry defaults and declares no image price", () => {
      expect(adapter().providerRetryPolicy(ROUTE)).toBeUndefined()
      expect(adapter().imageRequestPricing(ROUTE, "opus")).toBeUndefined()
    })

    it("reports the same image target request assembly uses", () => {
      const image = { width: 4000, height: 4000, bytes: 9 } as ImageAttachmentRef
      expect(adapter().imageRequestTarget(ROUTE, "opus", image)).toEqual(IMAGE_TARGET)
    })

    it("resolves a model through modelInfo", async () => {
      await expect(adapter().resolveModel(ROUTE, "opus")).resolves.toEqual(
        modelInfoFake(ROUTE, "opus"),
      )
    })

    it("binds model metadata and a stream in prepareCall", async () => {
      const call = await adapter().prepareCall(ROUTE, "opus")
      expect(call.model).toEqual(modelInfoFake(ROUTE, "opus"))
      const chunks = await collect(call.stream(OPTIONS))
      expect(chunks.at(-1)).toMatchObject({ type: "finish", reason: { kind: "stop" } })
    })
  })

  describe("listModels", () => {
    it("lists every discovered model with the route's capabilities", async () => {
      await expect(adapter().listModels(ROUTE)).resolves.toEqual([
        {
          provider: ROUTE,
          id: "opus",
          name: "Opus 5.5",
          description: "usage credits",
          inputModalities: ["text", "image"],
        },
        {
          provider: ROUTE,
          id: "sonnet",
          name: "Sonnet 5.5",
          inputModalities: ["text", "image"],
        },
      ])
      expect(discover).toHaveBeenCalledWith(native)
    })

    it("asks the CLI once while the settings stay the same", async () => {
      const subject = adapter()
      await subject.listModels(ROUTE)
      await subject.listModels(ROUTE)
      expect(discover).toHaveBeenCalledTimes(1)
    })

    it("shares one discovery between calls that overlap", async () => {
      const subject = adapter()
      await Promise.all([subject.listModels(ROUTE), subject.listModels(ROUTE)])
      expect(discover).toHaveBeenCalledTimes(1)
    })

    it("asks again when the settings change", async () => {
      const subject = adapter()
      await subject.listModels(ROUTE)
      settings = { ...settings, claudeConfigDir: "/other" }
      await subject.listModels(ROUTE)
      expect(discover).toHaveBeenCalledTimes(2)
    })

    describe("when discovery fails", () => {
      const failure = new NativeFailure("Not logged in", FailureCode.invalidCredential)

      it("rejects, and lists no pinned model instead", async () => {
        discover.mockRejectedValueOnce(failure)
        await expect(adapter().listModels(ROUTE)).rejects.toBe(failure)
      })

      it("publishes the message so the settings page can show it", async () => {
        discover.mockRejectedValueOnce(failure)
        await adapter()
          .listModels(ROUTE)
          .catch(() => {})
        expect(reportDiscovery).toHaveBeenLastCalledWith(failure.message)
      })

      it("keeps no failure, so a later login is seen, and clears the message", async () => {
        const subject = adapter()
        discover.mockRejectedValueOnce(failure)
        await subject.listModels(ROUTE).catch(() => {})
        await expect(subject.listModels(ROUTE)).resolves.toHaveLength(2)
        expect(discover).toHaveBeenCalledTimes(2)
        expect(reportDiscovery).toHaveBeenLastCalledWith(undefined)
      })

      it("ignores the outcome of a discovery the settings moved past", async () => {
        const subject = adapter()
        let failOld: (reason: Error) => void = () => {}
        discover.mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              failOld = reject
            }),
        )
        const old = subject.listModels(ROUTE)
        settings = { ...settings, command: "/other/claude" }
        await subject.listModels(ROUTE)
        reportDiscovery.mockClear()
        failOld(failure)
        await expect(old).rejects.toBe(failure)
        expect(reportDiscovery).not.toHaveBeenCalled()
        await subject.listModels(ROUTE)
        expect(discover).toHaveBeenCalledTimes(2)
      })
    })
  })

  describe("stream", () => {
    it("prepares the options and runs them with the signal and native deps", async () => {
      const signal = new AbortController().signal
      const prepare = vi.fn<AdapterDeps["prepare"]>(async () => PREPARED)
      const run = vi.fn<AdapterDeps["run"]>(scriptedRun(textEvents(0, "hello"), HELLO))
      const options = { ...OPTIONS, signal }
      await collect(adapter({ prepare, run }).stream(options))
      expect(prepare).toHaveBeenCalledWith(options)
      expect(run).toHaveBeenCalledWith(PREPARED, signal, native)
    })

    it("yields a stream the DSH assembler turns into a message", async () => {
      const assembler = new BlockAssembler()
      for (const chunk of await collect(adapter().stream(OPTIONS))) assembler.push(chunk)
      expect(assembler.blocks()).toEqual([{ type: "text", text: "hello" }])
      expect(assembler.finish).toEqual({ kind: "stop" })
      expect(assembler.usage).toMatchObject({ inputTokens: 10, outputTokens: 5 })
      expect(assembler.replayState).toMatchObject({ response: { kind: "claude-subscription" } })
    })

    it("delivers text before the process has finished", async () => {
      let release: () => void = () => {}
      const finished = new Promise<void>((resolve) => {
        release = resolve
      })
      const run: AdapterDeps["run"] = async function* () {
        yield start(0, { type: "text", text: "" })
        yield delta(0, { type: "text_delta", text: "hel" })
        await finished
        yield delta(0, { type: "text_delta", text: "lo" })
        return HELLO
      }
      const stream = adapter({ run }).stream(OPTIONS)[Symbol.asyncIterator]()
      expect((await stream.next()).value).toMatchObject({ type: "block-start" })
      expect((await stream.next()).value).toEqual({ type: "text-delta", index: 0, text: "hel" })
      release()
      await collect({ [Symbol.asyncIterator]: () => stream })
    })

    it("turns a preparation failure into a terminal finish", async () => {
      const failure = new NativeFailure("Bad history", FailureCode.invalidRequest)
      const prepare = async () => {
        throw failure
      }
      await expect(collect(adapter({ prepare }).stream(OPTIONS))).resolves.toEqual([
        { type: "finish", reason: { kind: "error", failure: failure.failure } },
      ])
    })

    it("ends with the failure after partial blocks", async () => {
      const failure = new NativeFailure("Cut short", FailureCode.transport)
      const run = scriptedRun(
        [start(0, { type: "text", text: "" }), delta(0, { type: "text_delta", text: "par" })],
        failure,
      )
      const chunks = await collect(adapter({ run }).stream(OPTIONS))
      expect(chunks).toEqual([
        { type: "block-start", index: 0, blockType: "text" },
        { type: "text-delta", index: 0, text: "par" },
        { type: "finish", reason: { kind: "error", failure: failure.failure } },
      ])
    })

    it("reports a cancelled call as aborted", async () => {
      const run = scriptedRun([], new NativeFailure("Cancelled", FailureCode.aborted))
      const chunks = await collect(adapter({ run }).stream(OPTIONS))
      expect(chunks).toMatchObject([{ type: "finish", reason: { kind: "aborted" } }])
    })

    it("turns a contradicting final message into a terminal finish", async () => {
      const run = scriptedRun(
        textEvents(0, "different"),
        completion(captured([{ type: "text", text: "hello" }], "end_turn")),
      )
      const chunks = await collect(adapter({ run }).stream(OPTIONS))
      expect(chunks.at(-1)).toMatchObject({
        type: "finish",
        reason: { kind: "error", failure: { code: FailureCode.nativeProtocol } },
      })
    })

    it("sends nothing after the finish", async () => {
      const chunks = await collect(adapter().stream(OPTIONS))
      expect(chunks.filter((chunk) => chunk.type === "finish")).toHaveLength(1)
      expect(chunks.at(-1)?.type).toBe("finish")
    })

    it("lets an unexpected error reach the DSH runtime, which normalizes it", async () => {
      const run = scriptedRun([], new TypeError("a bug"))
      await expect(collect(adapter({ run }).stream(OPTIONS))).rejects.toThrow("a bug")
    })

    it("closes the native run when the consumer stops early", async () => {
      let cleaned = false
      const run: AdapterDeps["run"] = async function* () {
        try {
          yield start(0, { type: "text", text: "" })
          yield delta(0, { type: "text_delta", text: "hel" })
          return HELLO
        } finally {
          cleaned = true
        }
      }
      for await (const chunk of adapter({ run }).stream(OPTIONS)) {
        if (chunk.type === "text-delta") break
      }
      expect(cleaned).toBe(true)
    })

    it("warns when the relay left the queried turn as the CLI built it", async () => {
      const run = scriptedRun(textEvents(0, "hello"), { ...HELLO, unrestored: "no unique frame" })
      await collect(adapter({ run }).stream(OPTIONS))
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("no unique frame"))
    })

    it("does not warn when the turn was restored", async () => {
      await collect(adapter().stream(OPTIONS))
      expect(warn).not.toHaveBeenCalled()
    })
  })
})
