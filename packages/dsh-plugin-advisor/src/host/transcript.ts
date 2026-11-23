import type { ContentBlock, Message, RequestUserInput, ToolSchema } from "@deepseek-ai/dsh-llm"
import type { ExecutorRecords, RenderOptions } from "../contract"
import { CONSULT_REQUEST, NESTED_CALL_NOTE } from "./prompts"

export function renderRecords(
  records: ExecutorRecords,
  options: RenderOptions,
): RequestUserInput[] {
  const texts = [
    renderTools(records.tools),
    ...records.messages.flatMap((message) => renderMessage(message, options)),
    renderRequest(options.nested),
  ]
  return texts.map((text) => ({ role: "user", content: [{ type: "text", text }] }))
}

function renderTools(tools: readonly ToolSchema[]): string {
  const body =
    tools.length === 0
      ? "none"
      : tools
          .map(
            (tool) =>
              `<tool name="${tool.name}">\n${tool.description}\nparameters: ${JSON.stringify(tool.parameters)}\n</tool>`,
          )
          .join("\n")
  return wrap("executor_tools", body)
}

function renderRequest(nested: boolean): string {
  return nested ? `${CONSULT_REQUEST}\n${NESTED_CALL_NOTE}` : CONSULT_REQUEST
}

function renderMessage(message: Message, options: RenderOptions): string[] {
  const body = message.content
    .map((block) => renderBlock(block, options))
    .filter((text) => text !== "")
    .join("\n")
  if (body === "") return []
  switch (message.role) {
    case "system":
      return [wrap("executor_system_prompt", body)]
    case "user":
      return [wrap(`user_message source="${message.source.kind}"`, body, "user_message")]
    case "assistant":
      return [wrap("executor_message", body)]
    case "tool":
      return [
        wrap(
          `tool_result call_id="${message.toolCallId}" status="${message.isError === true ? "error" : "ok"}"`,
          body,
          "tool_result",
        ),
      ]
    case "developer":
      return [wrap("tool_change", body)]
  }
}

function renderBlock(block: ContentBlock, options: RenderOptions): string {
  switch (block.type) {
    case "text":
      return block.text
    case "reasoning":
      return ""
    case "image":
      return "[image attachment]"
    case "file":
      return options.fileText(block.attachment)
    case "tool-call":
      return wrap(`tool_call id="${block.id}" name="${block.name}"`, block.arguments, "tool_call")
    case "tool-addition":
      return `[tool added: ${block.toolName}]`
    case "tool-removal":
      return `[tool removed: ${block.toolName}]`
  }
}

function wrap(open: string, body: string, close = open): string {
  return `<${open}>\n${body}\n</${close}>`
}
