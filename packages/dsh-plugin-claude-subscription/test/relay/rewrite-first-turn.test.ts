import { describe, expect, it } from "vitest"
import type { NativeBlock } from "../../src/contract"
import { pinMessageBreakpoint } from "../../src/relay/rewrite"
import { bodyOf, canonical, clone, type Json, messagesOf, wire } from "../support/rewrite-payloads"

const MARKER = { type: "ephemeral", ttl: "1h" }
const REMINDER: NativeBlock = {
  type: "text",
  text:
    "<system-reminder>\nAs you answer the user's questions, you can use the following context:\n" +
    "# userEmail\nThe user's email address is a@example.invalid.\n</system-reminder>\n",
}
const FRAME: NativeBlock = {
  type: "text",
  text: `Use the terminal tool to run \`echo alpha\`.${" source pack".repeat(200)}`,
}
const ENV = "Primary working directory: /tmp/claude-directsdk-cwd-501\nPlatform: darwin"

/** Native's opening request: reminder ahead of the frame, marker on the env/date message. */
function call1(): Json[] {
  return [
    { role: "user", content: [REMINDER, FRAME] },
    {
      role: "system",
      content: [
        { type: "text", text: `${ENV}\n\nToday's date is 2026-09-30.`, cache_control: MARKER },
      ],
    },
  ]
}

/** Native's second request: the first turn replayed bare, one tool round, the date after it. */
function call2(): Json[] {
  return [
    { role: "user", content: [FRAME] },
    { role: "system", content: ENV },
    {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "t1",
          name: "mcp__dsh__terminal",
          input: { command: "echo alpha" },
        },
      ],
    },
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t1", content: `alpha\n\n${REMINDER.text}` }],
    },
    {
      role: "system",
      content: [{ type: "text", text: "Today's date is 2026-09-30.", cache_control: MARKER }],
    },
  ]
}

function blocksOf(content: unknown): Json[] {
  return typeof content === "string" ? [{ type: "text", text: content }] : (content as Json[])
}

function withoutMark(block: Json): Json {
  const { cache_control: _mark, ...rest } = block
  return rest
}

/** What the API caches for this request: every message block up to and including the marker. */
function cachedPrefix(payload: Buffer): [string, string][] | null {
  const prefix: [string, string][] = []
  for (const message of messagesOf(payload)) {
    for (const block of blocksOf(message.content)) {
      prefix.push([message.role as string, canonical(withoutMark(block))])
      if ("cache_control" in block) return prefix
    }
  }
  return null
}

function replayed(payload: Buffer): [string, string][] {
  return messagesOf(payload).flatMap((message) =>
    blocksOf(message.content).map((block): [string, string] => [
      message.role as string,
      canonical(withoutMark(block)),
    ]),
  )
}

function markCount(messages: Json[]): number {
  return messages
    .filter((message) => Array.isArray(message.content))
    .flatMap((message) => message.content as Json[])
    .filter((block) => "cache_control" in block).length
}

describe("the opening request", () => {
  it("caches a prefix the second request replays", () => {
    const first = pinMessageBreakpoint(wire(call1()), [FRAME])
    const second = pinMessageBreakpoint(wire(call2()), [
      { type: "tool_result", tool_use_id: "t1", content: "alpha" },
    ])

    const prefix = cachedPrefix(first)
    expect(prefix).not.toBeNull()
    expect(replayed(second).slice(0, prefix?.length)).toEqual(prefix)
    expect(prefix?.at(-1)).toEqual(["user", canonical(FRAME)])
  })

  it("is sent as later requests replay it, with one marker", () => {
    const out = messagesOf(pinMessageBreakpoint(wire(call1()), [FRAME]))
    expect(out[0]?.content).toEqual([{ ...FRAME, cache_control: MARKER }])
    expect(markCount(out)).toBe(1)
    expect(String(blocksOf(out[1]?.content)[0]?.text).startsWith(ENV)).toBe(true)
  })

  it.each([
    [
      "a later turn: there is history",
      [...call2().slice(0, 3), { role: "user", content: [REMINDER, FRAME] }],
    ],
    ["the frame occurs twice", [{ role: "user", content: [REMINDER, FRAME, FRAME] }]],
    [
      "something other than text stands ahead of the frame",
      [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: "AA==" } },
            FRAME,
          ],
        },
      ],
    ],
    [
      "the frame is not in the turn at all",
      [{ role: "user", content: [REMINDER, { type: "text", text: "rewritten" }] }],
    ],
  ])("changes the first turn only when the frame is unambiguous: %s", (_name, original) => {
    const messages = clone(original)
    const turn = messages[messages.length - 1]?.content as Json[]
    turn[turn.length - 1] = { ...(turn[turn.length - 1] as Json), cache_control: MARKER }
    const raw = wire(messages)

    const out = bodyOf(pinMessageBreakpoint(raw, [FRAME])).messages as Json[]

    const strip = (content: unknown) =>
      Array.isArray(content) ? content.map((block) => withoutMark(block as Json)) : content
    const sent = bodyOf(raw).messages as Json[]
    out.forEach((message, index) => {
      expect(strip(message.content)).toEqual(strip(sent[index]?.content))
    })
  })
})
