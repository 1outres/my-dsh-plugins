import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { afterEach, describe, expect, it } from "vitest"
import type { JsonObject, NativeCompletion } from "../../src/contract"
import { FailureCode, NativeFailure } from "../../src/errors"
import { drainAfterAnswer } from "../../src/native/drain"
import { runNative } from "../../src/native/run"
import { CLEAN_RELAY, capturedMessage, type FakeRelayState } from "../support/fake-relay"
import {
  drainRun,
  eventually,
  type FakeClaudeStep,
  type NativeHarness,
  nativeHarness,
  preparedRequest,
  processAlive,
} from "../support/native-harness"

const USAGE = { input_tokens: 3, output_tokens: 2 }
const TEXT_MESSAGE: JsonObject = {
  role: "assistant",
  content: [{ type: "text", text: "FIRST" }],
  usage: USAGE,
}

interface AnswerShape {
  subtype?: string
  isError?: boolean
  nativeError?: string
  noStop?: boolean
  withDelta?: boolean
}

function answer(shape: AnswerShape = {}): FakeClaudeStep[] {
  const { subtype = "success", isError = false, nativeError, noStop = false } = shape
  const assistant: JsonObject = { type: "assistant", message: TEXT_MESSAGE }
  if (nativeError !== undefined) assistant.error = nativeError
  const steps: FakeClaudeStep[] = [{ out: assistant }]
  if (shape.withDelta !== false) {
    steps.push({
      out: {
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "FIRST" } },
      },
    })
  }
  if (!noStop) steps.push({ out: { type: "stream_event", event: { type: "message_stop" } } })
  steps.push({ out: { type: "result", subtype, is_error: isError, usage: USAGE } })
  return steps
}

describe("fast return", () => {
  const harnesses: NativeHarness[] = []

  afterEach(async () => {
    await Promise.all(harnesses.splice(0).map((created) => created.dispose()))
  })

  interface CaseOptions {
    relay?: Partial<FakeRelayState>
    answer?: AnswerShape
    exit?: number
    after?: (paths: CasePaths) => FakeClaudeStep[]
  }

  interface CasePaths {
    result: string
    release: string
    drained: string
  }

  function casePaths(root: string): CasePaths {
    return {
      result: join(root, "result"),
      release: join(root, "release"),
      drained: join(root, "drained"),
    }
  }

  // The fake CLI answers, marks the `result` file, and waits for `release` before it exits.
  function fastCase(options: CaseOptions = {}): { harness: NativeHarness; paths: CasePaths } {
    const harness = nativeHarness({
      relay: options.relay ?? CLEAN_RELAY,
      settings: { readIdleTimeoutSeconds: 10 },
      scenario: (root) => {
        const paths = casePaths(root)
        return {
          script: [
            ...answer(options.answer),
            { touch: paths.result },
            ...(options.after === undefined ? [] : options.after(paths)),
            { waitFor: paths.release },
            { exit: options.exit ?? 0 },
          ],
        }
      },
    })
    harnesses.push(harness)
    return { harness, paths: casePaths(harness.root) }
  }

  function run(harness: NativeHarness, signal?: AbortSignal) {
    return drainRun(runNative(preparedRequest(), signal, harness.deps))
  }

  function pidOf(harness: NativeHarness): number {
    const pid = harness.subprocess.spawned[0]?.pid
    if (pid === undefined) throw new Error("no child was spawned")
    return pid
  }

  it("returns at the result event while the CLI still runs, and closes the relay at exit", async () => {
    const { harness, paths } = fastCase()
    const { completion } = await run(harness)
    expect(completion.assistants[0]?.id).toBe("msg_captured")
    const pid = pidOf(harness)
    expect(processAlive(pid)).toBe(true)
    expect(harness.relay.last().closed).toBe(false)
    expect(harness.relay.last().aborted).toBe(false)
    expect(existsSync(harness.files()[0]?.directory ?? "")).toBe(false)
    writeFileSync(paths.release, "")
    await eventually(() => !processAlive(pid))
    await eventually(() => harness.relay.last().closed)
  })

  it("keeps draining stdout and stderr after it returns", async () => {
    const { harness, paths } = fastCase({
      after: ({ drained }) => [{ flood: 256 }, { touch: drained }],
    })
    await run(harness)
    await eventually(() => existsSync(paths.drained))
    writeFileSync(paths.release, "")
  })

  it("returns tool calls at the max-turns result without reading the exit code", async () => {
    const message = capturedMessage({
      content: [{ type: "tool_use", id: "toolu_1", name: "mcp__dsh__lookup", input: { q: "x" } }],
      stop_reason: "tool_use",
    })
    const { harness, paths } = fastCase({
      relay: { ...CLEAN_RELAY, message },
      answer: { subtype: "error_max_turns", isError: true, withDelta: false },
      exit: 1,
    })
    const { completion } = await run(harness)
    expect(processAlive(pidOf(harness))).toBe(true)
    expect(completion.assistants[0]?.stop_reason).toBe("tool_use")
    writeFileSync(paths.release, "")
    await eventually(() => harness.relay.last().closed)
  })

  it("does not let the caller's signal reach the process after it returns", async () => {
    const controller = new AbortController()
    const { harness, paths } = fastCase()
    await run(harness, controller.signal)
    controller.abort()
    await sleep(50)
    const pid = pidOf(harness)
    expect(processAlive(pid)).toBe(true)
    expect(harness.relay.last().aborted).toBe(false)
    writeFileSync(paths.release, "")
    await eventually(() => !processAlive(pid))
  })

  it("lets the caller's signal end the process before the result", async () => {
    const controller = new AbortController()
    const harness = nativeHarness({
      relay: CLEAN_RELAY,
      scenario: {
        script: [
          { out: { type: "stream_event", event: { type: "ping" } } },
          { sleepMs: 30_000 },
          ...answer(),
        ],
      },
    })
    harnesses.push(harness)
    const generator = runNative(preparedRequest(), controller.signal, harness.deps)
    await generator.next()
    controller.abort()
    const failed = await generator.next().catch((error: unknown) => error)
    expect((failed as NativeFailure).code).toBe(FailureCode.aborted)
    expect(harness.relay.last().aborted).toBe(true)
    await eventually(() => !processAlive(pidOf(harness)))
  })

  describe("after the grace period", () => {
    it("ends a CLI that will not exit, and only then closes the relay", async () => {
      const { harness } = fastCase({ after: () => [{ sleepMs: 30_000 }] })
      const generator = runNative(preparedRequest(), undefined, harness.deps)
      const { spawned } = harness.subprocess
      await drainRun(generator)
      const handle = spawned[0]?.handle
      if (handle === undefined) throw new Error("no child was spawned")
      const relay = harness.relay.last()
      await drainAfterAnswer(handle, relay, 200)
      expect(relay.closed).toBe(true)
      await eventually(() => !processAlive(pidOf(harness)))
    })
  })

  describe("results that keep waiting for the end of the process", () => {
    const cases: [string, CaseOptions, string | null][] = [
      [
        "a failed subtype",
        { answer: { subtype: "error_other" }, relay: CLEAN_RELAY },
        "Native request failed",
      ],
      ["a native error", { answer: { nativeError: "server_error" } }, "Native API error"],
      ["an unused relay", { relay: {} }, null],
      ["a denied retry", { relay: { ...CLEAN_RELAY, denied: 1 } }, null],
      [
        "a refusal",
        { relay: { ...CLEAN_RELAY, message: capturedMessage({ stop_reason: "refusal" }) } },
        null,
      ],
      ["is_error", { answer: { isError: true } }, "Native request failed"],
      [
        "max turns with no tool call",
        { answer: { subtype: "error_max_turns" }, exit: 1 },
        "Native request failed",
      ],
      ["no message_stop", { answer: { noStop: true } }, null],
      [
        "an incomplete capture",
        { relay: { ...CLEAN_RELAY, complete: false } },
        "Incomplete upstream response",
      ],
      [
        "a non-200 status",
        { relay: { ...CLEAN_RELAY, status: 503 } },
        "Incomplete upstream response",
      ],
      ["a failing exit with an unused relay", { relay: {}, exit: 1 }, "Native request failed"],
    ]

    it.each(cases)("%s", async (_name, options, expected) => {
      const { harness, paths } = fastCase(options)
      let settled = false
      const pending: Promise<NativeCompletion | NativeFailure> = run(harness).then(
        ({ completion }) => completion,
        (error: NativeFailure) => error,
      )
      const observed = pending.finally(() => {
        settled = true
      })
      await eventually(() => existsSync(paths.result))
      await sleep(50)
      expect(settled).toBe(false)
      writeFileSync(paths.release, "")
      const outcome = await observed
      expect(processAlive(pidOf(harness))).toBe(false)
      if (expected === null) {
        expect(outcome).not.toBeInstanceOf(NativeFailure)
      } else {
        expect(outcome).toBeInstanceOf(NativeFailure)
        expect((outcome as NativeFailure).message).toContain(expected)
      }
    })

    it("returns a refusal with a native error, since the relay's answer stands", async () => {
      const { harness, paths } = fastCase({
        relay: { ...CLEAN_RELAY, message: capturedMessage({ stop_reason: "refusal" }) },
        answer: { nativeError: "server_error" },
      })
      writeFileSync(paths.release, "")
      const { completion } = await run(harness)
      expect(completion.assistants[0]?.stop_reason).toBe("refusal")
    })

    it("returns tool calls at max turns with exit 1 on the slow path", async () => {
      const message = capturedMessage({
        content: [{ type: "tool_use", id: "toolu_1", name: "lookup", input: {} }],
      })
      const { harness, paths } = fastCase({
        relay: { ...CLEAN_RELAY, message },
        answer: { subtype: "error_max_turns", isError: true, withDelta: false, noStop: true },
        exit: 1,
      })
      writeFileSync(paths.release, "")
      const { completion } = await run(harness)
      expect(completion.assistants[0]?.content[0]?.type).toBe("tool_use")
    })

    it("refuses tool calls at max turns with an exit code other than 1", async () => {
      const message = capturedMessage({
        content: [{ type: "tool_use", id: "toolu_1", name: "lookup", input: {} }],
      })
      const { harness, paths } = fastCase({
        relay: { ...CLEAN_RELAY, status: 200, message, complete: true },
        answer: { subtype: "error_max_turns", isError: true, withDelta: false, noStop: true },
        exit: 2,
      })
      writeFileSync(paths.release, "")
      const outcome = await run(harness).catch((error: unknown) => error)
      expect(outcome).toBeInstanceOf(NativeFailure)
      expect((outcome as NativeFailure).message).toContain("Native request failed")
    })
  })
})
