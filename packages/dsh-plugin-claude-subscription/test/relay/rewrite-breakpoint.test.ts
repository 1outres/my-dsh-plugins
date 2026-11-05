import { describe, expect, it } from "vitest"
import type { NativeBlock } from "../../src/contract"
import {
  pinMessageBreakpoint,
  QUERIED_TURN_MISMATCH,
  QueriedTurnMismatch,
  restoreQueriedTurn,
} from "../../src/relay/rewrite"
import {
  bodyOf,
  contentOf,
  type Json,
  messageMarks,
  messagesOf,
  plain,
  wire,
} from "../support/rewrite-payloads"
import { rewriteAsRelay } from "../support/rewrite-pipeline"

const MARKER = { type: "ephemeral" }
const ASSISTANT = {
  role: "assistant",
  content: [
    { type: "thinking", thinking: "signed", signature: "sig" },
    { type: "tool_use", id: "t1", name: "mcp__dsh__probe", input: {} },
  ],
}
const RESULT: NativeBlock = { type: "tool_result", tool_use_id: "t1", content: "real output" }
const QUESTION: NativeBlock = { type: "text", text: "the real question" }
const DATE: NativeBlock = { type: "text", text: "Today's date is 2026-09-23." }

function withMarker<T extends Json>(block: T): T & { cache_control: typeof MARKER } {
  return { ...block, cache_control: MARKER }
}

describe("pinMessageBreakpoint", () => {
  it.each([
    [
      "2.1.280 tool round: reminder inside the tool_result, then a separate date message",
      [RESULT],
      [
        ASSISTANT,
        {
          role: "user",
          content: [
            { ...RESULT, content: "real output\n<system-reminder>userEmail</system-reminder>" },
          ],
        },
        { role: "system", content: [withMarker(DATE)] },
      ],
      [0, 1],
    ],
    [
      "an annotation after the host content, in wording no heuristic knows",
      [QUESTION],
      [
        ASSISTANT,
        {
          role: "user",
          content: [QUESTION, withMarker({ type: "text", text: "Session context: v9 build" })],
        },
      ],
      [1, 0],
    ],
    [
      "an annotation prepended to the newest turn: nothing of that turn recurs",
      [QUESTION],
      [
        ASSISTANT,
        {
          role: "user",
          content: [{ type: "text", text: "Any new preamble" }, withMarker(QUESTION)],
        },
      ],
      [0, 1],
    ],
    [
      "tool results then the user's own text with native's reminder in that text: the results recur",
      [RESULT, QUESTION],
      [
        ASSISTANT,
        {
          role: "user",
          content: [
            RESULT,
            withMarker({
              ...QUESTION,
              text: "the real question\n<system-reminder>x</system-reminder>",
            }),
          ],
        },
      ],
      [1, 0],
    ],
    [
      "every queried block unchanged, native's date in its own message after them",
      [RESULT],
      [
        ASSISTANT,
        { role: "user", content: [RESULT] },
        { role: "system", content: [withMarker(DATE)] },
      ],
      [1, 0],
    ],
    [
      "a block native appends after unchanged tool results: the results recur",
      [RESULT],
      [
        ASSISTANT,
        {
          role: "user",
          content: [RESULT, withMarker({ type: "text", text: "Session context: v9 build" })],
        },
      ],
      [1, 0],
    ],
  ])(
    "moves the breakpoint to the last block DSH itself sent: %s",
    (_name, queried, messages, expected) => {
      const raw = wire(messages)
      const out = pinMessageBreakpoint(raw, queried as NativeBlock[])
      expect(messageMarks(bodyOf(out))).toEqual([expected])
      expect(plain(bodyOf(out))).toEqual(plain(bodyOf(raw)))
    },
  )

  it.each([2, 4])(
    "does not pin inside a partly changed user message of %i parallel results",
    (count) => {
      const results: NativeBlock[] = Array.from({ length: count }, (_, i) => ({
        type: "tool_result",
        tool_use_id: `t${i}`,
        content: `output ${i}`,
      }))
      const assistant = {
        role: "assistant",
        content: results.map((_, i) => ({
          type: "tool_use",
          id: `t${i}`,
          name: `probe_${i}`,
          input: {},
        })),
      }
      const last = results[count - 1] as NativeBlock
      const changedLast = {
        ...last,
        content: `${last.content}\n<system-reminder>native note</system-reminder>`,
      }
      const raw = wire([
        assistant,
        { role: "user", content: [...results.slice(0, -1), withMarker(changedLast)] },
      ])

      const out = pinMessageBreakpoint(raw, results)

      expect(messageMarks(bodyOf(out))).toEqual([[0, count - 1]])
      expect(plain(bodyOf(out))).toEqual(plain(bodyOf(raw)))
    },
  )

  it.each([
    [
      "the breakpoint is already stable",
      wire([ASSISTANT, { role: "user", content: [RESULT, withMarker(QUESTION)] }]),
      [RESULT, QUESTION],
    ],
    [
      "nothing of the newest turn is anchored",
      wire([{ role: "user", content: [withMarker({ type: "text", text: "Any preamble" })] }]),
      [QUESTION],
    ],
    ["the payload is not json", Buffer.from("not json"), [QUESTION]],
    [
      "no frame was queried",
      wire([ASSISTANT, { role: "user", content: [withMarker(RESULT)] }]),
      [],
    ],
  ])("returns the same bytes when %s", (_name, payload, queried) => {
    expect(pinMessageBreakpoint(payload, queried as NativeBlock[])).toBe(payload)
  })

  it.each([
    ["a body that is not an object", Buffer.from("[]")],
    ["no messages", Buffer.from('{"model":"m"}')],
    ["messages that are not objects", Buffer.from('{"messages":[1,null]}')],
  ])("returns the same bytes for %s", (_name, payload) => {
    expect(pinMessageBreakpoint(payload, [QUESTION])).toBe(payload)
  })

  describe("folding the marks that never recur", () => {
    const ONE_HOUR = { type: "ephemeral", ttl: "1h" }
    const FIVE_MINUTES = { type: "ephemeral", ttl: "5m" }
    const trailing = (mark: Json) => ({
      role: "system",
      content: [{ ...DATE, cache_control: mark }],
    })

    it("moves the earliest later mark onto the last recurring block and drops the rest", () => {
      const raw = wire([
        ASSISTANT,
        { role: "user", content: [RESULT] },
        trailing(FIVE_MINUTES),
        trailing(ONE_HOUR),
      ])
      const out = bodyOf(pinMessageBreakpoint(raw, [RESULT]))
      expect(messageMarks(out)).toEqual([[1, 0]])
      const pinned = (out.messages as Json[])[1]?.content as Json[]
      expect(pinned[0]?.cache_control).toEqual(FIVE_MINUTES)
    })

    it("keeps the mark the last recurring block already has", () => {
      const raw = wire([
        ASSISTANT,
        { role: "user", content: [{ ...RESULT, cache_control: ONE_HOUR }] },
        trailing(FIVE_MINUTES),
      ])
      const out = messagesOf(pinMessageBreakpoint(raw, [RESULT]))
      expect(out[1]?.content).toEqual([{ ...RESULT, cache_control: ONE_HOUR }])
      expect(messageMarks({ messages: out })).toEqual([[1, 0]])
    })

    it("skips thinking blocks, which the API does not cache, when it picks the block", () => {
      const thinking = { type: "thinking", thinking: "t", signature: "s" }
      const raw = wire([
        { role: "user", content: [QUESTION] },
        { role: "assistant", content: [{ type: "text", text: "answer" }, thinking] },
        { role: "system", content: [withMarker(DATE)] },
      ])
      const out = messagesOf(pinMessageBreakpoint(raw, [QUESTION]))
      expect(messageMarks({ messages: out })).toEqual([[1, 0]])
      expect(contentOf(out[1])[1]).toEqual(thinking)
    })
  })
})

describe("restoration of the queried turn", () => {
  it("does not forward native's email annotation as tool output", () => {
    const native = {
      ...RESULT,
      content: "real output\n<system-reminder>userEmail: matt@example.com</system-reminder>",
    }
    const messages = [
      ASSISTANT,
      { role: "user", content: [native] },
      { role: "system", content: [{ type: "text", text: "Today's date is 2026-09-30." }] },
    ]
    const out = messagesOf(restoreQueriedTurn(wire(messages), [RESULT]))
    expect(out[1]?.content).toEqual([RESULT])
    expect(out[2]).toEqual(messages[2])
  })

  it("keeps a reminder that was part of the original tool result", () => {
    const original = {
      ...RESULT,
      content: "real output\n<system-reminder>quoted fixture</system-reminder>",
    }
    const native = {
      ...original,
      content: `${original.content}\n<system-reminder>userEmail</system-reminder>`,
    }
    const raw = wire([ASSISTANT, { role: "user", content: [native] }])
    expect(messagesOf(restoreQueriedTurn(raw, [original]))[1]?.content).toEqual([original])
  })

  it("restores the host frame of parallel results and a trailing native block", () => {
    const second: NativeBlock = { type: "tool_result", tool_use_id: "t2", content: "second output" }
    const native = [
      {
        ...RESULT,
        content: `${RESULT.content}\n<system-reminder>userEmail</system-reminder>`,
      },
      second,
      { type: "text", text: "native session context" },
    ]
    const raw = wire([ASSISTANT, { role: "user", content: native }])
    expect(messagesOf(restoreQueriedTurn(raw, [RESULT, second]))[1]?.content).toEqual([
      RESULT,
      second,
    ])
  })

  it("fails closed on a tool result with another id", () => {
    const changed = {
      ...RESULT,
      tool_use_id: "different",
      content: "real output\n<system-reminder>userEmail</system-reminder>",
    }
    const raw = wire([ASSISTANT, { role: "user", content: [changed] }])
    expect(() => restoreQueriedTurn(raw, [RESULT])).toThrow(QueriedTurnMismatch)
  })

  it("fails closed on an ambiguous tool result", () => {
    const raw = wire([ASSISTANT, { role: "user", content: [RESULT, RESULT] }])
    expect(() => restoreQueriedTurn(raw, [RESULT])).toThrow(QueriedTurnMismatch)
  })

  it("keeps the native payload when a plain user turn does not match", () => {
    const raw = wire([ASSISTANT, { role: "user", content: [{ ...QUESTION, text: "rewritten" }] }])
    expect(restoreQueriedTurn(raw, [QUESTION])).toBe(raw)
  })
})

describe("the rewrites together", () => {
  it("forwards the host tool result without native's email annotation", () => {
    const native = {
      ...RESULT,
      content: `${RESULT.content}\n<system-reminder>userEmail</system-reminder>`,
    }
    const out = rewriteAsRelay(wire([ASSISTANT, { role: "user", content: [native] }]), [RESULT])
    expect(out.unrestored).toBeNull()
    expect(messagesOf(out.payload)[1]?.content).toEqual([RESULT])
  })

  it("forwards an unmatched tool result unchanged and records why", () => {
    const changed = { ...RESULT, tool_use_id: "different" }
    const payload = wire([ASSISTANT, { role: "user", content: [changed] }])
    const out = rewriteAsRelay(payload, [RESULT])
    expect(out.unrestored).toBe(QUERIED_TURN_MISMATCH)
    expect(out.payload).toBe(payload)
  })
})
