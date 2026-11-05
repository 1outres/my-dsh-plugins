import { describe, expect, it } from "vitest"
import type { NativeBlock } from "../../src/contract"
import { stableRequestContext } from "../../src/relay/rewrite"
import { clone, type Json, messagesOf, wire } from "../support/rewrite-payloads"
import { rewriteAsRelay } from "../support/rewrite-pipeline"

const ENV = "Fixture environment"
const DATE = "Today's date is 2031-01-01."
const FRAME: NativeBlock = { type: "text", text: "Next user question" }
const REMINDER: NativeBlock = { type: "text", text: "Native context reminder" }
const MARK = { type: "ephemeral", ttl: "1h" }
const OTHER = { type: "ephemeral", ttl: "5m" }
const ASSISTANT = {
  role: "assistant",
  content: [
    { type: "thinking", thinking: "Fixture reasoning", signature: "fixture-signature" },
    { type: "text", text: "Previous answer" },
  ],
}

function text(value: string, extra: Json = {}): NativeBlock {
  return { type: "text", text: value, ...extra }
}

function native(env: unknown = ENV, tail: unknown = DATE): Json[] {
  return clone([
    { role: "system", content: env },
    ASSISTANT,
    { role: "user", content: [REMINDER, FRAME] },
    { role: "system", content: tail },
  ])
}

function stable(messages: unknown[], queried: NativeBlock[] = [FRAME]): Json[] {
  return messagesOf(stableRequestContext(wire(messages), queried))
}

function lastOf<T>(items: T[]): T {
  return items[items.length - 1] as T
}

describe("stableRequestContext", () => {
  it.each([
    ["a string environment", ENV],
    ["a list environment", [text("Earlier"), text(ENV)]],
  ])("returns the date line to the environment message: %s", (_name, env) => {
    for (const tail of [DATE, [text(DATE)]]) {
      const out = stable(native(env, tail))
      expect(out).toHaveLength(3)
      if (Array.isArray(env)) {
        expect(out[0]?.content).toEqual([env[0], text(`${ENV}\n\n${DATE}`)])
      } else {
        expect(out[0]?.content).toBe(`${ENV}\n\n${DATE}`)
      }
      expect(out[1]).toEqual(ASSISTANT)
      expect(out[2]?.content).toEqual([FRAME])
    }
  })

  it.each(["Today's date is 2031-01-01. Now 09:30.", "Per-request note", "Today's date is soon."])(
    "keeps trailing text that is not the date line in place: %s",
    (tail) => {
      const out = stable(native(ENV, tail))
      expect(out[0]?.content).toBe(ENV)
      expect(lastOf(out)).toEqual({ role: "system", content: tail })
      expect(out.at(-2)?.content).toEqual([FRAME])
    },
  )

  it.each([`${ENV}${DATE}`, `${ENV}\n${DATE}`])(
    "does not give the date twice to an environment that already ends with it: %j",
    (env) => {
      const out = stable(native(env))
      expect(out[0]?.content).toBe(env)
      expect(lastOf(out)).toEqual({ role: "system", content: DATE })
    },
  )

  it("still drops a reminder that equals the start of the frame", () => {
    const messages = native().slice(0, -1)
    lastOf(messages).content = [REMINDER, REMINDER, FRAME]
    const out = stable(messages, [REMINDER, FRAME])
    expect(lastOf(out).content).toEqual([REMINDER, FRAME])
  })

  it.each([
    [
      [text("ab"), text("a")],
      [text("a"), text("ba")],
    ],
    [[FRAME, FRAME], [FRAME]],
  ])(
    "leaves the turn as native built it when the frame is not found exactly once",
    (blocks, queried) => {
      const messages = native().slice(0, -1)
      lastOf(messages).content = blocks
      expect(stableRequestContext(wire(messages), queried)).toEqual(wire(messages))
    },
  )

  it.each([false, true])(
    "moves removed marks with setdefault and never multiplies them (frame has its own: %s)",
    (existing) => {
      const messages = native(ENV, [text(DATE, { cache_control: MARK })])
      const turn = messages[2]?.content as NativeBlock[]
      turn[0] = { ...(turn[0] as NativeBlock), cache_control: MARK }
      if (existing) turn[1] = { ...(turn[1] as NativeBlock), cache_control: OTHER }
      const out = stable(messages)
      expect(lastOf(out).content).toEqual([{ ...FRAME, cache_control: existing ? OTHER : MARK }])
      const marks = out.flatMap((message) =>
        Array.isArray(message.content)
          ? (message.content as Json[]).filter((block) => "cache_control" in block)
          : [],
      )
      expect(marks).toHaveLength(1)
    },
  )

  it("moves a message-level mark of a string date line onto the previous block", () => {
    const messages = native()
    lastOf(messages).cache_control = MARK
    const out = stable(messages)
    expect(out).toHaveLength(3)
    expect(lastOf(out).content).toEqual([{ ...FRAME, cache_control: MARK }])
  })

  it("does not move a null mark", () => {
    const messages = native().slice(0, -1)
    lastOf(messages).content = [{ ...REMINDER, cache_control: null }, FRAME]
    const out = stable(messages)
    expect(lastOf(out).content).toEqual([FRAME])
  })

  it("moves the reminder's marker onto the frame and keeps the suffix", () => {
    const messages = native().slice(0, -1)
    lastOf(messages).content = [{ ...REMINDER, cache_control: MARK }, REMINDER, FRAME, REMINDER]
    const out = stable(messages)
    expect(lastOf(out).content).toEqual([{ ...FRAME, cache_control: MARK }, REMINDER])
  })

  it.each(["tool_result", "opening", "protected", "missing", "already_stable", "multiple_tail"])(
    "returns the same bytes for an ineligible context: %s",
    (shape) => {
      const messages = native().slice(0, -1)
      let queried: NativeBlock[] = [FRAME]
      if (shape === "tool_result") {
        queried = [{ type: "tool_result", tool_use_id: "fixture-tool", content: "output" }]
        lastOf(messages).content = queried
      } else if (shape === "opening") {
        messages.splice(1, 1)
      } else if (shape === "protected") {
        ;((lastOf(messages).content as Json[])[0] as Json).citations = []
      } else if (shape === "missing") {
        queried = [text("Absent frame")]
      } else if (shape === "already_stable") {
        ;(messages[0] as Json).content = `${ENV}\n\n${DATE}`
        lastOf(messages).content = [FRAME]
        messages.push({ role: "system", content: DATE })
      } else {
        lastOf(messages).content = [FRAME]
        messages.push({ role: "system", content: [REMINDER, text(DATE)] })
      }
      const payload = wire(messages)
      expect(stableRequestContext(payload, queried)).toBe(payload)
    },
  )

  it.each([
    ["not json", Buffer.from("not json")],
    ["bytes that are not UTF-8", Buffer.from([0xff])],
    ["an empty object", Buffer.from("{}")],
    ["null", Buffer.from("null")],
    ["a message that is null", Buffer.from('{"messages":[null]}')],
    [
      "a text block without text",
      wire([
        { role: "system", content: ENV },
        { role: "system", content: [{ type: "text", text: 42 }] },
      ]),
    ],
  ])("returns the same bytes for an unexpected payload: %s", (_name, payload) => {
    expect(stableRequestContext(payload, [FRAME])).toBe(payload)
  })

  it.each([
    ["an unknown role", [{ role: "tool", content: "x" }]],
    ["content that is neither text nor a list", [{ role: "user", content: 7 }]],
    ["a block without a type", [{ role: "user", content: [{ text: "x" }] }]],
    ["a block that is not an object", [{ role: "user", content: ["x"] }]],
  ])("returns the same bytes for a message with %s", (_name, messages) => {
    const payload = wire([...native(), ...messages])
    expect(stableRequestContext(payload, [FRAME])).toBe(payload)
  })

  it("is idempotent", () => {
    const once = stableRequestContext(wire(native()), [FRAME])
    expect(stableRequestContext(once, [FRAME])).toBe(once)
  })

  it("works with no queried frame, moving only the date line", () => {
    const out = messagesOf(stableRequestContext(wire(native()), []))
    expect(out).toHaveLength(3)
    expect(out[0]?.content).toBe(`${ENV}\n\n${DATE}`)
    expect(lastOf(out).content).toEqual([REMINDER, FRAME])
  })
})

describe("consecutive per-call requests", () => {
  it("share a byte-identical prompt prefix", () => {
    const first = messagesOf(rewriteAsRelay(wire(native()), [FRAME]).payload)
    const nextFrame = text("Follow-up question")
    const messages = [
      ...native().slice(0, 2),
      { role: "user", content: [FRAME] },
      clone(ASSISTANT),
      { role: "user", content: [REMINDER, nextFrame] },
      { role: "system", content: DATE },
    ]
    const second = messagesOf(rewriteAsRelay(wire(messages), [nextFrame]).payload)

    expect(first).toHaveLength(3)
    expect(lastOf(first).content).toEqual([FRAME])
    expect(JSON.stringify(second.slice(0, first.length))).toBe(JSON.stringify(first))
    expect(second[first.length]).toEqual(ASSISTANT)
    expect(lastOf(second).content).toEqual([nextFrame])
  })
})
