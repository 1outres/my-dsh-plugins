import { describe, expect, it } from "vitest"
import { streamToolInput } from "../../src/relay/rewrite"
import { bodyOf } from "../support/rewrite-payloads"

const TOOLS = [
  { name: "mcp__dsh__write_file", input_schema: { type: "object" } },
  { name: "mcp__dsh__read_file", input_schema: { type: "object" }, eager_input_streaming: false },
]

describe("streamToolInput", () => {
  it("asks for streamed arguments on every tool and keeps values native already set", () => {
    const raw = Buffer.from(JSON.stringify({ model: "m", tools: TOOLS, messages: [] }))
    const out = bodyOf(streamToolInput(raw))
    expect(out.tools).toEqual([{ ...TOOLS[0], eager_input_streaming: true }, TOOLS[1]])
  })

  it.each([
    ["no tools", Buffer.from(JSON.stringify({ model: "m", messages: [] }))],
    ["not json", Buffer.from("not json")],
    [
      "every tool already set",
      Buffer.from(JSON.stringify({ model: "m", tools: [{ ...TOOLS[1] }], messages: [] })),
    ],
  ])("forwards the same bytes when there is nothing to change: %s", (_name, raw) => {
    expect(streamToolInput(raw)).toBe(raw)
  })

  it.each([
    ["tools is not a list", { model: "m", tools: { name: "x" }, messages: [] }],
    ["a tool is not an object", { model: "m", tools: ["x", 1, null], messages: [] }],
  ])("forwards the same bytes when the shape is unexpected: %s", (_name, body) => {
    const raw = Buffer.from(JSON.stringify(body))
    expect(streamToolInput(raw)).toBe(raw)
  })

  it("forwards the same bytes when the body is not an object", () => {
    const raw = Buffer.from("[]")
    expect(streamToolInput(raw)).toBe(raw)
  })
})
