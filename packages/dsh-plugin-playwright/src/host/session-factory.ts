import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Agent } from "@deepseek-ai/dsh-agent"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import playwrightMcp from "@playwright/mcp"
import type { BrowserContext } from "playwright"
import { VERSION } from "../version"
import type { SharedBrowser } from "./browser"
import type { SessionFactory } from "./registry"
import { PlaywrightSession } from "./session"

const CLIENT_NAME = "dsh-playwright"

type McpServer = Awaited<ReturnType<typeof playwrightMcp.createConnection>>

export class PlaywrightSessionFactory implements SessionFactory<PlaywrightSession> {
  readonly #browser: SharedBrowser
  readonly #toolCallTimeoutMs: number

  constructor(browser: SharedBrowser, toolCallTimeoutMs: number) {
    this.#browser = browser
    this.#toolCallTimeoutMs = toolCallTimeoutMs
  }

  async create(root: Agent): Promise<PlaywrightSession> {
    const outputDir = await mkdtemp(join(tmpdir(), "dsh-playwright-"))
    let context: BrowserContext | undefined
    let server: McpServer | undefined
    let client: Client | undefined
    try {
      context = await this.#browser.newContext()
      const sessionContext = context
      server = await playwrightMcp.createConnection(
        {
          browser: { isolated: false },
          capabilities: [],
          outputDir,
        },
        async () => sessionContext,
      )
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      await server.connect(serverTransport)
      client = new Client({ name: CLIENT_NAME, version: VERSION })
      await client.connect(clientTransport)
      return new PlaywrightSession({
        sessionId: root.id,
        context: sessionContext,
        connection: { client, server },
        outputDir,
        toolCallTimeoutMs: this.#toolCallTimeoutMs,
      })
    } catch (error) {
      if (client !== undefined) await client.close().catch(() => undefined)
      if (server !== undefined) await server.close().catch(() => undefined)
      if (context !== undefined) await context.close().catch(() => undefined)
      await rm(outputDir, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }
}
