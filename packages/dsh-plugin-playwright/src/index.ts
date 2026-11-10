import type { Context } from "@deepseek-ai/cordis"
import type {} from "@deepseek-ai/dsh-agent"
import type {} from "@deepseek-ai/dsh-session"
import type {} from "@deepseek-ai/dsh-workspace"
import { Config, type Config as PluginConfig, resolveConfig } from "./config"
import { SharedBrowser } from "./host/browser"
import { loadUpstreamTools, selectTools } from "./host/catalog"
import { SessionRegistry } from "./host/registry"
import { PlaywrightSessionFactory } from "./host/session-factory"
import { registerPlaywrightTools } from "./host/tools"

export const name = "playwright"

export const inject = ["tools", "agents"]

export { Config }

export async function apply(ctx: Context, config: PluginConfig): Promise<void> {
  const resolved = resolveConfig(config)
  const browser = new SharedBrowser(resolved)
  const sessions = new SessionRegistry(
    new PlaywrightSessionFactory(browser, resolved.toolCallTimeoutMs),
  )
  const tools = selectTools(await loadUpstreamTools())
  registerPlaywrightTools(ctx, sessions, tools, resolved.maxOutputBytes)

  const dispose = (sessionId: string): void => {
    void sessions.disposeSession(sessionId).catch((error: unknown) => {
      ctx.logger.warn(
        `playwright: could not dispose the browser of session ${sessionId}: ${String(error)}`,
      )
    })
  }
  ctx.on("session/disposed", (session) => {
    dispose(session.id)
  })
  ctx.on("workspace/session-stop", ({ sessionId }) => {
    dispose(sessionId)
  })

  ctx.effect(
    () => async () => {
      try {
        await sessions.disposeAll()
      } finally {
        await browser.close()
      }
    },
    "playwright: browser sessions",
  )
}
