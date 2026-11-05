import { describe, expect, it } from "vitest"
import type { NativeBlock } from "../../src/contract"
import {
  QUERIED_TURN_MISMATCH,
  QueriedTurnMismatch,
  restoreQueriedTurn,
} from "../../src/relay/rewrite"
import { bodyOf, clone, type Json, messagesOf, plain } from "../support/rewrite-payloads"
import { rewriteAsRelay } from "../support/rewrite-pipeline"

const RESULT: NativeBlock = { type: "tool_result", tool_use_id: "t1", content: "output" }
const ASSISTANT = {
  role: "assistant",
  content: [{ type: "tool_use", id: "t1", name: "probe", input: {} }],
}
const IMAGE = { type: "image", source: { type: "base64", media_type: "image/png", data: "AA==" } }
const EPHEMERAL = { type: "ephemeral" }
const ONE_HOUR = { type: "ephemeral", ttl: "1h" }
const FIVE_MINUTES = { type: "ephemeral", ttl: "5m" }

function wire(content: unknown, before: Json[] = [ASSISTANT], after: Json[] = []): Buffer {
  const messages = [...before, { role: "user", content }, ...after]
  return Buffer.from(JSON.stringify({ model: "fixture", messages }))
}

function restoredFrame(raw: Buffer, queried: NativeBlock[]): unknown {
  return messagesOf(restoreQueriedTurn(raw, queried))[1]?.content
}

function textBlock(text: string, extra: Json = {}): NativeBlock {
  return { type: "text", text, ...extra }
}

describe("restoreQueriedTurn", () => {
  it.each([
    { ...RESULT, is_error: false },
    { ...RESULT, content: [textBlock("output")] },
    { ...RESULT, content: [textBlock("output")], is_error: false },
  ])("restores the exact host shape of an equivalent plain tool result", (nativeResult) => {
    expect(restoredFrame(wire([nativeResult]), [clone(RESULT)])).toEqual([RESULT])
  })

  it.each([0, null, "false"])("does not let the error flag %j become success", (flag) => {
    expect(() => restoreQueriedTurn(wire([{ ...RESULT, is_error: flag }]), [RESULT])).toThrow(
      QueriedTurnMismatch,
    )
  })

  it("does not match a true tool error to an absent is_error", () => {
    expect(() => restoreQueriedTurn(wire([{ ...RESULT, is_error: true }]), [RESULT])).toThrow(
      QueriedTurnMismatch,
    )
  })

  it("accepts only appended unmarked plain text in a nested result and restores the host", () => {
    const host = { ...RESULT, content: [textBlock("output")] }
    const native = { ...host, content: [...host.content, textBlock("native note")] }
    expect(restoredFrame(wire([native]), [host])).toEqual([host])
  })

  it.each([
    [[textBlock("output"), IMAGE]],
    [[textBlock("output", { citations: [{ title: "host citation" }] })]],
  ])("keeps structured host content when native appends text", (hostContent) => {
    const host = { ...RESULT, content: clone(hostContent) }
    const native = { ...host, content: [...clone(hostContent), textBlock("native note")] }
    expect(restoredFrame(wire([native]), [host])).toEqual([host])
  })

  it.each([[[textBlock("out"), textBlock("put")]], ["output"]])(
    "restores the original representation of split host text",
    (content) => {
      const host = { ...RESULT, content }
      const native = {
        ...RESULT,
        content: [textBlock("o"), textBlock("utput native suffix")],
      }
      expect(restoredFrame(wire([native]), [host])).toEqual([host])
    },
  )

  it("keeps the cache settings of a matched nested block", () => {
    const host = { ...RESULT, content: [textBlock("output")] }
    const native = {
      ...host,
      content: [textBlock("output", { cache_control: ONE_HOUR }), textBlock("native suffix")],
    }
    expect(restoredFrame(wire([native]), [host])).toEqual([
      { ...host, content: [textBlock("output", { cache_control: ONE_HOUR })] },
    ])
  })

  it("keeps the host cache settings of a nested block when plain text is appended", () => {
    const content = [textBlock("output", { cache_control: ONE_HOUR })]
    const host = { ...RESULT, content }
    const native = { ...host, content: [...content, textBlock("native suffix")] }
    expect(restoredFrame(wire([native]), [host])).toEqual([host])
  })

  it.each([
    [[textBlock("out native insertion put")]],
    [[textBlock("output", { unknown: "native metadata" })]],
    [[textBlock("output", { cache_control: EPHEMERAL })]],
  ])("does not flatten protected or changed text into a host string", (nativeContent) => {
    expect(() =>
      restoreQueriedTurn(wire([{ ...RESULT, content: nativeContent }]), [RESULT]),
    ).toThrow(QueriedTurnMismatch)
  })

  it("rejects native text inserted before nested media", () => {
    const host = { ...RESULT, content: [textBlock("output"), IMAGE] }
    const native = { ...host, content: [textBlock("output native insertion"), IMAGE] }
    expect(() => restoreQueriedTurn(wire([native]), [host])).toThrow(QueriedTurnMismatch)
  })

  it("rejects conflicting nested cache settings", () => {
    const host = {
      ...RESULT,
      content: [textBlock("output", { cache_control: ONE_HOUR })],
    }
    const native = {
      ...RESULT,
      content: [textBlock("output", { cache_control: FIVE_MINUTES })],
    }
    expect(() => restoreQueriedTurn(wire([native]), [host])).toThrow(QueriedTurnMismatch)
  })

  it("restores split and extended plain user text in a mixed frame", () => {
    const host = [RESULT, textBlock("user words")]
    const native = [RESULT, textBlock("user "), textBlock("words native note")]
    expect(restoredFrame(wire(native), host)).toEqual(host)
  })

  it.each([
    IMAGE,
    textBlock("note", { cache_control: EPHEMERAL }),
    textBlock("note", { citations: [{ type: "web_search_result_location" }] }),
  ])("does not discard nested content that is not plain text", (extra) => {
    const host = { ...RESULT, content: [textBlock("output")] }
    const native = { ...host, content: [...host.content, extra] }
    expect(() => restoreQueriedTurn(wire([native]), [host])).toThrow(QueriedTurnMismatch)
  })

  it("rejects an appended tool result", () => {
    const extra = { type: "tool_result", tool_use_id: "unexpected", content: "hidden" }
    expect(() => restoreQueriedTurn(wire([RESULT, extra]), [RESULT])).toThrow(QueriedTurnMismatch)
  })

  it("fails closed on duplicate queried tool ids", () => {
    const duplicate = { ...RESULT, content: "second output" }
    expect(() => restoreQueriedTurn(wire([RESULT, duplicate]), [RESULT, duplicate])).toThrow(
      QueriedTurnMismatch,
    )
  })

  it("returns the same bytes for a plain user frame after a successful match", () => {
    const question = textBlock("hello")
    const raw = wire([question])
    expect(restoreQueriedTurn(raw, [question as NativeBlock])).toBe(raw)
  })

  it("returns the same bytes when native already sent the host frame", () => {
    const raw = wire([RESULT])
    expect(restoreQueriedTurn(raw, [RESULT])).toBe(raw)
  })

  it("leaves a frame without tool results out of scope, even when it changed", () => {
    const question = textBlock("hello") as NativeBlock
    const raw = wire([textBlock("rewritten")])
    expect(restoreQueriedTurn(raw, [question])).toBe(raw)
  })

  it("leaves an empty queried frame out of scope", () => {
    const raw = wire([RESULT])
    expect(restoreQueriedTurn(raw, [])).toBe(raw)
  })

  it("rejects the nested cache marker on native text that would be discarded", () => {
    const host = { ...RESULT, content: [textBlock("output")] }
    const native = {
      ...host,
      content: [...host.content, textBlock("note", { cache_control: EPHEMERAL })],
    }
    expect(() => restoreQueriedTurn(wire([native]), [host])).toThrow(QueriedTurnMismatch)
  })

  it.each([
    "\n<system-reminder>\n# userEmail\nsomeone@example.invalid\n</system-reminder>",
    "\nSession context: a wording no CLI has shipped yet",
    "\n\nToday's date is 2031-01-01.",
  ])("is anchored on host ids and content, not on native wording: %j", (annotation) => {
    const native = [{ ...RESULT, content: `${RESULT.content}${annotation}` }]
    const restored = messagesOf(restoreQueriedTurn(wire(native), [RESULT]))
    expect(restored.at(-1)?.content).toEqual([RESULT])
  })

  it("fails closed when the payload does not parse", () => {
    expect(() => restoreQueriedTurn(Buffer.from("not json"), [RESULT])).toThrow(QueriedTurnMismatch)
    expect(() => restoreQueriedTurn(Buffer.from("[]"), [RESULT])).toThrow(QueriedTurnMismatch)
    expect(() => restoreQueriedTurn(Buffer.from('{"model":"m"}'), [RESULT])).toThrow(
      QueriedTurnMismatch,
    )
    expect(() => restoreQueriedTurn(Buffer.from('{"messages":[null]}'), [RESULT])).toThrow(
      QueriedTurnMismatch,
    )
  })

  it("fails closed when the newest turn is not a user message with blocks", () => {
    const noUser = Buffer.from(JSON.stringify({ messages: [ASSISTANT] }))
    const textOnly = Buffer.from(
      JSON.stringify({ messages: [ASSISTANT, { role: "user", content: "text" }] }),
    )
    expect(() => restoreQueriedTurn(noUser, [RESULT])).toThrow(QueriedTurnMismatch)
    expect(() => restoreQueriedTurn(textOnly, [RESULT])).toThrow(QueriedTurnMismatch)
  })

  it("fails closed when a queried tool result has no usable id", () => {
    const nameless = { type: "tool_result", content: "x" }
    const empty = { ...RESULT, tool_use_id: "" }
    expect(() => restoreQueriedTurn(wire([nameless]), [nameless])).toThrow(QueriedTurnMismatch)
    expect(() => restoreQueriedTurn(wire([empty]), [empty])).toThrow(QueriedTurnMismatch)
  })

  it("gives the mismatch a stable message", () => {
    expect(new QueriedTurnMismatch().message).toBe(QUERIED_TURN_MISMATCH)
    expect(new QueriedTurnMismatch().name).toBe("QueriedTurnMismatch")
  })
})

describe("restoration through the relay rewrites", () => {
  it.each([
    [[RESULT, textBlock("note", { cache_control: ONE_HOUR })]],
    [[RESULT, { type: "tool_result", tool_use_id: "extra", content: "extra" }]],
    [[RESULT, IMAGE]],
    [[RESULT, textBlock("note", { citations: [] })]],
    [[RESULT, textBlock("note", { unknown: true })]],
    [[{ ...RESULT, is_error: true }]],
    [[{ ...RESULT, is_error: 0 }]],
    [[{ ...RESULT, tool_use_id: "wrong" }]],
    [[{ ...RESULT, content: "changed" }]],
    [[RESULT, RESULT]],
    [[textBlock("prepended"), RESULT]],
  ])("forwards native's frame when restoration cannot be proven: %j", (native) => {
    const raw = wire(native)
    const out = rewriteAsRelay(raw, [RESULT])
    expect(out.unrestored).toBe(QUERIED_TURN_MISMATCH)
    expect(plain(bodyOf(out.payload))).toEqual(plain(bodyOf(raw)))
  })

  it("forwards native's frame when a nested block changed", () => {
    const queried = [{ ...RESULT, content: [textBlock("output")] }]
    const native = [
      {
        ...RESULT,
        content: [textBlock("output"), textBlock("note", { cache_control: EPHEMERAL })],
      },
    ]
    const out = rewriteAsRelay(wire(native), queried)
    expect(out.unrestored).toBe(QUERIED_TURN_MISMATCH)
    expect(plain(bodyOf(out.payload))).toEqual(plain(bodyOf(wire(native))))
  })

  it("forwards native's frame when the host cache settings conflict", () => {
    const queried = [{ ...RESULT, cache_control: ONE_HOUR }]
    const native = [{ ...RESULT, cache_control: FIVE_MINUTES }]
    const out = rewriteAsRelay(wire(native), queried)
    expect(out.unrestored).toBe(QUERIED_TURN_MISMATCH)
    expect(plain(bodyOf(out.payload))).toEqual(plain(bodyOf(wire(native))))
  })

  it("replays two parallel rounds with the host frame, round after round", () => {
    const history = [
      { role: "user", content: "earlier prompt" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "signed", signature: "sig" },
          textBlock("earlier answer"),
        ],
      },
    ]
    for (const round of [0, 1]) {
      const queried: NativeBlock[] = [
        { type: "tool_result", tool_use_id: `p${round}a`, content: "A" },
        { type: "tool_result", tool_use_id: `p${round}b`, content: "B" },
      ]
      const assistant = {
        role: "assistant",
        content: [
          { type: "tool_use", id: `p${round}a`, name: "a", input: {} },
          { type: "tool_use", id: `p${round}b`, name: "b", input: {} },
        ],
      }
      const nativeResults = [...queried.map((block) => ({ ...block })), textBlock("native date")]
      const messages = [...history, assistant, { role: "user", content: nativeResults }]
      const raw = Buffer.from(JSON.stringify({ model: "fixture", messages }))

      const out = rewriteAsRelay(raw, queried)

      expect(out.unrestored).toBeNull()
      const sent = messagesOf(out.payload)
      expect(sent.slice(0, history.length)).toEqual(history)
      expect(sent.at(-1)?.content).toEqual(queried)
    }
  })
})
