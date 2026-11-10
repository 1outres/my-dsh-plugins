import { existsSync } from "node:fs"
import { type Browser, type BrowserContext, chromium } from "playwright"
import type { ResolvedConfig } from "../config"

/** One browser process shared by every session context. */
export class SharedBrowser {
  readonly #config: ResolvedConfig
  #browser: Browser | undefined
  #launching: Promise<Browser> | undefined
  #closed = false

  constructor(config: ResolvedConfig) {
    this.#config = config
  }

  async get(): Promise<Browser> {
    if (this.#closed) throw new Error("The Playwright browser is closed")
    if (this.#browser?.isConnected() === true) return this.#browser
    if (this.#launching !== undefined) return await this.#launching
    const launching = this.#launch()
    this.#launching = launching
    try {
      return await launching
    } finally {
      if (this.#launching === launching) this.#launching = undefined
    }
  }

  async newContext(): Promise<BrowserContext> {
    const browser = await this.get()
    return await browser.newContext()
  }

  isRunning(): boolean {
    return this.#browser?.isConnected() === true
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    const launching = this.#launching
    if (launching !== undefined) await launching.catch(() => undefined)
    const browser = this.#browser
    this.#browser = undefined
    if (browser !== undefined) await browser.close()
  }

  async #launch(): Promise<Browser> {
    const { executablePath, headless, launchArgs } = this.#config
    if (!existsSync(executablePath)) {
      throw new Error(`playwright: executablePath does not exist: ${executablePath}`)
    }
    const browser = await chromium.launch({ executablePath, headless, args: [...launchArgs] })
    if (this.#closed) {
      await browser.close()
      throw new Error("The Playwright browser was closed while it was starting")
    }
    browser.on("disconnected", () => {
      if (this.#browser === browser) this.#browser = undefined
    })
    this.#browser = browser
    return browser
  }
}
