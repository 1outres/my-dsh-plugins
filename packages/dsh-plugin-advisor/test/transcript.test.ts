import type { ContentBlock, RequestUserInput } from "@deepseek-ai/dsh-llm"
import { describe, expect, it } from "vitest"
import type { FileAttachmentRef } from "../src/contract"
import { renderRecords } from "../src/host/transcript"
import {
  assistant,
  call,
  developer,
  READ_TOOL,
  reasoning,
  system,
  text,
  toolResult,
  user,
} from "./support"

const fileText = (ref: FileAttachmentRef) => `file text of ${JSON.stringify(ref)}`

function texts(messages: readonly RequestUserInput[]): string[] {
  return messages.map((message) => {
    expect(message.role).toBe("user")
    expect(message.content).toHaveLength(1)
    const [block] = message.content
    if (block?.type !== "text") throw new Error("expected one text block")
    return block.text
  })
}

describe("renderRecords", () => {
  it("quotes the tools, every message, and the request, one user message each", () => {
    const rendered = texts(
      renderRecords(
        {
          tools: [READ_TOOL],
          messages: [
            system("You are a coding agent."),
            user([text("Fix the bug.")]),
            assistant([
              reasoning("hidden thoughts"),
              text("Reading the file."),
              call("c1", "read", '{"path":"a.ts"}'),
            ]),
            toolResult("c1", "const a = 1"),
            assistant([call("c2", "advisor", "{}")]),
          ],
        },
        { nested: false, fileText },
      ),
    )

    expect(rendered).toEqual([
      '<executor_tools>\n<tool name="read">\nRead a file.\nparameters: {"type":"object","properties":{"path":{"type":"string"}}}\n</tool>\n</executor_tools>',
      "<executor_system_prompt>\nYou are a coding agent.\n</executor_system_prompt>",
      '<user_message source="user">\nFix the bug.\n</user_message>',
      '<executor_message>\nReading the file.\n<tool_call id="c1" name="read">\n{"path":"a.ts"}\n</tool_call>\n</executor_message>',
      '<tool_result call_id="c1" status="ok">\nconst a = 1\n</tool_result>',
      '<executor_message>\n<tool_call id="c2" name="advisor">\n{}\n</tool_call>\n</executor_message>',
      "The executor has just called advisor(). Give your guidance now.",
    ])
  })

  it("marks failed tool results, notices, attachments, and tool changes", () => {
    const image = { type: "image", attachment: { id: "img" } } as unknown as ContentBlock
    const file = { type: "file", attachment: { id: "doc" } } as unknown as ContentBlock
    const rendered = texts(
      renderRecords(
        {
          tools: [],
          messages: [
            user([text("See these."), image, file]),
            user([text("You are repeating a call.")], "repeat-tool-reminder"),
            developer([
              { type: "tool-addition", toolName: "advisor" } as ContentBlock,
              { type: "tool-removal", toolName: "old" } as ContentBlock,
            ]),
            toolResult("c3", "no such file", true),
          ],
        },
        { nested: false, fileText },
      ),
    )

    expect(rendered).toEqual([
      "<executor_tools>\nnone\n</executor_tools>",
      '<user_message source="user">\nSee these.\n[image attachment]\nfile text of {"id":"doc"}\n</user_message>',
      '<user_message source="repeat-tool-reminder">\nYou are repeating a call.\n</user_message>',
      "<tool_change>\n[tool added: advisor]\n[tool removed: old]\n</tool_change>",
      '<tool_result call_id="c3" status="error">\nno such file\n</tool_result>',
      "The executor has just called advisor(). Give your guidance now.",
    ])
  })

  it("drops messages that carry only reasoning or nothing", () => {
    const rendered = texts(
      renderRecords(
        { tools: [], messages: [system(""), assistant([reasoning("only thoughts")])] },
        { nested: false, fileText },
      ),
    )
    expect(rendered).toEqual([
      "<executor_tools>\nnone\n</executor_tools>",
      "The executor has just called advisor(). Give your guidance now.",
    ])
  })

  it("says which results are missing when advisor() runs inside a program", () => {
    const rendered = texts(renderRecords({ tools: [], messages: [] }, { nested: true, fileText }))
    expect(rendered.at(-1)).toBe(
      "The executor has just called advisor(). Give your guidance now.\nIt called advisor() from inside a run_code program. Calls that program made before advisor() and their results are not in these records.",
    )
  })

  it("keeps earlier records byte-identical as the conversation grows", () => {
    const first = [system("Agent."), user([text("Task.")])]
    const grown = [...first, assistant([call("c1", "advisor", "{}")])]
    const before = texts(
      renderRecords({ tools: [READ_TOOL], messages: first }, { nested: false, fileText }),
    )
    const after = texts(
      renderRecords({ tools: [READ_TOOL], messages: grown }, { nested: false, fileText }),
    )
    expect(after.slice(0, before.length - 1)).toEqual(before.slice(0, -1))
  })
})
