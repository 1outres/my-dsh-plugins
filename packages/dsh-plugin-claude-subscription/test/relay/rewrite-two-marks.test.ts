import { describe, expect, it } from "vitest"
import type { NativeBlock } from "../../src/contract"
import { pinMessageBreakpoint } from "../../src/relay/rewrite"
import {
  bodyOf,
  clone,
  countMarks,
  type Json,
  messageMarks,
  plain,
} from "../support/rewrite-payloads"
import { rewriteAsRelay } from "../support/rewrite-pipeline"

const MARKER = { type: "ephemeral" }
const SYSTEM: Json[] = [
  { type: "text", text: "x-anthropic-billing-header: cc" },
  { type: "text", text: "You are Claude Code. DSH system prompt.", cache_control: MARKER },
]
const TOOLS: Json[] = [
  {
    name: "mcp__dsh__terminal",
    description: "run",
    input_schema: { type: "object" },
    cache_control: MARKER,
  },
]
const REMINDER = "\n<system-reminder>userEmail: user@example.com</system-reminder>"

function results(n: number): NativeBlock[] {
  return Array.from({ length: 4 }, (_, k) => ({
    type: "tool_result",
    tool_use_id: `r${n}c${k}`,
    content: `output ${n}.${k}`,
  }))
}

function assistant(n: number): Json {
  return {
    role: "assistant",
    content: [
      { type: "thinking", thinking: `plan ${n}`, signature: `sig${n}` },
      ...Array.from({ length: 4 }, (_, k) => ({
        type: "tool_use",
        id: `r${n}c${k}`,
        name: "mcp__dsh__terminal",
        input: { command: `echo ${n}.${k}` },
      })),
    ],
  }
}

/**
 * What native sends after `rounds` parallel rounds: older rounds replay as DSH sent them, the
 * newest carries native's reminder (optionally) and is followed by its per-request context.
 */
function nativeRequest(rounds: number, reminder: boolean): Json {
  const messages: Json[] = [
    { role: "user", content: [{ type: "text", text: "run four probes, twice" }] },
  ]
  for (let n = 0; n < rounds; n += 1) {
    messages.push(assistant(n), { role: "user", content: results(n) })
  }
  const toolUses = (messages[messages.length - 2] as Json).content as Json[]
  ;(toolUses[toolUses.length - 1] as Json).cache_control = MARKER
  if (reminder) {
    const newest = (messages[messages.length - 1] as Json).content as Json[]
    const lastResult = newest[newest.length - 1] as Json
    lastResult.content += REMINDER
  }
  messages.push({
    role: "system",
    content: [
      {
        type: "text",
        text: `Today's date is 2026-10-04. Request ${rounds}.`,
        cache_control: MARKER,
      },
    ],
  })
  return {
    model: "claude-opus-5-5",
    system: clone(SYSTEM),
    tools: clone(TOOLS),
    messages,
  }
}

function asBytes(body: Json): Buffer {
  return Buffer.from(JSON.stringify(body))
}

function withoutStreamingFlag(body: Json): Json[] {
  return (body.tools as Json[]).map(({ eager_input_streaming: _flag, ...tool }) => tool)
}

/** The request through block `at`, in the order the cache reads it. Marks are left out. */
function prefix(body: Json, at: [number, number]): string {
  const [i, j] = at
  const messages = body.messages as Json[]
  const head = [
    ...messages.slice(0, i),
    {
      ...(messages[i] as Json),
      content: ((messages[i] as Json).content as Json[]).slice(0, j + 1),
    },
  ]
  return JSON.stringify(plain({ tools: body.tools, system: body.system, messages: head }))
}

describe("two native marks on the message blocks", () => {
  it.each([false, true])(
    "keeps one breakpoint the next request reads (reminder in the last result: %s)",
    (reminder) => {
      const nativeN = nativeRequest(1, reminder)
      const first = rewriteAsRelay(asBytes(nativeN), results(0))
      const second = rewriteAsRelay(asBytes(nativeRequest(2, reminder)), results(1))
      const sentN = bodyOf(first.payload)
      const sentN1 = bodyOf(second.payload)

      expect(first.unrestored).toBeNull()
      expect(second.unrestored).toBeNull()
      // Native's mark on the last tool_use recurs and stays. The mark of the trailing system
      // message moves onto the last tool result, which recurs once it is restored.
      expect(messageMarks(nativeN)).toEqual([
        [1, 4],
        [3, 0],
      ])
      expect(messageMarks(sentN)).toEqual([
        [1, 4],
        [2, 3],
      ])
      expect(messageMarks(sentN1)).toEqual([
        [3, 4],
        [4, 3],
      ])
      // Only a mark moved: same content, same system and tools marks, never more than four.
      expect(sentN.system).toEqual(nativeN.system)
      expect(withoutStreamingFlag(sentN)).toEqual(nativeN.tools)
      expect(plain((sentN.messages as Json[])[3])).toEqual(plain((nativeN.messages as Json[])[3]))
      expect(countMarks(sentN)).toBe(4)
      expect(countMarks(nativeN)).toBe(4)

      // Request N+1 replays the prefix of request N through its last breakpoint byte for byte.
      const lastMark = messageMarks(sentN).at(-1) as [number, number]
      expect(prefix(sentN1, lastMark)).toBe(prefix(sentN, lastMark))
    },
  )

  it("falls back to native's tool_use mark when the result cannot be restored", () => {
    const nativeBody = nativeRequest(1, true)
    const sent = bodyOf(pinMessageBreakpoint(asBytes(nativeBody), results(0)))

    expect(messageMarks(sent)).toEqual([[1, 4]])
    expect(countMarks(sent)).toBe(countMarks(nativeBody) - 1)
    expect(plain(sent)).toEqual(plain(nativeBody))
    expect(sent.system).toEqual(nativeBody.system)
    expect(sent.tools).toEqual(nativeBody.tools)
    const following = nativeRequest(2, true)
    expect(prefix(following, [1, 4])).toBe(prefix(sent, [1, 4]))
  })

  it("leaves marks inside the recurring span alone", () => {
    const nativeBody = nativeRequest(1, false)
    ;(nativeBody.messages as Json[]).pop()
    const resultBlocks = ((nativeBody.messages as Json[])[2] as Json).content as Json[]
    ;(resultBlocks[resultBlocks.length - 1] as Json).cache_control = MARKER
    const raw = asBytes(nativeBody)
    expect(pinMessageBreakpoint(raw, results(0))).toBe(raw)
  })
})
