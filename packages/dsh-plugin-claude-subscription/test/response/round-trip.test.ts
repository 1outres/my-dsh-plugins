import { BlockAssembler, createAssistantMessage, type GenerateOptions } from "@deepseek-ai/dsh-llm"
import { describe, expect, it } from "vitest"
import type {
  NativeAssistantFrame,
  NativeBlock,
  NativeCompletion,
  NativeStreamEvent,
} from "../../src/contract"
import { prepareRequest } from "../../src/request/prepare"
import { projectionOf } from "../../src/request/replay"
import { ChunkTranslator } from "../../src/response/chunks"
import { user } from "../support/messages"
import {
  captured,
  completion,
  textEvents,
  thinkingEvents,
  toolEvents,
} from "../support/native-stream"

const SIGNED: NativeBlock = { type: "thinking", thinking: "hm", signature: "sig" }
const TEXT: NativeBlock = { type: "text", text: "hello" }

/** One answer as the DSH loop stores it, followed by the next user turn. */
function historyAfter(events: readonly NativeStreamEvent[], done: NativeCompletion) {
  const translator = new ChunkTranslator({
    toolNames: new Map([["probe", "probe"]]),
    projectionOf,
  })
  const assembler = new BlockAssembler()
  for (const event of events) for (const chunk of translator.event(event)) assembler.push(chunk)
  for (const chunk of translator.complete(done)) assembler.push(chunk)
  const stored = createAssistantMessage({
    content: assembler.blocks(),
    source: {
      provider: "claude-subscription",
      model: "opus",
      ...(assembler.replayState === undefined ? {} : { replayState: assembler.replayState }),
    },
  })
  return { stored, assembler }
}

async function replayedTurn(stored: ReturnType<typeof createAssistantMessage>) {
  const options: GenerateOptions = {
    provider: "claude-subscription",
    model: "opus",
    messages: [user("first"), stored, user("next")],
  }
  const prepared = await prepareRequest(options, {
    attachments: () => undefined,
    imageAccess: () => undefined,
  })
  const frame = prepared.frames.find((candidate) => candidate.type === "assistant")
  return frame as NativeAssistantFrame
}

describe("a stored answer on the next request", () => {
  it("replays the native turn, signed thinking included, with no usage (#92)", async () => {
    const message = captured([SIGNED, TEXT], "end_turn")
    const { stored } = historyAfter(
      [...thinkingEvents(0, "hm"), ...textEvents(1, "hello")],
      completion(message),
    )
    const { message: replayed } = await replayedTurn(stored)
    expect(replayed.content).toEqual([SIGNED, TEXT])
    expect(replayed).not.toHaveProperty("usage")
  })

  it("replays the name the CLI was offered, not its slip (#62)", async () => {
    const { stored } = historyAfter(
      toolEvents(0, "t1", "probe", "{}"),
      completion(captured([{ type: "tool_use", id: "t1", name: "probe", input: {} }], "tool_use")),
    )
    const { message: replayed } = await replayedTurn(stored)
    expect(replayed.content[0]?.name).toBe("mcp__dsh__probe")
  })

  it("replays canonical blocks after an edit, never stale signed thinking", async () => {
    const { stored } = historyAfter(
      [...thinkingEvents(0, "hm"), ...textEvents(1, "hello")],
      completion(captured([SIGNED, TEXT], "end_turn")),
    )
    const edited = createAssistantMessage({
      content: [{ type: "text", text: "edited" }],
      source: {
        provider: stored.source.provider,
        model: stored.source.model,
        replayState: stored.source.replayState,
      },
    })
    const { message: replayed } = await replayedTurn(edited)
    expect(replayed.content).toEqual([{ type: "text", text: "edited" }])
  })

  it("replays no orphan tool_use from a reply cut off at max tokens", async () => {
    const { stored, assembler } = historyAfter(
      [...textEvents(0, "hello"), ...toolEvents(1, "t1", "mcp__dsh__probe", "{}")],
      completion(
        captured(
          [TEXT, { type: "tool_use", id: "t1", name: "mcp__dsh__probe", input: {} }],
          "max_tokens",
        ),
      ),
    )
    expect(assembler.finish).toEqual({ kind: "max-tokens" })
    const { message: replayed } = await replayedTurn(stored)
    expect(replayed.content).toEqual([TEXT])
  })
})
