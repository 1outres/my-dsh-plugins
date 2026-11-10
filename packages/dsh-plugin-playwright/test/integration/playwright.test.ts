import { createServer as createHttpServer, type Server as HttpServer } from "node:http"
import type { AddressInfo } from "node:net"
import type { Context } from "@deepseek-ai/cordis"
import type { Agent } from "@deepseek-ai/dsh-agent"
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { Config, resolveConfig } from "../../src/config"
import { SharedBrowser } from "../../src/host/browser"
import { loadUpstreamTools, selectTools } from "../../src/host/catalog"
import { SessionRegistry } from "../../src/host/registry"
import { PlaywrightSessionFactory } from "../../src/host/session-factory"
import { registerPlaywrightTools } from "../../src/host/tools"

const chromiumPath = process.env.PLAYWRIGHT_IT_CHROMIUM
const describeIntegration =
  chromiumPath === undefined || chromiumPath === "" ? describe.skip : describe

type ToolContent = ReturnType<ToolDefinition["output"]["render"]>

interface CallResult {
  value: unknown
  content: ToolContent
  text: string
}

describeIntegration("Playwright sessions", () => {
  let http: HttpServer
  let baseUrl: string
  let browser: SharedBrowser
  let sessions: SessionRegistry<import("../../src/host/session").PlaywrightSession>
  const registered = new Map<string, ToolDefinition>()
  const rootA = { id: "integration-a" } as Agent
  const rootB = { id: "integration-b" } as Agent

  beforeAll(async () => {
    http = createHttpServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      if (url.pathname === "/a" || url.pathname === "/b") {
        const cookie = url.searchParams.get("cookie") ?? "none"
        response.setHeader("Set-Cookie", `who=${cookie}; Path=/; SameSite=Lax`)
        response.setHeader("Content-Type", "text/html")
        response.end(`<html><body><h1>page ${url.pathname}</h1></body></html>`)
        return
      }
      response.setHeader("Content-Type", "text/plain")
      response.end("ok")
    })
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve))
    const address = http.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${String(address.port)}`

    const config = resolveConfig(
      Config({ executablePath: chromiumPath ?? "", headless: true, launchArgs: [] }),
    )
    browser = new SharedBrowser(config)
    sessions = new SessionRegistry(new PlaywrightSessionFactory(browser, config.toolCallTimeoutMs))
    const ctx = {
      get: () => undefined,
      logger: { warn: () => {}, error: () => {} },
      tools: {
        register(definition: ToolDefinition) {
          registered.set(definition.name, definition)
          return () => {}
        },
      },
      agents: {
        list: () => [rootA, rootB],
        isOwnedBy: () => false,
      },
    } as unknown as Context
    registerPlaywrightTools(
      ctx,
      sessions,
      selectTools(await loadUpstreamTools()),
      config.maxOutputBytes,
    )
  }, 120_000)

  afterAll(async () => {
    await sessions.disposeAll().catch(() => undefined)
    await browser.close()
    await new Promise<void>((resolve, reject) => {
      http.close((error) => (error === undefined ? resolve() : reject(error)))
    })
  })

  async function call(
    name: string,
    args: Record<string, unknown>,
    agent: Agent,
  ): Promise<CallResult> {
    const definition = registered.get(name)
    if (definition === undefined) throw new Error(`Tool ${name} was not registered`)
    const exec = { agent, signal: new AbortController().signal } as ToolRunContext
    const value = await definition.execute(args, exec)
    const rendered = definition.output.render(args, value as never)
    const content =
      definition.projectContent?.(exec, {
        isError: false,
        value: value as never,
        content: rendered,
      }) ?? rendered
    return {
      value,
      content,
      text: content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n"),
    }
  }

  test("keeps tabs and cookies apart while both sessions work at once", async () => {
    expect(registered.has("browser_navigate")).toBe(true)
    expect(registered.has("browser_close")).toBe(false)
    expect(registered.has("browser_run_code_unsafe")).toBe(false)

    await Promise.all([
      call("browser_navigate", { url: `${baseUrl}/a?cookie=alpha` }, rootA),
      call("browser_navigate", { url: `${baseUrl}/b?cookie=beta` }, rootB),
    ])

    const [tabsA, tabsB, cookieA, cookieB] = await Promise.all([
      call("browser_tabs", { action: "list" }, rootA),
      call("browser_tabs", { action: "list" }, rootB),
      call("browser_evaluate", { function: "() => document.cookie" }, rootA),
      call("browser_evaluate", { function: "() => document.cookie" }, rootB),
    ])

    expect(tabsA.text).toContain("/a?cookie=alpha")
    expect(tabsA.text).not.toContain("/b?cookie=beta")
    expect(tabsB.text).toContain("/b?cookie=beta")
    expect(tabsB.text).not.toContain("/a?cookie=alpha")
    expect(cookieA.text).toContain("who=alpha")
    expect(cookieA.text).not.toContain("who=beta")
    expect(cookieB.text).toContain("who=beta")
    expect(cookieB.text).not.toContain("who=alpha")
    expect(browser.isRunning()).toBe(true)
  }, 120_000)

  test("launches a new browser after the shared one disappears", async () => {
    const shared = await browser.get()
    await shared.close()
    expect(browser.isRunning()).toBe(false)

    const result = await call("browser_navigate", { url: `${baseUrl}/a?cookie=again` }, rootA)
    expect(result.text).toContain("/a?cookie=again")
    expect(browser.isRunning()).toBe(true)

    const cookie = await call("browser_evaluate", { function: "() => document.cookie" }, rootA)
    expect(cookie.text).toContain("who=again")
  }, 120_000)

  test("closes the browser when every session is disposed", async () => {
    await sessions.disposeAll()
    await browser.close()
    expect(browser.isRunning()).toBe(false)
  }, 60_000)
})
