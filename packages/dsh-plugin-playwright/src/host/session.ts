import { rm } from "node:fs/promises"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { BrowserContext } from "playwright"

export interface SessionConnection {
  readonly client: Client
  readonly server: { close(): Promise<void> }
}

export interface PlaywrightSessionOptions {
  readonly sessionId: string
  readonly context: BrowserContext
  readonly connection: SessionConnection
  readonly outputDir: string
  readonly toolCallTimeoutMs: number
}

/** One root session's browser context and its private MCP connection. */
export class PlaywrightSession {
  readonly sessionId: string
  readonly #context: BrowserContext
  readonly #client: Client
  readonly #server: { close(): Promise<void> }
  readonly #outputDir: string
  readonly #toolCallTimeoutMs: number
  #contextClosed = false
  #connectionClosed = false
  #disposing: Promise<void> | undefined

  constructor(options: PlaywrightSessionOptions) {
    this.sessionId = options.sessionId
    this.#context = options.context
    this.#client = options.connection.client
    this.#server = options.connection.server
    this.#outputDir = options.outputDir
    this.#toolCallTimeoutMs = options.toolCallTimeoutMs
    this.#context.once("close", () => {
      this.#contextClosed = true
    })
    this.#client.onclose = () => {
      this.#connectionClosed = true
    }
  }

  isAlive(): boolean {
    if (this.#contextClosed || this.#connectionClosed) return false
    const browser = this.#context.browser()
    return browser?.isConnected() === true
  }

  async call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    if (!this.isAlive()) {
      throw new Error(`The Playwright browser for session ${this.sessionId} is closed; try again`)
    }
    return await this.#client.callTool({ name, arguments: args }, undefined, {
      signal,
      timeout: this.#toolCallTimeoutMs,
    })
  }

  async dispose(): Promise<void> {
    this.#disposing ??= this.#disposeAll()
    await this.#disposing
  }

  async #disposeAll(): Promise<void> {
    const failures: unknown[] = []
    const attempt = async (step: () => Promise<unknown>): Promise<void> => {
      try {
        await step()
      } catch (error) {
        failures.push(error)
      }
    }
    await attempt(async () => this.#client.close())
    await attempt(async () => this.#server.close())
    await attempt(async () => this.#context.close())
    await attempt(async () => rm(this.#outputDir, { recursive: true, force: true }))
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `Failed to dispose the Playwright session ${this.sessionId}`,
      )
    }
  }
}
