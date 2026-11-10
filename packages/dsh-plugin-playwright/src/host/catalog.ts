import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { Tool } from "@modelcontextprotocol/sdk/types.js"
import playwrightMcp from "@playwright/mcp"
import { VERSION } from "../version"

export interface UpstreamTool {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
  readonly outputSchema?: Record<string, unknown>
  readonly readOnly: boolean
  readonly taskRequired: boolean
}

/** Tools that would close or replace the browser shared by every session. */
export const EXCLUDED_TOOLS: ReadonlySet<string> = new Set([
  "browser_close",
  "browser_install",
  "browser_run_code_unsafe",
])

const CLIENT_NAME = "dsh-playwright-catalog"

export function selectTools(tools: readonly UpstreamTool[]): UpstreamTool[] {
  const seen = new Set<string>()
  const selected: UpstreamTool[] = []
  for (const tool of tools) {
    if (EXCLUDED_TOOLS.has(tool.name)) continue
    if (seen.has(tool.name)) {
      throw new Error(`Playwright MCP listed tool "${tool.name}" more than once`)
    }
    seen.add(tool.name)
    selected.push(tool)
  }
  return selected
}

export async function loadUpstreamTools(): Promise<UpstreamTool[]> {
  const server = await playwrightMcp.createConnection({
    browser: { isolated: false },
    capabilities: [],
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  let client: Client | undefined
  try {
    await server.connect(serverTransport)
    client = new Client({ name: CLIENT_NAME, version: VERSION })
    await client.connect(clientTransport)
    const response = await client.listTools()
    return response.tools.map(fromMcpTool)
  } finally {
    if (client !== undefined) await client.close().catch(() => undefined)
    await server.close().catch(() => undefined)
  }
}

function fromMcpTool(tool: Tool): UpstreamTool {
  return {
    name: tool.name,
    title: tool.title ?? tool.annotations?.title ?? tool.name,
    description: tool.description ?? "",
    inputSchema: tool.inputSchema as Record<string, unknown>,
    ...(tool.outputSchema === undefined
      ? {}
      : { outputSchema: tool.outputSchema as Record<string, unknown> }),
    readOnly: tool.annotations?.readOnlyHint === true,
    taskRequired: tool.execution?.taskSupport === "required",
  }
}
