import { describe, expect, it } from "vitest"
import { dropMessageBreakpoints } from "../../src/relay/rewrite"
import { bodyOf, type Json, messageMarks, plain } from "../support/rewrite-payloads"

const MARKER = { type: "ephemeral", ttl: "1h" }
const POLICY = [
  { type: "text", text: "You are Claude Code.", cache_control: MARKER },
  {
    type: "text",
    text: "Summarize the transcript in the next user message.",
    cache_control: MARKER,
  },
]
const TOOLS = [{ name: "mcp__dsh__probe", input_schema: { type: "object" }, cache_control: MARKER }]
const REMINDER = {
  type: "text",
  text: "<system-reminder>\n# userEmail\na@example.invalid\n</system-reminder>\n",
}
const FRAME = { type: "text", text: `<transcript>${" earlier turn".repeat(200)}</transcript>` }

function opening(extra: Json = {}): Json {
  return {
    model: "m",
    system: POLICY,
    ...extra,
    messages: [
      { role: "user", content: [REMINDER, FRAME] },
      {
        role: "system",
        content: [{ type: "text", text: "Today's date is 2026-10-16.", cache_control: MARKER }],
      },
    ],
  }
}

describe("dropMessageBreakpoints", () => {
  it("removes the message marks and keeps the system and tools marks", () => {
    const sent = opening({ tools: TOOLS })
    const out = bodyOf(dropMessageBreakpoints(Buffer.from(JSON.stringify(sent))))
    expect(messageMarks(out)).toEqual([])
    expect(out.system).toEqual(POLICY)
    expect(out.tools).toEqual(TOOLS)
    expect(plain(out.messages)).toEqual(plain(sent.messages))
  })

  it("forwards the same bytes when no message carries a mark", () => {
    const raw = Buffer.from(
      JSON.stringify({
        model: "m",
        system: POLICY,
        messages: [{ role: "user", content: [FRAME] }],
      }),
    )
    expect(dropMessageBreakpoints(raw)).toBe(raw)
  })

  it.each([
    ["not json", Buffer.from("not json")],
    ["no messages", Buffer.from(JSON.stringify({ model: "m" }))],
    ["messages that are not objects", Buffer.from(JSON.stringify({ messages: [null, 3] }))],
    ["a body that is not an object", Buffer.from("[]")],
  ])("forwards the same bytes when the payload does not parse: %s", (_name, raw) => {
    expect(dropMessageBreakpoints(raw)).toBe(raw)
  })

  it("forwards the same bytes when the only marks are null", () => {
    const raw = Buffer.from(
      JSON.stringify({
        model: "m",
        messages: [{ role: "user", content: [{ ...FRAME, cache_control: null }] }],
      }),
    )
    expect(dropMessageBreakpoints(raw)).toBe(raw)
  })

  it("removes a null mark together with a real one", () => {
    const raw = Buffer.from(
      JSON.stringify({
        model: "m",
        messages: [
          {
            role: "user",
            content: [
              { ...REMINDER, cache_control: null },
              { ...FRAME, cache_control: MARKER },
            ],
          },
        ],
      }),
    )
    const out = bodyOf(dropMessageBreakpoints(raw))
    expect((out.messages as Json[])[0]?.content).toEqual([REMINDER, FRAME])
  })

  it("leaves string content and non-object blocks alone", () => {
    const raw = Buffer.from(
      JSON.stringify({
        model: "m",
        messages: [
          { role: "user", content: "plain text" },
          { role: "user", content: ["loose", { ...FRAME, cache_control: MARKER }] },
        ],
      }),
    )
    const out = bodyOf(dropMessageBreakpoints(raw))
    expect(out.messages).toEqual([
      { role: "user", content: "plain text" },
      { role: "user", content: ["loose", FRAME] },
    ])
  })
})
