// Inventory only. The CLI starts this script to learn the tool list, and DSH runs every tool.
// It imports nothing from the plugin, because it is built to its own file and runs on its own.
import { readFileSync } from "node:fs"
import { createInterface } from "node:readline"

interface JsonRpcRequest {
  id?: unknown
  method?: unknown
}

const DENIAL = "Denied: native tools are inert; only DSH runs tools."

function resultFor(method: unknown, manifest: unknown): Record<string, unknown> {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "dsh-inert-inventory", version: "1" },
      }
    case "tools/list":
      return { tools: manifest }
    case "tools/call":
      return { isError: true, content: [{ type: "text", text: DENIAL }] }
    default:
      return {}
  }
}

async function main(manifestPath: string): Promise<void> {
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"))
  for await (const line of createInterface({ input: process.stdin })) {
    const request = JSON.parse(line) as JsonRpcRequest
    if (request.id === undefined) continue
    const answer = { jsonrpc: "2.0", id: request.id, result: resultFor(request.method, manifest) }
    process.stdout.write(`${JSON.stringify(answer)}\n`)
  }
}

const manifestPath = process.argv[2]
if (manifestPath === undefined) throw new Error("usage: inert-mcp <manifest path>")
await main(manifestPath)
