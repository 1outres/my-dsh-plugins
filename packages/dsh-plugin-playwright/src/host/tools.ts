import type { Context } from "@deepseek-ai/cordis"
import type { Agent } from "@deepseek-ai/dsh-agent"
import { createMcpToolDefinition } from "@deepseek-ai/dsh-mcp-client"
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools"
import type { UpstreamTool } from "./catalog"
import { requireAgent, resolveRootAgent } from "./root"

export interface BrowserToolSession {
  call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>
}

export interface BrowserToolRegistry {
  acquire(root: Agent): Promise<BrowserToolSession>
}

type ToolContent = ReturnType<ToolDefinition["output"]["render"]>

export function registerPlaywrightTools(
  ctx: Context,
  registry: BrowserToolRegistry,
  tools: readonly UpstreamTool[],
  maxOutputBytes: number,
): void {
  for (const tool of tools) {
    const definition = createMcpToolDefinition(ctx, {
      name: tool.name,
      rawName: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
      taskRequired: tool.taskRequired,
      call: async (args: Record<string, unknown>, exec: ToolRunContext) => {
        const agent = requireAgent(exec)
        const root = resolveRootAgent(ctx, agent)
        const session = await registry.acquire(root)
        return await session.call(tool.name, args, exec.signal)
      },
    })
    ctx.tools.register(limitOutput(definition, tool, maxOutputBytes))
  }
}

function limitOutput(
  definition: ToolDefinition,
  tool: UpstreamTool,
  maxOutputBytes: number,
): ToolDefinition {
  const projectContent = definition.projectContent
  return {
    ...definition,
    output: {
      ...definition.output,
      render: (args, value) => capContent(definition.output.render(args, value), maxOutputBytes),
    },
    ...(projectContent === undefined
      ? {}
      : {
          projectContent: (exec, result) => {
            const content = projectContent(exec, result)
            return content === undefined ? undefined : capContent(content, maxOutputBytes)
          },
        }),
    presentCall: () => ({
      card: "generic",
      title: tool.title,
      kind: tool.readOnly ? "read" : "other",
    }),
  }
}

function capContent(blocks: ToolContent, maxBytes: number): ToolContent {
  let remaining = maxBytes
  let truncated = false
  const capped: ToolContent = []
  for (const block of blocks) {
    if (block.type !== "text") {
      capped.push(block)
      continue
    }
    const bytes = Buffer.byteLength(block.text, "utf8")
    if (bytes <= remaining) {
      capped.push(block)
      remaining -= bytes
      continue
    }
    truncated = true
    if (remaining === 0) continue
    capped.push({ ...block, text: utf8Head(block.text, remaining) })
    remaining = 0
  }
  if (!truncated) return capped
  const last = capped.at(-1)
  if (last?.type === "text") {
    capped[capped.length - 1] = { ...last, text: `${last.text}\n[output truncated]` }
  } else {
    capped.push({ type: "text", text: "[output truncated]" })
  }
  return capped
}

/** Keep at most maxBytes of a UTF-8 string without cutting a character in half. */
function utf8Head(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, "utf8")
  if (bytes.length <= maxBytes) return text
  let end = maxBytes
  while (end > 0 && (bytes[end] ?? 0) >= 0x80 && (bytes[end] ?? 0) <= 0xbf) end -= 1
  return bytes.subarray(0, end).toString("utf8")
}
