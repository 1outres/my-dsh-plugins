import { existsSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { Browser, BrowserContext } from "playwright"
import { describe, expect, test } from "vitest"
import { PlaywrightSession } from "../src/host/session"

class FakeContext {
  connected = true
  closeCount = 0
  #listeners: Array<() => void> = []

  once(event: string, listener: () => void): void {
    if (event === "close") this.#listeners.push(listener)
  }

  browser(): Browser {
    return { isConnected: () => this.connected } as Browser
  }

  async close(): Promise<void> {
    this.closeCount += 1
    this.connected = false
    for (const listener of this.#listeners) listener()
  }

  closeFromOutside(): void {
    this.connected = false
    for (const listener of this.#listeners) listener()
  }
}

class FakeClient {
  onclose: (() => void) | undefined
  closeCount = 0
  calls: unknown[] = []
  result: unknown = { content: [{ type: "text", text: "ok" }] }

  async callTool(params: unknown): Promise<unknown> {
    this.calls.push(params)
    return this.result
  }

  async close(): Promise<void> {
    this.closeCount += 1
    this.onclose?.()
  }
}

class FakeServer {
  closeCount = 0

  async close(): Promise<void> {
    this.closeCount += 1
  }
}

async function makeSession(): Promise<{
  session: PlaywrightSession
  context: FakeContext
  client: FakeClient
  server: FakeServer
  outputDir: string
}> {
  const outputDir = await mkdtemp(join(tmpdir(), "dsh-playwright-test-"))
  const context = new FakeContext()
  const client = new FakeClient()
  const server = new FakeServer()
  const session = new PlaywrightSession({
    sessionId: "root",
    context: context as unknown as BrowserContext,
    connection: { client: client as unknown as Client, server },
    outputDir,
    toolCallTimeoutMs: 1000,
  })
  return { session, context, client, server, outputDir }
}

describe("PlaywrightSession", () => {
  test("forwards a call while its context and connection are alive", async () => {
    const { session, client } = await makeSession()
    const result = await session.call(
      "browser_navigate",
      { url: "https://example.com" },
      new AbortController().signal,
    )
    expect(result).toEqual({ content: [{ type: "text", text: "ok" }] })
    expect(client.calls).toEqual([
      { name: "browser_navigate", arguments: { url: "https://example.com" } },
    ])
    expect(session.isAlive()).toBe(true)
  })

  test("refuses a call after the context closes", async () => {
    const { session, context } = await makeSession()
    context.closeFromOutside()
    expect(session.isAlive()).toBe(false)
    await expect(
      session.call("browser_snapshot", {}, new AbortController().signal),
    ).rejects.toThrow(/is closed/)
  })

  test("refuses a call after the MCP connection closes", async () => {
    const { session, client } = await makeSession()
    client.onclose?.()
    expect(session.isAlive()).toBe(false)
    await expect(
      session.call("browser_snapshot", {}, new AbortController().signal),
    ).rejects.toThrow(/is closed/)
  })

  test("closes the connection, the server, the context, and the output directory once", async () => {
    const { session, context, client, server, outputDir } = await makeSession()
    expect(existsSync(outputDir)).toBe(true)
    await session.dispose()
    await session.dispose()
    expect(client.closeCount).toBe(1)
    expect(server.closeCount).toBe(1)
    expect(context.closeCount).toBe(1)
    expect(existsSync(outputDir)).toBe(false)
  })
})
