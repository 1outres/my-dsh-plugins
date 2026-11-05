import { describe, expect, it } from "vitest"
import type { NativeFrame } from "../../src/contract"
import { conversationSessionId } from "../../src/request/session-id"

function userFrame(text: string): NativeFrame {
  return { type: "user", message: { role: "user", content: [{ type: "text", text }] } }
}

const toolRound: NativeFrame[] = [
  {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: "c1", name: "mcp__dsh__probe", input: {} }],
    },
  },
  {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "c1", content: "result" }],
    },
  },
]

describe("conversationSessionId", () => {
  it("keeps one id for every request of one conversation", () => {
    const opening = [userFrame("go")]
    const later = [userFrame("go"), ...toolRound]
    expect(conversationSessionId("s", later)).toBe(conversationSessionId("s", opening))
  })

  it("gives different conversations different ids", () => {
    expect(conversationSessionId("s", [userFrame("go")])).not.toBe(
      conversationSessionId("s", [userFrame("something else")]),
    )
    expect(conversationSessionId("one", [userFrame("go")])).not.toBe(
      conversationSessionId("two", [userFrame("go")]),
    )
  })

  it("returns a version 4 UUID", () => {
    expect(conversationSessionId("s", [userFrame("go")])).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it("does not depend on the order of keys inside the first frame", () => {
    const reordered: NativeFrame = {
      type: "user",
      message: { content: [{ text: "go", type: "text" }], role: "user" },
    }
    expect(conversationSessionId("s", [reordered])).toBe(
      conversationSessionId("s", [userFrame("go")]),
    )
  })

  it("accepts a request without frames", () => {
    expect(conversationSessionId("s", [])).toMatch(/^[0-9a-f-]{36}$/)
  })
})
