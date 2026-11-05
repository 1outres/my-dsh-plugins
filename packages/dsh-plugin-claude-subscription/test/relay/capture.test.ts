import { describe, expect, it } from "vitest"
import type { JsonObject } from "../../src/contract"
import { CaptureError, SseCapture } from "../../src/relay/capture"

function sse(...events: JsonObject[]): Buffer {
  return Buffer.from(events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join(""))
}

const START = {
  type: "message_start",
  message: {
    id: "m",
    role: "assistant",
    content: [],
    stop_reason: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  },
}

function textBlock(index: number, ...deltas: string[]): JsonObject[] {
  return [
    { type: "content_block_start", index, content_block: { type: "text", text: "" } },
    ...deltas.map((text) => ({
      type: "content_block_delta",
      index,
      delta: { type: "text_delta", text },
    })),
    { type: "content_block_stop", index },
  ]
}

function toolBlock(index: number, ...parts: string[]): JsonObject[] {
  return [
    {
      type: "content_block_start",
      index,
      content_block: { type: "tool_use", id: "t", name: "w", input: {} },
    },
    ...parts.map((partial_json) => ({
      type: "content_block_delta",
      index,
      delta: { type: "input_json_delta", partial_json },
    })),
    { type: "content_block_stop", index },
  ]
}

function ending(stop_reason: string, usage: JsonObject = { output_tokens: 9 }): JsonObject[] {
  return [{ type: "message_delta", delta: { stop_reason }, usage }, { type: "message_stop" }]
}

function capture(...events: JsonObject[]): SseCapture {
  const result = new SseCapture()
  result.feed(sse(...events))
  return result
}

describe("SseCapture", () => {
  it("drops a tool call cut off mid-argument and still captures the stream", () => {
    const result = capture(
      START,
      ...textBlock(0, "Writing it."),
      ...toolBlock(1, '{"path": "a.md", "content": "trunc'),
      ...ending("max_tokens"),
    )
    expect(result.complete).toBe(true)
    expect(result.message?.content).toEqual([{ type: "text", text: "Writing it." }])
    expect(result.message?.stop_reason).toBe("max_tokens")
  })

  it("assembles text, thinking, signature, tool input and citations", () => {
    const result = capture(
      START,
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hm" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "m" } },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "signature_delta", signature: "si" },
      },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "g" } },
      { type: "content_block_stop", index: 0 },
      ...textBlock(1, "Hel", "lo"),
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "citations_delta", citation: { cited_text: "a" } },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "citations_delta", citation: { cited_text: "b" } },
      },
      ...toolBlock(2, '{"path"', ': "a.md"}'),
      ...ending("tool_use"),
    )
    expect(result.complete).toBe(true)
    expect(result.message?.content).toEqual([
      { type: "thinking", thinking: "hmm", signature: "sig" },
      { type: "text", text: "Hello", citations: [{ cited_text: "a" }, { cited_text: "b" }] },
      { type: "tool_use", id: "t", name: "w", input: { path: "a.md" } },
    ])
  })

  it.each([
    ["an empty partial_json", [""]],
    ["only blank partial_json", ["  ", "\n"]],
    ["only C0 separators and NEL", ["\x1c\x1d\x1e\x1f\x85"]],
    ["only wide spaces", ["  　"]],
  ])("treats a tool call with %s as no arguments", (_name, parts) => {
    const result = capture(START, ...toolBlock(0, ...parts), ...ending("tool_use"))
    expect(result.message?.content).toEqual([{ type: "tool_use", id: "t", name: "w", input: {} }])
  })

  it("stores a tool input of negative zero as zero, which DSH can keep", () => {
    const result = capture(START, ...toolBlock(0, '{"a": -0, "b": [-0.0]}'), ...ending("tool_use"))
    const [block] = result.message?.content ?? []
    const input = block?.input as { a: number; b: number[] }
    expect(Object.is(input.a, 0)).toBe(true)
    expect(Object.is(input.b[0], 0)).toBe(true)
  })

  it.each([
    ["a number past the double range", '{"a": 1e400}'],
    ["a nested number past the double range", '{"a": {"b": [-1e999]}}'],
  ])("treats a tool input with %s as cut off", (_name, input) => {
    const result = capture(
      START,
      ...textBlock(0, "Writing it."),
      ...toolBlock(1, input),
      ...ending("tool_use"),
    )
    expect(result.complete).toBe(true)
    expect(result.message?.content).toEqual([{ type: "text", text: "Writing it." }])
  })

  it("does not treat a byte order mark as blank", () => {
    const result = capture(START, ...toolBlock(0, "﻿"), ...ending("tool_use"))
    expect(result.message?.content).toEqual([])
  })

  it("keeps the other calls when one of several tool calls is cut off", () => {
    const result = capture(
      START,
      ...toolBlock(0, '{"a": 1}'),
      ...toolBlock(1, '{"b": '),
      ...toolBlock(2, '{"c": 3}'),
      ...ending("max_tokens"),
    )
    expect(result.message?.content).toEqual([
      { type: "tool_use", id: "t", name: "w", input: { a: 1 } },
      { type: "tool_use", id: "t", name: "w", input: { c: 3 } },
    ])
  })

  it("is not complete before message_stop, or without a stop reason, or with an open tool input", () => {
    expect(capture(START, ...textBlock(0, "x"), ending("end_turn")[0] as JsonObject).complete).toBe(
      false,
    )
    expect(capture(START, ...textBlock(0, "x"), { type: "message_stop" }).complete).toBe(false)
    const open = capture(
      START,
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "t", name: "w", input: {} },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"a"' },
      },
      ...ending("tool_use"),
    )
    expect(open.complete).toBe(false)
  })

  describe("an error event", () => {
    const OVERLOADED = {
      type: "error",
      error: { type: "overloaded_error", message: "Overloaded" },
    }

    it("is kept with its type and message, and the stream is not complete", () => {
      const result = capture(START, ...textBlock(0, "Part"), OVERLOADED)
      expect(result.error).toEqual({ type: "overloaded_error", message: "Overloaded" })
      expect(result.complete).toBe(false)
      expect(result.message?.content).toEqual([{ type: "text", text: "Part" }])
    })

    it("can come before any message", () => {
      expect(capture(OVERLOADED).error).toEqual({
        type: "overloaded_error",
        message: "Overloaded",
      })
    })

    it("keeps the first one", () => {
      const result = capture(OVERLOADED, {
        type: "error",
        error: { type: "api_error", message: "Later" },
      })
      expect(result.error?.type).toBe("overloaded_error")
    })

    it("is null for a healthy stream, and does not undo a complete answer", () => {
      expect(capture(START, ...textBlock(0, "x"), ...ending("end_turn")).error).toBeNull()
      const after = capture(START, ...textBlock(0, "x"), ...ending("end_turn"), OVERLOADED)
      expect(after.complete).toBe(true)
    })

    it.each([
      ["no error object", { type: "error" }],
      ["an error that is text", { type: "error", error: "Overloaded" }],
      ["an error with no type", { type: "error", error: { message: "x" } }],
      ["an error with no message", { type: "error", error: { type: "api_error" } }],
    ])("raises a CaptureError for %s", (_name, event) => {
      expect(() => capture(event)).toThrow(CaptureError)
    })
  })

  it("starts with no message", () => {
    const result = new SseCapture()
    expect(result.message).toBeNull()
    expect(result.complete).toBe(false)
    expect(result.error).toBeNull()
  })

  it("merges the usage of message_delta over the usage of message_start", () => {
    const result = capture(
      {
        ...START,
        message: {
          ...START.message,
          usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 3 },
        },
      },
      ...textBlock(0, "x"),
      ...ending("end_turn", { output_tokens: 42, output_tokens_details: { thinking_tokens: 7 } }),
    )
    expect(result.message?.usage).toEqual({
      input_tokens: 5,
      output_tokens: 42,
      cache_read_input_tokens: 3,
      output_tokens_details: { thinking_tokens: 7 },
    })
  })

  it("copies the fields of message_delta onto the message", () => {
    const result = capture(
      START,
      { type: "message_delta", delta: { stop_reason: "refusal", stop_details: { category: "x" } } },
      { type: "message_stop" },
    )
    expect(result.message?.stop_reason).toBe("refusal")
    expect(result.message?.stop_details).toEqual({ category: "x" })
    expect(result.message?.usage).toEqual({ input_tokens: 1, output_tokens: 1 })
  })

  it("never lets a field name from the stream change the message prototype", () => {
    const result = new SseCapture()
    result.feed(
      Buffer.from(
        `data: ${JSON.stringify(START)}\n\n` +
          'data: {"type":"message_delta","delta":{"__proto__":{"polluted":true},"stop_reason":"end_turn"}}\n\n' +
          'data: {"type":"message_stop"}\n\n',
      ),
    )
    expect(result.complete).toBe(true)
    expect(Object.getPrototypeOf(result.message)).toBe(Object.prototype)
    expect(({} as JsonObject).polluted).toBeUndefined()
  })

  it("ignores events it does not know", () => {
    const result = capture(
      START,
      { type: "ping" },
      { type: "something_new", x: 1 },
      ...ending("end_turn"),
    )
    expect(result.complete).toBe(true)
  })

  it("keeps blocks of unknown type and unknown delta types", () => {
    const result = capture(
      START,
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "redacted_thinking", data: "abc" },
      },
      { type: "content_block_delta", index: 0, delta: { type: "future_delta", x: 1 } },
      { type: "content_block_stop", index: 0 },
      ...ending("end_turn"),
    )
    expect(result.message?.content).toEqual([{ type: "redacted_thinking", data: "abc" }])
  })

  describe("framing", () => {
    const stream = Buffer.from(
      [START, ...textBlock(0, "Héllo 😀"), ...ending("end_turn")]
        .map((e) => `event: x\r\ndata: ${JSON.stringify(e)}\r\n\r\n`)
        .join(""),
    )

    it("reads a CRLF stream split at every byte, including inside a multi-byte character", () => {
      const result = new SseCapture()
      for (const byte of stream) result.feed(Uint8Array.of(byte))
      expect(result.complete).toBe(true)
      expect(result.message?.content).toEqual([{ type: "text", text: "Héllo 😀" }])
    })

    it("keeps an incomplete frame until the rest arrives", () => {
      const result = new SseCapture()
      const cut = stream.indexOf("message_stop") - 10
      result.feed(stream.subarray(0, cut))
      expect(result.complete).toBe(false)
      result.feed(stream.subarray(cut))
      expect(result.complete).toBe(true)
    })

    it("joins several data lines of one frame with a newline and strips leading spaces", () => {
      const result = new SseCapture()
      result.feed(
        Buffer.from(
          'event: message_start\ndata:   {"type":"message_start",\ndata: "message":' +
            `${JSON.stringify(START.message)}}\n\n`,
        ),
      )
      expect(result.message?.id).toBe("m")
    })

    it("ignores frames and lines that carry no data", () => {
      const result = new SseCapture()
      result.feed(Buffer.from(": comment\n\nevent: ping\n\ndata:\n\nid: 7\nretry: 1\n\n"))
      expect(result.message).toBeNull()
    })

    it("does not split a line at a Unicode line separator inside the data", () => {
      const text = "a b c\u0085d\fe\vf"
      const result = new SseCapture()
      result.feed(Buffer.from(sse(START, ...textBlock(0, text), ...ending("end_turn"))))
      expect(result.message?.content).toEqual([{ type: "text", text }])
    })
  })

  describe("a stream it cannot follow", () => {
    function feeding(...frames: string[]): () => void {
      return () => new SseCapture().feed(Buffer.from(frames.map((f) => `${f}\n\n`).join("")))
    }
    const start = `data: ${JSON.stringify(START)}`

    it.each([
      ["invalid JSON", feeding("data: {nope")],
      ["JSON that is not an object", feeding("data: [1]")],
      ["an event without a type", feeding('data: {"x":1}')],
      [
        "a block before message_start",
        feeding('data: {"type":"content_block_start","content_block":{"type":"text"}}'),
      ],
      ["a message_start without a message", feeding('data: {"type":"message_start"}')],
      [
        "a message_start with a message that has no usage",
        feeding('data: {"type":"message_start","message":{"role":"assistant","content":[]}}'),
      ],
      [
        "a delta for a block that does not exist",
        feeding(
          start,
          'data: {"type":"content_block_delta","index":3,"delta":{"type":"text_delta","text":"x"}}',
        ),
      ],
      [
        "a text delta without text",
        feeding(
          start,
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta"}}',
        ),
      ],
      [
        "a block start that is not an object",
        feeding(start, 'data: {"type":"content_block_start","index":0,"content_block":"x"}'),
      ],
      [
        "a message_delta whose delta is not an object",
        feeding(start, 'data: {"type":"message_delta","delta":3}'),
      ],
    ])("raises a CaptureError for %s", (_name, run) => {
      expect(run).toThrow(CaptureError)
    })

    it("raises a CaptureError for bytes that are not UTF-8", () => {
      expect(() => new SseCapture().feed(Uint8Array.of(0xff, 0xfe))).toThrow(CaptureError)
    })

    it("names its errors so a relay can record them", () => {
      expect(feeding("data: {nope")).toThrow(expect.objectContaining({ name: "CaptureError" }))
    })
  })
})
