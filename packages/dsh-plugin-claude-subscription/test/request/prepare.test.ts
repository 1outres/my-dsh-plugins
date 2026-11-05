import { createHash } from "node:crypto"
import { AttachmentId } from "@deepseek-ai/dsh-attachment"
import {
  type ContentBlock,
  type GenerateOptions,
  offloadedImageText,
  requestImageHandleText,
  requiredImageOffload,
  type ToolSchema,
} from "@deepseek-ai/dsh-llm"
import { describe, expect, it } from "vitest"
import {
  type CapturedMessage,
  PROVIDER_ID,
  type ReplayCarrier,
  type ToolManifestEntry,
} from "../../src/contract"
import { FailureCode } from "../../src/errors"
import { type AttachmentReader, type PrepareDeps, prepareRequest } from "../../src/request/prepare"
import { projectionOf } from "../../src/request/replay"
import {
  imageBlock,
  imageRef,
  PNG_BYTES,
  recordingReader,
  sizedReader,
} from "../support/attachments"
import {
  assistant,
  developer,
  reasoning,
  system,
  text,
  toolCall,
  toolResult,
  user,
  withCarrier,
} from "../support/messages"

type Messages = GenerateOptions["messages"]

const NO_ATTACHMENTS: PrepareDeps = { attachments: () => undefined, imageAccess: () => undefined }

function tool(name: string, extra: Partial<ToolSchema> = {}): ToolSchema {
  return { name, description: "", parameters: { type: "object" }, ...extra }
}

function prepare(
  messages: Messages,
  extra: Partial<GenerateOptions> = {},
  deps: PrepareDeps = NO_ATTACHMENTS,
) {
  return prepareRequest({ provider: PROVIDER_ID, model: "sonnet", messages, ...extra }, deps)
}

function withReader(
  reader: AttachmentReader,
  imageAccess: PrepareDeps["imageAccess"] = () => undefined,
): PrepareDeps {
  return { attachments: () => reader, imageAccess }
}

function rejection(promise: Promise<unknown>) {
  return expect(promise).rejects
}

function carrierFor(
  content: ContentBlock[],
  messages: CapturedMessage[],
  projection = projectionOf(content),
): ReplayCarrier {
  return { kind: "claude-subscription", version: 1, messages, projection }
}

const USAGE = {
  input_tokens: 158258,
  output_tokens: 900,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

const WRITING_INPUT = { path: "x", content: "a".repeat(3000) }

const writingContent = (): ContentBlock[] => [
  reasoning("private"),
  text("Writing."),
  toolCall("t1", "write_file", WRITING_INPUT),
]

const writingNative = (): CapturedMessage => ({
  id: "msg_1",
  role: "assistant",
  content: [
    { type: "thinking", thinking: "private", signature: "opaque" },
    { type: "text", text: "Writing." },
    { type: "tool_use", id: "t1", name: "mcp__dsh__write_file", input: WRITING_INPUT },
  ],
  usage: USAGE,
  stop_reason: "tool_use",
})

const withoutUsage = ({ usage: _usage, ...message }: CapturedMessage) => message

describe("system prompt", () => {
  it("joins options.system and the leading system messages", async () => {
    const prepared = await prepare([system("from history"), user("go")], { system: "from options" })
    expect(prepared.system).toBe("from options\n\nfrom history")
  })

  it("is empty when the request has none", async () => {
    expect((await prepare([user("go")])).system).toBe("")
    expect((await prepare([system(""), user("go")])).system).toBe("")
  })

  it("rejects a system message after the history has started", async () => {
    await rejection(prepare([user("go"), system("late"), user("again")])).toMatchObject({
      code: FailureCode.invalidRequest,
    })
  })

  it("rejects a system message with content that is not text", async () => {
    const message = { ...system("x"), content: [imageBlock(imageRef())] }
    await rejection(prepare([message as never, user("go")])).toMatchObject({
      code: FailureCode.invalidRequest,
    })
  })
})

describe("request fields", () => {
  it("names the native model and the session", async () => {
    const prepared = await prepare([user("go")], { model: "sonnet-5.5" })
    expect(prepared.nativeModel).toBe("claude-sonnet-5-5[1m]")
    expect(prepared.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab]/)
  })

  it("keeps one session id for every round of a conversation", async () => {
    const opening = await prepare([user("go")], { tools: [tool("probe")] })
    const later = await prepare(
      [user("go"), assistant([toolCall("c1", "probe")]), toolResult("c1", "result")],
      { tools: [tool("probe")] },
    )
    const other = await prepare([user("something else")], { tools: [tool("probe")] })
    expect(later.sessionId).toBe(opening.sessionId)
    expect(other.sessionId).not.toBe(opening.sessionId)
  })

  it("rejects an empty model", async () => {
    await rejection(prepare([user("go")], { model: "" })).toMatchObject({
      code: FailureCode.invalidRequest,
    })
  })

  it("puts generation fields and then the tools in the extra body", async () => {
    const prepared = await prepare([user("go")], {
      model: "claude-haiku-4-5",
      maxTokens: 17,
      tools: [tool("probe"), tool("A_1-z"), tool("x".repeat(50))],
    })
    const empty = { type: "object", properties: {} }
    expect(JSON.stringify(prepared.extraBody)).toBe(
      JSON.stringify({
        max_tokens: 17,
        tools: ["probe", "A_1-z", "x".repeat(50)].map((name) => ({
          name: `mcp__dsh__${name}`,
          description: "",
          input_schema: empty,
        })),
      }),
    )
    expect(prepared.maxOutputTokens).toBe(17)
    expect(prepared.effort).toBeUndefined()
  })

  it("sends the effort in the body and as the CLI effort", async () => {
    const prepared = await prepare([user("go")], {
      reasoningEffort: "high" as never,
    })
    expect(prepared.effort).toBe("high")
    expect(prepared.extraBody.output_config).toEqual({ effort: "high" })
    expect(prepared.extraBody.thinking).toEqual({ type: "adaptive", display: "summarized" })
  })

  it("sends the disable where the route accepts it", async () => {
    const prepared = await prepare([user("go")], {
      model: "claude-sonnet-5",
      reasoningEffort: "off" as never,
    })
    expect(prepared.extraBody.thinking).toEqual({ type: "disabled" })
    expect(prepared.extraBody.context_management).toEqual({ edits: [] })
    expect(prepared.effort).toBeUndefined()
  })

  it("validates and drops the temperature", async () => {
    const prepared = await prepare([user("go")], { temperature: 0.3 })
    expect(prepared.extraBody).not.toHaveProperty("temperature")
    await rejection(prepare([user("go")], { temperature: Number.NaN })).toMatchObject({
      code: FailureCode.invalidRequest,
    })
  })

  it("maps stop strings to stop sequences", async () => {
    const prepared = await prepare([user("go")], { stop: ["END"] })
    expect(prepared.extraBody.stop_sequences).toEqual(["END"])
  })
})

describe("tools", () => {
  const manifestOf = (prepared: { manifest: readonly ToolManifestEntry[] }) =>
    prepared.manifest.map((entry) => entry.name)

  it("lists every tool, deferred ones included, in the manifest and the name map", async () => {
    const prepared = await prepare([user("go")], {
      tools: [tool("probe"), tool("late", { deferLoading: true })],
    })
    expect(manifestOf(prepared)).toEqual(["probe", "late"])
    expect([...prepared.toolNames.keys()]).toEqual(["probe", "late"])
  })

  it("normalizes tool schemas for the validator", async () => {
    const parameters = {
      type: "object",
      properties: { proposal: { anyOf: [{ type: "string" }, { type: "null" }] } },
      allOf: [{ required: ["proposal"] }],
    }
    const prepared = await prepare([user("go")], { tools: [tool("probe", { parameters })] })
    const wire = (prepared.extraBody.tools as { input_schema: unknown }[])[0]?.input_schema
    expect(wire).toEqual({ type: "object", properties: { proposal: { type: "string" } } })
    expect(prepared.manifest[0]?.inputSchema).toEqual(wire)
  })

  it("declares an empty tool list when there are no tools", async () => {
    const prepared = await prepare([user("go")])
    expect(prepared.extraBody.tools).toEqual([])
    expect(prepared.manifest).toEqual([])
  })

  it("rejects an invalid tool name", async () => {
    await rejection(prepare([user("go")], { tools: [tool("has.dot")] })).toMatchObject({
      code: FailureCode.invalidRequest,
    })
  })
})

describe("one-shot calls", () => {
  it("is one-shot for an auxiliary purpose with no tools and one frame", async () => {
    expect((await prepare([user("title")], { purpose: "session-title" })).oneShot).toBe(true)
    expect((await prepare([user("sum")], { purpose: "compaction", tools: [] })).oneShot).toBe(true)
  })

  it("is not one-shot without a purpose, with tools, or with several frames", async () => {
    expect((await prepare([user("go")])).oneShot).toBe(false)
    const withTools = await prepare([user("go")], { purpose: "compaction", tools: [tool("probe")] })
    expect(withTools.oneShot).toBe(false)
    const history = [user("go"), assistant([text("hi")]), user("more")]
    expect((await prepare(history, { purpose: "compaction" })).oneShot).toBe(false)
  })
})

describe("text the CLI would read as a slash command", () => {
  const padded = (value: string) => ({ type: "text", text: ` ${value}` })
  const bare = (value: string) => ({ type: "text", text: value })

  async function framesFor(...messages: GenerateOptions["messages"]) {
    return (await prepare(messages)).frames.map((frame) => frame.message.content)
  }

  it("gets a leading space on the queried turn", async () => {
    expect(await framesFor(user("/compact now"))).toEqual([[padded("/compact now")]])
  })

  it("gets a leading space on a replayed turn", async () => {
    const frames = await framesFor(user("/help"), assistant([text("ok")]), user("next"))
    expect(frames[0]).toEqual([padded("/help")])
    expect(frames[2]).toEqual([bare("next")])
  })

  it("looks only at the last block, which is the one the CLI reads", async () => {
    expect(await framesFor(user([text("/first"), text("/last")]))).toEqual([
      [bare("/first"), padded("/last")],
    ])
    expect(await framesFor(user([text("/first"), text("last")]))).toEqual([
      [bare("/first"), bare("last")],
    ])
  })

  it("covers text merged after tool results, and developer text", async () => {
    const frames = await framesFor(
      user("start"),
      assistant([toolCall("call_1", "probe")]),
      toolResult("call_1", "/result stays"),
      developer([text("/note")]),
    )
    expect(frames[2]).toEqual([
      { type: "tool_result", tool_use_id: "call_1", content: "/result stays" },
      padded("/note"),
    ])
  })

  it("leaves assistant text and other leading characters alone", async () => {
    const frames = await framesFor(user(" /spaced"), assistant([text("/answer")]), user("!ls"))
    expect(frames).toEqual([[bare(" /spaced")], [bare("/answer")], [bare("!ls")]])
  })
})

describe("history", () => {
  it("projects a tool round into native frames", async () => {
    const prepared = await prepare(
      [user("go"), assistant([text("Calling."), toolCall("t1", "probe")]), toolResult("t1", "ok")],
      { tools: [tool("probe")] },
    )
    expect(JSON.stringify(prepared.frames)).toBe(
      JSON.stringify([
        { type: "user", message: { role: "user", content: [{ type: "text", text: "go" }] } },
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "Calling." },
              { type: "tool_use", id: "t1", name: "mcp__dsh__probe", input: {} },
            ],
          },
        },
        {
          type: "user",
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }],
          },
        },
      ]),
    )
  })

  it("marks only failed tool results", async () => {
    const prepared = await prepare([
      user("go"),
      assistant([toolCall("t1", "probe"), toolCall("t2", "probe")]),
      toolResult("t1", "boom", true),
      toolResult("t2", "fine"),
    ])
    const results = prepared.frames[2]?.message.content
    expect(results).toEqual([
      { type: "tool_result", tool_use_id: "t1", content: "boom", is_error: true },
      { type: "tool_result", tool_use_id: "t2", content: "fine" },
    ])
    expect(prepared.frames).toHaveLength(3)
  })

  it("joins the text of a tool result and sends an empty one empty", async () => {
    const prepared = await prepare([
      user("go"),
      assistant([toolCall("t1", "probe"), toolCall("t2", "probe"), toolCall("t3", "probe")]),
      toolResult("t1", [text("a"), text("b")]),
      toolResult("t2", ""),
      toolResult("t3", []),
    ])
    expect(prepared.frames[2]?.message.content).toEqual([
      { type: "tool_result", tool_use_id: "t1", content: "ab" },
      { type: "tool_result", tool_use_id: "t2", content: "" },
      { type: "tool_result", tool_use_id: "t3", content: "" },
    ])
  })

  it("rejects content it cannot send in a user message or a tool result", async () => {
    const odd = [{ type: "future-block" }] as unknown as ContentBlock[]
    for (const content of [odd, [reasoning("private")]]) {
      await rejection(prepare([user(content)])).toMatchObject({ code: FailureCode.invalidRequest })
      await rejection(
        prepare([
          user("go"),
          assistant([toolCall("t1", "probe")]),
          toolResult("t1", content),
          user("next"),
        ]),
      ).toMatchObject({ code: FailureCode.invalidRequest })
    }
  })

  it("merges neighbouring user messages into one frame", async () => {
    const prepared = await prepare([user("first"), user("second")])
    expect(prepared.frames).toHaveLength(1)
    expect(prepared.frames[0]?.message.content).toEqual([
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ])
  })

  it("skips empty text blocks and drops messages left with nothing", async () => {
    const prepared = await prepare([user([text("")]), user("go")])
    expect(prepared.frames).toHaveLength(1)
    expect(prepared.frames[0]?.message.content).toEqual([{ type: "text", text: "go" }])
  })

  it("drops reasoning when there is no carrier", async () => {
    const prepared = await prepare([
      user("go"),
      assistant([reasoning("private"), text("hi")]),
      user("more"),
    ])
    expect(prepared.frames[1]?.message.content).toEqual([{ type: "text", text: "hi" }])
  })

  it("drops an assistant turn that has nothing left to send", async () => {
    const prepared = await prepare([
      user("go"),
      assistant([reasoning("only thoughts")]),
      user("more"),
    ])
    expect(prepared.frames).toHaveLength(1)
    expect(prepared.frames[0]?.message.content).toHaveLength(2)
  })

  it("must end in a nonempty user turn", async () => {
    await rejection(prepare([user("go"), assistant([text("hi")])])).toMatchObject({
      code: FailureCode.invalidRequest,
    })
    await rejection(prepare([])).toMatchObject({ code: FailureCode.invalidRequest })
    await rejection(prepare([user([text("")])])).toMatchObject({ code: FailureCode.invalidRequest })
  })

  it("rejects tool arguments that are not JSON", async () => {
    const broken = assistant([toolCall("t1", "probe", '{"a":')])
    await rejection(prepare([user("go"), broken, toolResult("t1", "x")])).toMatchObject({
      code: FailureCode.invalidRequest,
    })
  })
})

describe("developer messages", () => {
  it("turns text into user context", async () => {
    const prepared = await prepare([
      user("go"),
      assistant([text("hi")]),
      developer([text("note")]),
      user("more"),
    ])
    expect(prepared.frames).toHaveLength(3)
    expect(prepared.frames[2]?.message.content).toEqual([
      { type: "text", text: "note" },
      { type: "text", text: "more" },
    ])
  })

  it("does not send tool additions or removals as text", async () => {
    const change = developer([
      { type: "tool-addition", toolName: "late" },
      { type: "tool-removal", toolName: "old" },
    ])
    const prepared = await prepare([user("go"), assistant([text("hi")]), change, user("more")])
    expect(prepared.frames[2]?.message.content).toEqual([{ type: "text", text: "more" }])
  })

  it("rejects developer content it cannot represent", async () => {
    const odd = developer([imageBlock(imageRef())])
    await rejection(prepare([odd, user("go")])).toMatchObject({ code: FailureCode.invalidRequest })
  })
})

describe("tool names in history", () => {
  const LONG_NAME = `mcp__server__${"x".repeat(51)}`
  const alias = `${LONG_NAME.slice(0, 41)}_${createHash("sha256").update(LONG_NAME).digest("hex").slice(0, 8)}`

  it("replays an offered long name by its alias and a call outside the inventory by its own name", async () => {
    const history: Messages = [
      user("go"),
      assistant([toolCall("t1", LONG_NAME), toolCall("t2", "unoffered")]),
      toolResult("t1", "ok"),
      toolResult("t2", "Tool 'unoffered' does not exist"),
    ]
    const prepared = await prepare(history, { tools: [tool(LONG_NAME)] })
    const names = (prepared.frames[1]?.message.content ?? []).map((block) => block.name)
    expect(names).toEqual([`mcp__dsh__${alias}`, "unoffered"])
  })

  it("rebuilds the alias after a host edit drops the carrier", async () => {
    const content = [text("Calling."), toolCall("toolu_test", LONG_NAME)]
    const native: CapturedMessage = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "private", signature: "sig" },
        { type: "text", text: "Calling." },
        { type: "tool_use", id: "toolu_test", name: `mcp__dsh__${alias}`, input: {} },
      ],
      usage: USAGE,
    }
    const edited = assistant(
      [text("middleware changed"), toolCall("toolu_test", LONG_NAME)],
      withCarrier(carrierFor(content, [native])),
    )
    const prepared = await prepare([user("go"), edited, toolResult("toolu_test", "ok")], {
      tools: [tool(LONG_NAME)],
    })
    const blocks = prepared.frames[1]?.message.content ?? []
    expect(blocks.map((block) => block.type)).toEqual(["text", "tool_use"])
    expect(blocks[1]?.name).toBe(`mcp__dsh__${alias}`)
  })
})

describe("native replay", () => {
  const history = (
    message = assistant(
      writingContent(),
      withCarrier(carrierFor(writingContent(), [writingNative()])),
    ),
  ): Messages => [user("write"), message, toolResult("t1", "ok")]

  it("replays the native turn when the stored message still matches its projection", async () => {
    const prepared = await prepare(history())
    expect(prepared.frames[1]).toEqual({
      type: "assistant",
      message: withoutUsage(writingNative()),
    })
    expect(JSON.stringify(prepared.frames[1])).toContain("opaque")
  })

  it("drops the native usage so a compacted history does not trip the size gate", async () => {
    const stored = writingNative()
    const prepared = await prepare(
      history(assistant(writingContent(), withCarrier(carrierFor(writingContent(), [stored])))),
    )
    expect(prepared.frames[1]?.message).not.toHaveProperty("usage")
    expect(stored.usage).toEqual(USAGE)
  })

  it("keeps the native turn when only the tool result changed", async () => {
    const compacted: Messages = [
      user("write"),
      assistant(writingContent(), withCarrier(carrierFor(writingContent(), [writingNative()]))),
      toolResult("t1", "[tool result demoted]"),
    ]
    const prepared = await prepare(compacted)
    expect(prepared.frames[1]?.message.content).toEqual(withoutUsage(writingNative()).content)
  })

  it("replays several native messages as several frames", async () => {
    const second: CapturedMessage = {
      role: "assistant",
      content: [{ type: "text", text: "More." }],
      usage: USAGE,
    }
    const content = [text("Writing. More.")]
    const message = assistant(content, withCarrier(carrierFor(content, [writingNative(), second])))
    const prepared = await prepare([user("go"), message, user("next")])
    expect(prepared.frames.map((frame) => frame.type)).toEqual([
      "user",
      "assistant",
      "assistant",
      "user",
    ])
  })

  it("replays canonical text and tool calls once the host edited the message", async () => {
    const edited = assistant(
      [text("Hook replacement"), toolCall("t1", "write_file", WRITING_INPUT)],
      withCarrier(carrierFor(writingContent(), [writingNative()])),
    )
    const prepared = await prepare(history(edited))
    const blocks = prepared.frames[1]?.message.content ?? []
    expect(blocks.map((block) => block.type)).toEqual(["text", "tool_use"])
    expect(blocks[0]?.text).toBe("Hook replacement")
    expect(blocks[1]?.input).toEqual(WRITING_INPUT)
    expect(JSON.stringify(blocks)).not.toContain("opaque")
  })

  it("replays the native turn when the stored model is another spelling of the same route", async () => {
    const carrier = withCarrier(carrierFor(writingContent(), [writingNative()]))
    for (const stored of ["claude-sonnet-5-5", "claude-sonnet-5-5[1m]"]) {
      const prepared = await prepare(history(assistant(writingContent(), carrier, stored)))
      expect(JSON.stringify(prepared.frames[1]), stored).toContain("opaque")
    }
  })

  it("replays canonical blocks once the model changed, because the signatures belong to the old one", async () => {
    const message = assistant(
      writingContent(),
      withCarrier(carrierFor(writingContent(), [writingNative()])),
      "opus",
    )
    const prepared = await prepare(history(message))
    const blocks = prepared.frames[1]?.message.content ?? []
    expect(blocks.map((block) => block.type)).toEqual(["text", "tool_use"])
    expect(JSON.stringify(blocks)).not.toContain("opaque")
  })

  it("replays canonical blocks for a carrier with another version or shape", async () => {
    const states = [
      { response: { ...carrierFor(writingContent(), [writingNative()]), version: 999 } },
      { response: { kind: "claude-subscription", version: 1, messages: "bad", projection: {} } },
      { response: { kind: "someone-else" } },
      { response: undefined },
      { response: null },
    ]
    for (const state of states) {
      const prepared = await prepare(history(assistant(writingContent(), state)))
      const blocks = prepared.frames[1]?.message.content ?? []
      expect(
        blocks.map((block) => block.type),
        JSON.stringify(state),
      ).toEqual(["text", "tool_use"])
    }
  })

  it("does not change the stored messages", async () => {
    const stored = history()
    const before = structuredClone(stored)
    await prepare(stored)
    expect(stored).toEqual(before)
  })
})

describe("images", () => {
  const ref = imageRef()
  const base64 = Buffer.from(PNG_BYTES).toString("base64")

  it("sends handle text and the request version of each image", async () => {
    const reader = recordingReader(320, 240)
    const prepared = await prepare([user([text("look"), imageBlock(ref)])], {}, withReader(reader))
    expect(prepared.frames[0]?.message.content).toEqual([
      { type: "text", text: "look" },
      { type: "text", text: requestImageHandleText(ref, { width: 320, height: 240 }) },
      { type: "image", source: { type: "base64", media_type: "image/png", data: base64 } },
    ])
  })

  it("names an image that has a display name the way DSH does", async () => {
    const named = imageRef({ name: "shot.png" })
    const prepared = await prepare([user([imageBlock(named)])], {}, withReader(recordingReader()))
    expect(prepared.frames[0]?.message.content[0]?.text).toBe(
      requestImageHandleText(named, { width: 320, height: 240 }),
    )
  })

  it("asks for the stored size when the image fits the pixel budget", async () => {
    const reader = recordingReader()
    const signal = new AbortController().signal
    await prepare([user([imageBlock(ref)])], { signal }, withReader(reader))
    expect(reader.calls).toEqual([
      [ref, { width: 640, height: 480, maxBytes: 1024 * 1024 }, signal],
    ])
  })

  it("scales a large image down to the pixel budget and keeps its shape", async () => {
    const reader = recordingReader()
    const large = imageRef({ width: 4000, height: 3000 })
    await prepare([user([imageBlock(large)])], {}, withReader(reader))
    const target = reader.calls[0]?.[1]
    expect(target).toBeDefined()
    expect((target?.width ?? 0) * (target?.height ?? 0)).toBeLessThanOrEqual(4194304)
    expect(Math.abs((target?.width ?? 0) / (target?.height ?? 1) - 4 / 3)).toBeLessThan(0.01)
  })

  it("reads an image used twice once", async () => {
    const reader = recordingReader()
    await prepare(
      [user([imageBlock(ref)]), assistant([text("ok")]), user([imageBlock(ref)])],
      {},
      withReader(reader),
    )
    expect(reader.calls).toHaveLength(1)
  })

  it("sends images from a tool result inside the result", async () => {
    const prepared = await prepare(
      [
        user("look"),
        assistant([toolCall("c1", "look")]),
        toolResult("c1", [text("image:"), imageBlock(ref)]),
      ],
      {},
      withReader(recordingReader()),
    )
    expect(prepared.frames[2]?.message.content).toEqual([
      {
        type: "tool_result",
        tool_use_id: "c1",
        content: [
          { type: "text", text: "image:" },
          { type: "text", text: requestImageHandleText(ref, { width: 320, height: 240 }) },
          { type: "image", source: { type: "base64", media_type: "image/png", data: base64 } },
        ],
      },
    ])
  })

  it("sends placeholder text for an offloaded image without reading it", async () => {
    const reader = recordingReader()
    const prepared = await prepare([user([imageBlock(ref, true)])], {}, withReader(reader))
    expect(prepared.frames[0]?.message.content).toEqual([
      { type: "text", text: offloadedImageText(ref) },
    ])
    expect(reader.calls).toEqual([])
  })

  describe("with a read-only path for the image", () => {
    const access = { readonlyPath: "/work/.dsh/attachments/abab.png" }
    const imageAccess = () => access

    it("names the path beside a retained image, in a user message and in a tool result", async () => {
      const prepared = await prepare(
        [
          user([imageBlock(ref)]),
          assistant([toolCall("c1", "look")]),
          toolResult("c1", [imageBlock(ref)]),
        ],
        {},
        withReader(recordingReader(), imageAccess),
      )
      const expected = requestImageHandleText(ref, { width: 320, height: 240 }, access)
      expect(prepared.frames[0]?.message.content[0]).toEqual({ type: "text", text: expected })
      expect(JSON.stringify(prepared.frames[2]?.message.content)).toContain(access.readonlyPath)
    })

    it("names the path in the placeholder of an offloaded image", async () => {
      const prepared = await prepare(
        [user([imageBlock(ref, true)])],
        {},
        withReader(recordingReader(), imageAccess),
      )
      expect(prepared.frames[0]?.message.content).toEqual([
        { type: "text", text: offloadedImageText(ref, access) },
      ])
    })

    it("asks for the path of the image it names, by its own reference", async () => {
      const seen: (string | undefined)[] = []
      const other = imageRef({ name: "other" })
      await prepare(
        [user([imageBlock(ref), imageBlock(other, true)])],
        {},
        withReader(recordingReader(), (asked) => {
          seen.push(asked.name)
          return access
        }),
      )
      expect(seen).toEqual([undefined, "other"])
    })
  })

  describe("the request image budget", () => {
    const MIB = 1024 * 1024
    const refs = [0, 1, 2, 3].map((n) =>
      imageRef({ attachmentId: AttachmentId(`sha256:${String(n).repeat(64)}`) }),
    )
    type Blocks = ReturnType<typeof imageBlock>[]
    const messagesOf = (blocks: Blocks) => blocks.map((block) => user([block]))
    const retained = (count: number): Blocks => refs.slice(0, count).map((r) => imageBlock(r))

    function oracle(blocks: Blocks, bytes: number): number {
      return requiredImageOffload(
        messagesOf(blocks),
        { representation: "base64", maxBytes: 20 * MIB },
        () => bytes,
      )
    }

    it("passes when the base64 size of all retained images fits 20 MiB", async () => {
      const blocks = retained(3)
      expect(oracle(blocks, 4 * MIB)).toBe(0)
      await expect(
        prepare(messagesOf(blocks), {}, withReader(sizedReader(4 * MIB))),
      ).resolves.toBeDefined()
    })

    it.each([
      [3, 6 * MIB],
      [4, 6 * MIB],
      [4, 12 * MIB],
    ])(
      "asks to offload as many images as DSH counts (%i images of %i bytes)",
      async (count, bytes) => {
        const blocks = retained(count)
        const needed = oracle(blocks, bytes)
        expect(needed).toBeGreaterThan(0)
        const failure = await prepare(messagesOf(blocks), {}, withReader(sizedReader(bytes))).catch(
          (error: unknown) => error,
        )
        expect(failure).toMatchObject({
          code: FailureCode.imageOffloadRequired,
          failure: { code: "IMAGE_OFFLOAD_REQUIRED", offloadImages: needed },
        })
      },
    )

    it("does not count an image DSH already offloaded", async () => {
      const blocks = [imageBlock(refs[0] ?? ref, true), ...retained(3).slice(1)]
      expect(oracle(blocks, 6 * MIB)).toBe(0)
      await expect(
        prepare(messagesOf(blocks), {}, withReader(sizedReader(6 * MIB))),
      ).resolves.toBeDefined()
    })

    it("counts the same image once for each place it appears", async () => {
      const blocks = [0, 1, 2].map(() => imageBlock(ref))
      const failure = await prepare(messagesOf(blocks), {}, withReader(sizedReader(6 * MIB))).catch(
        (error: unknown) => error,
      )
      expect(failure).toMatchObject({ failure: { offloadImages: oracle(blocks, 6 * MIB) } })
    })
  })

  it("fails when the request has an image and no attachment service", async () => {
    await rejection(prepare([user([imageBlock(ref)])])).toMatchObject({
      code: FailureCode.invalidRequest,
    })
  })

  it("rejects an image in an assistant message", async () => {
    const message = assistant([imageBlock(ref)])
    await rejection(
      prepare([user("go"), message, user("more")], {}, withReader(recordingReader())),
    ).toMatchObject({
      code: FailureCode.invalidRequest,
    })
  })

  it("passes a failed read on", async () => {
    const failing: AttachmentReader = {
      readImageRequest: () => Promise.reject(new Error("store is gone")),
    }
    await rejection(prepare([user([imageBlock(ref)])], {}, withReader(failing))).toThrow(
      "store is gone",
    )
  })
})
