import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import type { NativeBlock } from "../../src/contract"
import { pinMessageBreakpoint } from "../../src/relay/rewrite"
import {
  bodyOf,
  canonical,
  clone,
  countMarks,
  type Json,
  messageMarks,
  messagesOf,
  plain,
} from "../support/rewrite-payloads"
import { rewriteAsRelay } from "../support/rewrite-pipeline"

const MARKER = { type: "ephemeral", ttl: "1h" }
const OPENING: NativeBlock = {
  type: "text",
  text: `Run the echo steps one at a time.${" source pack".repeat(200)}`,
}
const FOLLOW_UP: NativeBlock = { type: "text", text: "One more echo." }
const STEER: NativeBlock = { type: "text", text: "User sent a /steer: also print the date." }
const REMINDER = "\n<system-reminder>userEmail: user@example.invalid</system-reminder>"

interface Layout {
  tools: Json[]
  system: Json[]
  /** Whether native also marks the last assistant block. */
  assistantMark: boolean
}

const LAYOUTS: Record<string, Layout> = {
  "2.1.285": {
    tools: [{ name: "mcp__dsh__terminal", description: "run", input_schema: { type: "object" } }],
    system: [
      { type: "text", text: "x-anthropic-billing-header: cc" },
      { type: "text", text: "You are Claude Code.", cache_control: MARKER },
      { type: "text", text: "DSH system prompt.", cache_control: MARKER },
    ],
    assistantMark: false,
  },
  "2.1.287": {
    tools: [
      {
        name: "mcp__dsh__terminal",
        description: "run",
        input_schema: { type: "object" },
        cache_control: MARKER,
      },
    ],
    system: [
      { type: "text", text: "x-anthropic-billing-header: cc" },
      { type: "text", text: "You are Claude Code. DSH system prompt.", cache_control: MARKER },
    ],
    assistantMark: true,
  },
}
const LAYOUT_NAMES = Object.keys(LAYOUTS)

function layoutOf(name: string): Layout {
  return LAYOUTS[name] as Layout
}

function last<T>(items: readonly T[]): T {
  return items[items.length - 1] as T
}

function assistant(n: number, think: boolean, calls: number): Json {
  return {
    role: "assistant",
    content: [
      ...(think ? [{ type: "thinking", thinking: `plan ${n}`, signature: `sig${n}` }] : []),
      ...Array.from({ length: calls }, (_, k) => ({
        type: "tool_use",
        id: `t${n}c${k}`,
        name: "mcp__dsh__terminal",
        input: { command: `echo ${n}.${k}` },
      })),
    ],
  }
}

interface TurnOptions {
  calls?: number
  steer?: number
  start?: number
}

/**
 * The messages DSH holds for one turn: its opening, `rounds` tool rounds and the answer. Round n's
 * assistant message thinks when `think(n)`. A /steer row rides in the results of round `steer`.
 */
function turn(
  opening: NativeBlock,
  rounds: number,
  think: (n: number) => boolean,
  { calls = 1, steer, start = 0 }: TurnOptions = {},
): Json[] {
  const messages: Json[] = [{ role: "user", content: [opening] }]
  for (let n = start; n < start + rounds; n += 1) {
    messages.push(assistant(n, think(n), calls), {
      role: "user",
      content: [
        ...Array.from({ length: calls }, (_, k) => ({
          type: "tool_result",
          tool_use_id: `t${n}c${k}`,
          content: `${n}.${k}`,
        })),
        ...(n === steer ? [STEER] : []),
      ],
    })
  }
  const n = start + rounds
  messages.push({
    role: "assistant",
    content: [
      ...(think(n) ? [{ type: "thinking", thinking: `plan ${n}`, signature: `sig${n}` }] : []),
      { type: "text", text: `done ${n}` },
    ],
  })
  return messages
}

/**
 * Native's request for a history that ends in a user frame: its environment message after the
 * first turn and its per-request date message last, which is where it puts the message mark.
 */
function native(messages: Json[], layoutName: string): Json {
  const layout = layoutOf(layoutName)
  const sent = clone(messages)
  sent.splice(1, 0, {
    role: "system",
    content: "Primary working directory: /tmp/claude-directsdk-cwd",
  })
  if (layout.assistantMark && sent.length > 3) {
    const blocks = sent[sent.length - 2]?.content as Json[]
    last(blocks).cache_control = MARKER
  }
  sent.push({
    role: "system",
    content: [{ type: "text", text: "Today's date is 2026-10-10.", cache_control: MARKER }],
  })
  return {
    model: "claude-opus-5-5",
    tools: clone(layout.tools),
    system: clone(layout.system),
    messages: sent,
  }
}

function queriedOf(messages: Json[]): NativeBlock[] {
  return last(messages).content as NativeBlock[]
}

/** The body the relay forwards for the request that queries the last message of `messages`. */
function pinned(messages: Json[], layoutName: string): Json {
  const raw = Buffer.from(JSON.stringify(native(messages, layoutName)))
  return bodyOf(pinMessageBreakpoint(raw, queriedOf(messages)))
}

type Where = "tools" | "system" | [number, number]

interface Placed {
  where: Where
  scope: string | number
  block: Json
}

/**
 * The documented lookup of Anthropic's prompt cache. Each breakpoint checks up to 20 positions
 * back, itself included, and a run of tool_use or tool_result blocks counts once. Entries are
 * written only at breakpoints. A thinking block renders closed once a later user message carries
 * more than tool results.
 */
class Cache {
  readonly #entries = new Set<string>()

  /** Where this request's read ends: a message block, "system", "tools", or null. */
  send(body: Json): Where | null {
    const messages = body.messages as Json[]
    const opens = messages.map(
      (message) =>
        message.role === "user" &&
        (message.content as Json[]).some((block) => block.type !== "tool_result"),
    )
    const flat: Placed[] = [
      ...(body.tools as Json[]).map((block): Placed => ({ where: "tools", scope: "tools", block })),
      ...(body.system as Json[]).map(
        (block): Placed => ({ where: "system", scope: "system", block }),
      ),
    ]
    messages.forEach((message, i) => {
      const blocks = Array.isArray(message.content)
        ? (message.content as Json[])
        : [{ type: "text", text: message.content }]
      blocks.forEach((block, j) => {
        const closed = opens.slice(i + 1).some(Boolean)
        flat.push({
          where: [i, j],
          scope: i,
          block: block.type === "thinking" ? { ...block, closed } : block,
        })
      })
    })

    const keys: string[] = []
    const digest = createHash("sha256")
    for (const { scope, block } of flat) {
      const { cache_control: _mark, ...rest } = block
      digest.update(canonical([scope, rest]))
      keys.push(digest.copy().digest("hex"))
    }
    const marks = flat.flatMap((entry, k) => ("cache_control" in entry.block ? [k] : []))
    let read = -1
    for (const mark of marks) {
      let k = mark
      let seen = 1
      while (k >= 0 && seen <= 20) {
        if (this.#entries.has(keys[k] as string)) {
          read = Math.max(read, k)
          break
        }
        const kind = flat[k]?.block.type
        k -= 1
        const sameRun =
          (kind === "tool_use" || kind === "tool_result") && k >= 0 && flat[k]?.block.type === kind
        if (!sameRun) seen += 1
      }
    }
    for (const k of marks) this.#entries.add(keys[k] as string)
    return read < 0 ? null : (flat[read] as Placed).where
  }
}

/**
 * Sends every request of the conversation in order and returns the forwarded body and the read
 * of each. Only marks may change, and never to more than four or one over native's own count.
 */
function replay(messages: Json[], layoutName: string): { body: Json; read: Where | null }[] {
  const cache = new Cache()
  const ends = messages.flatMap((message, i) => (message.role === "user" ? [i + 1] : []))
  return ends.map((end) => {
    const raw = native(messages.slice(0, end), layoutName)
    const body = pinned(messages.slice(0, end), layoutName)
    expect(plain(body)).toEqual(plain(raw))
    expect(body.tools).toEqual(raw.tools)
    expect(body.system).toEqual(raw.system)
    expect(countMarks(body)).toBeLessThanOrEqual(Math.min(4, countMarks(raw) + 1))
    return { body, read: cache.send(body) }
  })
}

function nativeIndex(i: number): number {
  return i === 0 ? 0 : i + 1
}

function lastMark(body: Json): [number, number] | undefined {
  return messageMarks(body).at(-1)
}

describe("the mark that keeps a finished turn readable", () => {
  it.each(
    LAYOUT_NAMES.flatMap((layout) => [
      [layout, 0],
      [layout, 6],
    ]) as [string, number][],
  )(
    "lets the next turn after a long loop read up to the first thinking (layout %s, thinks from round %i)",
    (layout, first) => {
      const think = (n: number) => [first, 9, 14].includes(n)
      const messages = [...turn(OPENING, 14, think), { role: "user", content: [FOLLOW_UP] }]
      const sent = replay(messages, layout)
      const anchor = [nativeIndex(2 * first), 0]
      const finalRequest = last(sent)
      expect(messageMarks(finalRequest.body)).toContainEqual(anchor)
      expect(finalRequest.read).toEqual(anchor)
      for (let i = 0; i < sent.length - 2; i += 1) {
        expect((sent[i + 1] as (typeof sent)[number]).read).toEqual(
          lastMark((sent[i] as (typeof sent)[number]).body),
        )
      }
    },
  )

  it("keeps everything before the finished turn when a later turn runs the long loop", () => {
    const first = turn(OPENING, 1, () => true)
    const second = turn(FOLLOW_UP, 14, () => true, { start: 1 })
    const messages = [
      ...first,
      ...second,
      { role: "user", content: [{ type: "text", text: "And again." }] },
    ]
    const { body, read } = last(replay(messages, "2.1.285"))
    expect(read).toEqual([nativeIndex(first.length), 0])
    expect(read).toEqual([5, 0])
    expect(countMarks(body)).toBe(4)
  })

  it.each(LAYOUT_NAMES)(
    "forwards a short loop with the recurring mark only (layout %s)",
    (layoutName) => {
      const messages = [...turn(OPENING, 4, () => true), { role: "user", content: [FOLLOW_UP] }]
      const sent = replay(messages, layoutName)
      for (const { body } of sent) {
        const nativeMark =
          layoutOf(layoutName).assistantMark && (body.messages as Json[]).length > 4
        expect(messageMarks(body)).toHaveLength(1 + (nativeMark ? 1 : 0))
      }
      expect(last(sent).read).toEqual([0, 0])
    },
  )

  it("leaves a loop without thinking to the recurring mark", () => {
    const messages = [...turn(OPENING, 14, () => false), { role: "user", content: [FOLLOW_UP] }]
    const sent = replay(messages, "2.1.285")
    expect(sent.every(({ body }) => messageMarks(body).length === 1)).toBe(true)
    expect(last(sent).read).toEqual(lastMark((sent[sent.length - 2] as (typeof sent)[number]).body))
  })

  it.each(LAYOUT_NAMES)(
    "reads a steer row after a long loop up to the turn's first thinking (layout %s)",
    (layoutName) => {
      const messages = turn(OPENING, 14, () => true, { steer: 11 })
      const sent = replay(messages, layoutName)
      const steer = sent.findIndex(
        ({ body }) =>
          canonical(plain(last(((body.messages as Json[]).at(-2) as Json).content as Json[]))) ===
          canonical(STEER),
      )
      expect(steer).toBeGreaterThanOrEqual(0)
      const { body, read } = sent[steer] as (typeof sent)[number]
      expect(read).toEqual([0, 0])
      expect(messageMarks(body)).toContainEqual([0, 0])
      expect((sent[steer + 1] as (typeof sent)[number]).read).toEqual(lastMark(body))
    },
  )

  it.each(LAYOUT_NAMES)(
    "reads parallel rounds and then a new turn up to the first thinking (layout %s)",
    (layoutName) => {
      const messages = [
        ...turn(OPENING, 6, () => true, { calls: 4 }),
        { role: "user", content: [FOLLOW_UP] },
      ]
      expect(last(replay(messages, layoutName)).read).toEqual([0, 0])
    },
  )

  it("moves a native mark instead of adding a fifth at the limit", () => {
    const messages = [...turn(OPENING, 14, () => true), { role: "user", content: [FOLLOW_UP] }]
    const raw = native(messages, "2.1.287")
    const body = pinned(messages, "2.1.287")
    expect(countMarks(raw)).toBe(4)
    expect(countMarks(body)).toBe(4)
    expect(messageMarks(raw)).toEqual([
      [30, 1],
      [32, 0],
    ])
    expect(messageMarks(body)).toEqual([
      [0, 0],
      [31, 0],
    ])
    expect(plain(body)).toEqual(plain(raw))
    expect(body.tools).toEqual(raw.tools)
    expect(body.system).toEqual(raw.system)
  })

  it("forwards the fold only when there is no spare slot and no native mark to move", () => {
    const messages = [...turn(OPENING, 14, () => true), { role: "user", content: [FOLLOW_UP] }]
    const raw = native(messages, "2.1.285")
    ;((raw.tools as Json[])[0] as Json).cache_control = MARKER
    raw.cache_control = { type: "ephemeral" }
    const body = bodyOf(pinMessageBreakpoint(Buffer.from(JSON.stringify(raw)), queriedOf(messages)))
    expect(messageMarks(body)).toEqual([[31, 0]])
  })

  it.each(LAYOUT_NAMES)(
    "counts a nested marker toward the four, so the request stays at four (layout %s)",
    (layoutName) => {
      const messages = [...turn(OPENING, 14, () => true), { role: "user", content: [FOLLOW_UP] }]
      const raw = native(messages, layoutName)
      delete ((raw.tools as Json[])[0] as Json).cache_control
      const result = ((raw.messages as Json[])[5] as Json).content as Json[]
      ;(result[0] as Json).content = [{ type: "text", text: "1.0", cache_control: MARKER }]

      const body = bodyOf(
        pinMessageBreakpoint(Buffer.from(JSON.stringify(raw)), queriedOf(messages)),
      )

      expect(countMarks(raw)).toBe(4)
      expect(countMarks(body)).toBe(4)
      expect((body.messages as Json[])[5]).toEqual((raw.messages as Json[])[5])
      expect(messageMarks(body)).toEqual(
        layoutName === "2.1.285"
          ? [[31, 0]]
          : [
              [0, 0],
              [31, 0],
            ],
      )
      expect(plain(body)).toEqual(plain(raw))
      expect(body.tools).toEqual(raw.tools)
      expect(body.system).toEqual(raw.system)
    },
  )

  it("keeps a mark the block before the first thinking already has", () => {
    const messages = [...turn(OPENING, 14, () => true), { role: "user", content: [FOLLOW_UP] }]
    const raw = native(messages, "2.1.285")
    const system = raw.system as Json[]
    delete (system[2] as Json).cache_control
    const own = { type: "ephemeral", ttl: "5m" }
    const opening = ((raw.messages as Json[])[0] as Json).content as Json[]
    ;(opening[0] as Json).cache_control = own

    const body = bodyOf(pinMessageBreakpoint(Buffer.from(JSON.stringify(raw)), queriedOf(messages)))

    const sent = body.messages as Json[]
    expect((((sent[0] as Json).content as Json[])[0] as Json).cache_control).toEqual(own)
    expect(messageMarks(body)).toEqual([
      [0, 0],
      [31, 0],
    ])
  })

  it("does not move a mark when the recurring block has none of its own", () => {
    const messages = [...turn(OPENING, 14, () => true), { role: "user", content: [FOLLOW_UP] }]
    const raw = native(messages, "2.1.285")
    ;(raw.messages as Json[]).pop()
    raw.cache_control = { type: "ephemeral" }
    ;(raw.tools as Json[])[0] = { ...((raw.tools as Json[])[0] as Json), cache_control: MARKER }
    const midLoop = ((raw.messages as Json[])[28] as Json).content as Json[]
    ;(midLoop[midLoop.length - 1] as Json).cache_control = MARKER
    expect(countMarks(raw)).toBe(5)
    delete ((raw.system as Json[])[2] as Json).cache_control
    expect(countMarks(raw)).toBe(4)
    const bytes = Buffer.from(JSON.stringify(raw))

    expect(pinMessageBreakpoint(bytes, queriedOf(messages))).toBe(bytes)
  })

  it("gives the turn mark the TTL of the mark after it", () => {
    const messages = [...turn(OPENING, 14, () => true), { role: "user", content: [FOLLOW_UP] }]
    const raw = native(messages, "2.1.285")
    const finalBlocks = ((raw.messages as Json[]).at(-1) as Json).content as Json[]
    ;(finalBlocks[0] as Json).cache_control = { type: "ephemeral" }

    const body = bodyOf(pinMessageBreakpoint(Buffer.from(JSON.stringify(raw)), queriedOf(messages)))

    const sent = body.messages as Json[]
    expect((((sent[0] as Json).content as Json[])[0] as Json).cache_control).toEqual({
      type: "ephemeral",
    })
    expect((((sent[31] as Json).content as Json[])[0] as Json).cache_control).toEqual({
      type: "ephemeral",
    })
  })

  it("forwards the turn mark with the steer frame restored", () => {
    const messages = turn(OPENING, 14, () => true, { steer: 11 })
    const end = messages.findIndex((message) => (message.content as Json[]).includes(STEER)) + 1
    const raw = native(messages.slice(0, end), "2.1.285")
    const reminded = ((raw.messages as Json[]).at(-2) as Json).content as Json[]
    ;(reminded[0] as Json).content += REMINDER

    const out = rewriteAsRelay(Buffer.from(JSON.stringify(raw)), queriedOf(messages.slice(0, end)))

    expect(out.unrestored).toBeNull()
    const sent = bodyOf(out.payload)
    const sentMessages = messagesOf(out.payload)
    expect(last(sentMessages).role).toBe("user")
    expect(String((sentMessages[1] as Json).content).endsWith("Today's date is 2026-10-10.")).toBe(
      true,
    )
    expect(plain(last(sentMessages).content)).toEqual((messages[end - 1] as Json).content)
    expect(messageMarks(sent)).toEqual([
      [0, 0],
      [sentMessages.length - 1, 1],
    ])
    expect(countMarks(sent)).toBe(4)
  })
})
