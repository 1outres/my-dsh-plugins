import { spawn } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { JsonObject, ToolManifestEntry } from "../../src/contract"

const SCRIPT = fileURLToPath(new URL("../../src/standalone/inert-mcp.ts", import.meta.url))

const MANIFEST: ToolManifestEntry[] = [
  { name: "probe", description: "TAIL", inputSchema: { type: "object", properties: {} } },
]

/** Sends JSON-RPC rows to the server, closes stdin, and returns every answer. */
async function exchange(manifestPath: string, rows: readonly JsonObject[]): Promise<JsonObject[]> {
  const child = spawn(process.execPath, [SCRIPT, manifestPath], {
    stdio: ["pipe", "pipe", "ignore"],
  })
  const answers: JsonObject[] = []
  const reading = (async () => {
    for await (const line of createInterface({ input: child.stdout })) {
      answers.push(JSON.parse(line) as JsonObject)
    }
  })()
  const exited = new Promise((resolve) => child.once("close", resolve))
  child.stdin.end(rows.map((row) => `${JSON.stringify(row)}\n`).join(""))
  await reading
  await exited
  return answers
}

describe("inert MCP server", () => {
  let root: string
  let manifestPath: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "inert-mcp-test-"))
    manifestPath = join(root, "tools.json")
    writeFileSync(manifestPath, JSON.stringify(MANIFEST))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it("answers initialize with its capabilities", async () => {
    const [answer] = await exchange(manifestPath, [{ jsonrpc: "2.0", id: 1, method: "initialize" }])
    expect(answer).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: "2024-11-05", capabilities: { tools: {} } },
    })
  })

  it("lists the manifest as it stands", async () => {
    const [answer] = await exchange(manifestPath, [{ jsonrpc: "2.0", id: 2, method: "tools/list" }])
    expect(answer).toEqual({ jsonrpc: "2.0", id: 2, result: { tools: MANIFEST } })
  })

  it("denies every tool call", async () => {
    const [answer] = await exchange(manifestPath, [
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "probe", arguments: {} } },
    ])
    expect(answer).toMatchObject({ id: 3, result: { isError: true } })
    const result = answer?.result as { content: { type: string; text: string }[] }
    expect(result.content[0]?.text).toContain("Denied")
  })

  it("answers an unknown request with an empty result", async () => {
    const [answer] = await exchange(manifestPath, [{ jsonrpc: "2.0", id: 4, method: "ping" }])
    expect(answer).toEqual({ jsonrpc: "2.0", id: 4, result: {} })
  })

  it("stays silent on a notification", async () => {
    const answers = await exchange(manifestPath, [
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 5, method: "ping" },
    ])
    expect(answers.map((answer) => answer.id)).toEqual([5])
  })
})
