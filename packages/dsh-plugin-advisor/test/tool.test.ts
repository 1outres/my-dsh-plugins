import type { GenerateOptions, Message, StreamChunk, ToolSchema } from "@deepseek-ai/dsh-llm"
import { ToolContextUnavailableError, type ToolRunContext } from "@deepseek-ai/dsh-tools"
import { describe, expect, it } from "vitest"
import type { AdvisorSettings } from "../src/contract"
import { AdvisorError } from "../src/host/errors"
import { createAdvisorTool } from "../src/host/tool"
import { assistant, call, READ_TOOL, system, text, user } from "./support"

const SETTINGS: AdvisorSettings = {
  route: { provider: "claude", model: "opus" },
  adviceWordLimit: 150,
  timeoutMs: 60000,
}

interface SessionShape {
  readonly messages: readonly Message[]
  readonly header: { readonly tools?: readonly ToolSchema[] } | undefined
}

function agentOf(shape: SessionShape) {
  return {
    id: "a1",
    session: {
      id: "s1",
      deriveMessages: () => [...shape.messages],
      requestHeader: () => shape.header,
    },
  }
}

function execOf(agent: unknown, parent?: symbol): ToolRunContext {
  return {
    callId: "c9",
    rootCallId: "c9",
    name: "advisor",
    arguments: {},
    agent,
    signal: new AbortController().signal,
    ...(parent === undefined ? {} : { parent }),
    deferContext: () => {},
    concludeTurn: () => {},
  } as unknown as ToolRunContext
}

function setup(settings: () => AdvisorSettings = () => SETTINGS) {
  const calls: GenerateOptions[] = []
  const tool = createAdvisorTool({
    settings,
    ports: {
      stream: (options) => {
        calls.push(options)
        return reply("Write the test first.")
      },
      fileText: () => "",
    },
  })
  return { tool, calls }
}

async function* reply(value: string): AsyncIterable<StreamChunk> {
  yield { type: "block-start", index: 0, blockType: "text" }
  yield { type: "text-delta", index: 0, text: value }
  yield { type: "block-end", index: 0, block: { type: "text", text: value } }
  yield { type: "finish", reason: { kind: "stop" } }
}

const SESSION: SessionShape = {
  messages: [
    system("Agent."),
    user([text("Add a feature.")]),
    assistant([call("c9", "advisor", "{}")]),
  ],
  header: { tools: [READ_TOOL] },
}

function textOf(options: GenerateOptions | undefined, index: number): string {
  const block = options?.messages.at(index)?.content[0]
  if (block?.type !== "text") throw new Error("expected a text block")
  return block.text
}

describe("advisor tool", () => {
  it("is an advisor tool with no parameters", () => {
    const { tool } = setup()
    expect(tool.name).toBe("advisor")
    expect(tool.parameters).toMatchObject({ type: "object" })
    expect(Object.keys((tool.parameters as { properties?: object }).properties ?? {})).toEqual([])
  })

  it("asks the advisor about the calling session and returns its advice", async () => {
    const { tool, calls } = setup()
    const value = await tool.execute({}, execOf(agentOf(SESSION)))

    expect(value).toEqual({
      advice: "Write the test first.",
      model: "claude/opus",
      truncated: false,
    })
    expect(calls).toHaveLength(1)
    expect(textOf(calls[0], 0)).toContain('<tool name="read">')
    expect(textOf(calls[0], 1)).toBe("<executor_system_prompt>\nAgent.\n</executor_system_prompt>")
    expect(textOf(calls[0], 3)).toContain('<tool_call id="c9" name="advisor">')
    expect(calls[0]?.sessionId).toBe("s1")
  })

  it("renders the advice as the model-facing result", () => {
    const { tool } = setup()
    expect(
      tool.output.render({}, { advice: "Do X.", model: "claude/opus", truncated: false }),
    ).toEqual([{ type: "text", text: "Do X." }])
  })

  it("notes truncated advice in the model-facing result", () => {
    const { tool } = setup()
    expect(
      tool.output.render({}, { advice: "Do X", model: "claude/opus", truncated: true }),
    ).toEqual([
      { type: "text", text: "Do X\n\n[The advice was cut off by the advisor output limit.]" },
    ])
  })

  it("tells the advisor when the call came from inside a program", async () => {
    const { tool, calls } = setup()
    await tool.execute({}, execOf(agentOf(SESSION), Symbol("run_code")))
    expect(textOf(calls[0], -1)).toContain("from inside a run_code program")
  })

  it("passes a tool-less request header as no tools", async () => {
    const { tool, calls } = setup()
    await tool.execute({}, execOf(agentOf({ ...SESSION, header: {} })))
    expect(textOf(calls[0], 0)).toBe("<executor_tools>\nnone\n</executor_tools>")
  })

  it("needs a calling agent", async () => {
    const { tool } = setup()
    await expect(tool.execute({}, execOf(undefined))).rejects.toBeInstanceOf(
      ToolContextUnavailableError,
    )
  })

  it("needs a session that has made a model request", async () => {
    const { tool } = setup()
    await expect(
      tool.execute({}, execOf(agentOf({ ...SESSION, header: undefined }))),
    ).rejects.toBeInstanceOf(ToolContextUnavailableError)
  })

  it("fails loud on an incomplete advisor route", async () => {
    const { tool, calls } = setup(() => {
      throw new AdvisorError("invalid_config", "set both provider and model")
    })
    await expect(tool.execute({}, execOf(agentOf(SESSION)))).rejects.toBeInstanceOf(AdvisorError)
    expect(calls).toHaveLength(0)
  })

  it("shows its own card titles", () => {
    const { tool } = setup()
    expect(tool.presentCall?.({})).toEqual({ card: "generic", title: "Advisor", kind: "other" })
    const content = [{ type: "text" as const, text: "Do X." }]
    expect(tool.presentResult?.({}, { content, isError: false })).toEqual({
      card: "generic",
      title: "Advisor reviewed",
      content,
    })
    expect(tool.presentResult?.({}, { content, isError: true })).toEqual({
      card: "generic",
      title: "Advisor unavailable",
      content,
    })
  })
})
