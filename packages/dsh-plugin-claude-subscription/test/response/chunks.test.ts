import {
  AssistantStreamAccumulator,
  BlockAssembler,
  type ContentBlock,
  type StreamChunk,
} from "@deepseek-ai/dsh-llm"
import { describe, expect, it, vi } from "vitest"
import type {
  NativeBlock,
  NativeCompletion,
  NativeStreamEvent,
  ReplayCarrier,
} from "../../src/contract"
import { FailureCode, NativeFailure } from "../../src/errors"
import { ChunkTranslator, failureChunk } from "../../src/response/chunks"
import {
  captured,
  completion,
  delta,
  start,
  stop,
  textEvents,
  thinkingEvents,
  toolEvents,
} from "../support/native-stream"

const PROJECTION = { content: "projected", toolCalls: [] }

function translator(toolNames: ReadonlyMap<string, string> = new Map([["probe", "probe"]])) {
  const projectionOf = vi.fn((_content: readonly ContentBlock[]) => PROJECTION)
  return { projectionOf, chunks: new ChunkTranslator({ toolNames, projectionOf }) }
}

function translate(
  events: readonly NativeStreamEvent[],
  done: NativeCompletion,
  toolNames?: ReadonlyMap<string, string>,
) {
  const { chunks, projectionOf } = translator(toolNames)
  const output = [...events.flatMap((event) => chunks.event(event)), ...chunks.complete(done)]
  const assembler = new BlockAssembler()
  for (const chunk of output) assembler.push(chunk)
  return { output, assembler, projectionOf }
}

function finishOf(output: readonly StreamChunk[]) {
  const last = output.at(-1)
  if (last?.type !== "finish") throw new Error("the stream did not end with finish")
  return last
}

function carrierOf(output: readonly StreamChunk[]): ReplayCarrier {
  return finishOf(output).replayState?.response as ReplayCarrier
}

function storedByDsh(output: readonly StreamChunk[]): void {
  const accumulator = new AssistantStreamAccumulator()
  for (const chunk of output) accumulator.push({ time: 0, chunk })
}

const text = (value: string): NativeBlock => ({ type: "text", text: value })
const thinking = (value: string): NativeBlock => ({
  type: "thinking",
  thinking: value,
  signature: "sig",
})
const toolUse = (id: string, name: string, input: unknown = {}): NativeBlock => ({
  type: "tool_use",
  id,
  name,
  input,
})

describe("ChunkTranslator", () => {
  describe("the normal lifecycle", () => {
    const events = [
      ...thinkingEvents(0, "pri", "vate"),
      ...textEvents(1, "hel", "lo"),
      ...toolEvents(2, "toolu_test", "mcp__dsh__probe", '{"value"', ':"x"}'),
    ]
    const done = completion(
      captured(
        [
          thinking("private"),
          text("hello"),
          toolUse("toolu_test", "mcp__dsh__probe", { value: "x" }),
        ],
        "tool_use",
      ),
    )

    it("assembles reasoning, text and a runnable tool call", () => {
      const { assembler } = translate(events, done)
      expect(assembler.blocks()).toEqual([
        { type: "reasoning", text: "private" },
        { type: "text", text: "hello" },
        { type: "tool-call", id: "toolu_test", name: "probe", arguments: '{"value":"x"}' },
      ])
      expect(assembler.finish).toEqual({ kind: "tool-calls" })
    })

    it("sends usage just before finish and nothing after it", () => {
      const { output } = translate(events, done)
      expect(output.map((chunk) => chunk.type).slice(-2)).toEqual(["usage", "finish"])
    })

    it("streams text and thinking as they arrive", () => {
      const { chunks } = translator()
      chunks.event(start(0, { type: "thinking", thinking: "" }))
      expect(chunks.event(delta(0, { type: "thinking_delta", thinking: "hm" }))).toEqual([
        { type: "block-start", index: 0, blockType: "reasoning" },
        { type: "reasoning-delta", index: 0, text: "hm" },
      ])
      expect(chunks.event(delta(0, { type: "thinking_delta", thinking: "m" }))).toEqual([
        { type: "reasoning-delta", index: 0, text: "m" },
      ])
      expect(chunks.event(stop(0))).toEqual([
        { type: "block-end", index: 0, block: { type: "reasoning", text: "hmm" } },
      ])
    })

    it("streams a tool call with the DSH name and holds its block-end", () => {
      const { chunks } = translator()
      expect(
        chunks.event(start(0, { type: "tool_use", id: "t1", name: "mcp__dsh__probe", input: {} })),
      ).toEqual([
        { type: "block-start", index: 0, blockType: "tool-call" },
        { type: "tool-call-delta", index: 0, id: "t1", name: "probe", argumentsDelta: "" },
      ])
      expect(chunks.event(delta(0, { type: "input_json_delta", partial_json: "{}" }))).toEqual([
        { type: "tool-call-delta", index: 0, id: "t1", argumentsDelta: "{}" },
      ])
      expect(chunks.event(stop(0))).toEqual([])
    })
  })

  describe("what the DSH assembler does with an open tool call", () => {
    it("runs it on a stop or tool-calls finish, so a held block-end alone is not enough", () => {
      const assembler = new BlockAssembler()
      const { chunks } = translator()
      for (const event of [start(0, toolUse("t1", "mcp__dsh__probe")), stop(0)]) {
        for (const chunk of chunks.event(event)) assembler.push(chunk)
      }
      assembler.push({ type: "finish", reason: { kind: "stop" } })
      expect(assembler.blocks().map((block) => block.type)).toEqual(["tool-call"])
    })

    it("drops it on a max-tokens finish", () => {
      const assembler = new BlockAssembler()
      const { chunks } = translator()
      for (const chunk of chunks.event(start(0, toolUse("t1", "mcp__dsh__probe")))) {
        assembler.push(chunk)
      }
      assembler.push({ type: "finish", reason: { kind: "max-tokens" } })
      expect(assembler.blocks()).toEqual([])
    })

    it("leaves it out of what an interrupted turn keeps", () => {
      const { chunks } = translator()
      const assembler = new BlockAssembler()
      const events = [...textEvents(0, "partial"), start(1, toolUse("t1", "mcp__dsh__probe"))]
      for (const chunk of events.flatMap((event) => chunks.event(event))) assembler.push(chunk)
      expect(assembler.interruptedBlocks()).toEqual([{ type: "text", text: "partial" }])
    })
  })

  describe("tool names", () => {
    const aliased = new Map([
      ["a_tool_with_a_very_long_name_that_needs_an_alias_because_of_its_length", "short_alias"],
      ["probe", "probe"],
    ])

    function nameOf(nativeName: string, toolNames: ReadonlyMap<string, string> = aliased) {
      const { assembler, output } = translate(
        toolEvents(0, "t1", nativeName, "{}"),
        completion(captured([toolUse("t1", nativeName)], "tool_use")),
        toolNames,
      )
      const [block] = assembler.blocks()
      if (block?.type !== "tool-call") throw new Error("expected a tool call")
      return { name: block.name, carrier: carrierOf(output) }
    }

    it("removes the prefix", () => {
      expect(nameOf("mcp__dsh__probe").name).toBe("probe")
    })

    it("maps a long alias back to the DSH name", () => {
      expect(nameOf("mcp__dsh__short_alias").name).toBe(
        "a_tool_with_a_very_long_name_that_needs_an_alias_because_of_its_length",
      )
    })

    it("maps a bare name the same way and carries the offered name for replay (#62)", () => {
      const { name, carrier } = nameOf("short_alias")
      expect(name).toBe("a_tool_with_a_very_long_name_that_needs_an_alias_because_of_its_length")
      expect(carrier.messages[0]?.content[0]?.name).toBe("mcp__dsh__short_alias")
    })

    it("lets a name outside the inventory reach DSH, which owns tool validation (#39)", () => {
      expect(nameOf("mcp__fastmail__draft_email").name).toBe("mcp__fastmail__draft_email")
      expect(nameOf("mcp__dsh__unlisted").name).toBe("unlisted")
      expect(nameOf("mcp__dsh__unlisted").carrier.messages[0]?.content[0]?.name).toBe(
        "mcp__dsh__unlisted",
      )
    })

    it("does not change the capture it was given", () => {
      const message = captured([toolUse("t1", "probe")], "tool_use")
      translate(toolEvents(0, "t1", "probe", "{}"), completion(message))
      expect(message.content[0]?.name).toBe("probe")
    })
  })

  describe("a refusal", () => {
    const refused = (stop_details?: Record<string, unknown>) =>
      completion(
        captured([text("partial"), toolUse("t1", "mcp__dsh__probe")], "refusal", {
          ...(stop_details === undefined ? {} : { stop_details }),
        }),
      )
    const events = [...textEvents(0, "partial"), ...toolEvents(1, "t1", "mcp__dsh__probe", "{")]

    it("finishes with CONTENT_FILTER and the explanation", () => {
      const { output } = translate(
        events,
        refused({ explanation: "  Not allowed.  ", category: "cyber" }),
      )
      expect(finishOf(output).reason).toEqual({
        kind: "error",
        failure: { code: "CONTENT_FILTER", message: "Not allowed." },
      })
    })

    it("names the category when there is no explanation", () => {
      const { output } = translate(events, refused({ category: "cyber" }))
      expect(finishOf(output).reason).toEqual({
        kind: "error",
        failure: { code: "CONTENT_FILTER", message: "provider refusal category: cyber" },
      })
    })

    it("has a plain default", () => {
      const { output } = translate(events, refused())
      expect(finishOf(output).reason).toEqual({
        kind: "error",
        failure: { code: "CONTENT_FILTER", message: "The provider refused this request." },
      })
    })

    it("closes no tool call and stores no replay state", () => {
      const { output } = translate(events, refused())
      expect(output.filter((chunk) => chunk.type === "block-end" && chunk.index === 1)).toEqual([])
      expect(finishOf(output).replayState).toBeUndefined()
    })
  })

  describe("a reply cut short", () => {
    it.each(["max_tokens", "model_context_window_exceeded"])(
      "%s finishes as max-tokens",
      (reason) => {
        const { assembler, output } = translate(
          textEvents(0, "partial"),
          completion(captured([text("partial")], reason)),
        )
        expect(assembler.finish).toEqual({ kind: "max-tokens" })
        expect(assembler.blocks()).toEqual([{ type: "text", text: "partial" }])
        expect(carrierOf(output).messages).toHaveLength(1)
      },
    )

    it("never produces a runnable call from an argument the capture dropped", () => {
      const { assembler, output, projectionOf } = translate(
        [...textEvents(0, "partial"), ...toolEvents(1, "t1", "mcp__dsh__probe", '{"a":')],
        completion(captured([text("partial")], "max_tokens")),
      )
      expect(assembler.finish).toEqual({ kind: "max-tokens" })
      expect(assembler.blocks()).toEqual([{ type: "text", text: "partial" }])
      expect(projectionOf).toHaveBeenCalledWith([{ type: "text", text: "partial" }])
      expect(carrierOf(output).messages[0]?.content).toEqual([text("partial")])
    })

    it("stores no carrier when a complete tool_use would replay without its result", () => {
      const { assembler, output } = translate(
        [
          ...toolEvents(0, "t1", "mcp__dsh__probe", "{}"),
          ...toolEvents(1, "t2", "mcp__dsh__probe", '{"a":'),
        ],
        completion(captured([toolUse("t1", "mcp__dsh__probe")], "max_tokens")),
      )
      expect(assembler.finish).toEqual({ kind: "max-tokens" })
      expect(assembler.blocks()).toEqual([])
      expect(finishOf(output).replayState).toBeUndefined()
    })
  })

  describe("a carrier DSH would not keep or the API would not accept", () => {
    const unsigned: NativeBlock = { type: "thinking", thinking: "hm" }
    const emptySignature: NativeBlock = { type: "thinking", thinking: "hm", signature: "" }

    it.each([
      ["negative zero", -0],
      ["infinity", Number.POSITIVE_INFINITY],
    ])("stores no replay state when a text block holds %s", (_name, number) => {
      const { output } = translate(
        textEvents(0, "hello"),
        completion(captured([{ ...text("hello"), citations: [{ start: number }] }], "end_turn")),
      )
      expect(finishOf(output).reason).toEqual({ kind: "stop" })
      expect(finishOf(output).replayState).toBeUndefined()
      expect(() => storedByDsh(output)).not.toThrow()
    })

    it("stores no replay state when a thinking block holds negative zero", () => {
      const block = { ...thinking("hm"), extra: [-0] }
      const { output } = translate(
        [...thinkingEvents(0, "hm"), ...textEvents(1, "hello")],
        completion(captured([block, text("hello")], "end_turn")),
      )
      expect(finishOf(output).replayState).toBeUndefined()
      expect(() => storedByDsh(output)).not.toThrow()
    })

    it("keeps the replay state of an ordinary carrier DSH can store", () => {
      const { output } = translate(
        textEvents(0, "hello"),
        completion(captured([{ ...text("hello"), citations: [{ start: 0, end: 5 }] }], "end_turn")),
      )
      expect(finishOf(output).replayState).toBeDefined()
      expect(() => storedByDsh(output)).not.toThrow()
    })

    it("stores no replay state when a reply cut off at the limit holds only thinking", () => {
      const { assembler, output } = translate(
        [...thinkingEvents(0, "hm"), ...toolEvents(1, "t1", "mcp__dsh__probe", '{"a":')],
        completion(captured([thinking("hm")], "max_tokens")),
      )
      expect(assembler.finish).toEqual({ kind: "max-tokens" })
      expect(finishOf(output).replayState).toBeUndefined()
    })

    it.each([
      ["has no signature", unsigned],
      ["has an empty signature", emptySignature],
    ])("stores no replay state when a thinking block %s", (_name, block) => {
      const { output } = translate(
        [...thinkingEvents(0, "hm"), ...textEvents(1, "hello")],
        completion(captured([block, text("hello")], "end_turn")),
      )
      expect(finishOf(output).replayState).toBeUndefined()
    })

    it("stores no replay state for an unsigned thinking block in a reply cut off at the limit", () => {
      const { output } = translate(
        [...thinkingEvents(0, "hm"), ...textEvents(1, "partial")],
        completion(captured([unsigned, text("partial")], "max_tokens")),
      )
      expect(finishOf(output).replayState).toBeUndefined()
    })

    it("keeps the replay state of a turn with only a tool call", () => {
      const { output } = translate(
        toolEvents(0, "t1", "mcp__dsh__probe", "{}"),
        completion(captured([toolUse("t1", "mcp__dsh__probe")], "tool_use")),
      )
      expect(finishOf(output).replayState).toBeDefined()
    })

    it("keeps the replay state when redacted thinking comes with text", () => {
      const { output } = translate(
        textEvents(0, "hello"),
        completion(
          captured([{ type: "redacted_thinking", data: "opaque" }, text("hello")], "end_turn"),
        ),
      )
      expect(finishOf(output).replayState).toBeDefined()
    })
  })

  describe("a tool call with no input object", () => {
    it.each([
      ["no input", undefined],
      ["a null input", null],
      ["an input that is text", "{}"],
      ["an input that is a list", []],
    ])("fails the answer for %s", (_name, input) => {
      const call: NativeBlock = { type: "tool_use", id: "t1", name: "mcp__dsh__probe", input }
      if (input === undefined) delete call.input
      const { chunks } = translator()
      expect(() => chunks.complete(completion(captured([call], "tool_use")))).toThrowError(
        expect.objectContaining({ code: FailureCode.nativeProtocol }),
      )
    })

    it("keeps a call with empty arguments, which the capture delivers as an empty object", () => {
      const { assembler } = translate(
        toolEvents(0, "t1", "mcp__dsh__probe", ""),
        completion(captured([toolUse("t1", "mcp__dsh__probe", {})], "tool_use")),
      )
      expect(assembler.blocks()).toEqual([
        { type: "tool-call", id: "t1", name: "probe", arguments: "{}" },
      ])
    })
  })

  describe("a streamed tool call the final message does not hold", () => {
    it.each(["end_turn", "tool_use"])(
      "fails on %s, because DSH would run the open call",
      (reason) => {
        const { chunks } = translator()
        for (const event of toolEvents(0, "t1", "mcp__dsh__probe", '{"a":')) chunks.event(event)
        expect(() => chunks.complete(completion(captured([text("x")], reason)))).toThrowError(
          expect.objectContaining({ code: FailureCode.nativeProtocol }),
        )
      },
    )
  })

  describe("an empty answer", () => {
    it("is EMPTY_RESPONSE when end_turn has no content", () => {
      const { output } = translate([], completion(captured([], "end_turn")))
      const { reason } = finishOf(output)
      expect(reason).toMatchObject({ kind: "error", failure: { code: "EMPTY_RESPONSE" } })
    })

    it("is EMPTY_RESPONSE for thinking alone, because the loop would end the turn in silence", () => {
      const { output } = translate(
        thinkingEvents(0, "stalling"),
        completion(captured([thinking("stalling")], "end_turn")),
      )
      expect(finishOf(output).reason).toMatchObject({
        kind: "error",
        failure: { code: "EMPTY_RESPONSE" },
      })
      expect(finishOf(output).replayState).toBeUndefined()
    })

    it("is EMPTY_RESPONSE when the only text is an empty string", () => {
      const { output } = translate(textEvents(0), completion(captured([text("")], "end_turn")))
      expect(finishOf(output).reason).toMatchObject({ failure: { code: "EMPTY_RESPONSE" } })
    })

    it("stays a stop for text with no content but white space", () => {
      const { assembler } = translate(
        textEvents(0, "\n"),
        completion(captured([text("\n")], "end_turn")),
      )
      expect(assembler.finish).toEqual({ kind: "stop" })
    })
  })

  describe("the final message against the stream", () => {
    it("emits everything from the final message when no stream events came", () => {
      const { assembler } = translate(
        [],
        completion(
          captured(
            [thinking("hm"), text("hi"), toolUse("t1", "mcp__dsh__probe", { a: 1 })],
            "tool_use",
          ),
        ),
      )
      expect(assembler.blocks()).toEqual([
        { type: "reasoning", text: "hm" },
        { type: "text", text: "hi" },
        { type: "tool-call", id: "t1", name: "probe", arguments: '{"a":1}' },
      ])
    })

    it("flattens the turns of several assistant messages", () => {
      const { assembler } = translate(
        [],
        completion(captured([text("a")], "end_turn"), captured([text("b")], "end_turn")),
      )
      expect(assembler.blocks()).toEqual([
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ])
    })

    it("emits what the stream did not finish", () => {
      const { output, assembler } = translate(
        [start(0, text("")), delta(0, { type: "text_delta", text: "hel" })],
        completion(captured([text("hello")], "end_turn")),
      )
      expect(output).toContainEqual({ type: "text-delta", index: 0, text: "lo" })
      expect(assembler.blocks()).toEqual([{ type: "text", text: "hello" }])
    })

    it("fails when open text is not a prefix of the final text", () => {
      const { chunks } = translator()
      chunks.event(start(0, text("")))
      chunks.event(delta(0, { type: "text_delta", text: "other" }))
      expect(() => chunks.complete(completion(captured([text("hello")], "end_turn")))).toThrowError(
        expect.objectContaining({ code: FailureCode.nativeProtocol }),
      )
    })

    it("fails when closed text differs from the final text", () => {
      const { chunks } = translator()
      for (const event of textEvents(0, "hel")) chunks.event(event)
      expect(() => chunks.complete(completion(captured([text("hello")], "end_turn")))).toThrowError(
        expect.objectContaining({ code: FailureCode.nativeProtocol }),
      )
    })

    it("fails when streamed text is missing from the final message", () => {
      const { chunks } = translator()
      for (const event of textEvents(0, "hello")) chunks.event(event)
      expect(() => chunks.complete(completion(captured([], "end_turn")))).toThrowError(
        expect.objectContaining({ code: FailureCode.nativeProtocol }),
      )
    })

    it("does not fail a healthy answer over thinking that differs, which only shows", () => {
      const { assembler } = translate(
        [...thinkingEvents(0, "streamed"), ...textEvents(1, "hello")],
        completion(captured([thinking("final"), text("hello")], "end_turn")),
      )
      expect(assembler.finish).toEqual({ kind: "stop" })
      expect(assembler.blocks()).toEqual([
        { type: "reasoning", text: "streamed" },
        { type: "text", text: "hello" },
      ])
    })

    it("uses the final arguments, not the streamed spelling", () => {
      const { assembler } = translate(
        toolEvents(0, "t1", "mcp__dsh__probe", '{ "a" : 1 }'),
        completion(captured([toolUse("t1", "mcp__dsh__probe", { a: 1 })], "tool_use")),
      )
      expect(assembler.blocks()).toEqual([
        { type: "tool-call", id: "t1", name: "probe", arguments: '{"a":1}' },
      ])
    })
  })

  describe("blocks it does not show", () => {
    const redacted: NativeBlock = { type: "redacted_thinking", data: "opaque" }

    it("ignores redacted thinking for display and keeps it in the carrier", () => {
      const { assembler, output } = translate(
        [start(0, redacted), stop(0), ...textEvents(1, "hello")],
        completion(captured([redacted, text("hello")], "end_turn")),
      )
      expect(assembler.blocks()).toEqual([{ type: "text", text: "hello" }])
      expect(carrierOf(output).messages[0]?.content).toEqual([redacted, text("hello")])
    })

    it("ignores unknown blocks and their deltas", () => {
      const { assembler } = translate(
        [
          start(0, { type: "server_tool_use", id: "s1" }),
          delta(0, { type: "input_json_delta", partial_json: "{}" }),
          stop(0),
          ...textEvents(1, "hello"),
        ],
        completion(captured([{ type: "server_tool_use", id: "s1" }, text("hello")], "end_turn")),
      )
      expect(assembler.blocks()).toEqual([{ type: "text", text: "hello" }])
    })

    it("adds no block for thinking with no display text", () => {
      const { assembler } = translate(
        [...thinkingEvents(0), ...textEvents(1, "hello")],
        completion(captured([thinking(""), text("hello")], "end_turn")),
      )
      expect(assembler.blocks()).toEqual([{ type: "text", text: "hello" }])
    })

    it("ignores events that hold no block", () => {
      const { chunks } = translator()
      expect(chunks.event({ type: "message_start", message: {} })).toEqual([])
      expect(chunks.event({ type: "ping" })).toEqual([])
      expect(chunks.event({ type: "message_stop" })).toEqual([])
    })
  })

  describe("a malformed stream", () => {
    const failure = expect.objectContaining({ code: FailureCode.nativeProtocol })

    it("refuses a delta for a block that never started", () => {
      const { chunks } = translator()
      expect(() => chunks.event(delta(4, { type: "text_delta", text: "x" }))).toThrowError(failure)
    })

    it("refuses a block index used twice", () => {
      const { chunks } = translator()
      chunks.event(start(0, text("")))
      expect(() => chunks.event(start(0, text("")))).toThrowError(failure)
    })

    it("refuses a delta of the wrong kind", () => {
      const { chunks } = translator()
      chunks.event(start(0, text("")))
      expect(() => chunks.event(delta(0, { type: "thinking_delta", thinking: "x" }))).toThrowError(
        failure,
      )
    })

    it("refuses a tool_use with no id", () => {
      const { chunks } = translator()
      expect(() => chunks.event(start(0, { type: "tool_use", name: "probe" }))).toThrowError(
        failure,
      )
    })

    it("refuses a final tool_use with no name", () => {
      const { chunks } = translator()
      expect(() =>
        chunks.complete(completion(captured([{ type: "tool_use", id: "t1" }], "tool_use"))),
      ).toThrowError(failure)
    })

    it("refuses a final block list whose kinds differ from the stream", () => {
      const { chunks } = translator()
      for (const event of thinkingEvents(0, "x")) chunks.event(event)
      expect(() => chunks.complete(completion(captured([text("x")], "end_turn")))).toThrowError(
        failure,
      )
    })
  })

  describe("usage", () => {
    it("reports disjoint counts and their sum", () => {
      const { output } = translate(
        textEvents(0, "hello"),
        completion(
          captured([text("hello")], "end_turn", {
            usage: {
              input_tokens: 3,
              output_tokens: 5,
              cache_read_input_tokens: 11,
              cache_creation_input_tokens: 7,
              output_tokens_details: { thinking_tokens: 4 },
            },
          }),
        ),
      )
      expect(output.at(-2)).toEqual({
        type: "usage",
        usage: {
          inputTokens: 3,
          outputTokens: 5,
          cacheReadTokens: 11,
          cacheWriteTokens: 7,
          reasoningTokens: 4,
          totalTokens: 26,
        },
      })
    })

    it("leaves out what the provider did not report", () => {
      const { output } = translate(
        textEvents(0, "hello"),
        completion(captured([text("hello")], "end_turn")),
      )
      expect(output.at(-2)).toEqual({
        type: "usage",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      })
    })

    it("is reported on a refusal too", () => {
      const { output } = translate([], completion(captured([], "refusal")))
      expect(output.at(-2)?.type).toBe("usage")
    })
  })

  describe("replay state", () => {
    const message = captured([thinking("hm"), text("hello")], "end_turn")
    const events = [...thinkingEvents(0, "hm"), ...textEvents(1, "hello")]

    it("holds the carrier, with no per-block entries", () => {
      const { output } = translate(events, completion(message))
      const { replayState } = finishOf(output)
      expect(replayState).toEqual({
        response: {
          kind: "claude-subscription",
          version: 1,
          messages: [message],
          projection: PROJECTION,
        },
      })
      expect(replayState).not.toHaveProperty("blocks")
    })

    it("projects exactly the blocks the assembler stores", () => {
      const { assembler, projectionOf } = translate(
        [...events, ...toolEvents(2, "t1", "mcp__dsh__probe", "{}")],
        completion(
          captured([thinking("hm"), text("hello"), toolUse("t1", "mcp__dsh__probe")], "tool_use"),
        ),
      )
      expect(projectionOf).toHaveBeenCalledWith(assembler.blocks())
    })

    it("survives the assembler unchanged", () => {
      const { assembler, output } = translate(events, completion(message))
      expect(assembler.replayState).toEqual(finishOf(output).replayState)
    })
  })
})

describe("failureChunk", () => {
  it("makes a terminal error from a failure", () => {
    const failure = new NativeFailure("Too many", FailureCode.rateLimit, { status: 429 })
    expect(failureChunk(failure, undefined)).toEqual({
      type: "finish",
      reason: { kind: "error", failure: failure.failure },
    })
  })

  it("makes an aborted finish from an aborted failure", () => {
    const failure = new NativeFailure("Cancelled", FailureCode.aborted)
    expect(failureChunk(failure, undefined).reason.kind).toBe("aborted")
  })

  it("makes an aborted finish when the signal fired, whatever the failure says", () => {
    const failure = new NativeFailure("Pipe broke", FailureCode.transport)
    expect(failureChunk(failure, AbortSignal.abort()).reason.kind).toBe("aborted")
  })

  it("stops a partial tool call from ever running", () => {
    const { chunks } = translator()
    const assembler = new BlockAssembler()
    const failure = new NativeFailure("Pipe broke", FailureCode.transport)
    for (const chunk of [
      ...toolEvents(0, "t1", "mcp__dsh__probe", '{"a":').flatMap((event) => chunks.event(event)),
      failureChunk(failure, undefined),
    ]) {
      assembler.push(chunk)
    }
    expect(assembler.finish.kind).toBe("error")
    expect(assembler.interruptedBlocks()).toEqual([])
  })
})
