import type { ContentBlock } from "@deepseek-ai/dsh-llm"
import { describe, expect, it } from "vitest"
import { FailureCode, NativeFailure } from "../../src/errors"
import { projectionOf } from "../../src/request/replay"

const call = (id: string, name: string, args: string) =>
  ({ type: "tool-call", id, name, arguments: args }) as unknown as ContentBlock

describe("projectionOf", () => {
  it("joins the text blocks and trims the result", () => {
    const content: ContentBlock[] = [
      { type: "text", text: "  Writing." },
      { type: "text", text: " Done.\n" },
    ]
    expect(projectionOf(content)).toEqual({ content: "Writing. Done.", toolCalls: [] })
  })

  it("leaves reasoning out", () => {
    const content: ContentBlock[] = [
      { type: "reasoning", text: "private" },
      { type: "text", text: "visible" },
    ]
    expect(projectionOf(content).content).toBe("visible")
  })

  it("parses each tool call's arguments", () => {
    const content = [
      { type: "text", text: "Writing." },
      call("t1", "write_file", JSON.stringify({ path: "x", content: "a".repeat(3000) })),
      call("t2", "probe", "{}"),
    ] as ContentBlock[]
    expect(projectionOf(content).toolCalls).toEqual([
      { id: "t1", name: "write_file", input: { path: "x", content: "a".repeat(3000) } },
      { id: "t2", name: "probe", input: {} },
    ])
  })

  it("does not depend on how the arguments are spaced", () => {
    expect(projectionOf([call("t1", "probe", '{ "a": 1 }')])).toEqual(
      projectionOf([call("t1", "probe", '{"a":1}')]),
    )
  })

  it("rejects arguments that are not JSON", () => {
    expect.assertions(2)
    try {
      projectionOf([call("t1", "probe", '{"a":')])
    } catch (error) {
      expect(error).toBeInstanceOf(NativeFailure)
      expect((error as NativeFailure).code).toBe(FailureCode.invalidRequest)
    }
  })
})
